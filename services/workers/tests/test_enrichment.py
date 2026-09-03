from unittest.mock import MagicMock

import anthropic
import pytest

from src.enrichment import EXTRACTOR_VERSION, FilmEnrichmentWorker, FilmFingerprintV1

FINGERPRINT_KWARGS = dict(
    pacing=0.5,
    rhythmVariance=0.5,
    ambiguity=0.5,
    psychologicalDepth=0.5,
    warmth=0.5,
    darkness=0.5,
    linearity=0.5,
    dialogueDensity=0.5,
    actionIntensity=0.5,
    plotComplexity=0.5,
    visualComplexity=0.5,
    soundscapeComplexity=0.5,
    colorSaturation=0.5,
)


def _parsed_response(fingerprint, served_model="claude-test-served"):
    """Shape of anthropic's ParsedMessage as this worker reads it."""
    return MagicMock(parsed_output=fingerprint, stop_reason="end_turn", stop_details=None, model=served_model)


def _text_response(text):
    return MagicMock(content=[MagicMock(type="text", text=text)], stop_reason="end_turn", stop_details=None)


@pytest.fixture
def worker():
    # Explicit override so tests never depend on ANTHROPIC_FINGERPRINT_MODEL /
    # ANTHROPIC_EXPLANATION_MODEL being set in the environment.
    worker = FilmEnrichmentWorker(model="claude-test")
    # The real client (H3) is built lazily on first use, so tests never need
    # ANTHROPIC_API_KEY set either -- pre-seed a mock in its place.
    worker._client = MagicMock()
    return worker


class TestGenerateFingerprint:
    def test_returns_the_parsed_fingerprint_on_success(self, worker):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(fake_fingerprint))

        result = worker.generate_fingerprint("Arrival", "desc", "plot")

        assert isinstance(result, FilmFingerprintV1)
        assert result.pacing == 0.5

    def test_uses_structured_output_with_the_schema_and_the_configured_model(self, worker):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(fake_fingerprint))

        worker.generate_fingerprint("Arrival", "desc", "plot", additional_context="Year: 2016")

        call = worker._client.messages.parse.call_args
        assert call.kwargs["model"] == "claude-test"
        assert call.kwargs["output_format"] is FilmFingerprintV1
        prompt = call.kwargs["messages"][0]["content"]
        assert "Arrival" in prompt and "plot" in prompt and "Year: 2016" in prompt
        assert "film analyst" in call.kwargs["system"].lower()

    def test_stamps_provenance_the_model_could_not_know_about_itself(self, worker):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(fake_fingerprint))

        result = worker.generate_fingerprint("Arrival", "desc", "plot", source_ids=["sr-1"])

        assert result.generatedBy == "anthropic"
        # The id the API served, not the alias we asked for.
        assert result.modelVersion == "claude-test-served"
        assert result.extractorVersion == EXTRACTOR_VERSION == "enrichment-worker-v2"
        assert result.sourceIds == ["sr-1"]
        # Neither knowable at this layer yet (no source_records/review queue) --
        # honest "unknown", never a fabricated claim (FINGERPRINT_SCHEMA.md §8).
        assert result.licenseStatus == "unknown"
        assert result.reviewStatus == "unreviewed"
        assert result.generatedAt is not None

    def test_falls_back_to_the_requested_model_id_when_the_response_has_none(self, worker):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(fake_fingerprint, served_model=None))

        result = worker.generate_fingerprint("Arrival", "desc", "plot")

        assert result.modelVersion == "claude-test"

    def test_raises_a_clear_error_when_the_model_refuses(self, worker):
        response = MagicMock(
            parsed_output=None,
            stop_reason="refusal",
            stop_details=MagicMock(explanation="policy violation", category="other"),
        )
        worker._client.messages.parse = MagicMock(return_value=response)

        with pytest.raises(ValueError, match="policy violation"):
            worker.generate_fingerprint("Arrival", "desc", "plot")

    def test_raises_when_the_output_hits_the_token_ceiling(self, worker):
        response = MagicMock(parsed_output=None, stop_reason="max_tokens", stop_details=None)
        worker._client.messages.parse = MagicMock(return_value=response)

        with pytest.raises(ValueError, match="token ceiling"):
            worker.generate_fingerprint("Arrival", "desc", "plot")

    def test_wraps_anthropic_api_errors_in_a_value_error(self, worker):
        worker._client.messages.parse = MagicMock(side_effect=anthropic.APIConnectionError(request=MagicMock()))

        with pytest.raises(ValueError):
            worker.generate_fingerprint("Arrival", "desc", "plot")

    def test_sends_the_workspace_header_only_when_a_workspace_id_is_configured(self, monkeypatch):
        import src.enrichment as enrichment_module

        constructed = []
        monkeypatch.setattr(enrichment_module.anthropic, "Anthropic", lambda **kwargs: constructed.append(kwargs) or MagicMock())

        monkeypatch.delenv("ANTHROPIC_WORKSPACE_ID", raising=False)
        FilmEnrichmentWorker(model="claude-test")._get_client()
        monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "wrkspc_test")
        FilmEnrichmentWorker(model="claude-test")._get_client()

        assert constructed[0] == {"default_headers": None}
        assert constructed[1] == {"default_headers": {"anthropic-workspace-id": "wrkspc_test"}}

    def test_requires_a_configured_model_when_no_override_is_given(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_FINGERPRINT_MODEL", raising=False)
        unconfigured_worker = FilmEnrichmentWorker()

        with pytest.raises(RuntimeError, match="ANTHROPIC_FINGERPRINT_MODEL"):
            unconfigured_worker.generate_fingerprint("Arrival", "desc", "plot")


class TestGenerateRecommendationExplanation:
    def test_returns_the_model_generated_text(self, worker):
        worker._client.messages.create = MagicMock(return_value=_text_response("A slow, warm character study."))

        text = worker.generate_recommendation_explanation("Arrival", {"pacing": 0.1, "warmth": 0.9})

        assert text == "A slow, warm character study."

    # M12: user_preferences/similar_titles were removed from the signature
    # entirely, not merely left unused, so a caller cannot pass user data
    # back in by mistake -- the old calling convention must now fail loudly.
    def test_no_longer_accepts_the_old_user_data_arguments(self, worker):
        with pytest.raises(TypeError):
            worker.generate_recommendation_explanation(
                {"pacing": 0.8}, "Arrival", {"pacing": 0.9, "warmth": 0.2}, ["Interstellar"]
            )

    def test_prompt_is_built_only_from_film_evidence(self, worker):
        worker._client.messages.create = MagicMock(return_value=_text_response("ok"))

        worker.generate_recommendation_explanation(
            "Arrival",
            {"pacing": 0.1, "warmth": 0.9, "ambiguity": 0.05, "plotComplexity": 0.95, "darkness": 0.5},
            themes=["identity", "isolation"],
        )

        call = worker._client.messages.create.call_args
        prompt = call.kwargs["messages"][0]["content"]
        assert "Arrival" in prompt
        assert "pacing" in prompt and "warmth" in prompt and "ambiguity" in prompt and "plotComplexity" in prompt
        assert "identity" in prompt and "isolation" in prompt
        # darkness (0.5) is the neutral midpoint -- the least informative
        # value about the film, and the 5th of 5 by distance from it -- so
        # it's correctly the one dropped by the top-4 cutoff.
        assert "darkness" not in prompt
        instructions = call.kwargs["system"].lower()
        assert "viewer" in instructions and "preference" in instructions

    def test_raises_a_clear_error_when_the_model_refuses(self, worker):
        response = MagicMock(content=[], stop_reason="refusal", stop_details=MagicMock(explanation=None, category="other"))
        worker._client.messages.create = MagicMock(return_value=response)

        with pytest.raises(ValueError, match="refused"):
            worker.generate_recommendation_explanation("Arrival", {"pacing": 0.1})

    def test_wraps_anthropic_api_errors_in_a_value_error(self, worker):
        worker._client.messages.create = MagicMock(side_effect=anthropic.APIConnectionError(request=MagicMock()))

        with pytest.raises(ValueError):
            worker.generate_recommendation_explanation("Arrival", {})
