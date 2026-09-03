"""
Film fingerprinting worker on the Anthropic Messages API.

Background-only LLM use (blueprint §15): a film's fingerprint is extracted from
licensed evidence into a versioned JSON schema (structured outputs, Pydantic
enforced), stamped with provenance, and published once per extractor/model
version. See docs/FINGERPRINT_SCHEMA.md §5 and docs/ARCHITECTURE_DECISIONS.md
ADR-6/ADR-23 (rules) and the provider-switch decision recorded in
docs/DEMO_DATA_PLAN_2026-09-03.md §8 for the rules this pipeline must follow.
"""

import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import anthropic
from pydantic import BaseModel, Field

# Bump whenever this pipeline's prompt or evidence shape changes -- a
# published fingerprint is re-extracted only on a schema/model/extractor
# version change, never ad hoc (FINGERPRINT_SCHEMA.md §5). v2: the
# Anthropic port -- the prompt is unchanged, but a different model family
# behind the same prompt is exactly the kind of change that must be visible
# in every published fingerprint's provenance.
EXTRACTOR_VERSION = "enrichment-worker-v2"

# Output ceilings. Adaptive thinking (on by default for the configured model
# family) counts toward max_tokens, so these leave room for reasoning before
# the ~400-token JSON / 2-sentence answer -- a cap hit is a hard failure, not
# a truncated fingerprint.
FINGERPRINT_MAX_TOKENS = 8192
EXPLANATION_MAX_TOKENS = 2048
CLIENT_MAX_RETRIES = 6


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


class FingerprintConfidence(BaseModel):
    """Per-dimension confidence, 0-1 -- one named field per dimension so the
    structured-output schema *requires* all thirteen. A free-form map came
    back empty from the model on the first real run; a named object cannot."""

    pacing: float
    rhythmVariance: float
    ambiguity: float
    psychologicalDepth: float
    warmth: float
    darkness: float
    linearity: float
    dialogueDensity: float
    actionIntensity: float
    plotComplexity: float
    visualComplexity: float
    soundscapeComplexity: float
    colorSaturation: float


class FingerprintOutput(BaseModel):
    """What the model is asked to produce: the thirteen dimensions, themes and
    a complete confidence object. Provenance is never part of this schema --
    generate_fingerprint() stamps it afterwards onto the published
    FilmFingerprintV1, whose shape (confidence as a map) stays unchanged."""

    pacing: float = Field(..., description="Pacing 0-1 (slow to fast)")
    rhythmVariance: float = Field(..., description="Rhythm variance 0-1 (consistent to varied)")
    ambiguity: float = Field(..., description="Ambiguity 0-1 (clear to ambiguous)")
    psychologicalDepth: float = Field(..., description="Psychological depth 0-1 (shallow to deep)")
    warmth: float = Field(..., description="Emotional warmth 0-1 (cold to warm)")
    darkness: float = Field(..., description="Darkness 0-1 (light to dark)")
    linearity: float = Field(..., description="Narrative structure 0-1 (linear to fragmented)")
    dialogueDensity: float = Field(..., description="Dialogue density 0-1 (sparse to dense)")
    actionIntensity: float = Field(..., description="Action intensity 0-1 (contemplative to action-heavy)")
    plotComplexity: float = Field(..., description="Plot complexity 0-1 (simple to complex)")
    visualComplexity: float = Field(..., description="Visual complexity 0-1 (minimal to elaborate)")
    soundscapeComplexity: float = Field(..., description="Soundscape complexity 0-1 (minimal to elaborate)")
    colorSaturation: float = Field(..., description="Color saturation 0-1 (desaturated/black-and-white to vivid)")
    themes: list[str] = Field(default_factory=list, description="Primary themes, short phrases")
    confidence: FingerprintConfidence = Field(
        ..., description="How well the evidence supports each score, 0-1 per dimension; low where the plot text says little"
    )


# ---------------------------------------------------------------------------
# Version 2 families (FINGERPRINT_SCHEMA.md §3.1): fifteen namespaced features a
# plot synopsis can support, plus a controlled theme vocabulary. Published as a
# nested `v2` block inside the V1 fingerprint so V1 stays frozen.
# ---------------------------------------------------------------------------

V2_EXTRACTOR_VERSION = "enrichment-worker-v2-families-v1"
V2_SCHEMA_VERSION = "film-fingerprint-v2"

# Pydantic field name -> published namespaced key (dots are not valid identifiers).
V2_FEATURE_KEYS: Dict[str, str] = {
    "narrative_revelation": "narrative.revelation",
    "narrative_perspective": "narrative.perspective",
    "narrative_unreliability": "narrative.unreliability",
    "tone_irony": "tone.irony",
    "tone_unease": "tone.unease",
    "tone_catharsis": "tone.catharsis",
    "tone_compassion": "tone.compassion",
    "characters_agency": "characters.agency",
    "characters_moralAmbiguity": "characters.moralAmbiguity",
    "characters_transformation": "characters.transformation",
    "characters_relationshipCentrality": "characters.relationshipCentrality",
    "ending_openness": "ending.openness",
    "ending_twist": "ending.twist",
    "ending_justice": "ending.justice",
    "ending_optimism": "ending.optimism",
}
V2_FEATURES = tuple(V2_FEATURE_KEYS.values())

THEME_VOCABULARY = (
    "identity", "family", "memory", "power", "justice", "survival", "love", "grief", "faith", "class", "war",
    "coming-of-age", "technology", "isolation", "freedom", "art", "crime", "migration", "friendship", "madness",
    "nature", "duty", "revenge", "community",
)


class FingerprintV2Features(BaseModel):
    narrative_revelation: float = Field(..., description="0 everything known early -> 1 built on withheld information revealed gradually")
    narrative_perspective: float = Field(..., description="0 one viewpoint -> 1 many viewpoints")
    narrative_unreliability: float = Field(..., description="0 reliable narration -> 1 contradictory or unreliable narration")
    tone_irony: float = Field(..., description="0 earnest -> 1 ironic or satirical")
    tone_unease: float = Field(..., description="0 comfort -> 1 sustained dread")
    tone_catharsis: float = Field(..., description="0 emotion withheld -> 1 full emotional release")
    tone_compassion: float = Field(..., description="0 cold or detached gaze on the characters -> 1 compassionate gaze")
    characters_agency: float = Field(..., description="0 characters buffeted by events -> 1 characters driving events")
    characters_moralAmbiguity: float = Field(..., description="0 clear-cut -> 1 morally ambiguous")
    characters_transformation: float = Field(..., description="0 static -> 1 transformed by the end")
    characters_relationshipCentrality: float = Field(..., description="0 an individual's story -> 1 relationships at the centre")
    ending_openness: float = Field(..., description="0 closed ending -> 1 open ending")
    ending_twist: float = Field(..., description="0 no reversal -> 1 major final reversal")
    ending_justice: float = Field(..., description="0 dramatic justice absent -> 1 dramatic justice served")
    ending_optimism: float = Field(..., description="0 bitter -> 1 hopeful")


class FingerprintV2Confidence(FingerprintV2Features):
    """Same fifteen fields, each the confidence 0-1 that the evidence supports the score."""


class FingerprintV2Output(BaseModel):
    features: FingerprintV2Features
    themes: list[str] = Field(default_factory=list, description="Up to three tags from the given vocabulary, most central first")
    confidence: FingerprintV2Confidence


# ---------------------------------------------------------------------------
# Third block: the form families (FINGERPRINT_SCHEMA.md §3.3)
# ---------------------------------------------------------------------------
# The BP §6.1 families V1 and V2 left uncovered in the dense vector -- rhythm
# detail, dialogue & information, style -- plus the two tone registers and the
# one narrative scale the first non-synthetic ranker showed were missing
# (DEMO_DATA_PLAN_2026-09-03.md §7.2: playfulness, sentimentality, the size of
# the story's canvas). Camera movement and editing are not here: they need
# descriptive visual evidence the fixture does not carry. No key encodes a
# political, religious or other sensitive stance (PRIVACY.md §1.6):
# narrative.scope is the size of the canvas, not a position.
V3_EXTRACTOR_VERSION = "enrichment-worker-v3-form-v1"
V3_SCHEMA_VERSION = "film-fingerprint-v3"

V3_FEATURE_KEYS: Dict[str, str] = {
    "rhythm_setupLength": "rhythm.setupLength",
    "rhythm_turningPointDensity": "rhythm.turningPointDensity",
    "rhythm_deliberateness": "rhythm.deliberateness",
    "information_expositionDirectness": "information.expositionDirectness",
    "information_subtext": "information.subtext",
    "information_knowledgeComplexity": "information.knowledgeComplexity",
    "style_stylization": "style.stylization",
    "style_experimentation": "style.experimentation",
    "style_scale": "style.scale",
    "tone_playfulness": "tone.playfulness",
    "tone_sentimentality": "tone.sentimentality",
    "narrative_scope": "narrative.scope",
}
V3_FEATURES = tuple(V3_FEATURE_KEYS.values())


class FingerprintV3Features(BaseModel):
    rhythm_setupLength: float = Field(..., description="0 the first significant event happens at once -> 1 a long establishing stretch before anything happens")
    rhythm_turningPointDensity: float = Field(..., description="0 a handful of turning points -> 1 the situation turns every few minutes")
    rhythm_deliberateness: float = Field(..., description="0 slow stretches feel slack, empty or repetitive -> 1 every slow stretch serves observation, tension or mood")
    information_expositionDirectness: float = Field(..., description="0 facts are implied or shown -> 1 facts are stated outright (narration, explanation)")
    information_subtext: float = Field(..., description="0 what is said is what is meant -> 1 the meaning lies beneath the dialogue")
    information_knowledgeComplexity: float = Field(..., description="0 no specialised knowledge needed -> 1 dense technical, historical or professional knowledge")
    style_stylization: float = Field(..., description="0 naturalistic realism -> 1 a heightened, expressionist or artificial world")
    style_experimentation: float = Field(..., description="0 conventional form -> 1 formally experimental in structure, image or sound")
    style_scale: float = Field(..., description="0 a chamber piece in a few rooms -> 1 large-scale spectacle across many places and set pieces")
    tone_playfulness: float = Field(..., description="0 grave throughout -> 1 playful, comic or whimsical")
    tone_sentimentality: float = Field(..., description="0 emotionally restrained -> 1 openly sentimental, emotion pressed on the viewer")
    narrative_scope: float = Field(..., description="0 an intimate, private story -> 1 a society, institution or system as the canvas")


class FingerprintV3Confidence(FingerprintV3Features):
    """Same twelve fields, each the confidence 0-1 that the evidence supports the score."""


class FingerprintV3Output(BaseModel):
    features: FingerprintV3Features
    confidence: FingerprintV3Confidence


def _refusal_text(response) -> Optional[str]:
    """The model's refusal explanation, if this response is a refusal."""
    if getattr(response, "stop_reason", None) != "refusal":
        return None
    details = getattr(response, "stop_details", None)
    explanation = getattr(details, "explanation", None) if details is not None else None
    category = getattr(details, "category", None) if details is not None else None
    if isinstance(explanation, str) and explanation:
        return explanation
    return f"refused ({category})" if isinstance(category, str) and category else "refused"


def _first_text(response) -> Optional[str]:
    """Text of the first text block in a Messages API response, if any."""
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", None)
        if getattr(block, "type", None) == "text" and isinstance(text, str) and text:
            return text
    return None


def _served_model(response, requested: str) -> str:
    """The model id the API actually served (an alias may resolve to a dated
    snapshot); the configured id is the fallback."""
    served = getattr(response, "model", None)
    return served if isinstance(served, str) and served else requested


# ---------------------------------------------------------------------------
# Call accounting (board request G7, owner's decision 2026-09-04): every model
# call records its tokens, models, latency and status -- one JSON line per
# call in $LLM_CALL_LOG_DIR/<runId>.jsonl (default <os tmp>/movie-llm-calls,
# outside git like the catalog cache) and in memory on the worker for the run
# report. Cost is derived, never stored as a fact: it is filled in only when
# LLM_PRICES_JSON names prices for the served model, else null, so a later
# study computes it from the tokens with the prices of its day. No prompt or
# evidence text is ever written here, only counts.
# ---------------------------------------------------------------------------

PURPOSES = ("fingerprint_v1", "fingerprint_v2", "fingerprint_v3", "explanation")
DEFAULT_CALL_LOG_DIR = Path(tempfile.gettempdir()) / "movie-llm-calls"


def call_log_dir() -> Path:
    configured = os.environ.get("LLM_CALL_LOG_DIR")
    return Path(configured) if configured else DEFAULT_CALL_LOG_DIR


def load_prices() -> Optional[Dict[str, Dict[str, float]]]:
    """`{"<model>": {"inputPerMTok": x, "outputPerMTok": y}}` from LLM_PRICES_JSON, or None (invalid JSON counts as none)."""
    raw = os.environ.get("LLM_PRICES_JSON")
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int, prices: Optional[Dict[str, Dict[str, float]]]) -> Optional[float]:
    """Input and output tokens at the served model's per-million prices; None when no price is known for it."""
    entry = (prices or {}).get(model)
    if not isinstance(entry, dict):
        return None
    try:
        return round(input_tokens / 1e6 * float(entry["inputPerMTok"]) + output_tokens / 1e6 * float(entry["outputPerMTok"]), 6)
    except (KeyError, TypeError, ValueError):
        return None


def _usage_int(usage, name: str) -> int:
    value = getattr(usage, name, None) if usage is not None else None
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def call_status(response, expect_parsed: bool) -> str:
    """ok | refused | ceiling | unparsed | error -- what the API answered, before the caller's own checks."""
    if response is None:
        return "error"
    if _refusal_text(response):
        return "refused"
    if getattr(response, "stop_reason", None) == "max_tokens":
        return "ceiling"
    if expect_parsed:
        return "ok" if getattr(response, "parsed_output", None) is not None else "unparsed"
    return "ok" if _first_text(response) else "unparsed"


def summarize_calls(calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One row per (purpose, modelServed): calls, ok, tokens in/out, mean per title, mean latency, cost when every call had one."""
    groups: Dict[tuple, List[Dict[str, Any]]] = {}
    for call in calls:
        groups.setdefault((str(call.get("purpose")), str(call.get("modelServed"))), []).append(call)
    rows = []
    for (purpose, model), members in sorted(groups.items()):
        titles = {call.get("internalId") for call in members if call.get("internalId")}
        input_tokens = sum(int(call.get("inputTokens") or 0) for call in members)
        output_tokens = sum(int(call.get("outputTokens") or 0) for call in members)
        costs = [call.get("costUsd") for call in members]
        rows.append(
            {
                "purpose": purpose,
                "modelServed": model,
                "calls": len(members),
                "ok": sum(1 for call in members if call.get("status") == "ok"),
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "titles": len(titles),
                "meanInputPerTitle": round(input_tokens / len(titles)) if titles else None,
                "meanOutputPerTitle": round(output_tokens / len(titles)) if titles else None,
                "meanLatencyMs": round(sum(int(call.get("latencyMs") or 0) for call in members) / len(members)),
                "costUsd": round(sum(costs), 6) if costs and all(isinstance(cost, (int, float)) for cost in costs) else None,
            }
        )
    return rows


def format_calls_table(calls: List[Dict[str, Any]], run_id: Optional[str] = None) -> str:
    """Markdown for the run report: the summary rows, or a line saying no call was recorded."""
    rows = summarize_calls(calls)
    header = f"## Model calls{f' (run `{run_id}`)' if run_id else ''}"
    if not rows:
        return f"{header}\n\nNo model calls were recorded in this run.\n"
    lines = [
        header,
        "",
        "| Purpose | Model served | Calls | OK | Input tokens | Output tokens | Titles | Input / title | Output / title | Mean latency | Cost (USD) |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        cost = f"{row['costUsd']:.4f}" if row["costUsd"] is not None else "— (no LLM_PRICES_JSON)"
        lines.append(
            f"| {row['purpose']} | {row['modelServed']} | {row['calls']} | {row['ok']} | {row['inputTokens']} | {row['outputTokens']} | {row['titles']} | "
            f"{row['meanInputPerTitle'] if row['meanInputPerTitle'] is not None else '—'} | {row['meanOutputPerTitle'] if row['meanOutputPerTitle'] is not None else '—'} | "
            f"{row['meanLatencyMs']} ms | {cost} |"
        )
    lines.append("")
    lines.append("Tokens as the API reported them (`usage`); the log holds one JSON line per call under `LLM_CALL_LOG_DIR` and never any prompt or evidence text.")
    return "\n".join(lines) + "\n"


class FilmEnrichmentWorker:
    """Worker for generating film fingerprints and spoiler-free descriptions."""

    def __init__(self, model: Optional[str] = None):
        """
        Args:
            model: overrides the configured model for every call this worker
                instance makes (tests, one-off scripts). Leave unset in
                production so each task reads its own configured model
                (`ANTHROPIC_FINGERPRINT_MODEL` / `ANTHROPIC_EXPLANATION_MODEL`,
                ADR-6) -- the model id is never a hard-coded default, since
                model choice is a deployment decision, not a code constant.
        """
        self._model_override = model
        self._client: Optional[anthropic.Anthropic] = None
        # Call accounting: one record per model call this instance makes (G7);
        # the run id names the JSON-lines file and the report section.
        self.run_id: str = os.environ.get("LLM_RUN_ID") or f"run-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{os.getpid()}"
        self.calls: List[Dict[str, Any]] = []

    def _record_call(
        self,
        response,
        *,
        purpose: str,
        model_requested: str,
        internal_id: Optional[str],
        extractor_version: str,
        started_at: float,
        status: str,
        error: Optional[str] = None,
    ) -> Dict[str, Any]:
        usage = getattr(response, "usage", None) if response is not None else None
        served = _served_model(response, model_requested) if response is not None else model_requested
        input_tokens = _usage_int(usage, "input_tokens")
        output_tokens = _usage_int(usage, "output_tokens")
        record = {
            "occurredAt": datetime.now(timezone.utc).isoformat(),
            "runId": self.run_id,
            "purpose": purpose,
            "provider": "anthropic",
            "modelRequested": model_requested,
            "modelServed": served,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "cacheCreationInputTokens": _usage_int(usage, "cache_creation_input_tokens"),
            "cacheReadInputTokens": _usage_int(usage, "cache_read_input_tokens"),
            "latencyMs": int((time.monotonic() - started_at) * 1000),
            "status": status,
            "error": error,
            "internalId": internal_id,
            "extractorVersion": extractor_version,
            "costUsd": estimate_cost_usd(served, input_tokens, output_tokens, load_prices()),
        }
        self.calls.append(record)
        try:
            directory = call_log_dir()
            directory.mkdir(parents=True, exist_ok=True)
            with (directory / f"{self.run_id}.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass  # accounting must never break an extraction; the in-memory record still feeds the report
        return record

    def _call(
        self,
        purpose: str,
        model: str,
        internal_id: Optional[str],
        extractor_version: str,
        expect_parsed: bool,
        request: Callable[[anthropic.Anthropic], Any],
    ):
        """Run one API request and record it, whatever happens; API errors are re-raised for the caller's own wrapping."""
        started_at = time.monotonic()
        try:
            response = request(self._get_client())
        except anthropic.APIError as error:
            self._record_call(
                None,
                purpose=purpose,
                model_requested=model,
                internal_id=internal_id,
                extractor_version=extractor_version,
                started_at=started_at,
                status="error",
                error=type(error).__name__,
            )
            raise
        self._record_call(
            response,
            purpose=purpose,
            model_requested=model,
            internal_id=internal_id,
            extractor_version=extractor_version,
            started_at=started_at,
            status=call_status(response, expect_parsed),
        )
        return response

    def _get_client(self) -> anthropic.Anthropic:
        # Built on first real use, not at import time or construction time
        # (H3, ADR-36): importing this module -- transitively,
        # `python -m src.training`, which never talks to any LLM -- must not
        # fail on a machine without credentials. The zero-argument client
        # resolves ANTHROPIC_API_KEY (or an `ant auth login` profile) itself.
        if self._client is None:
            # An identity-linked API key must name the workspace it acts in
            # (the API answers 400 "anthropic-workspace-id is required"
            # otherwise). Plain workspace keys need no header, so the id is
            # optional configuration, never a hard-coded value.
            workspace_id = os.environ.get("ANTHROPIC_WORKSPACE_ID")
            headers = {"anthropic-workspace-id": workspace_id} if workspace_id else None
            # Batch extraction is latency-tolerant: let the SDK's exponential
            # backoff absorb 429/529/5xx bursts (default is 2 retries; a 529
            # "Overloaded" got through that on the first real catalog run).
            self._client = anthropic.Anthropic(default_headers=headers, max_retries=CLIENT_MAX_RETRIES)
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
        *,
        internal_id: Optional[str] = None,
    ) -> FilmFingerprintV1:
        """
        Generate a film fingerprint with structured outputs.

        Args:
            title: Film title
            description: Short film description
            plot_summary: Detailed plot summary
            additional_context: Optional additional context (year, genres, country...)
            source_ids: `source_records` row ids backing the evidence above, if
                any exist yet (FINGERPRINT_SCHEMA.md §2 `sourceIds`) -- stamped
                onto the result as-is, never invented.

        Returns:
            FilmFingerprintV1 object with computed fingerprint

        Raises:
            ValueError: If the API call fails, the model refuses, or the output
                hits the token ceiling before a complete fingerprint exists
        """
        model = self._resolve_model("ANTHROPIC_FINGERPRINT_MODEL")

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
            response = self._call(
                "fingerprint_v1",
                model,
                internal_id,
                EXTRACTOR_VERSION,
                True,
                lambda client: client.messages.parse(
                    model=model,
                    max_tokens=FINGERPRINT_MAX_TOKENS,
                    system=instructions,
                    messages=[{"role": "user", "content": input_text}],
                    output_format=FingerprintOutput,
                ),
            )
        except anthropic.APIError as error:
            raise ValueError(f"Anthropic fingerprint request failed: {error}") from error

        output = getattr(response, "parsed_output", None)
        if not isinstance(output, FingerprintOutput):
            refusal = _refusal_text(response)
            if refusal:
                raise ValueError(f"The model refused to fingerprint this film: {refusal}")
            stop_reason = getattr(response, "stop_reason", None)
            if stop_reason == "max_tokens":
                raise ValueError("The fingerprint response hit the token ceiling before a complete JSON object")
            raise ValueError(f"The model did not return a parsed fingerprint (stop_reason={stop_reason or 'unknown'})")

        parsed = FilmFingerprintV1(
            **output.model_dump(exclude={"confidence"}),
            confidence=output.confidence.model_dump(),
        )
        parsed.generatedBy = "anthropic"
        parsed.generatedAt = datetime.now(timezone.utc)
        parsed.modelVersion = _served_model(response, model)
        parsed.extractorVersion = EXTRACTOR_VERSION
        parsed.sourceIds = source_ids
        parsed.licenseStatus = "unknown"
        parsed.reviewStatus = "unreviewed"

        return parsed

    def generate_fingerprint_v2(
        self,
        title: str,
        description: str,
        plot_summary: str,
        additional_context: Optional[str] = None,
        source_ids: Optional[list[str]] = None,
        *,
        internal_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract the V2 families (FINGERPRINT_SCHEMA.md §3.1) from the same
        evidence as V1 and return the published `v2` block as a JSON-ready dict:
        namespaced feature keys, themes restricted to the vocabulary, per-feature
        confidence, provenance stamped here (never asked of the model).

        Raises:
            ValueError: on API failure, refusal, or a truncated/unparsed answer
        """
        model = self._resolve_model("ANTHROPIC_FINGERPRINT_MODEL")

        context = f"Title: {title}\nDescription: {description}\nPlot Summary: {plot_summary}\n"
        if additional_context:
            context += f"Additional Context: {additional_context}\n"
        vocabulary = ", ".join(THEME_VOCABULARY)
        instructions = f"""You are an expert film analyst. Score narrative structure, tone, characters and ending on 0-1 scales strictly from the evidence given.
Every scale is described in the schema. Distinguish carefully: irony (a satirical or detached stance) from mere darkness; sustained dread from sadness; a compassionate gaze on characters from a cold or contemptuous one, whatever the subject matter. Ending features describe how the story resolves and are used internally only.
Themes: choose up to three from this vocabulary only, most central first: {vocabulary}.
Give a confidence for every feature: high only where the plot text clearly supports the score, low where you are inferring."""
        input_text = f"""Analyze this film and provide the version-2 fingerprint:

{context}

Score all fifteen features and give a confidence for each."""

        try:
            response = self._call(
                "fingerprint_v2",
                model,
                internal_id,
                V2_EXTRACTOR_VERSION,
                True,
                lambda client: client.messages.parse(
                    model=model,
                    max_tokens=FINGERPRINT_MAX_TOKENS,
                    system=instructions,
                    messages=[{"role": "user", "content": input_text}],
                    output_format=FingerprintV2Output,
                ),
            )
        except anthropic.APIError as error:
            raise ValueError(f"Anthropic V2 fingerprint request failed: {error}") from error

        output = getattr(response, "parsed_output", None)
        if not isinstance(output, FingerprintV2Output):
            refusal = _refusal_text(response)
            if refusal:
                raise ValueError(f"The model refused to fingerprint this film (V2): {refusal}")
            stop_reason = getattr(response, "stop_reason", None)
            if stop_reason == "max_tokens":
                raise ValueError("The V2 fingerprint response hit the token ceiling before a complete JSON object")
            raise ValueError(f"The model did not return a parsed V2 fingerprint (stop_reason={stop_reason or 'unknown'})")

        features = {V2_FEATURE_KEYS[name]: float(value) for name, value in output.features.model_dump().items()}
        confidence = {V2_FEATURE_KEYS[name]: float(value) for name, value in output.confidence.model_dump().items()}
        themes = [theme for theme in output.themes if theme in THEME_VOCABULARY][:3]
        return {
            "schemaVersion": V2_SCHEMA_VERSION,
            "features": features,
            "themes": themes,
            "confidence": confidence,
            "generatedBy": "anthropic",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "modelVersion": _served_model(response, model),
            "extractorVersion": V2_EXTRACTOR_VERSION,
            "sourceIds": source_ids,
            "licenseStatus": "unknown",
            "reviewStatus": "unreviewed",
        }

    def generate_fingerprint_v3(
        self,
        title: str,
        description: str,
        plot_summary: str,
        additional_context: Optional[str] = None,
        source_ids: Optional[list[str]] = None,
        *,
        internal_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Extract the third block -- the form families (FINGERPRINT_SCHEMA.md
        §3.3) -- from the same evidence as V1/V2 and return the published `v3`
        block: namespaced feature keys, per-feature confidence, provenance
        stamped here (never asked of the model). Style features are scored from
        descriptive text only, so their confidence is expected to run low; the
        report shows it per feature.

        Raises:
            ValueError: on API failure, refusal, or a truncated/unparsed answer
        """
        model = self._resolve_model("ANTHROPIC_FINGERPRINT_MODEL")

        context = f"Title: {title}\nDescription: {description}\nPlot Summary: {plot_summary}\n"
        if additional_context:
            context += f"Additional Context: {additional_context}\n"
        instructions = """You are an expert film analyst. Score the film's rhythm, its handling of information, its style, two tone registers and its narrative scale on 0-1 scales strictly from the evidence given.
Every scale is described in the schema. Distinguish carefully: deliberate slowness (stretches that serve observation, tension or mood) from slack or repetition; subtext (meaning beneath the words) from ambiguity of plot; stylization of the world (heightened, artificial, expressionist) from mere visual richness; playfulness (comic, whimsical, light-footed) from warmth; open sentimentality (emotion pressed on the viewer) from depth of feeling. narrative.scope is the size of the story's canvas -- a private life versus a society, institution or system -- never a political or moral stance.
Style features usually cannot be judged from a plot alone: score them from whatever the description says about the film's form and give a low confidence where you are inferring.
Give a confidence for every feature: high only where the text clearly supports the score, low where you are inferring."""
        input_text = f"""Analyze this film and provide the version-3 fingerprint (form families):

{context}

Score all twelve features and give a confidence for each."""

        try:
            response = self._call(
                "fingerprint_v3",
                model,
                internal_id,
                V3_EXTRACTOR_VERSION,
                True,
                lambda client: client.messages.parse(
                    model=model,
                    max_tokens=FINGERPRINT_MAX_TOKENS,
                    system=instructions,
                    messages=[{"role": "user", "content": input_text}],
                    output_format=FingerprintV3Output,
                ),
            )
        except anthropic.APIError as error:
            raise ValueError(f"Anthropic V3 fingerprint request failed: {error}") from error

        output = getattr(response, "parsed_output", None)
        if not isinstance(output, FingerprintV3Output):
            refusal = _refusal_text(response)
            if refusal:
                raise ValueError(f"The model refused to fingerprint this film (V3): {refusal}")
            stop_reason = getattr(response, "stop_reason", None)
            if stop_reason == "max_tokens":
                raise ValueError("The V3 fingerprint response hit the token ceiling before a complete JSON object")
            raise ValueError(f"The model did not return a parsed V3 fingerprint (stop_reason={stop_reason or 'unknown'})")

        features = {V3_FEATURE_KEYS[name]: float(value) for name, value in output.features.model_dump().items()}
        confidence = {V3_FEATURE_KEYS[name]: float(value) for name, value in output.confidence.model_dump().items()}
        return {
            "schemaVersion": V3_SCHEMA_VERSION,
            "features": features,
            "confidence": confidence,
            "generatedBy": "anthropic",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "modelVersion": _served_model(response, model),
            "extractorVersion": V3_EXTRACTOR_VERSION,
            "sourceIds": source_ids,
            "licenseStatus": "unknown",
            "reviewStatus": "unreviewed",
        }

    def generate_recommendation_explanation(
        self,
        title: str,
        fingerprint: Dict[str, float],
        themes: Optional[list[str]] = None,
        *,
        internal_id: Optional[str] = None,
    ) -> str:
        """
        Generate a spoiler-free, evidence-only description of a film's tone
        and character from its own fingerprint.

        M12 (ADR-50): this used to also take the user's learned preference
        weights and their previously-watched titles, and put both into the
        prompt -- exactly what ADR-23 and PRIVACY.md §6.1 forbid ("prompts
        contain licensed evidence and schema only -- never user ids, rankings,
        preferences or account data") and BP §15.2 rules out ("لا يستنتج
        سمات حساسة عن المستخدم من سجل المشاهدة"). Those parameters are
        removed entirely, not merely unused, so a future caller cannot pass
        user data back in by mistake. What personalizes a recommendation
        (which dimensions drove the score, and in which direction) already
        exists as RecommendationsService's own RecommendationReason -- computed
        and rendered entirely on the backend/client, never sent to any third
        party. This function only ever describes the film itself, for any
        viewer, from evidence the caller supplies.

        Args:
            title: Film title
            fingerprint: Film's fingerprint (dimension -> 0-1 score)
            themes: Primary themes identified for the film, if any

        Returns:
            Natural language, spoiler-free description of the film's traits

        Raises:
            ValueError: If the API call fails, the model refuses, or returns no text
        """
        model = self._resolve_model("ANTHROPIC_EXPLANATION_MODEL")

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
            response = self._call(
                "explanation",
                model,
                internal_id,
                "explanation",
                False,
                lambda client: client.messages.create(
                    model=model,
                    max_tokens=EXPLANATION_MAX_TOKENS,
                    system=instructions,
                    messages=[{"role": "user", "content": input_text}],
                ),
            )
        except anthropic.APIError as error:
            raise ValueError(f"Anthropic explanation request failed: {error}") from error

        refusal = _refusal_text(response)
        if refusal:
            raise ValueError(f"The model refused to describe this film: {refusal}")
        content = _first_text(response)
        if not content:
            raise ValueError("The explanation response did not include any text")

        return content
