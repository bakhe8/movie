from unittest.mock import MagicMock

import openai
import pytest

from src.enrichment import FilmEnrichmentWorker, FilmFingerprintV1

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


@pytest.fixture
def worker():
    # Explicit override so tests never depend on OPENAI_FINGERPRINT_MODEL /
    # OPENAI_EXPLANATION_MODEL being set in the environment.
    worker = FilmEnrichmentWorker(model="gpt-test")
    # The real client (H3) is built lazily on first use, so tests never need
    # OPENAI_API_KEY set either -- pre-seed a mock in its place.
    worker._client = MagicMock()
    return worker


class TestGenerateFingerprint:
    def test_returns_the_parsed_fingerprint_on_success(self, worker):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        response = MagicMock(output_parsed=fake_fingerprint)
        worker._client.responses.parse = MagicMock(return_value=response)

        result = worker.generate_fingerprint("Arrival", "desc", "plot")

        assert isinstance(result, FilmFingerprintV1)
        assert result.pacing == 0.5

    def test_stamps_provenance_the_model_could_not_know_about_itself(self, worker):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        response = MagicMock(output_parsed=fake_fingerprint)
        worker._client.responses.parse = MagicMock(return_value=response)

        result = worker.generate_fingerprint("Arrival", "desc", "plot", source_ids=["sr-1"])

        assert result.generatedBy == "openai"
        assert result.modelVersion == "gpt-test"
        assert result.extractorVersion == "enrichment-worker-v1"
        assert result.sourceIds == ["sr-1"]
        # Neither knowable at this layer yet (no source_records/review queue) --
        # honest "unknown", never a fabricated claim (FINGERPRINT_SCHEMA.md §8).
        assert result.licenseStatus == "unknown"
        assert result.reviewStatus == "unreviewed"
        assert result.generatedAt is not None

    def test_raises_a_clear_error_when_the_model_refuses(self, worker):
        response = MagicMock(
            output_parsed=None,
            output=[MagicMock(type="message", content=[MagicMock(type="refusal", refusal="policy violation")])],
        )
        worker._client.responses.parse = MagicMock(return_value=response)

        with pytest.raises(ValueError, match="policy violation"):
            worker.generate_fingerprint("Arrival", "desc", "plot")

    def test_wraps_openai_api_errors_in_a_value_error(self, worker):
        worker._client.responses.parse = MagicMock(
            side_effect=openai.APIConnectionError(request=MagicMock())
        )

        with pytest.raises(ValueError):
            worker.generate_fingerprint("Arrival", "desc", "plot")

    def test_requires_a_configured_model_when_no_override_is_given(self, monkeypatch):
        monkeypatch.delenv("OPENAI_FINGERPRINT_MODEL", raising=False)
        unconfigured_worker = FilmEnrichmentWorker()

        with pytest.raises(RuntimeError, match="OPENAI_FINGERPRINT_MODEL"):
            unconfigured_worker.generate_fingerprint("Arrival", "desc", "plot")


class TestGenerateRecommendationExplanation:
    def test_returns_the_model_generated_text(self, worker):
        response = MagicMock(output_text="Because it's moody and slow.")
        worker._client.responses.create = MagicMock(return_value=response)

        text = worker.generate_recommendation_explanation(
            {"pacing": 0.8}, "Arrival", {"pacing": 0.9, "warmth": 0.2}, ["Interstellar"]
        )

        assert text == "Because it's moody and slow."

    def test_wraps_openai_api_errors_in_a_value_error(self, worker):
        worker._client.responses.create = MagicMock(
            side_effect=openai.APIConnectionError(request=MagicMock())
        )

        with pytest.raises(ValueError):
            worker.generate_recommendation_explanation({}, "Arrival", {}, [])
