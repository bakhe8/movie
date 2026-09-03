"""
Train every demo persona and score how well the learned taste recovers the
hidden one (docs/DEMO_DATA_PLAN_2026-09-03.md WS4).

    python -m src.train_demo [--personas PATH] [--dry-run]

For each profile whose account ends in the personas fixture's email domain,
runs the real trainer (`train_profile`, unchanged) and prints one row:
completed triads, the held-out metrics, and the recovery score -- the cosine
similarity between the learned weights and the persona's hidden theta.

The recovery score is a pipeline sanity check, not a product metric: the
persona's rankings were sampled from the model's own likelihood, so the
learner *should* find the vector back. What it says nothing about is whether
the fingerprints describe films the way people experience them (plan §7).
"""

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import psycopg2
from dotenv import load_dotenv

from .training import FINGERPRINT_DIMENSIONS, train_profile

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PERSONAS = REPO_ROOT / "apps" / "backend" / "src" / "scripts" / "fixtures" / "personas.demo.json"

# The recovery bar for the persona with enough triads to learn from; the
# newcomer (theta = 0) is unrecoverable by design and is never asserted.
RECOVERY_FLOOR = 0.8
HELD_OUT_FLOOR = 0.75


@dataclass
class DemoProfile:
    slug: str
    email: str
    profile_id: str


@dataclass
class DemoRow:
    slug: str
    profile_id: str
    training_triad_count: int
    held_out_triad_count: int
    held_out_pairwise_accuracy: Optional[float]
    held_out_nll: Optional[float]
    genre_diversity: Optional[int]
    language_diversity: Optional[int]
    recovery: Optional[float]
    error: Optional[str] = None


def cosine(left: Sequence[float], right: Sequence[float]) -> Optional[float]:
    """Cosine similarity; None when either vector has no direction (all zeros)."""
    if len(left) != len(right):
        raise ValueError("vectors differ in length")
    dot = sum(a * b for a, b in zip(left, right))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    if norm_left == 0 or norm_right == 0:
        return None
    return dot / (norm_left * norm_right)


def load_personas(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        fixture = json.load(handle)
    for persona in fixture["personas"]:
        if len(persona["theta"]) != len(FINGERPRINT_DIMENSIONS):
            raise ValueError(f"{persona['slug']}: theta must have {len(FINGERPRINT_DIMENSIONS)} values")
    return fixture


def list_demo_profiles(database_url: str, email_domain: str) -> List[DemoProfile]:
    with psycopg2.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            '''
            SELECT u.email, p.id
            FROM profiles p JOIN users u ON u.id = p."userId"
            WHERE u.email LIKE %s
            ORDER BY u.email
            ''',
            (f"%@{email_domain}",),
        )
        return [DemoProfile(slug=email.split("@", 1)[0], email=email, profile_id=str(profile_id)) for email, profile_id in cursor.fetchall()]


def train_demo_profiles(profiles: List[DemoProfile], fixture: Dict[str, Any], trainer=train_profile) -> List[DemoRow]:
    theta_by_slug = {persona["slug"]: persona["theta"] for persona in fixture["personas"]}
    rows: List[DemoRow] = []
    for profile in profiles:
        try:
            result = trainer(profile.profile_id)
        except Exception as error:  # noqa: BLE001 -- one persona's failure must not hide the others' rows
            rows.append(DemoRow(profile.slug, profile.profile_id, 0, 0, None, None, None, None, None, f"{type(error).__name__}: {error}"))
            continue
        theta = theta_by_slug.get(profile.slug)
        weights = [float(value) for value in result.weights]
        rows.append(
            DemoRow(
                slug=profile.slug,
                profile_id=profile.profile_id,
                training_triad_count=result.training_triad_count,
                held_out_triad_count=result.held_out_triad_count,
                held_out_pairwise_accuracy=result.held_out_pairwise_accuracy,
                held_out_nll=result.held_out_nll,
                # Present only once the trainer's diversity columns exist; None otherwise, never 0.
                genre_diversity=getattr(result, "training_genre_diversity", None),
                language_diversity=getattr(result, "training_language_diversity", None),
                recovery=cosine(weights, theta) if theta is not None else None,
            )
        )
    return rows


def format_table(rows: List[DemoRow], fixture: Dict[str, Any]) -> str:
    expected = {persona["slug"]: persona["expectedBand"] for persona in fixture["personas"]}
    lines = [
        f"{'persona':<12} {'triads':>6} {'held-out':>8} {'ho-acc':>7} {'ho-nll':>7} {'genres':>6} {'langs':>5} {'recovery':>8}  expected band",
        "-" * 84,
    ]
    for row in rows:
        if row.error:
            lines.append(f"{row.slug:<12} FAILED: {row.error}")
            continue
        fmt = lambda value, spec: format(value, spec) if value is not None else "-"  # noqa: E731
        lines.append(
            f"{row.slug:<12} {row.training_triad_count:>6} {row.held_out_triad_count:>8} "
            f"{fmt(row.held_out_pairwise_accuracy, '7.2f')} {fmt(row.held_out_nll, '7.3f')} "
            f"{fmt(row.genre_diversity, '6d')} {fmt(row.language_diversity, '5d')} {fmt(row.recovery, '8.2f')}  {expected.get(row.slug, '?')}"
        )
    return "\n".join(lines)


def acceptance(rows: List[DemoRow], fixture: Dict[str, Any]) -> List[str]:
    """The plan's WS4 bar: the richest persona recovers its theta and predicts held-out rounds."""
    problems: List[str] = []
    richest = max(fixture["personas"], key=lambda persona: persona["triads"])
    for row in rows:
        if row.error:
            problems.append(f"{row.slug}: training failed ({row.error})")
        if row.slug == richest["slug"] and not row.error:
            if row.recovery is None or row.recovery < RECOVERY_FLOOR:
                problems.append(f"{row.slug}: recovery {row.recovery} below {RECOVERY_FLOOR} -- the seed→train→rank pipeline, not the persona, is wrong")
            if row.held_out_pairwise_accuracy is None or row.held_out_pairwise_accuracy < HELD_OUT_FLOOR:
                problems.append(f"{row.slug}: held-out pairwise accuracy {row.held_out_pairwise_accuracy} below {HELD_OUT_FLOOR}")
    return problems


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Train every demo persona and report recovery")
    parser.add_argument("--personas", type=Path, default=DEFAULT_PERSONAS)
    parser.add_argument("--dry-run", action="store_true", help="list the demo profiles, train nothing")
    args = parser.parse_args(argv)

    load_dotenv(REPO_ROOT / ".env", override=False)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2

    fixture = load_personas(args.personas)
    profiles = list_demo_profiles(database_url, fixture["emailDomain"])
    if not profiles:
        print(f"no profiles with an @{fixture['emailDomain']} account -- run `npm run db:seed:demo` first", file=sys.stderr)
        return 1
    print(f"demo profiles: {len(profiles)} ({', '.join(profile.slug for profile in profiles)})")
    if args.dry_run:
        return 0

    rows = train_demo_profiles(profiles, fixture)
    print(format_table(rows, fixture))
    problems = acceptance(rows, fixture)
    if problems:
        print("\nACCEPTANCE NOT MET:\n  " + "\n  ".join(problems))
        return 1
    print("\nacceptance met: snapshots written for every persona; recovery and held-out bars passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
