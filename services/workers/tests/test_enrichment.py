from unittest.mock import MagicMock

import anthropic
import pytest

from src.enrichment import (
    EXTRACTOR_VERSION,
    FilmEnrichmentWorker,
    FilmFingerprintV1,
    FingerprintConfidence,
    FingerprintOutput,
)

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


def _model_output(**overrides):
    """What the model returns: dimensions + themes + a complete confidence object."""
    return FingerprintOutput(
        **FINGERPRINT_KWARGS,
        themes=["identity"],
        confidence=FingerprintConfidence(**{key: 0.7 for key in FINGERPRINT_KWARGS}),
        **overrides,
    )


def _usage(input_tokens=1200, output_tokens=300):
    return MagicMock(input_tokens=input_tokens, output_tokens=output_tokens, cache_creation_input_tokens=0, cache_read_input_tokens=0)


def _parsed_response(output, served_model="claude-test-served"):
    """Shape of anthropic's ParsedMessage as this worker reads it."""
    return MagicMock(parsed_output=output, stop_reason="end_turn", stop_details=None, model=served_model, usage=_usage())


def _text_response(text):
    return MagicMock(content=[MagicMock(type="text", text=text)], stop_reason="end_turn", stop_details=None, model="claude-test-served", usage=_usage(80, 40))


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
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(_model_output()))

        result = worker.generate_fingerprint("Arrival", "desc", "plot")

        assert isinstance(result, FilmFingerprintV1)
        assert result.pacing == 0.5
        assert result.themes == ["identity"]

    def test_confidence_is_published_as_a_complete_per_dimension_map(self, worker):
        # The output schema names all thirteen confidence fields (a free-form
        # map came back empty on the first real run); the published
        # FilmFingerprintV1 keeps its map shape so the three copies stay equal.
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(_model_output()))

        result = worker.generate_fingerprint("Arrival", "desc", "plot")

        assert set(result.confidence) == set(FINGERPRINT_KWARGS)
        assert all(value == 0.7 for value in result.confidence.values())
        assert FingerprintOutput.model_json_schema()["properties"]["confidence"]["$ref"].endswith("FingerprintConfidence")
        assert set(FingerprintConfidence.model_json_schema()["required"]) == set(FINGERPRINT_KWARGS)

    def test_uses_structured_output_with_the_schema_and_the_configured_model(self, worker):
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(_model_output()))

        worker.generate_fingerprint("Arrival", "desc", "plot", additional_context="Year: 2016")

        call = worker._client.messages.parse.call_args
        assert call.kwargs["model"] == "claude-test"
        assert call.kwargs["output_format"] is FingerprintOutput
        prompt = call.kwargs["messages"][0]["content"]
        assert "Arrival" in prompt and "plot" in prompt and "Year: 2016" in prompt
        assert "film analyst" in call.kwargs["system"].lower()

    def test_stamps_provenance_the_model_could_not_know_about_itself(self, worker):
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(_model_output()))

        result = worker.generate_fingerprint("Arrival", "desc", "plot", source_ids=["sr-1"])

        assert result.generatedBy == "anthropic"
        # The id the API served, not the alias we asked for.
        assert result.modelVersion == "claude-test-served"
        assert result.extractorVersion == EXTRACTOR_VERSION == "enrichment-worker-v2-linearity-fix"
        assert result.sourceIds == ["sr-1"]
        # Neither knowable at this layer yet (no source_records/review queue) --
        # honest "unknown", never a fabricated claim (FINGERPRINT_SCHEMA.md §8).
        assert result.licenseStatus == "unknown"
        assert result.reviewStatus == "unreviewed"
        assert result.generatedAt is not None

    def test_falls_back_to_the_requested_model_id_when_the_response_has_none(self, worker):
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(_model_output(), served_model=None))

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

        assert constructed[0] == {"default_headers": None, "max_retries": 6}
        assert constructed[1] == {"default_headers": {"anthropic-workspace-id": "wrkspc_test"}, "max_retries": 6}

    def test_requires_a_configured_model_when_no_override_is_given(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_FINGERPRINT_MODEL", raising=False)
        unconfigured_worker = FilmEnrichmentWorker()

        with pytest.raises(RuntimeError, match="ANTHROPIC_FINGERPRINT_MODEL"):
            unconfigured_worker.generate_fingerprint("Arrival", "desc", "plot")


class TestGenerateFingerprintV2:
    def _output(self, themes):
        from src.enrichment import FingerprintV2Confidence, FingerprintV2Features, FingerprintV2Output

        values = {name: 0.6 for name in FingerprintV2Features.model_fields}
        return FingerprintV2Output(
            features=FingerprintV2Features(**values),
            themes=themes,
            confidence=FingerprintV2Confidence(**{name: 0.4 for name in values}),
        )

    def test_publishes_namespaced_keys_with_confidence_and_provenance(self, worker):
        from src.enrichment import V2_EXTRACTOR_VERSION, V2_FEATURES

        worker._client.messages.parse = MagicMock(return_value=_parsed_response(self._output(["identity", "memory"])))

        block = worker.generate_fingerprint_v2("Arrival", "desc", "plot", additional_context="Year: 2016", source_ids=["sr-1"])

        assert set(block["features"]) == set(V2_FEATURES) and len(V2_FEATURES) == 15
        assert all(key.count(".") == 1 for key in block["features"])
        assert block["features"]["tone.irony"] == 0.6 and block["confidence"]["tone.irony"] == 0.4
        assert block["themes"] == ["identity", "memory"]
        assert block["schemaVersion"] == "film-fingerprint-v2"
        assert block["extractorVersion"] == V2_EXTRACTOR_VERSION
        assert block["modelVersion"] == "claude-test-served" and block["generatedBy"] == "anthropic"
        assert block["sourceIds"] == ["sr-1"] and block["licenseStatus"] == "unknown" and block["reviewStatus"] == "unreviewed"
        call = worker._client.messages.parse.call_args
        assert "Plot Summary: plot" in call.kwargs["messages"][0]["content"]
        assert "compassionate" in call.kwargs["system"]

    def test_drops_themes_outside_the_vocabulary_and_caps_at_three(self, worker):
        worker._client.messages.parse = MagicMock(
            return_value=_parsed_response(self._output(["love", "not-a-theme", "grief", "war", "faith"]))
        )

        block = worker.generate_fingerprint_v2("Arrival", "desc", "plot")

        assert block["themes"] == ["love", "grief", "war"]

    def test_raises_on_refusal(self, worker):
        response = MagicMock(parsed_output=None, stop_reason="refusal", stop_details=MagicMock(explanation="nope", category="other"))
        worker._client.messages.parse = MagicMock(return_value=response)

        with pytest.raises(ValueError, match="nope"):
            worker.generate_fingerprint_v2("Arrival", "desc", "plot")


class TestGenerateFingerprintV3:
    def _output(self):
        from src.enrichment import FingerprintV3Confidence, FingerprintV3Features, FingerprintV3Output

        values = {name: 0.3 for name in FingerprintV3Features.model_fields}
        return FingerprintV3Output(features=FingerprintV3Features(**values), confidence=FingerprintV3Confidence(**{name: 0.2 for name in values}))

    def test_publishes_the_twelve_form_keys_with_confidence_and_provenance(self, worker):
        from src.enrichment import V2_FEATURES, V3_EXTRACTOR_VERSION, V3_FEATURES

        worker._client.messages.parse = MagicMock(return_value=_parsed_response(self._output()))

        block = worker.generate_fingerprint_v3("Arrival", "desc", "plot", additional_context="Year: 2016", source_ids=["sr-1"])

        assert set(block["features"]) == set(V3_FEATURES) and len(V3_FEATURES) == 12
        assert all(key.count(".") == 1 for key in block["features"])
        assert not set(V3_FEATURES) & set(V2_FEATURES)  # a key belongs to exactly one block
        assert block["features"]["style.scale"] == 0.3 and block["confidence"]["style.scale"] == 0.2
        assert "themes" not in block  # themes are published once, in the V2 block
        assert block["schemaVersion"] == "film-fingerprint-v3"
        assert block["extractorVersion"] == V3_EXTRACTOR_VERSION
        assert block["modelVersion"] == "claude-test-served" and block["generatedBy"] == "anthropic"
        assert block["sourceIds"] == ["sr-1"] and block["licenseStatus"] == "unknown" and block["reviewStatus"] == "unreviewed"
        call = worker._client.messages.parse.call_args
        assert "Plot Summary: plot" in call.kwargs["messages"][0]["content"]
        assert "never a political or moral stance" in call.kwargs["system"]

    def test_raises_on_refusal(self, worker):
        response = MagicMock(parsed_output=None, stop_reason="refusal", stop_details=MagicMock(explanation="nope", category="other"))
        worker._client.messages.parse = MagicMock(return_value=response)

        with pytest.raises(ValueError, match="nope"):
            worker.generate_fingerprint_v3("Arrival", "desc", "plot")


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


class TestCallAccounting:
    """Board request G7: tokens, models, latency and status per model call; cost only with prices."""

    def _v2_output(self):
        from src.enrichment import FingerprintV2Confidence, FingerprintV2Features, FingerprintV2Output

        values = {name: 0.6 for name in FingerprintV2Features.model_fields}
        return FingerprintV2Output(features=FingerprintV2Features(**values), themes=[], confidence=FingerprintV2Confidence(**{name: 0.4 for name in values}))

    def test_records_usage_models_latency_status_and_writes_one_json_line(self, worker, tmp_path, monkeypatch):
        import json

        from src.enrichment import V2_EXTRACTOR_VERSION

        monkeypatch.setenv("LLM_CALL_LOG_DIR", str(tmp_path))
        monkeypatch.delenv("LLM_PRICES_JSON", raising=False)
        worker.run_id = "run-test"
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(self._v2_output()))

        worker.generate_fingerprint_v2("Arrival", "desc", "a secret plot", internal_id="DEMO0001")

        record = worker.calls[-1]
        assert record["purpose"] == "fingerprint_v2" and record["provider"] == "anthropic"
        assert record["modelRequested"] == "claude-test" and record["modelServed"] == "claude-test-served"
        assert (record["inputTokens"], record["outputTokens"], record["cacheCreationInputTokens"], record["cacheReadInputTokens"]) == (1200, 300, 0, 0)
        assert record["status"] == "ok" and record["error"] is None and record["latencyMs"] >= 0
        assert record["internalId"] == "DEMO0001" and record["extractorVersion"] == V2_EXTRACTOR_VERSION and record["runId"] == "run-test"
        assert record["costUsd"] is None  # no LLM_PRICES_JSON: derived later, never a stored fact
        lines = (tmp_path / "run-test.jsonl").read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1 and json.loads(lines[0])["purpose"] == "fingerprint_v2"
        assert "secret plot" not in lines[0]  # never any prompt or evidence text

    def test_error_refusal_and_explanation_lines(self, worker, tmp_path, monkeypatch):
        import anthropic

        monkeypatch.setenv("LLM_CALL_LOG_DIR", str(tmp_path))
        worker._client.messages.parse = MagicMock(side_effect=anthropic.APIConnectionError(request=MagicMock()))
        with pytest.raises(ValueError):
            worker.generate_fingerprint("Arrival", "desc", "plot", internal_id="DEMO0002")
        assert worker.calls[-1]["status"] == "error" and worker.calls[-1]["error"] == "APIConnectionError"
        assert worker.calls[-1]["purpose"] == "fingerprint_v1" and worker.calls[-1]["inputTokens"] == 0

        refusal = MagicMock(parsed_output=None, stop_reason="refusal", stop_details=MagicMock(explanation="nope", category="other"), model="m", usage=_usage(10, 0))
        worker._client.messages.parse = MagicMock(return_value=refusal)
        with pytest.raises(ValueError):
            worker.generate_fingerprint_v3("Arrival", "desc", "plot")
        assert worker.calls[-1]["status"] == "refused" and worker.calls[-1]["purpose"] == "fingerprint_v3" and worker.calls[-1]["internalId"] is None

        worker._client.messages.create = MagicMock(return_value=_text_response("A slow, warm film."))
        worker.generate_recommendation_explanation("Arrival", {"pacing": 0.2}, internal_id="DEMO0003")
        assert worker.calls[-1]["purpose"] == "explanation" and worker.calls[-1]["status"] == "ok" and worker.calls[-1]["outputTokens"] == 40
        assert len((tmp_path / f"{worker.run_id}.jsonl").read_text(encoding="utf-8").splitlines()) == 3

    def test_cost_only_with_prices_and_the_summary_table(self, worker, tmp_path, monkeypatch):
        import json

        from src.enrichment import estimate_cost_usd, format_calls_table, summarize_calls

        monkeypatch.setenv("LLM_CALL_LOG_DIR", str(tmp_path))
        monkeypatch.setenv("LLM_PRICES_JSON", json.dumps({"claude-test-served": {"inputPerMTok": 3.0, "outputPerMTok": 15.0}}))
        worker._client.messages.parse = MagicMock(return_value=_parsed_response(self._v2_output()))
        worker.generate_fingerprint_v2("Arrival", "desc", "plot", internal_id="DEMO0001")
        worker.generate_fingerprint_v2("Persona", "desc", "plot", internal_id="DEMO0002")
        assert worker.calls[-1]["costUsd"] == pytest.approx(1200 / 1e6 * 3.0 + 300 / 1e6 * 15.0)
        assert estimate_cost_usd("unknown-model", 100, 100, {"claude-test-served": {"inputPerMTok": 3.0, "outputPerMTok": 15.0}}) is None

        rows = summarize_calls(worker.calls)
        assert rows == [
            {
                "purpose": "fingerprint_v2",
                "modelServed": "claude-test-served",
                "calls": 2,
                "ok": 2,
                "inputTokens": 2400,
                "outputTokens": 600,
                "titles": 2,
                "meanInputPerTitle": 1200,
                "meanOutputPerTitle": 300,
                "meanLatencyMs": rows[0]["meanLatencyMs"],
                "costUsd": pytest.approx(2 * (1200 / 1e6 * 3.0 + 300 / 1e6 * 15.0)),
            }
        ]
        table = format_calls_table(worker.calls, "run-x")
        assert "## Model calls (run `run-x`)" in table and "| fingerprint_v2 | claude-test-served | 2 | 2 | 2400 | 600 | 2 | 1200 | 300 |" in table
        assert "No model calls were recorded" in format_calls_table([], None)

        monkeypatch.setenv("LLM_PRICES_JSON", "not json")
        worker.generate_fingerprint_v2("Third", "desc", "plot", internal_id="DEMO0003")
        assert worker.calls[-1]["costUsd"] is None
        assert summarize_calls(worker.calls)[0]["costUsd"] is None  # one call without a price: the sum is unknown, not partial
