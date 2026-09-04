"""
Offline evaluation protocol and the model acceptance gate
(BP §16.1–§16.5; RANKING_ALGORITHM.md §6–§8; ALPHA_PLAN phase 6, item 6.1).

    python -m src.evaluation [--exclude-domain demo.local ...] [--min-triads 30]
                             [--min-profiles 3] [--margin 0.03] [--bootstrap 1000]
                             [--seed 0] [--out report.json] [--label <model version>]

What it does, per profile with at least five completed triads whose three
titles all carry every served fingerprint key:

1. Temporal split exactly as the trainer applies it (the most recent
   floor(0.2 n) triads held out; whole triads stay on one side).
2. Fit the served model (Plackett–Luce over training.FINGERPRINT_DIMENSIONS,
   whatever the trainer serves at the time -- 40 keys since ADR-75) on the training
   side only. The L2 strength is chosen on an inner temporal split of the
   training side, never on the held-out slice, so the gate's held-out
   numbers are untouched by model selection.
3. Score the held-out triads with the model and with three simpler
   alternatives (BP §16.3): random, popularity (how many profiles watched the
   title), genre match (the profile's own winning genres on the training
   side), and one ablation, the pre-ADR-69 V1-only Plackett–Luce model.
4. Pool the held-out triads across profiles; report pairwise accuracy,
   top-1 accuracy, Kendall τ, the model's NLL, 95% cluster-bootstrap
   intervals (resampling profiles, since a profile's triads are not
   independent), and slices by triad language and by evidence size.
5. Decide the gate with thresholds fixed *before* the run (CLI flags,
   defaults below), and print a JSON report that `POST /admin/models`
   accepts as `evalReport`.

Exit codes: 0 gate passed · 1 gate failed · 2 insufficient data.

Read-only: nothing is written to the database. Baseline popularity is
computed over the whole `user_title_states` table as it stands (not frozen
at each profile's cutoff) — a known simplification favouring the baseline,
so it cannot flatter the model.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from .ranker import PlackettLuceRanker
from .training import (
    FINGERPRINT_V1_DIMENSIONS,
    REGULARIZATION_GRID,
    TRAINABLE_TRIAD_PREDICATE,
    TriadEvent,
    fingerprint_vector,
    load_trainable_triads,
)

Scorer = Callable[[str], float]

RANDOM_NLL = math.log(6.0)  # uniform over the 6 orders of a triad
MODEL_NAME = "pl_served"
BASELINES = ("random", "popularity", "genre_match", "pl_v1")


# ---------------------------------------------------------------------------
# Data


@dataclass
class ProfileData:
    profile_id: str
    triads: List[TriadEvent]  # oldest first, every served fingerprint key present on all three titles
    fingerprints: Dict[str, np.ndarray]  # served-key vectors (training.FINGERPRINT_DIMENSIONS)
    fingerprints_v1: Dict[str, np.ndarray]  # 13-key vectors
    genres: Dict[str, List[str]]
    languages: Dict[str, Optional[str]]


@dataclass
class GateThresholds:
    min_triads: int = 30
    min_profiles: int = 3
    margin: float = 0.03
    slice_min_triads: int = 20
    slice_tolerance: float = 0.05
    bootstrap: int = 1000
    seed: int = 0


@dataclass
class TriadScore:
    profile_id: str
    language: str
    evidence: str
    # per scorer name -> (pairwise correct, pairwise total, top1 hit)
    pairwise: Dict[str, Tuple[float, int]] = field(default_factory=dict)
    top1: Dict[str, float] = field(default_factory=dict)
    nll: Dict[str, float] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Pure pieces


def temporal_split(triads: List[TriadEvent]) -> Tuple[List[TriadEvent], List[TriadEvent]]:
    """RANKING_ALGORITHM.md §6 step 2, as the trainer applies it."""
    n = len(triads)
    if n < 5:
        return triads, []
    held = max(1, n // 5)
    return triads[:-held], triads[-held:]


def pairwise_hits(triad: TriadEvent, scorer: Scorer) -> Tuple[float, int]:
    """Correct pairs (ties count half) and total pairs for one triad."""
    ids, ranking = triad
    correct = 0.0
    total = 0
    for i in range(3):
        for j in range(i + 1, 3):
            better, worse = ids[ranking[i]], ids[ranking[j]]
            a, b = scorer(better), scorer(worse)
            if a > b:
                correct += 1.0
            elif a == b:
                correct += 0.5
            total += 1
    return correct, total


def top1_hit(triad: TriadEvent, scorer: Scorer) -> float:
    """1 when the scorer's best is the user's first; ties share the credit."""
    ids, ranking = triad
    scores = [scorer(t) for t in ids]
    best = max(scores)
    winners = [k for k, s in enumerate(scores) if s == best]
    return 1.0 / len(winners) if ranking[0] in winners else 0.0


def triad_nll(triad: TriadEvent, scorer: Scorer) -> float:
    """Plackett–Luce NLL of the observed order under the scorer's utilities."""
    ids, ranking = triad
    scores = np.array([scorer(t) for t in ids], dtype=float)
    total = 0.0
    for pos in range(2):
        remaining = scores[ranking[pos:]]
        m = float(np.max(remaining))
        total -= float(scores[ranking[pos]] - (m + math.log(float(np.sum(np.exp(remaining - m))))))
    return total


def genre_match_scorer(train: Sequence[TriadEvent], genres: Dict[str, List[str]]) -> Scorer:
    """
    BP §16.3 "simple genre/content similarity": on the training side, every
    genre of a triad's winner earns +1 and every genre of its loser −1; a
    title then scores the sum over its genres. No fingerprint, no fitting.
    """
    weight: Counter[str] = Counter()
    for ids, ranking in train:
        for g in genres.get(ids[ranking[0]], []):
            weight[g] += 1.0
        for g in genres.get(ids[ranking[2]], []):
            weight[g] -= 1.0
    return lambda title_id: float(sum(weight.get(g, 0.0) for g in genres.get(title_id, [])))


def popularity_scorer(popularity: Dict[str, int]) -> Scorer:
    return lambda title_id: float(popularity.get(title_id, 0))


def constant_scorer() -> Scorer:
    return lambda _title_id: 0.0


def fit_with_inner_selection(train: List[TriadEvent], fingerprints: Dict[str, np.ndarray], dim: int) -> PlackettLuceRanker:
    """
    Fit on `train`; choose the L2 strength on an inner temporal split of
    `train` (its own last 20%), never on the gate's held-out slice.
    """
    inner_train, inner_val = temporal_split(train)
    chosen = REGULARIZATION_GRID[0]
    if inner_val:
        best_nll: Optional[float] = None
        for candidate in REGULARIZATION_GRID:
            r = PlackettLuceRanker(dim, regularization=candidate)
            r.fit(inner_train, fingerprints, population_priors=None)
            scorer = model_scorer(r, fingerprints)
            nll = float(np.mean([triad_nll(t, scorer) for t in inner_val]))
            if best_nll is None or nll < best_nll:
                best_nll, chosen = nll, candidate
    ranker = PlackettLuceRanker(dim, regularization=chosen)
    ranker.fit(train, fingerprints, population_priors=None)
    return ranker


def model_scorer(ranker: PlackettLuceRanker, fingerprints: Dict[str, np.ndarray]) -> Scorer:
    return lambda title_id: float(ranker.predict_score(title_id, fingerprints[title_id]))


def triad_language(ids: Sequence[str], languages: Dict[str, Optional[str]]) -> str:
    """'ar' / 'en' / 'other' when all three titles agree, 'mixed' otherwise, 'unknown' when any is missing."""
    langs = [languages.get(t) for t in ids]
    if any(not lang for lang in langs):
        return "unknown"
    buckets = {"ar" if lang == "ar" else "en" if lang == "en" else "other" for lang in langs}
    return buckets.pop() if len(buckets) == 1 else "mixed"


def evidence_bucket(train_size: int) -> str:
    if train_size < 5:
        return "lt5"
    if train_size < 10:
        return "5-9"
    if train_size < 20:
        return "10-19"
    return "20+"


def evaluate_profile(profile: ProfileData, popularity: Dict[str, int]) -> List[TriadScore]:
    """Held-out triad scores for the served model and every baseline; [] when nothing is held out."""
    train, held = temporal_split(profile.triads)
    if not held:
        return []
    dim = next(iter(profile.fingerprints.values())).shape[0]
    served = fit_with_inner_selection(train, profile.fingerprints, dim)
    scorers: Dict[str, Scorer] = {
        MODEL_NAME: model_scorer(served, profile.fingerprints),
        "random": constant_scorer(),
        "popularity": popularity_scorer(popularity),
        "genre_match": genre_match_scorer(train, profile.genres),
    }
    if profile.fingerprints_v1:
        v1_dim = next(iter(profile.fingerprints_v1.values())).shape[0]
        v1 = fit_with_inner_selection(train, profile.fingerprints_v1, v1_dim)
        scorers["pl_v1"] = model_scorer(v1, profile.fingerprints_v1)

    results: List[TriadScore] = []
    for triad in held:
        score = TriadScore(profile.profile_id, triad_language(triad[0], profile.languages), evidence_bucket(len(train)))
        for name, scorer in scorers.items():
            score.pairwise[name] = pairwise_hits(triad, scorer)
            score.top1[name] = top1_hit(triad, scorer)
        score.nll[MODEL_NAME] = triad_nll(triad, scorers[MODEL_NAME])
        score.nll["random"] = RANDOM_NLL
        if "pl_v1" in scorers:
            score.nll["pl_v1"] = triad_nll(triad, scorers["pl_v1"])
        results.append(score)
    return results


# ---------------------------------------------------------------------------
# Aggregation


def pooled_accuracy(scores: Iterable[TriadScore], name: str) -> Optional[float]:
    correct = total = 0.0
    for s in scores:
        if name in s.pairwise:
            c, t = s.pairwise[name]
            correct += c
            total += t
    return correct / total if total else None


def pooled_top1(scores: Iterable[TriadScore], name: str) -> Optional[float]:
    values = [s.top1[name] for s in scores if name in s.top1]
    return float(np.mean(values)) if values else None


def pooled_nll(scores: Iterable[TriadScore], name: str) -> Optional[float]:
    values = [s.nll[name] for s in scores if name in s.nll]
    return float(np.mean(values)) if values else None


def cluster_bootstrap(
    scores: List[TriadScore],
    statistic: Callable[[List[TriadScore]], Optional[float]],
    resamples: int,
    seed: int,
) -> Tuple[Optional[float], Optional[float]]:
    """95% percentile interval, resampling profiles with replacement."""
    by_profile: Dict[str, List[TriadScore]] = defaultdict(list)
    for s in scores:
        by_profile[s.profile_id].append(s)
    profiles = list(by_profile)
    if len(profiles) < 2 or resamples <= 0:
        return None, None
    rng = np.random.default_rng(seed)
    draws: List[float] = []
    for _ in range(resamples):
        picked = rng.choice(len(profiles), size=len(profiles), replace=True)
        sample = [s for k in picked for s in by_profile[profiles[k]]]
        value = statistic(sample)
        if value is not None:
            draws.append(value)
    if not draws:
        return None, None
    return float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))


def best_baseline(scores: List[TriadScore]) -> Tuple[Optional[str], Optional[float]]:
    best: Tuple[Optional[str], Optional[float]] = (None, None)
    for name in BASELINES:
        acc = pooled_accuracy(scores, name)
        if acc is not None and (best[1] is None or acc > best[1]):
            best = (name, acc)
    return best


def build_report(scores: List[TriadScore], thresholds: GateThresholds, label: str) -> Dict[str, Any]:
    profiles = {s.profile_id for s in scores}
    n = len(scores)
    model_acc = pooled_accuracy(scores, MODEL_NAME)
    baseline_name, baseline_acc = best_baseline(scores)

    def diff(sample: List[TriadScore]) -> Optional[float]:
        a = pooled_accuracy(sample, MODEL_NAME)
        b = pooled_accuracy(sample, baseline_name) if baseline_name else None
        return None if a is None or b is None else a - b

    acc_ci = cluster_bootstrap(scores, lambda s: pooled_accuracy(s, MODEL_NAME), thresholds.bootstrap, thresholds.seed)
    diff_ci = cluster_bootstrap(scores, diff, thresholds.bootstrap, thresholds.seed + 1)

    per_scorer: Dict[str, Dict[str, Optional[float]]] = {}
    for name in (MODEL_NAME, *BASELINES):
        acc = pooled_accuracy(scores, name)
        if acc is None:
            continue
        per_scorer[name] = {
            "pairwiseAccuracy": acc,
            "top1Accuracy": pooled_top1(scores, name),
            "kendallTau": 2 * acc - 1,
            "nll": pooled_nll(scores, name),
        }

    slices: Dict[str, Dict[str, Any]] = {"language": {}, "evidence": {}}
    for axis, key in (("language", lambda s: s.language), ("evidence", lambda s: s.evidence)):
        groups: Dict[str, List[TriadScore]] = defaultdict(list)
        for s in scores:
            groups[key(s)].append(s)
        for group, members in sorted(groups.items()):
            slices[axis][group] = {
                "triads": len(members),
                "model": pooled_accuracy(members, MODEL_NAME),
                "bestBaseline": pooled_accuracy(members, baseline_name) if baseline_name else None,
            }

    checks: List[Dict[str, Any]] = []

    def check(name: str, passed: Optional[bool], value: Any, threshold: Any) -> None:
        checks.append({"name": name, "passed": passed, "value": value, "threshold": threshold})

    sufficient = n >= thresholds.min_triads and len(profiles) >= thresholds.min_profiles
    check("enough_held_out_triads", n >= thresholds.min_triads, n, thresholds.min_triads)
    check("enough_profiles", len(profiles) >= thresholds.min_profiles, len(profiles), thresholds.min_profiles)

    margin_ok = model_acc is not None and baseline_acc is not None and model_acc - baseline_acc >= thresholds.margin
    check(
        "beats_best_baseline_by_margin",
        margin_ok if sufficient else None,
        None if model_acc is None or baseline_acc is None else model_acc - baseline_acc,
        thresholds.margin,
    )
    ci_ok = diff_ci[0] is not None and diff_ci[0] > 0
    check("difference_ci_excludes_zero", ci_ok if sufficient else None, diff_ci[0], 0)

    model_nll = pooled_nll(scores, MODEL_NAME)
    v1_nll = pooled_nll(scores, "pl_v1")
    nll_ok = model_nll is not None and model_nll < RANDOM_NLL and (v1_nll is None or model_nll <= v1_nll)
    check("nll_improves_on_simpler_models", nll_ok if sufficient else None, model_nll, {"random": RANDOM_NLL, "pl_v1": v1_nll})

    coverage_ok = True
    worst: Optional[Dict[str, Any]] = None
    for group, entry in slices["language"].items():
        if entry["triads"] < thresholds.slice_min_triads or entry["model"] is None or entry["bestBaseline"] is None:
            continue
        gap = entry["model"] - entry["bestBaseline"]
        if worst is None or gap < worst["gap"]:
            worst = {"slice": group, "gap": gap, "triads": entry["triads"]}
        if gap < -thresholds.slice_tolerance:
            coverage_ok = False
    check("no_language_slice_falls_behind", coverage_ok if sufficient else None, worst, -thresholds.slice_tolerance)

    passed = sufficient and all(c["passed"] for c in checks)
    return {
        "protocol": "offline-eval-v1",
        "label": label,
        "gate": {"passed": passed, "sufficient": sufficient, "checks": checks, "thresholds": thresholds.__dict__},
        "heldOut": {"triads": n, "profiles": len(profiles)},
        "model": MODEL_NAME,
        "bestBaseline": baseline_name,
        "scorers": per_scorer,
        "modelAccuracyCi95": acc_ci,
        "differenceCi95": diff_ci,
        "slices": slices,
    }


# ---------------------------------------------------------------------------
# Database


def load_profiles(cursor, exclude_domains: Sequence[str]) -> Tuple[List[ProfileData], Dict[str, int]]:
    # Counted and loaded through training.py's own predicate (H4): the gate
    # must see exactly the triads training would, holdout rows excluded.
    cursor.execute(
        f"""
        SELECT p.id FROM profiles p JOIN users u ON u.id = p."userId"
        WHERE u.active AND NOT EXISTS (SELECT 1 FROM unnest(%s::text[]) d WHERE u.email ILIKE '%%@' || d)
          AND (SELECT COUNT(*) FROM triads t WHERE t."profileId" = p.id AND {TRAINABLE_TRIAD_PREDICATE}) >= 5
        ORDER BY p."createdAt"
        """,
        (list(exclude_domains),),
    )
    profile_ids = [str(r[0]) for r in cursor.fetchall()]
    cursor.execute('SELECT "titleId", COUNT(DISTINCT "profileId") FROM user_title_states WHERE state = %s GROUP BY 1', ("watched",))
    popularity = {str(t): int(c) for t, c in cursor.fetchall()}

    profiles: List[ProfileData] = []
    for profile_id in profile_ids:
        triads = load_trainable_triads(cursor, profile_id)
        wanted = sorted({t for ids, _ in triads for t in ids})
        cursor.execute('SELECT id, fingerprint, genres, "originalLanguage" FROM titles WHERE id = ANY(%s::uuid[])', (wanted,))
        fingerprints: Dict[str, np.ndarray] = {}
        fingerprints_v1: Dict[str, np.ndarray] = {}
        genres: Dict[str, List[str]] = {}
        languages: Dict[str, Optional[str]] = {}
        for title_id, fingerprint, genre_text, language in cursor.fetchall():
            tid = str(title_id)
            fp = json.loads(fingerprint) if isinstance(fingerprint, str) else fingerprint
            if isinstance(fp, dict):
                vector = fingerprint_vector(fp)
                if vector is not None:
                    fingerprints[tid] = vector
                v1 = [fp.get(k) for k in FINGERPRINT_V1_DIMENSIONS]
                if all(isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v) for v in v1):
                    fingerprints_v1[tid] = np.array(v1, dtype=float)
            genres[tid] = [g for g in (genre_text or "").split(",") if g]
            languages[tid] = language
        complete = [t for t in triads if all(i in fingerprints and i in fingerprints_v1 for i in t[0])]
        if len(complete) >= 5:
            profiles.append(ProfileData(profile_id, complete, fingerprints, fingerprints_v1, genres, languages))
    return profiles, popularity


def run(profiles: List[ProfileData], popularity: Dict[str, int], thresholds: GateThresholds, label: str) -> Dict[str, Any]:
    scores: List[TriadScore] = []
    for profile in profiles:
        scores.extend(evaluate_profile(profile, popularity))
    report = build_report(scores, thresholds, label)
    report["profilesEvaluated"] = len(profiles)
    return report


def format_summary(report: Dict[str, Any]) -> str:
    lines = [f"offline evaluation ({report['label']}): held-out {report['heldOut']['triads']} triads over {report['heldOut']['profiles']} profiles"]
    for name, m in report["scorers"].items():
        nll = "—" if m["nll"] is None else f"{m['nll']:.3f}"
        lines.append(f"  {name:12s} pairwise={m['pairwiseAccuracy']:.3f} top1={m['top1Accuracy']:.3f} nll={nll}")
    ci = report["differenceCi95"]
    lines.append(f"  model − best baseline ({report['bestBaseline']}): CI95 {ci}")
    for c in report["gate"]["checks"]:
        state = "n/a" if c["passed"] is None else ("PASS" if c["passed"] else "FAIL")
        lines.append(f"  [{state}] {c['name']}: {c['value']} (threshold {c['threshold']})")
    lines.append("GATE " + ("PASSED" if report["gate"]["passed"] else ("INSUFFICIENT DATA" if not report["gate"]["sufficient"] else "FAILED")))
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    import psycopg2
    import psycopg2.extras
    from dotenv import load_dotenv

    parser = argparse.ArgumentParser(description="Offline evaluation and acceptance gate (BP §16)")
    parser.add_argument("--exclude-domain", action="append", default=[], help="email domain to leave out (repeatable), e.g. demo.local")
    parser.add_argument("--min-triads", type=int, default=GateThresholds.min_triads)
    parser.add_argument("--min-profiles", type=int, default=GateThresholds.min_profiles)
    parser.add_argument("--margin", type=float, default=GateThresholds.margin)
    parser.add_argument("--slice-min-triads", type=int, default=GateThresholds.slice_min_triads)
    parser.add_argument("--slice-tolerance", type=float, default=GateThresholds.slice_tolerance)
    parser.add_argument("--bootstrap", type=int, default=GateThresholds.bootstrap)
    parser.add_argument("--seed", type=int, default=GateThresholds.seed)
    parser.add_argument("--label", default="plackett-luce-v2", help="model version label written into the report")
    parser.add_argument("--out", type=Path, default=None, help="write the JSON report here (evalReport for POST /admin/models)")
    args = parser.parse_args(argv)

    psycopg2.extras.register_uuid()
    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=False)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    thresholds = GateThresholds(
        min_triads=args.min_triads,
        min_profiles=args.min_profiles,
        margin=args.margin,
        slice_min_triads=args.slice_min_triads,
        slice_tolerance=args.slice_tolerance,
        bootstrap=args.bootstrap,
        seed=args.seed,
    )
    # Explicit close: psycopg2's connection context manager only commits/rolls
    # back, it never closes (AUDIT_2026-09-05 C2). Harmless for this one-shot
    # CLI, but kept consistent with training.py's long-running-process fix.
    connection = psycopg2.connect(database_url)
    try:
        with connection, connection.cursor() as cursor:
            profiles, popularity = load_profiles(cursor, args.exclude_domain)
    finally:
        connection.close()
    report = run(profiles, popularity, thresholds, args.label)
    report["excludedDomains"] = list(args.exclude_domain)
    print(format_summary(report))
    if args.out:
        args.out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"report written to {args.out}")
    if not report["gate"]["sufficient"]:
        return 2
    return 0 if report["gate"]["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
