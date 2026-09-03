"""
Offline evaluation of the V2 fingerprint families (FINGERPRINT_SCHEMA.md §3.1).

    python -m src.fingerprint_v2_eval --email claude@judge.local [--email ...] [--all-demo]
                                      [--order PATH] [--regularization 0.01]

For each profile: the same completed triads the trainer uses, in the same
temporal order, with the same hold-out rule (n >= 5 -> the most recent n // 5
held out), fitted with the same PlackettLuceRanker on three feature sets:

  v1       the 13 frozen dimensions the model reads today
  v1+v2    those plus the 15 V2 features from `fingerprint.v2.features`
  v2       the 15 V2 features alone

and reports held-out NLL and pairwise accuracy per set. With `--order` (a
judge's own preference order, e.g. fixtures/judge-claude.ranking.json) it
also fits on every triad and reports the Spearman correlation between that
order and the model's ranking of the judge's watched titles under each set --
the number that says whether V2 moves the model toward the judge.

Read-only: nothing is written to the database. Titles without a complete
vector under a feature set drop the triads they sit in, exactly as the
trainer does (absence is unknown, never zero).
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from .enrichment import V2_FEATURES
from .ranker import PlackettLuceRanker, compute_nll, compute_pairwise_accuracy
from .training import FINGERPRINT_DIMENSIONS, TriadEvent, ranking_to_indices

psycopg2.extras.register_uuid()

REPO_ROOT = Path(__file__).resolve().parents[3]
FEATURE_SETS: Dict[str, Tuple[str, ...]] = {
    "v1": tuple(FINGERPRINT_DIMENSIONS),
    "v1+v2": tuple(FINGERPRINT_DIMENSIONS) + tuple(V2_FEATURES),
    "v2": tuple(V2_FEATURES),
}


def feature_vector(fingerprint: Optional[Dict[str, Any]], keys: Sequence[str]) -> Optional[np.ndarray]:
    """Order a stored fingerprint into `keys`; None when any key is missing or non-finite (unknown != zero)."""
    if not isinstance(fingerprint, dict):
        return None
    v2 = fingerprint.get("v2") if isinstance(fingerprint.get("v2"), dict) else {}
    v2_features = v2.get("features") if isinstance(v2.get("features"), dict) else {}
    values = []
    for key in keys:
        value = v2_features.get(key) if "." in key else fingerprint.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
            return None
        values.append(float(value))
    return np.array(values)


def temporal_split(triads: List[TriadEvent]) -> Tuple[List[TriadEvent], List[TriadEvent]]:
    """RANKING_ALGORITHM.md §6 step 2, as the trainer applies it."""
    n = len(triads)
    if n < 5:
        return triads, []
    held = max(1, n // 5)
    return triads[:-held], triads[-held:]


@dataclass
class SetResult:
    feature_set: str
    triads_used: int
    held_out: int
    held_out_nll: Optional[float]
    held_out_accuracy: Optional[float]
    spearman: Optional[float]


def spearman(left: Dict[str, int], right: Dict[str, int]) -> Optional[float]:
    common = [key for key in left if key in right]
    n = len(common)
    if n < 3:
        return None
    d2 = sum((left[key] - right[key]) ** 2 for key in common)
    return 1 - 6 * d2 / (n * (n * n - 1))


def evaluate_profile(
    triads: List[TriadEvent],
    fingerprints: Dict[str, Optional[Dict[str, Any]]],
    regularization: float,
    judge_order: Optional[List[str]] = None,
    watched_ids: Optional[List[str]] = None,
) -> List[SetResult]:
    results: List[SetResult] = []
    for name, keys in FEATURE_SETS.items():
        vectors = {title_id: feature_vector(fingerprint, keys) for title_id, fingerprint in fingerprints.items()}
        vectors = {title_id: vector for title_id, vector in vectors.items() if vector is not None}
        usable = [(ids, ranking) for ids, ranking in triads if all(title_id in vectors for title_id in ids)]
        if not usable:
            results.append(SetResult(name, 0, 0, None, None, None))
            continue
        train, held = temporal_split(usable)
        nll = accuracy = None
        if held:
            ranker = PlackettLuceRanker(len(keys), regularization=regularization)
            ranker.fit(train, vectors, population_priors=None)
            nll = float(compute_nll(held, vectors, ranker))
            accuracy = float(compute_pairwise_accuracy(held, vectors, ranker))
        rho = None
        if judge_order and watched_ids:
            full = PlackettLuceRanker(len(keys), regularization=regularization)
            full.fit(usable, vectors, population_priors=None)
            scored = [title_id for title_id in watched_ids if title_id in vectors]
            model_rank = {
                title_id: position + 1
                for position, title_id in enumerate(sorted(scored, key=lambda t: -full.predict_score(t, vectors[t])))
            }
            judge_rank = {title_id: position + 1 for position, title_id in enumerate(judge_order) if title_id in model_rank}
            rho = spearman(judge_rank, model_rank)
        results.append(SetResult(name, len(usable), len(held), nll, accuracy, rho))
    return results


def load_profile(cursor, email: str) -> Tuple[Optional[str], List[TriadEvent], Dict[str, Optional[Dict[str, Any]]], List[str], Dict[str, str]]:
    cursor.execute('SELECT p.id FROM profiles p JOIN users u ON u.id = p."userId" WHERE u.email = %s ORDER BY p."createdAt" LIMIT 1', (email,))
    row = cursor.fetchone()
    if not row:
        return None, [], {}, [], {}
    profile_id = str(row[0])
    cursor.execute(
        '''
        SELECT "titleIds", ranking FROM triads
        WHERE "profileId" = %s AND status = 'completed' AND ranking IS NOT NULL
        ORDER BY COALESCE("answeredAt", "createdAt") ASC
        ''',
        (profile_id,),
    )
    triads = [
        (tuple(str(t) for t in title_ids), ranking_to_indices(tuple(str(t) for t in title_ids), ranking))
        for title_ids, ranking in cursor.fetchall()
    ]
    cursor.execute('SELECT "titleId" FROM user_title_states WHERE "profileId" = %s AND state = %s', (profile_id, "watched"))
    watched = [str(r[0]) for r in cursor.fetchall()]
    wanted = sorted({t for ids, _ in triads for t in ids} | set(watched))
    fingerprints: Dict[str, Optional[Dict[str, Any]]] = {}
    internal_ids: Dict[str, str] = {}
    if wanted:
        cursor.execute('SELECT id, "internalId", fingerprint FROM titles WHERE id = ANY(%s::uuid[])', (wanted,))
        for title_id, internal_id, fingerprint in cursor.fetchall():
            fingerprints[str(title_id)] = json.loads(fingerprint) if isinstance(fingerprint, str) else fingerprint
            internal_ids[internal_id] = str(title_id)
    return profile_id, triads, fingerprints, watched, internal_ids


def format_rows(email: str, results: List[SetResult]) -> str:
    fmt = lambda value, spec: format(value, spec) if value is not None else "-"  # noqa: E731
    lines = [f"{email}"]
    for r in results:
        lines.append(
            f"  {r.feature_set:<6} triads {r.triads_used:>3} held-out {r.held_out:>2}  "
            f"acc {fmt(r.held_out_accuracy, '.2f'):>5}  nll {fmt(r.held_out_nll, '.3f'):>6}  spearman {fmt(r.spearman, '.2f'):>5}"
        )
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Offline V1 vs V1+V2 vs V2 fingerprint evaluation")
    parser.add_argument("--email", action="append", default=[], help="profile owner's email (repeatable)")
    parser.add_argument("--all-demo", action="store_true", help="also every @demo.local persona")
    parser.add_argument("--order", type=Path, help="judge order fixture (internalIds, best first) for the Spearman column")
    parser.add_argument("--regularization", type=float, default=0.01)
    args = parser.parse_args(argv)

    load_dotenv(REPO_ROOT / ".env", override=False)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    order_internal: Optional[List[str]] = None
    if args.order:
        order_internal = json.loads(args.order.read_text(encoding="utf-8"))["watched"]

    emails = list(args.email)
    with psycopg2.connect(database_url) as connection, connection.cursor() as cursor:
        if args.all_demo:
            cursor.execute("SELECT email FROM users WHERE email LIKE %s ORDER BY email", ("%@demo.local",))
            emails += [r[0] for r in cursor.fetchall()]
        if not emails:
            print("give --email or --all-demo", file=sys.stderr)
            return 2
        exit_code = 0
        for email in emails:
            profile_id, triads, fingerprints, watched, internal_ids = load_profile(cursor, email)
            if not profile_id:
                print(f"{email}: no profile")
                exit_code = 1
                continue
            judge_order = [internal_ids[i] for i in order_internal if i in internal_ids] if order_internal and email == args.email[0] else None
            results = evaluate_profile(triads, fingerprints, args.regularization, judge_order, watched if judge_order else None)
            print(format_rows(email, results))
        return exit_code


if __name__ == "__main__":
    sys.exit(main())
