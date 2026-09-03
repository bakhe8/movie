"""Train and persist a Plackett-Luce preference model for one profile."""

import argparse
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import psycopg2
from dotenv import load_dotenv

from .ranker import PlackettLuceRanker, compute_pairwise_accuracy

FINGERPRINT_DIMENSIONS = (
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
MODEL_VERSION = "plackett-luce-v1"


def fingerprint_vector(fingerprint: dict[str, Any]) -> np.ndarray:
    return np.array([float(fingerprint.get(dimension, 0) or 0) for dimension in FINGERPRINT_DIMENSIONS])


def train_profile(profile_id: str) -> int:
    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=True)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    with psycopg2.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            '''
            SELECT "titleIds", ranking
            FROM triads
            WHERE "profileId" = %s AND status = 'completed' AND ranking IS NOT NULL
            ''',
            (profile_id,),
        )
        triads = [(tuple(title_ids), ranking) for title_ids, ranking in cursor.fetchall()]
        if not triads:
            raise ValueError("No completed triads exist for this profile")

        title_ids = sorted({title_id for triad_ids, _ in triads for title_id in triad_ids})
        cursor.execute('SELECT id, fingerprint FROM titles WHERE id = ANY(%s)', (title_ids,))
        fingerprints = {
            title_id: fingerprint_vector(json.loads(fingerprint) if isinstance(fingerprint, str) else fingerprint)
            for title_id, fingerprint in cursor.fetchall()
            if fingerprint is not None
        }
        complete_triads = [
            (triad_ids, ranking)
            for triad_ids, ranking in triads
            if all(title_id in fingerprints for title_id in triad_ids)
        ]
        if not complete_triads:
            raise ValueError("Completed triads need fingerprints before model training")

        ranker = PlackettLuceRanker(len(FINGERPRINT_DIMENSIONS))
        # No population_priors source exists yet (no shared/cross-user popularity or
        # critic-prior model in this codebase) -- explicit None rather than omitting
        # the argument, so this gap stays visible instead of silently defaulting away.
        # See PlackettLuceRanker.population_priors and blueprint §7.1 (b(m) term).
        ranker.fit(complete_triads, fingerprints, population_priors=None)
        pairwise_accuracy = compute_pairwise_accuracy(complete_triads, fingerprints, ranker)
        cursor.execute(
            '''
            INSERT INTO user_model_snapshots
              ("profileId", weights, "biasTerms", "modelVersion", "trainingTriadCount", "pairwiseAccuracy")
            VALUES (%s, %s, %s, %s, %s, %s)
            ''',
            (
                profile_id,
                ranker.weights.tolist(),
                json.dumps(ranker.bias_terms),
                MODEL_VERSION,
                len(complete_triads),
                pairwise_accuracy,
            ),
        )

    return len(complete_triads)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a preference model for a profile")
    parser.add_argument("profile_id", help="UUID of the profile to train")
    args = parser.parse_args()
    triad_count = train_profile(args.profile_id)
    print(f"Trained {MODEL_VERSION} from {triad_count} completed triads")


if __name__ == "__main__":
    main()