from unittest.mock import MagicMock

import openai
import pytest

from src.enrichment import FilmEnrichmentWorker, FilmFingerprintV1, openai_client

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
    return FilmEnrichmentWorker()


class TestGenerateFingerprint:
    def test_returns_the_parsed_fingerprint_on_success(self, worker, monkeypatch):
        fake_fingerprint = FilmFingerprintV1(**FINGERPRINT_KWARGS)
        completion = MagicMock(choices=[MagicMock(message=MagicMock(parsed=fake_fingerprint, refusal=None))])
        monkeypatch.setattr(
            openai_client.beta.chat.completions, "parse", MagicMock(return_value=completion)
        )

        result = worker.generate_fingerprint("Arrival", "desc", "plot")

        assert isinstance(result, FilmFingerprintV1)
        assert result.pacing == 0.5

    def test_raises_a_clear_error_when_the_model_refuses(self, worker, monkeypatch):
        completion = MagicMock(
            choices=[MagicMock(message=MagicMock(parsed=None, refusal="policy violation"))]
        )
        monkeypatch.setattr(
            openai_client.beta.chat.completions, "parse", MagicMock(return_value=completion)
        )

        with pytest.raises(ValueError, match="policy violation"):
            worker.generate_fingerprint("Arrival", "desc", "plot")

    def test_wraps_openai_api_errors_in_a_value_error(self, worker, monkeypatch):
        monkeypatch.setattr(
            openai_client.beta.chat.completions,
            "parse",
            MagicMock(side_effect=openai.APIConnectionError(request=MagicMock())),
        )

        with pytest.raises(ValueError):
            worker.generate_fingerprint("Arrival", "desc", "plot")


class TestGenerateRecommendationExplanation:
    def test_returns_the_model_generated_text(self, worker, monkeypatch):
        response = MagicMock(choices=[MagicMock(message=MagicMock(content="Because it's moody and slow."))])
        monkeypatch.setattr(openai_client.chat.completions, "create", MagicMock(return_value=response))

        text = worker.generate_recommendation_explanation(
            {"pacing": 0.8}, "Arrival", {"pacing": 0.9, "warmth": 0.2}, ["Interstellar"]
        )

        assert text == "Because it's moody and slow."

    def test_wraps_openai_api_errors_in_a_value_error(self, worker, monkeypatch):
        monkeypatch.setattr(
            openai_client.chat.completions,
            "create",
            MagicMock(side_effect=openai.APIConnectionError(request=MagicMock())),
        )

        with pytest.raises(ValueError):
            worker.generate_recommendation_explanation({}, "Arrival", {}, [])
