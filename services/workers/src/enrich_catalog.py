"""
Enrich the demo catalog fixture with fingerprints (docs/DEMO_DATA_PLAN_2026-09-03.md WS2).

    python -m src.enrich_catalog [--fixture PATH] [--only DEMO0007] [--limit N] [--force]
                                 [--concurrency 4] [--placeholder] [--partial-ids a,b,c]
                                 [--write-db] [--dry-run]

Reads `apps/backend/src/scripts/fixtures/catalog.demo.json`, runs the enrichment
worker on every entry whose fingerprint is missing or was produced by an older
extractor version, and writes the fingerprints back into the fixture (every 10
completions and at the end, atomically), plus a build report next to it.

Rules it enforces (FINGERPRINT_SCHEMA.md §5, DATA_LICENSING.md §4):
  - the evidence sent is the fixture's own text (Wikipedia lead + plot section,
    fixture-only fields) and the film's facts; never user data, never text we
    have no right to derive from;
  - one extraction per (title, extractorVersion): a re-run is a no-op unless the
    extractor version changed or --force is given;
  - provenance is whatever the worker stamps; this script adds nothing to it and
    leaves licenseStatus 'unknown' -- the fixture is a development artefact;
  - a refusal or an API failure is recorded in the report and leaves the entry
    without a fingerprint (re-run to retry) -- never a fabricated vector;
  - --placeholder fills deterministic genre-centroid vectors labelled
    'demo-placeholder-v1' so the UI can be exercised without any credentials;
    they are never mistaken for extractions;
  - a fixed set of titles is left deliberately partial (two dimensions removed)
    so the one-band confidence demotion (ADR-19) is visible in the demo.
"""

import argparse
import hashlib
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dotenv import load_dotenv

from .enrichment import EXTRACTOR_VERSION, V2_EXTRACTOR_VERSION, V3_EXTRACTOR_VERSION, FilmEnrichmentWorker, format_calls_table

# Nested blocks that hang off a V1 fingerprint: CLI flag -> (fingerprint key, current extractor version).
BLOCKS: Dict[str, Tuple[str, str]] = {
    "v2": ("v2", V2_EXTRACTOR_VERSION),
    "v3": ("v3", V3_EXTRACTOR_VERSION),
}

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURE = REPO_ROOT / "apps" / "backend" / "src" / "scripts" / "fixtures" / "catalog.demo.json"

PLACEHOLDER_VERSION = "demo-placeholder-v1"
PARTIAL_SUFFIX = "+partial"
# Left partial on purpose: two dimensions removed after extraction so the
# ADR-19 demotion ("some traits unknown, confidence lowered one band") shows
# on Home. One per slice/tier mix; ids are stable because the list is
# append-only.
DEFAULT_PARTIAL_IDS = ("DEMO0007", "DEMO0063", "DEMO0150", "DEMO0222", "DEMO0290")
PARTIAL_DIMENSIONS = ("soundscapeComplexity", "colorSaturation")
WRITE_EVERY = 10

DIMENSIONS = (
    "pacing",
    "rhythmVariance",
    "ambiguity",
    "psychologicalDepth",
    "warmth",
    "darkness",
    "linearity",
    "dialogueDensity",
    "actionIntensity",
    "plotComplexity",
    "visualComplexity",
    "soundscapeComplexity",
    "colorSaturation",
)

# Genre centroids for the placeholder generator (13 dims, DIMENSIONS order).
# Editorial, not extracted -- that is the whole point of the label.
GENRE_CENTROIDS: Dict[str, Tuple[float, ...]] = {
    "Drama": (0.35, 0.45, 0.55, 0.75, 0.50, 0.55, 0.40, 0.65, 0.20, 0.50, 0.50, 0.45, 0.45),
    "Comedy": (0.65, 0.50, 0.20, 0.35, 0.85, 0.15, 0.25, 0.80, 0.30, 0.35, 0.55, 0.50, 0.75),
    "Thriller": (0.70, 0.70, 0.65, 0.60, 0.25, 0.75, 0.55, 0.55, 0.60, 0.80, 0.65, 0.75, 0.40),
    "Crime": (0.60, 0.60, 0.55, 0.60, 0.25, 0.80, 0.55, 0.60, 0.60, 0.75, 0.60, 0.65, 0.40),
    "Romance": (0.35, 0.35, 0.30, 0.65, 0.90, 0.20, 0.30, 0.85, 0.10, 0.35, 0.55, 0.55, 0.70),
    "Action": (0.90, 0.75, 0.20, 0.30, 0.40, 0.55, 0.30, 0.35, 0.95, 0.45, 0.85, 0.90, 0.65),
    "Adventure": (0.75, 0.65, 0.25, 0.35, 0.65, 0.35, 0.30, 0.45, 0.75, 0.50, 0.85, 0.80, 0.80),
    "Science Fiction": (0.55, 0.55, 0.70, 0.55, 0.30, 0.60, 0.55, 0.50, 0.55, 0.80, 0.90, 0.90, 0.45),
    "Fantasy": (0.55, 0.60, 0.50, 0.45, 0.60, 0.45, 0.45, 0.45, 0.55, 0.65, 0.95, 0.85, 0.80),
    "Horror": (0.55, 0.75, 0.65, 0.45, 0.10, 0.95, 0.45, 0.35, 0.55, 0.50, 0.70, 0.85, 0.30),
    "Animation": (0.65, 0.55, 0.20, 0.40, 0.85, 0.20, 0.25, 0.60, 0.50, 0.40, 0.95, 0.80, 0.95),
    "Musical": (0.60, 0.65, 0.15, 0.40, 0.85, 0.15, 0.30, 0.65, 0.20, 0.30, 0.85, 0.95, 0.90),
    "War": (0.55, 0.65, 0.45, 0.60, 0.25, 0.85, 0.40, 0.50, 0.80, 0.55, 0.70, 0.85, 0.35),
    "Western": (0.40, 0.50, 0.35, 0.50, 0.35, 0.60, 0.25, 0.40, 0.65, 0.40, 0.75, 0.60, 0.55),
    "History": (0.35, 0.40, 0.35, 0.65, 0.45, 0.55, 0.30, 0.70, 0.35, 0.60, 0.80, 0.60, 0.50),
    "Mystery": (0.45, 0.55, 0.85, 0.65, 0.30, 0.65, 0.65, 0.65, 0.30, 0.90, 0.60, 0.65, 0.40),
    "Coming-of-Age": (0.35, 0.40, 0.35, 0.75, 0.75, 0.30, 0.30, 0.70, 0.10, 0.30, 0.50, 0.45, 0.65),
    "Family": (0.60, 0.45, 0.10, 0.35, 0.95, 0.10, 0.20, 0.65, 0.35, 0.30, 0.70, 0.65, 0.85),
    "Biography": (0.40, 0.45, 0.30, 0.70, 0.50, 0.45, 0.45, 0.75, 0.25, 0.50, 0.55, 0.50, 0.50),
    "Film Noir": (0.45, 0.50, 0.75, 0.65, 0.15, 0.85, 0.55, 0.70, 0.40, 0.80, 0.60, 0.55, 0.15),
    "Documentary": (0.40, 0.40, 0.30, 0.50, 0.45, 0.45, 0.35, 0.80, 0.15, 0.40, 0.45, 0.40, 0.45),
}
NEUTRAL_CENTROID = tuple(0.5 for _ in DIMENSIONS)


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------


# Below this many characters of plot text the extractor's own confidence drops
# a full step (DEMO_DATA_PLAN §7.5: 0.45-0.55 against 0.64 above 2,000 on this
# catalog), so a second plot in Arabic is appended when the fixture has one.
PLOT_SHORT_CHARS = 2000
AR_EVIDENCE_SUFFIX = "+ar-evidence"


def uses_arabic_evidence(entry: Dict[str, Any]) -> bool:
    """True when the entry carries an Arabic plot and its English plot is short."""
    evidence = entry.get("evidence") or {}
    plot_ar = evidence.get("plotSummaryAr") or ""
    plot = evidence.get("plotSummary") or ""
    return bool(plot_ar) and plot_ar != plot and len(plot) < PLOT_SHORT_CHARS


def build_evidence(entry: Dict[str, Any]) -> Dict[str, Any]:
    """
    The evidence payload for one fixture entry, in the worker's argument names.

    The English description is used when it is a real Wikipedia lead; when it
    is only Wikidata's stub ("1955 film"), the Arabic lead is the real
    description (fetch-catalog.ts marks this in `descriptionSource`). When the
    English plot is short and the fixture carries the Arabic Wikipedia plot
    section (fetch-evidence-ar.ts), that section is appended as a second plot
    and its article joins the source ids -- more evidence for the same film,
    never a different film.
    """
    evidence = entry.get("evidence") or {}
    description_source = entry.get("descriptionSource")
    description = entry.get("description") or ""
    if description_source != "wikipedia:en" and entry.get("descriptionAr"):
        description = entry["descriptionAr"]
    plot = evidence.get("plotSummary") or ""
    arabic = uses_arabic_evidence(entry)
    source_ids = list(evidence.get("sourceIds") or [])
    if arabic:
        plot = f"{plot}\n\n[Plot section of the Arabic Wikipedia article]\n{evidence['plotSummaryAr']}".strip()
        if evidence.get("plotSourceAr") and evidence["plotSourceAr"] not in source_ids:
            source_ids.append(evidence["plotSourceAr"])

    context_parts = []
    if entry.get("releaseYear"):
        context_parts.append(f"Year: {entry['releaseYear']}")
    if entry.get("genres"):
        context_parts.append(f"Genres: {', '.join(entry['genres'])}")
    if entry.get("country"):
        context_parts.append(f"Country: {entry['country']}")
    if entry.get("originalLanguage"):
        context_parts.append(f"Original language: {entry['originalLanguage']}")
    if entry.get("titleAr"):
        context_parts.append(f"Arabic title: {entry['titleAr']}")
    plot_source = evidence.get("plotSource")
    if plot_source and str(plot_source).endswith(":lead"):
        context_parts.append("Evidence note: no plot section was available; the plot text is only the article lead")
    if arabic:
        context_parts.append("Evidence note: the English plot is short; the Arabic Wikipedia plot section follows it as second evidence for the same film")

    return {
        "title": entry.get("titleEn") or entry.get("titleAr") or entry["internalId"],
        "description": description,
        "plot_summary": plot,
        "additional_context": "; ".join(context_parts) or None,
        "source_ids": source_ids,
        "has_plot": bool(plot),
        "uses_arabic_evidence": arabic,
    }


def needs_arabic_evidence_extraction(entry: Dict[str, Any], force: bool = False) -> bool:
    """A title whose evidence would now include the Arabic plot but whose V1 fingerprint was made without it."""
    fingerprint = entry.get("fingerprint")
    if not isinstance(fingerprint, dict) or not uses_arabic_evidence(entry):
        return False
    return force or AR_EVIDENCE_SUFFIX not in str(fingerprint.get("extractorVersion") or "")


def stamp_arabic_evidence(fingerprint: Dict[str, Any]) -> Dict[str, Any]:
    """Mark a V1 fingerprint as extracted with the Arabic plot appended (a different evidence policy is a different version)."""
    version = str(fingerprint.get("extractorVersion") or "")
    if AR_EVIDENCE_SUFFIX not in version:
        fingerprint["extractorVersion"] = f"{version}{AR_EVIDENCE_SUFFIX}"
    return fingerprint


def needs_extraction(entry: Dict[str, Any], force: bool = False, extractor_version: str = EXTRACTOR_VERSION) -> bool:
    """One extraction per (title, extractorVersion): current or current+partial is done."""
    if force:
        return True
    fingerprint = entry.get("fingerprint")
    if not isinstance(fingerprint, dict):
        return True
    version = fingerprint.get("extractorVersion")
    return version not in (extractor_version, f"{extractor_version}{PARTIAL_SUFFIX}")


def needs_block_extraction(entry: Dict[str, Any], block_key: str, extractor_version: str, force: bool = False) -> bool:
    """
    A nested block (v2, v3) hangs off a V1 fingerprint (FINGERPRINT_SCHEMA.md
    §3.1, §3.3); a title without one is skipped, and one already carrying the
    current extractor version of that block is done unless forced.
    """
    fingerprint = entry.get("fingerprint")
    if not isinstance(fingerprint, dict):
        return False
    if force:
        return True
    block = fingerprint.get(block_key)
    return not (isinstance(block, dict) and block.get("extractorVersion") == extractor_version)


def needs_v2_extraction(entry: Dict[str, Any], force: bool = False, extractor_version: str = V2_EXTRACTOR_VERSION) -> bool:
    return needs_block_extraction(entry, "v2", extractor_version, force)


def needs_v3_extraction(entry: Dict[str, Any], force: bool = False, extractor_version: str = V3_EXTRACTOR_VERSION) -> bool:
    return needs_block_extraction(entry, "v3", extractor_version, force)


def enrich_entry_v2(worker: FilmEnrichmentWorker, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Run the V2 extraction on one entry and return the `v2` block."""
    evidence = build_evidence(entry)
    return worker.generate_fingerprint_v2(
        title=evidence["title"],
        description=evidence["description"],
        plot_summary=evidence["plot_summary"],
        additional_context=evidence["additional_context"],
        source_ids=evidence["source_ids"],
        internal_id=entry.get("internalId"),
    )


def enrich_entry_v3(worker: FilmEnrichmentWorker, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Run the third-block extraction on one entry and return the `v3` block."""
    evidence = build_evidence(entry)
    return worker.generate_fingerprint_v3(
        title=evidence["title"],
        description=evidence["description"],
        plot_summary=evidence["plot_summary"],
        additional_context=evidence["additional_context"],
        source_ids=evidence["source_ids"],
        internal_id=entry.get("internalId"),
    )


def placeholder_fingerprint(entry: Dict[str, Any], seed: int = 20260903) -> Dict[str, Any]:
    """
    Deterministic genre-centroid vector with seeded jitter, labelled as a
    placeholder in every provenance field so it is never mistaken for an
    extraction. Same entry + seed -> same vector, run after run.
    """
    centroids = [GENRE_CENTROIDS[genre] for genre in entry.get("genres") or [] if genre in GENRE_CENTROIDS]
    base = [sum(values) / len(centroids) for values in zip(*centroids)] if centroids else list(NEUTRAL_CENTROID)
    digest = hashlib.sha256(f"{seed}:{entry['internalId']}".encode("utf-8")).digest()
    vector: Dict[str, float] = {}
    for index, dimension in enumerate(DIMENSIONS):
        # One byte of the digest per dimension -> jitter in [-0.12, 0.12].
        jitter = (digest[index] / 255.0 - 0.5) * 0.24
        vector[dimension] = round(min(0.95, max(0.05, base[index] + jitter)), 3)
    return {
        "schemaVersion": "film-fingerprint-v1",
        **vector,
        "themes": [genre.lower() for genre in entry.get("genres") or []],
        # Uniformly low: a centroid is a guess about the genre, not about the film.
        "confidence": {dimension: 0.3 for dimension in DIMENSIONS},
        "generatedBy": "placeholder",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "modelVersion": None,
        "sourceIds": [],
        "extractorVersion": PLACEHOLDER_VERSION,
        "licenseStatus": "unknown",
        "reviewStatus": "unreviewed",
    }


def make_partial(fingerprint: Dict[str, Any]) -> Dict[str, Any]:
    """Remove two dimensions (absence = unknown, never zero; ADR-19) and mark the version."""
    partial = {key: value for key, value in fingerprint.items() if key not in PARTIAL_DIMENSIONS}
    confidence = dict(partial.get("confidence") or {})
    for dimension in PARTIAL_DIMENSIONS:
        confidence.pop(dimension, None)
    partial["confidence"] = confidence
    version = str(partial.get("extractorVersion") or "")
    if not version.endswith(PARTIAL_SUFFIX):
        partial["extractorVersion"] = f"{version}{PARTIAL_SUFFIX}"
    return partial


def enrich_entry(worker: FilmEnrichmentWorker, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Run the worker on one entry and return the fingerprint as a JSON-ready dict."""
    evidence = build_evidence(entry)
    fingerprint = worker.generate_fingerprint(
        title=evidence["title"],
        description=evidence["description"],
        plot_summary=evidence["plot_summary"],
        additional_context=evidence["additional_context"],
        source_ids=evidence["source_ids"],
        internal_id=entry.get("internalId"),
    )
    return fingerprint.model_dump(mode="json")


def load_fixture(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        entries = json.load(handle)
    if not isinstance(entries, list):
        raise ValueError(f"{path} does not hold a JSON array of catalog entries")
    return entries


def write_fixture(path: Path, entries: List[Dict[str, Any]]) -> None:
    """Atomic: write next to the target, then replace, so a crash never leaves a half file."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(entries, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def select_entries(entries: Iterable[Dict[str, Any]], only: Optional[str], limit: Optional[int]) -> List[Dict[str, Any]]:
    selected = [entry for entry in entries if only is None or entry.get("internalId") == only]
    return selected[:limit] if limit else selected


# ---------------------------------------------------------------------------
# Database write-through (optional)
# ---------------------------------------------------------------------------


def write_fingerprints_to_db(entries: List[Dict[str, Any]]) -> int:
    """UPDATE titles.fingerprint for already-seeded rows, matched by internalId. Returns rows updated."""
    import psycopg2  # imported here so the fixture-only path needs no database driver

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for --write-db")
    updated = 0
    with psycopg2.connect(database_url) as connection, connection.cursor() as cursor:
        for entry in entries:
            if not isinstance(entry.get("fingerprint"), dict):
                continue
            cursor.execute(
                'UPDATE titles SET fingerprint = %s::json, "updatedAt" = now() WHERE "internalId" = %s',
                (json.dumps(entry["fingerprint"]), entry["internalId"]),
            )
            updated += cursor.rowcount
    return updated


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def build_report(
    fixture: Path,
    entries: List[Dict[str, Any]],
    results: Dict[str, Tuple[str, str]],
    mode: str,
    elapsed: float,
    calls: Optional[List[Dict[str, Any]]] = None,
    run_id: Optional[str] = None,
) -> str:
    done = [entry for entry in entries if isinstance(entry.get("fingerprint"), dict)]
    versions: Dict[str, int] = {}
    models: Dict[str, int] = {}
    block_versions: Dict[str, Dict[str, int]] = {name: {} for name in BLOCKS}
    block_confidence: Dict[str, Dict[str, List[float]]] = {name: {} for name in BLOCKS}
    for entry in done:
        fingerprint = entry["fingerprint"]
        versions[str(fingerprint.get("extractorVersion"))] = versions.get(str(fingerprint.get("extractorVersion")), 0) + 1
        models[str(fingerprint.get("modelVersion"))] = models.get(str(fingerprint.get("modelVersion")), 0) + 1
        for name, (block_key, _) in BLOCKS.items():
            block = fingerprint.get(block_key)
            if isinstance(block, dict):
                key = f"{block.get('extractorVersion')} / {block.get('modelVersion')}"
                block_versions[name][key] = block_versions[name].get(key, 0) + 1
                for feature, value in (block.get("confidence") or {}).items():
                    if isinstance(value, (int, float)):
                        block_confidence[name].setdefault(feature, []).append(float(value))
    failures = [(internal_id, detail) for internal_id, (status, detail) in results.items() if status == "failed"]
    refusals = [(internal_id, detail) for internal_id, detail in failures if "refused" in detail.lower()]
    confidences = [
        value
        for entry in done
        for value in (entry["fingerprint"].get("confidence") or {}).values()
        if isinstance(value, (int, float))
    ]
    mean_confidence = sum(confidences) / len(confidences) if confidences else None
    lines = [
        "# Demo catalog — enrichment report",
        "",
        f"Generated by `services/workers/src/enrich_catalog.py` on {datetime.now(timezone.utc).date().isoformat()} "
        f"(mode: {mode}; {elapsed:.0f} s).",
        f"Fixture: `{fixture.name}` · entries: {len(entries)} · with fingerprint: {len(done)} · "
        f"extracted this run: {sum(1 for status, _ in results.values() if status == 'done')} · "
        f"skipped (already current): {sum(1 for status, _ in results.values() if status == 'skipped')} · "
        f"failed: {len(failures)}.",
        "",
        "## Provenance",
        "",
        "| extractorVersion | Titles |",
        "|---|---|",
        *[f"| {version} | {count} |" for version, count in sorted(versions.items())],
        "",
        "| modelVersion (as served) | Titles |",
        "|---|---|",
        *[f"| {model} | {count} |" for model, count in sorted(models.items())],
        "",
        f"Mean per-dimension confidence reported by the extractor: {mean_confidence:.2f}" if mean_confidence is not None else "No confidence values yet.",
        "",
        *[
            line
            for name in BLOCKS
            for line in [
                f"| {name.upper()} block (extractorVersion / modelVersion) | Titles |",
                "|---|---|",
                *([f"| {key} | {count} |" for key, count in sorted(block_versions[name].items())] or ["| none | 0 |"]),
                "",
            ]
        ],
        *[
            line
            for name in BLOCKS
            if block_confidence[name]
            for line in [
                f"| {name.upper()} feature | Mean confidence |",
                "|---|---|",
                *[f"| `{feature}` | {sum(values) / len(values):.2f} |" for feature, values in sorted(block_confidence[name].items())],
                "",
            ]
        ],
        f"## Failures ({len(failures)})",
        "",
        "None." if not failures else "\n".join(["| Id | Detail |", "|---|---|", *[f"| {internal_id} | {detail.replace('|', '/')} |" for internal_id, detail in failures]]),
        "",
        f"Refusals among them: {len(refusals)} — each is a human-review item (BP §15.4), never re-tried blindly.",
        "",
        "## Rules",
        "",
        "- Evidence sent: the fixture's own Wikipedia lead and plot text plus year/genres/country/language; never user data. "
        "When the English plot is under 2,000 characters and the fixture carries the Arabic Wikipedia plot section, that section is appended "
        "(`+ar-evidence` in the version).",
        "- One extraction per (title, extractorVersion); `--force` is the only way to overwrite.",
        "- `licenseStatus` stays `unknown` and `reviewStatus` `unreviewed`: a development fixture, not a rights registry.",
        "",
        format_calls_table(list(calls or []), run_id),
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fingerprint the demo catalog fixture")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--only", help="internalId of a single entry")
    parser.add_argument("--limit", type=int, help="stop after N candidate entries")
    parser.add_argument("--force", action="store_true", help="re-extract even when the fingerprint is current")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--placeholder", action="store_true", help="fill deterministic placeholders instead of calling the model")
    parser.add_argument("--v2", action="store_true", help="extract the V2 families into fingerprint.v2 (V1 must already exist)")
    parser.add_argument("--v3", action="store_true", help="extract the third block (form families) into fingerprint.v3 (V1 must already exist)")
    parser.add_argument("--partial-ids", default=",".join(DEFAULT_PARTIAL_IDS), help="comma-separated ids to leave partial ('' for none)")
    parser.add_argument(
        "--ar-evidence",
        action="store_true",
        help="re-extract V1 only for titles whose short English plot now gets the Arabic plot appended and whose fingerprint predates that",
    )
    parser.add_argument("--write-db", action="store_true", help="also UPDATE titles.fingerprint for seeded rows (DATABASE_URL)")
    parser.add_argument("--dry-run", action="store_true", help="print the evidence that would be sent, change nothing")
    parser.add_argument("--seed", type=int, default=20260903, help="placeholder generator seed")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    # override=False: an exported key in the shell wins over the file, and an
    # empty ANTHROPIC_API_KEY= line in .env cannot blank a real one.
    load_dotenv(REPO_ROOT / ".env", override=False)

    entries = load_fixture(args.fixture)
    selected = select_entries(entries, args.only, None)
    block_name = "v3" if args.v3 else "v2" if args.v2 else None
    if args.v2 and args.v3:
        print("give one of --v2 / --v3 per run: each block is its own extraction and report", file=sys.stderr)
        return 2
    if block_name and args.placeholder:
        print(f"--{block_name} has no placeholder mode: the families exist only as extractions", file=sys.stderr)
        return 2
    block_key, block_version = BLOCKS[block_name] if block_name else (None, None)
    if args.ar_evidence and (block_key or args.placeholder):
        print("--ar-evidence re-extracts V1 with the model; it does not combine with --v2/--v3/--placeholder", file=sys.stderr)
        return 2
    needing = [
        entry
        for entry in selected
        if (
            needs_arabic_evidence_extraction(entry, args.force)
            if args.ar_evidence
            else needs_block_extraction(entry, block_key, block_version, args.force)
            if block_key
            else needs_extraction(entry, args.force)
        )
    ]
    candidates = needing[: args.limit] if args.limit else needing
    candidate_ids = {entry["internalId"] for entry in candidates}
    partial_ids = {value.strip() for value in args.partial_ids.split(",") if value.strip()}
    mode = block_name if block_name else "placeholder" if args.placeholder else "ar-evidence" if args.ar_evidence else "anthropic"
    print(
        f"enrich: {len(entries)} entries in {args.fixture.name}; {len(needing)} need extraction, "
        f"{len(candidates)} in this run ({mode})"
    )

    if args.dry_run:
        for entry in candidates:
            evidence = build_evidence(entry)
            print(f"  {entry['internalId']} {evidence['title']}: description {len(evidence['description'])} chars, "
                  f"plot {len(evidence['plot_summary'])} chars, context: {evidence['additional_context']}")
        return 0

    results: Dict[str, Tuple[str, str]] = {}
    needing_ids = {entry["internalId"] for entry in needing}
    for entry in selected:
        if entry["internalId"] not in needing_ids:
            results[entry["internalId"]] = ("skipped", "fingerprint already current")
    # Entries that need extraction but fall outside --limit get no result row:
    # they are simply left for the next run.

    started = time.monotonic()
    lock = threading.Lock()
    completed_since_write = 0
    calls: List[Dict[str, Any]] = []
    run_id: Optional[str] = None

    def finish(entry: Dict[str, Any], fingerprint: Optional[Dict[str, Any]], error: Optional[str]) -> None:
        nonlocal completed_since_write
        with lock:
            if fingerprint is not None:
                if block_key:
                    # A nested block hangs off the existing V1 fingerprint; V1 keys and the other blocks are untouched.
                    entry["fingerprint"][block_key] = fingerprint
                else:
                    # A V1 re-extraction replaces the top-level keys only: the nested
                    # blocks (v2, v3) were made from their own evidence and stay.
                    previous = entry.get("fingerprint") if isinstance(entry.get("fingerprint"), dict) else {}
                    if uses_arabic_evidence(entry):
                        fingerprint = stamp_arabic_evidence(fingerprint)
                    fresh = make_partial(fingerprint) if entry["internalId"] in partial_ids else fingerprint
                    for nested_key in ("v2", "v3"):
                        if isinstance(previous.get(nested_key), dict):
                            fresh[nested_key] = previous[nested_key]
                    entry["fingerprint"] = fresh
                results[entry["internalId"]] = ("done", "")
                print(f"  ✓ {entry['internalId']} {entry.get('titleEn')}")
            else:
                results[entry["internalId"]] = ("failed", error or "unknown error")
                print(f"  ✗ {entry['internalId']} {entry.get('titleEn')}: {error}")
            completed_since_write += 1
            if completed_since_write >= WRITE_EVERY:
                write_fixture(args.fixture, entries)
                completed_since_write = 0

    if args.placeholder:
        for entry in candidates:
            finish(entry, placeholder_fingerprint(entry, args.seed), None)
    elif candidates:
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            print("  note: ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN not set; relying on an `ant auth login` profile if one exists")
        worker = FilmEnrichmentWorker()
        # One accounting file per run, named by mode and time (G7).
        worker.run_id = os.environ.get("LLM_RUN_ID") or f"enrich-{mode}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"

        extract = enrich_entry_v3 if args.v3 else enrich_entry_v2 if args.v2 else enrich_entry

        def run(entry: Dict[str, Any]) -> None:
            try:
                finish(entry, extract(worker, entry), None)
            except Exception as error:  # noqa: BLE001 -- one bad title must not kill the pool; it is reported
                finish(entry, None, f"{type(error).__name__}: {error}")

        with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
            for future in as_completed([pool.submit(run, entry) for entry in candidates]):
                future.result()
        recorded = getattr(worker, "calls", None)
        calls = list(recorded) if isinstance(recorded, list) else []
        run_id = worker.run_id if isinstance(getattr(worker, "run_id", None), str) else None

    write_fixture(args.fixture, entries)
    elapsed = time.monotonic() - started
    report_path = args.fixture.with_name(
        args.fixture.stem + (f".enrichment-{block_name}-report.md" if block_name else ".enrichment-ar-evidence-report.md" if args.ar_evidence else ".enrichment-report.md")
    )
    report_path.write_text(build_report(args.fixture, entries, results, mode, elapsed, calls, run_id), encoding="utf-8")

    if args.write_db:
        updated = write_fingerprints_to_db([entry for entry in entries if results.get(entry["internalId"], ("", ""))[0] == "done"])
        print(f"  database: {updated} titles updated")

    failed = sum(1 for status, _ in results.values() if status == "failed")
    done = sum(1 for status, _ in results.values() if status == "done")
    current = sum(1 for status, _ in results.values() if status == "skipped")
    left = len(needing) - len(candidate_ids)
    print(
        f"\n{done} extracted, {failed} failed, {current} already current, {left} left for a later run "
        f"→ {args.fixture.name}; report → {report_path.name}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
