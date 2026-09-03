"""
Film fingerprinting worker using the OpenAI Responses API.

This module generates film fingerprints using OpenAI's language models
with structured outputs (Pydantic schema enforcement). See
docs/FINGERPRINT_SCHEMA.md §5 and docs/ARCHITECTURE_DECISIONS.md ADR-6/23
for the rules this pipeline must follow.
"""

import os
from datetime import datetime, timezone
from typing import Dict, Optional

import openai
from pydantic import BaseModel, Field

# Bump whenever this pipeline's prompt or evidence shape changes -- a
# published fingerprint is re-extracted only on a schema/model/extractor
# version change, never ad hoc (FINGERPRINT_SCHEMA.md §5).
EXTRACTOR_VERSION = "enrichment-worker-v1"


class FilmFingerprintV1(BaseModel):
    """Structured output schema for film fingerprints."""

    schemaVersion: str = Field("film-fingerprint-v1", description="Schema version identifier")

    # Tempo and rhythm
    pacing: float = Field(..., description="Pacing score 0-1 (slow to fast)")
    rhythmVariance: float = Field(..., description="Rhythm variance 0-1 (consistent to varied)")

    # Emotional/thematic
    ambiguity: float = Field(..., description="Ambiguity 0-1 (clear to ambiguous)")
    psychologicalDepth: float = Field(..., description="Psychological depth 0-1")
    warmth: float = Field(..., description="Emotional warmth 0-1 (cold to warm)")
    darkness: float = Field(..., description="Darkness 0-1 (light to dark)")

    # Narrative
    linearity: float = Field(..., description="Narrative linearity 0-1 (linear to fragmented)")
    dialogueDensity: float = Field(..., description="Dialogue density 0-1")
    actionIntensity: float = Field(..., description="Action intensity 0-1")
    plotComplexity: float = Field(..., description="Plot complexity 0-1")

    # Aesthetic
    visualComplexity: float = Field(..., description="Visual complexity 0-1")
    soundscapeComplexity: float = Field(..., description="Soundscape complexity 0-1")
    colorSaturation: float = Field(..., description="Color saturation 0-1")

    # Themes
    themes: list[str] = Field(default_factory=list, description="Primary themes identified")

    # Confidence scores
    confidence: Dict[str, float] = Field(default_factory=dict, description="Confidence per dimension")

    # Provenance -- who/what produced this fingerprint and whether it may be
    # used commercially. Stamped by generate_fingerprint() after the model
    # call, never requested from the model itself: it has no way to know its
    # own model id, the current time, or this pipeline's licensing status.
    # Mirrors packages/shared/src/types.ts's FilmFingerprintV1
    # (FINGERPRINT_SCHEMA.md §2; keep all three copies in sync by hand).
    generatedBy: Optional[str] = None
    generatedAt: Optional[datetime] = None
    modelVersion: Optional[str] = None
    sourceIds: Optional[list[str]] = None
    extractorVersion: Optional[str] = None
    # 'unknown' until the caller's input evidence is verified rights-clear
    # against a source_records row -- this worker never asserts
    # 'commercial_allowed' about its own output (DATA_LICENSING.md §1:
    # access is not a license).
    licenseStatus: Optional[str] = None
    # 'unreviewed' until a human review queue exists (FINGERPRINT_SCHEMA.md §8).
    reviewStatus: Optional[str] = None


def _refusal_text(response) -> Optional[str]:
    """Pull the model's refusal message out of a Responses API result, if any."""
    for item in getattr(response, "output", []) or []:
        if getattr(item, "type", None) != "message":
            continue
        for content in getattr(item, "content", []) or []:
            if getattr(content, "type", None) == "refusal":
                return content.refusal
    return None


class FilmEnrichmentWorker:
    """Worker for generating film fingerprints using OpenAI."""

    def __init__(self, model: Optional[str] = None):
        """
        Args:
            model: overrides the configured model for every call this worker
                instance makes (tests, one-off scripts). Leave unset in
                production so each task reads its own configured model
                (`OPENAI_FINGERPRINT_MODEL` / `OPENAI_EXPLANATION_MODEL`,
                ADR-6) -- the model id is never a hard-coded default, since
                model choice is a deployment decision, not a code constant.
        """
        self._model_override = model
        self._client: Optional[openai.OpenAI] = None

    def _get_client(self) -> openai.OpenAI:
        # Built on first real use, not at import time or construction time
        # (H3): a module-level client made `import src.enrichment` --
        # transitively, `python -m src.training`, which never talks to
        # OpenAI -- fail on any machine without OPENAI_API_KEY set.
        if self._client is None:
            self._client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        return self._client

    def _resolve_model(self, env_var: str) -> str:
        if self._model_override:
            return self._model_override
        model = os.environ.get(env_var)
        if not model:
            raise RuntimeError(
                f"{env_var} environment variable is required (no model override was passed to FilmEnrichmentWorker)."
            )
        return model

    def generate_fingerprint(
        self,
        title: str,
        description: str,
        plot_summary: str,
        additional_context: Optional[str] = None,
        source_ids: Optional[list[str]] = None,
    ) -> FilmFingerprintV1:
        """
        Generate a film fingerprint using OpenAI structured outputs.

        Args:
            title: Film title
            description: Short film description
            plot_summary: Detailed plot summary
            additional_context: Optional additional context (cast, director, etc.)
            source_ids: `source_records` row ids backing the evidence above, if
                any exist yet (FINGERPRINT_SCHEMA.md §2 `sourceIds`) -- stamped
                onto the result as-is, never invented.

        Returns:
            FilmFingerprintV1 object with computed fingerprint

        Raises:
            ValueError: If the API call fails or returns no parsed fingerprint
        """
        model = self._resolve_model("OPENAI_FINGERPRINT_MODEL")

        context = f"Title: {title}\n"
        context += f"Description: {description}\n"
        context += f"Plot Summary: {plot_summary}\n"
        if additional_context:
            context += f"Additional Context: {additional_context}\n"

        instructions = """You are an expert film analyst specializing in semantic film analysis.

Analyze the given film and generate a detailed fingerprint across multiple dimensions.
Score each dimension on a 0-1 scale with high confidence scores only where you have clear evidence from the plot/description.
Focus on objective aspects that can be inferred from the plot, themes, and narrative structure."""

        input_text = f"""Analyze this film and provide its fingerprint:

{context}

Provide scores for all dimensions. For dimensions you're less confident about, provide lower confidence scores."""

        try:
            response = self._get_client().responses.parse(
                model=model,
                instructions=instructions,
                input=input_text,
                max_output_tokens=1024,
                text_format=FilmFingerprintV1,
                # Never retain film-evidence prompts/outputs on OpenAI's side
                # (blueprint §15.2, ADR-6/23; no user data is sent here either way).
                store=False,
            )
        except openai.OpenAIError as error:
            raise ValueError(f"OpenAI fingerprint request failed: {error}") from error

        parsed = response.output_parsed
        if parsed is None:
            refusal = _refusal_text(response)
            raise ValueError(f"OpenAI did not return a parsed fingerprint: {refusal or 'unknown reason'}")

        parsed.generatedBy = "openai"
        parsed.generatedAt = datetime.now(timezone.utc)
        parsed.modelVersion = model
        parsed.extractorVersion = EXTRACTOR_VERSION
        parsed.sourceIds = source_ids
        parsed.licenseStatus = "unknown"
        parsed.reviewStatus = "unreviewed"

        return parsed

    def generate_recommendation_explanation(
        self,
        title: str,
        fingerprint: Dict[str, float],
        themes: Optional[list[str]] = None,
    ) -> str:
        """
        Generate a spoiler-free, evidence-only description of a film's tone
        and character from its own fingerprint.

        M12: this used to also take the user's learned preference weights
        and their previously-watched titles, and put both into the prompt --
        exactly what ADR-23 and PRIVACY.md §6.1 forbid ("prompts contain
        licensed evidence and schema only -- never user ids, rankings,
        preferences or account data") and BP §15.2 rules out ("لا يستنتج
        سمات حساسة عن المستخدم من سجل المشاهدة"). Those parameters are
        removed entirely, not merely unused, so a future caller cannot pass
        user data back in by mistake. What personalizes a recommendation
        (which dimensions drove the score, and in which direction) already
        exists as RecommendationsService's own RecommendationReason -- computed
        and rendered entirely on the backend/client, never sent to OpenAI or
        any other third party. This function only ever describes the film
        itself, for any viewer, from evidence the caller supplies.

        Args:
            title: Film title
            fingerprint: Film's fingerprint (dimension -> 0-1 score)
            themes: Primary themes identified for the film, if any

        Returns:
            Natural language, spoiler-free description of the film's traits

        Raises:
            ValueError: If the API call fails or returns no text
        """
        model = self._resolve_model("OPENAI_EXPLANATION_MODEL")

        dimensions = {k: v for k, v in fingerprint.items() if isinstance(v, (int, float))}
        # The film's own most distinctive traits -- farthest from the 0.5
        # midpoint -- are the most informative evidence about what it is
        # actually like, independent of any specific viewer.
        notable = sorted(dimensions.items(), key=lambda item: abs(item[1] - 0.5), reverse=True)[:4]
        evidence_lines = "\n".join(f"- {dim}: {value:.2f}" for dim, value in notable)
        themes_line = f"\nThemes: {', '.join(themes)}" if themes else ""

        instructions = (
            "You are a film analyst. Using only the evidence given -- never "
            "your own knowledge of this film -- write a spoiler-free, 1-2 "
            "sentence description of its tone and character. Do not mention "
            "any viewer, preference, or recommendation; describe only the "
            "film itself."
        )
        input_text = f"""Film: {title}

Evidence (0-1 scale):
{evidence_lines}{themes_line}

Describe the film's tone and character from this evidence alone."""

        try:
            response = self._get_client().responses.create(
                model=model,
                instructions=instructions,
                input=input_text,
                max_output_tokens=150,
                # Never retain film-evidence prompts/outputs on OpenAI's side
                # (blueprint §15.2, ADR-6/23; no user data is sent here either way).
                store=False,
            )
        except openai.OpenAIError as error:
            raise ValueError(f"OpenAI explanation request failed: {error}") from error

        content = response.output_text
        if not content:
            raise ValueError("OpenAI response did not include explanation text")

        return content
