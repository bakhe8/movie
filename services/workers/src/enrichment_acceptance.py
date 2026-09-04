"""
Enrichment acceptance tests (board C-4; ALPHA_PLAN item 5.5; BP §15.4).

Two of the six axes in BP §15.4's table -- the two ALPHA_PLAN item 5.5 scopes
for this pass, "run before publishing any batch":

  stability   -- re-extract the same input with the same extractor version;
                 gate: drift within a bound, otherwise freeze and investigate.
                 `drift` / `drift_gate` here, over two fixture snapshots.
  human review -- a human-reviewed sample's measured agreement with the
                 extraction it corrects. That side reads Postgres
                 (`content_features` rows the admin board writes,
                 `apps/backend/src/scripts/measure-review-agreement.ts`); this
                 module is the fixture-only stability half.

Schema validity, spoilers, usefulness and cost (the other four rows) are out
of this pass's scope.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

# Default bound: real evidence from the Arabic-evidence re-extraction (plan
# §7.5) put every V1 dimension's mean |delta| between two runs of the *same*
# evidence at 0.01-0.04, except `linearity` at 0.10-0.13 with outright flips
# on a tenth of titles -- a wording ambiguity in that one scale, not noise.
# 0.08 sits between the two, so it passes the stable dimensions and fails
# exactly the one the real data flagged.
DEFAULT_DRIFT_THRESHOLD = 0.08

V1_KEYS = (
    "pacing", "rhythmVariance", "ambiguity", "psychologicalDepth", "warmth", "darkness", "linearity",
    "dialogueDensity", "actionIntensity", "plotComplexity", "visualComplexity", "soundscapeComplexity", "colorSaturation",
)


def _nested_features(fingerprint: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Namespaced keys from whichever nested block has them (v2, v3) -- block-agnostic, like the trainer's feature_vector()."""
    merged: Dict[str, Any] = {}
    for block_key in ("v2", "v3"):
        block = (fingerprint or {}).get(block_key)
        if isinstance(block, dict) and isinstance(block.get("features"), dict):
            merged.update(block["features"])
    return merged


def feature_value(fingerprint: Optional[Dict[str, Any]], key: str) -> Optional[float]:
    """A single dimension's value, V1 at the top level or namespaced from a nested block; None if missing/non-numeric (unknown, never 0)."""
    if not isinstance(fingerprint, dict):
        return None
    value = _nested_features(fingerprint).get(key) if "." in key else fingerprint.get(key)
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


@dataclass
class DriftRow:
    internal_id: str
    key: str
    baseline: float
    current: float

    @property
    def delta(self) -> float:
        return abs(self.current - self.baseline)


@dataclass
class DriftSummary:
    key: str
    n: int
    mean_abs_delta: float
    max_abs_delta: float
    flagged: int  # |delta| >= a per-title flag threshold (a fixed marker, independent of the gate bound)

    def to_dict(self) -> Dict[str, Any]:
        return {"key": self.key, "n": self.n, "meanAbsDelta": round(self.mean_abs_delta, 4), "maxAbsDelta": round(self.max_abs_delta, 4), "flagged": self.flagged}


def compute_drift(
    baseline: Dict[str, Dict[str, Any]],
    current: Dict[str, Dict[str, Any]],
    keys: Sequence[str] = V1_KEYS,
    flag_threshold: float = 0.4,
) -> List[DriftRow]:
    """
    One row per (title, key) present with a known value in *both* snapshots
    (a key unknown in either counts as no comparison, not a drift of 0 --
    ADR-19). `baseline`/`current` are internalId -> fingerprint dict.
    """
    rows: List[DriftRow] = []
    for internal_id, current_fp in current.items():
        baseline_fp = baseline.get(internal_id)
        if baseline_fp is None:
            continue
        for key in keys:
            before = feature_value(baseline_fp, key)
            after = feature_value(current_fp, key)
            if before is not None and after is not None:
                rows.append(DriftRow(internal_id, key, before, after))
    return rows


def summarize_drift(rows: Sequence[DriftRow], flag_threshold: float = 0.4) -> List[DriftSummary]:
    """One row per key, sorted by mean |delta| descending -- the least stable dimension first."""
    by_key: Dict[str, List[DriftRow]] = {}
    for row in rows:
        by_key.setdefault(row.key, []).append(row)
    summaries = [
        DriftSummary(
            key=key,
            n=len(members),
            mean_abs_delta=sum(row.delta for row in members) / len(members),
            max_abs_delta=max(row.delta for row in members),
            flagged=sum(1 for row in members if row.delta >= flag_threshold),
        )
        for key, members in by_key.items()
    ]
    return sorted(summaries, key=lambda summary: summary.mean_abs_delta, reverse=True)


def drift_gate(summaries: Sequence[DriftSummary], threshold: float = DEFAULT_DRIFT_THRESHOLD) -> List[str]:
    """Keys whose mean |delta| exceeds the bound -- BP §15.4's 'freeze and investigate' list. Empty means the gate passes."""
    return [summary.key for summary in summaries if summary.mean_abs_delta > threshold]


def format_drift_report(summaries: Sequence[DriftSummary], threshold: float, failing: Sequence[str]) -> str:
    lines = [
        "# Enrichment acceptance — stability (BP §15.4, board C-4)",
        "",
        f"Re-extraction drift between two snapshots of the same titles, {len(summaries)} dimension(s) compared, gate bound {threshold} (mean |Δ|).",
        "",
        "| Dimension | n | mean \\|Δ\\| | max \\|Δ\\| | flagged (\\|Δ\\|≥0.4) |",
        "|---|---|---|---|---|",
        *[f"| `{s.key}` | {s.n} | {s.mean_abs_delta:.3f} | {s.max_abs_delta:.3f} | {s.flagged} |" for s in summaries],
        "",
        "**Gate: FAIL — freeze and investigate**" if failing else "**Gate: PASS**",
        "",
        (f"Dimensions over the bound: {', '.join(f'`{k}`' for k in failing)} — do not cite these as displayed reasons until re-worded and re-extracted." if failing else "No dimension exceeded the bound."),
        "",
    ]
    return "\n".join(lines)


def _load_by_internal_id(path: Path) -> Dict[str, Dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    entries = raw["entries"] if isinstance(raw, dict) else raw
    return {entry["internalId"]: entry.get("fingerprint") for entry in entries}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Enrichment acceptance tests (BP §15.4)")
    sub = parser.add_subparsers(dest="command", required=True)
    drift_parser = sub.add_parser("drift", help="stability: drift between two fixture snapshots")
    drift_parser.add_argument("--baseline", type=Path, required=True)
    drift_parser.add_argument("--current", type=Path, required=True)
    drift_parser.add_argument("--threshold", type=float, default=DEFAULT_DRIFT_THRESHOLD)
    drift_parser.add_argument("--report", type=Path, help="write the report here (default: alongside --current)")
    drift_parser.add_argument("--only", help="comma-separated internalIds to scope the comparison to (a just-processed batch), else every title in both snapshots")
    args = parser.parse_args(argv)

    baseline = _load_by_internal_id(args.baseline)
    current = _load_by_internal_id(args.current)
    if args.only:
        wanted = {value.strip() for value in args.only.split(",") if value.strip()}
        baseline = {k: v for k, v in baseline.items() if k in wanted}
        current = {k: v for k, v in current.items() if k in wanted}
    rows = compute_drift(baseline, current)
    summaries = summarize_drift(rows)
    failing = drift_gate(summaries, args.threshold)
    report = format_drift_report(summaries, args.threshold, failing)
    report_path = args.report or args.current.with_name(args.current.stem + ".drift-report.md")
    report_path.write_text(report, encoding="utf-8")
    print(f"drift: {len(rows)} comparisons across {len(summaries)} dimension(s) → {report_path.name}")
    print("GATE: FAIL" if failing else "GATE: PASS")
    if failing:
        print(f"  over bound ({args.threshold}): {', '.join(failing)}")
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
