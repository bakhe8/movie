"""Train and persist a Plackett-Luce preference model for one profile."""

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from .ranker import PlackettLuceRanker, compute_nll, compute_pairwise_accuracy

# Without this, psycopg2 has no typecaster for uuid[] (unlike scalar uuid,
# which it already returns as str) and hands back the column's raw Postgres
# text form ("{id1,id2,id3}") instead of a Python list -- silently iterated
# character-by-character wherever this module treated it as one. Every
# id is re-cast to str right after fetching (below) so the rest of this
# module's str-keyed dicts/comparisons are unaffected either way.
psycopg2.extras.register_uuid()

TriadEvent = Tuple[Tuple[str, str, str], List[int]]

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


def fingerprint_vector(fingerprint: dict[str, Any]) -> np.ndarray | None:
    """
    Order a stored fingerprint into the model's dimension order.

    Returns None when any dimension is missing, None, or not a finite number:
    absence means unknown, never zero (blueprint §6, §11.3; ADR-19), and a
    triad with an incompletely described title is excluded from training rather
    than fitted against fabricated values.
    """
    values = []
    for dimension in FINGERPRINT_DIMENSIONS:
        value = fingerprint.get(dimension)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
            return None
        values.append(float(value))
    return np.array(values)


@dataclass
class TrainingResult:
    weights: np.ndarray
    bias_terms: Dict[str, float]
    training_triad_count: int
    pairwise_accuracy: float  # in-sample, over every triad used to fit `weights` -- unchanged semantics
    held_out_triad_count: int
    held_out_nll: Optional[float]
    held_out_pairwise_accuracy: Optional[float]


def train_and_evaluate(complete_triads: List[TriadEvent], fingerprints: Dict[str, np.ndarray]) -> TrainingResult:
    """
    Temporal hold-out, fit, evaluate, refit for serving -- no I/O (RANKING_ALGORITHM.md
    §6, ADR-22). `complete_triads` must already be ordered oldest-first by
    `answeredAt`/`createdAt`; the split slices off the tail as "most recent".

    Step 2 of §6: when there are at least 5 triads, the most recent
    floor(0.2n) are held out and evaluated only, never fitted on. Below that,
    train on everything and report no held-out metrics -- there is not enough
    data left after a split to make them meaningful (confidence stays
    inconclusive/initial, per RecommendationsService).

    Step 6: the served `weights`/`bias_terms`/`pairwise_accuracy` are always
    refit on the full `complete_triads` (this is unchanged from before the
    hold-out existed) -- the held-out slice affects only which metrics get
    reported, never what the profile is actually served.
    """
    fingerprint_dim = next(iter(fingerprints.values())).shape[0]
    n = len(complete_triads)

    held_out_nll: Optional[float] = None
    held_out_pairwise_accuracy: Optional[float] = None
    held_out_triad_count = 0

    if n >= 5:
        held_out_triad_count = max(1, n // 5)  # floor(0.2n), exact since 0.2 == 1/5
        train_triads = complete_triads[:-held_out_triad_count]
        held_out_triads = complete_triads[-held_out_triad_count:]

        # Fresh instance: PlackettLuceRanker.fit() only zero-initializes when
        # self.weights is None, so reusing an instance across two fits would
        # start the second one from the first one's result, breaking the
        # deterministic-zero-init guarantee (ADR-22) for this eval fit.
        eval_ranker = PlackettLuceRanker(fingerprint_dim)
        eval_ranker.fit(train_triads, fingerprints, population_priors=None)
        held_out_nll = compute_nll(held_out_triads, fingerprints, eval_ranker)
        held_out_pairwise_accuracy = compute_pairwise_accuracy(held_out_triads, fingerprints, eval_ranker)

    serving_ranker = PlackettLuceRanker(fingerprint_dim)
    # No population_priors source exists yet (no shared/cross-user popularity or
    # critic-prior model in this codebase) -- explicit None rather than omitting
    # the argument, so this gap stays visible instead of silently defaulting away.
    # See PlackettLuceRanker.population_priors and blueprint §7.1 (b(m) term).
    serving_ranker.fit(complete_triads, fingerprints, population_priors=None)
    pairwise_accuracy = compute_pairwise_accuracy(complete_triads, fingerprints, serving_ranker)

    return TrainingResult(
        weights=serving_ranker.weights,
        bias_terms=serving_ranker.bias_terms,
        training_triad_count=n,
        pairwise_accuracy=pairwise_accuracy,
        held_out_triad_count=held_out_triad_count,
        held_out_nll=held_out_nll,
        held_out_pairwise_accuracy=held_out_pairwise_accuracy,
    )


def train_profile(profile_id: str) -> TrainingResult:
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
            ORDER BY "createdAt" ASC
            ''',
            (profile_id,),
        )
        # "createdAt" stands in for the not-yet-existing "answeredAt" column
        # (IMPLEMENTATION_STATUS.md gap 3) -- with at most one active triad per
        # profile at a time (ADR-28), creation order already is answer order.
        triads = [
            (tuple(str(title_id) for title_id in title_ids), ranking) for title_ids, ranking in cursor.fetchall()
        ]
        if not triads:
            raise ValueError("No completed triads exist for this profile")

        title_ids = sorted({title_id for triad_ids, _ in triads for title_id in triad_ids})
        # Explicit cast: psycopg2 sends a Python list of str as text[] by
        # default, and Postgres has no text = uuid comparison operator, so
        # this raised UndefinedFunction on every real invocation -- caught
        # only by actually running train_profile() against a live database,
        # something no existing test does (found while verifying gap 2).
        cursor.execute('SELECT id, fingerprint FROM titles WHERE id = ANY(%s::uuid[])', (title_ids,))
        vectors = {
            str(title_id): fingerprint_vector(json.loads(fingerprint) if isinstance(fingerprint, str) else fingerprint)
            for title_id, fingerprint in cursor.fetchall()
            if fingerprint is not None
        }
        # Only fully described titles enter training; a partial fingerprint is unknown,
        # not zero (ADR-19), so the whole triad is left out rather than distorted.
        fingerprints = {title_id: vector for title_id, vector in vectors.items() if vector is not None}
        # Order is preserved from the ORDER BY above -- list comprehensions don't reshuffle.
        complete_triads = [
            (triad_ids, ranking)
            for triad_ids, ranking in triads
            if all(title_id in fingerprints for title_id in triad_ids)
        ]
        if not complete_triads:
            raise ValueError("Completed triads need complete fingerprints on all three titles before model training")

        result = train_and_evaluate(complete_triads, fingerprints)
        cursor.execute(
            '''
            INSERT INTO user_model_snapshots
              ("profileId", weights, "biasTerms", "modelVersion", "trainingTriadCount", "pairwiseAccuracy",
               "heldOutTriadCount", "heldOutNll", "heldOutPairwiseAccuracy")
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''',
            (
                profile_id,
                result.weights.tolist(),
                json.dumps(result.bias_terms),
                MODEL_VERSION,
                result.training_triad_count,
                result.pairwise_accuracy,
                result.held_out_triad_count,
                result.held_out_nll,
                result.held_out_pairwise_accuracy,
            ),
        )

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a preference model for a profile")
    parser.add_argument("profile_id", help="UUID of the profile to train")
    args = parser.parse_args()
    result = train_profile(args.profile_id)
    print(f"Trained {MODEL_VERSION} from {result.training_triad_count} completed triads")
    if result.held_out_triad_count > 0:
        print(
            f"Held out {result.held_out_triad_count} most recent triads for evaluation: "
            f"NLL={result.held_out_nll:.4f}, pairwise accuracy={result.held_out_pairwise_accuracy:.2%}"
        )
    else:
        print("Fewer than 5 completed triads -- no held-out evaluation yet (RANKING_ALGORITHM.md §6)")


if __name__ == "__main__":
    main()