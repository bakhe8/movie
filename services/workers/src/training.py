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

from .enrichment import V2_FEATURES, V3_FEATURES
from .ranker import PlackettLuceRanker, compute_nll, compute_pairwise_accuracy

# Without this, psycopg2 has no typecaster for uuid[] (unlike scalar uuid,
# which it already returns as str) and hands back the column's raw Postgres
# text form ("{id1,id2,id3}") instead of a Python list -- silently iterated
# character-by-character wherever this module treated it as one. Every
# id is re-cast to str right after fetching (below) so the rest of this
# module's str-keyed dicts/comparisons are unaffected either way.
psycopg2.extras.register_uuid()

TriadEvent = Tuple[Tuple[str, str, str], List[int]]

FINGERPRINT_V1_DIMENSIONS = (
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
# V2_FEATURES/V3_FEATURES (imported from enrichment.py, the single source of
# truth for the namespaced "family.feature" keys, FINGERPRINT_SCHEMA.md
# §3.1/§3.3) read only, never modified here -- V1 first, then V2, then V3, in
# enrichment.py's own order, matching how they were proposed and extracted
# (DEMO_DATA_PLAN_2026-09-03.md §7.2, §7.3).
FINGERPRINT_DIMENSIONS = FINGERPRINT_V1_DIMENSIONS + V2_FEATURES + V3_FEATURES
MODEL_VERSION = "plackett-luce-v3"

# Held-out-chosen L2 strength for theta^T*phi (blueprint §7.1's protection
# for that term: "regularization ... before showing a tendency"). A single
# scalar picked per training run, not a fixed constant and not a separate,
# untested per-block penalty -- BP §7.1 names general regularization for this
# term, not a per-family split. Real evaluations against a genuine
# human-derived ranking (not a synthetic persona) validated this exact
# adaptive approach twice: 0.1 held up at 25 rounds / 0.01 at 50 for V1+V2
# (DEMO_DATA_PLAN_2026-09-03.md §7.2); for V1+V2+V3 at 75 rounds (71 valid,
# 14 held out) 0.03 was the held-out-chosen value and beat V1+V2 alone at
# every candidate in the grid (§7.3) -- precisely the situation an adaptive,
# held-out-chosen value is for, rather than guessing one number or adding a
# separate, unvalidated per-block hyperparameter.
REGULARIZATION_GRID = (0.01, 0.03, 0.1, 0.3)


def fingerprint_vector(fingerprint: dict[str, Any]) -> np.ndarray | None:
    """
    Order a stored fingerprint into the model's dimension order.

    V1 keys are read at the top level; V2 and V3 keys are namespaced
    "family.feature" and live nested under fingerprint["v2"]["features"] and
    fingerprint["v3"]["features"] respectively (FINGERPRINT_SCHEMA.md
    §3.1/§3.3) -- the three sub-shapes are read into one flat 40-dimension
    vector here so nothing past this function needs to know a fingerprint has
    three different internal shapes. V2 and V3 family names never collide
    (checked against V3_FEATURES specifically, not just "contains a dot"),
    so a namespaced key is read from V3's block only when it is actually one
    of V3's own keys, V2's block otherwise.

    Returns None when any dimension is missing, None, or not a finite number:
    absence means unknown, never zero (blueprint §6, §11.3; ADR-19), and a
    triad with an incompletely described title is excluded from training rather
    than fitted against fabricated values. A title enriched with V1 (+V2) only
    (no "v3" block yet -- true of the original 15 seed titles, which neither
    enrichment pass has touched) is therefore incomplete under the
    40-dimension vector, the same way a title missing even one V1 dimension
    always was.
    """
    v2_features = (fingerprint.get("v2") or {}).get("features") or {}
    v3_features = (fingerprint.get("v3") or {}).get("features") or {}
    values = []
    for dimension in FINGERPRINT_DIMENSIONS:
        if "." not in dimension:
            value = fingerprint.get(dimension)
        elif dimension in V3_FEATURES:
            value = v3_features.get(dimension)
        else:
            value = v2_features.get(dimension)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
            return None
        values.append(float(value))
    return np.array(values)


def compute_genre_diversity(triads: List[TriadEvent], genres: Dict[str, List[str]]) -> int:
    """
    Distinct genre count across every title in `triads` (blueprint gap 5,
    BP §9.2's "sufficient effective evidence (not one series repeated)" and
    "diversity of ... genres" read together). Titles missing from `genres`
    (no genres recorded) contribute nothing, the same "absence is unknown,
    not a failure" treatment as a missing fingerprint dimension -- they are
    simply not evidence of diversity either way, not evidence against it.
    """
    seen = set()
    for triad_ids, _ in triads:
        for title_id in triad_ids:
            seen.update(genres.get(title_id, []))
    return len(seen)


def compute_language_diversity(triads: List[TriadEvent], languages: Dict[str, str]) -> int:
    """
    Distinct original-language count across every title in `triads` (blueprint
    gap 6/gap 5, BP §9.2's second named diversity axis). Same treatment as
    compute_genre_diversity: a title missing from `languages` (no recorded
    original language) contributes nothing -- unknown, not evidence against
    diversity.
    """
    seen = set()
    for triad_ids, _ in triads:
        for title_id in triad_ids:
            language = languages.get(title_id)
            if language:
                seen.add(language)
    return len(seen)


def compute_director_diversity(triads: List[TriadEvent], directors: Dict[str, List[str]]) -> int:
    """
    Distinct director count across every title in `triads` (blueprint gap 5,
    BP §9.2's third and last named diversity axis). Same treatment as
    compute_genre_diversity: a title missing from `directors` (no `credits`
    row with role 'director', or the title predates gap 6's ingestion pass)
    contributes nothing -- unknown, not evidence against diversity. A
    co-directed title's directors are each counted (list-valued, like genre).
    """
    seen = set()
    for triad_ids, _ in triads:
        for title_id in triad_ids:
            seen.update(directors.get(title_id, []))
    return len(seen)


def ranking_to_indices(triad_ids: Tuple[str, str, str], ranking_title_ids: List[Any]) -> List[int]:
    """
    Convert a triads.ranking row -- title ids in ranked order, best first
    (ADR-15) -- into positions into `triad_ids`, the representation the
    model math (ranker.py) actually works with. The DB/API boundary speaks
    title ids; everything past this function still speaks indices.
    """
    return [triad_ids.index(str(title_id)) for title_id in ranking_title_ids]


@dataclass
class TrainingResult:
    weights: np.ndarray
    bias_terms: Dict[str, float]
    training_triad_count: int
    pairwise_accuracy: float  # in-sample, over every triad used to fit `weights` -- unchanged semantics
    held_out_triad_count: int
    held_out_nll: Optional[float]
    held_out_pairwise_accuracy: Optional[float]
    # Blueprint gap 5 (BP §9.2). Both NULL/None below the same 5-triad floor
    # held-out metrics use (ADR-31) -- too little data for either to mean
    # anything (RecommendationsService.confidenceBand()).
    standard_errors: Optional[np.ndarray]
    training_genre_diversity: Optional[int]
    training_language_diversity: Optional[int]
    training_director_diversity: Optional[int]
    # The L2 strength actually used to fit the served weights -- REGULARIZATION_GRID's
    # default (first entry) below the 5-triad floor, held-out-chosen above it.
    # Diagnostic only, not persisted (RANKING_ALGORITHM.md/ADR-22's determinism
    # only requires the same events reproduce the same choice, which a fixed
    # grid + argmin already guarantees).
    chosen_regularization: float


def train_and_evaluate(
    complete_triads: List[TriadEvent],
    fingerprints: Dict[str, np.ndarray],
    genres: Optional[Dict[str, List[str]]] = None,
    languages: Optional[Dict[str, str]] = None,
    directors: Optional[Dict[str, List[str]]] = None,
) -> TrainingResult:
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

    `genres` (title_id -> genre list), `languages` (title_id -> original
    language) and `directors` (title_id -> director person-id list) are
    optional and used only for `training_genre_diversity` /
    `training_language_diversity` / `training_director_diversity` (blueprint
    gap 5); omitting any of them (or passing an empty dict) is equivalent to
    no title having any known genre/language/director.
    """
    fingerprint_dim = next(iter(fingerprints.values())).shape[0]
    n = len(complete_triads)

    held_out_nll: Optional[float] = None
    held_out_pairwise_accuracy: Optional[float] = None
    held_out_triad_count = 0
    standard_errors: Optional[np.ndarray] = None
    training_genre_diversity: Optional[int] = None
    training_language_diversity: Optional[int] = None
    training_director_diversity: Optional[int] = None
    # Below the 5-triad floor there's no held-out slice to choose from --
    # default to the grid's first (smallest, most permissive) entry, same
    # spirit as every other held-out-gated diagnostic here reporting nothing
    # meaningful yet rather than an arbitrary guess.
    chosen_regularization = REGULARIZATION_GRID[0]

    if n >= 5:
        held_out_triad_count = max(1, n // 5)  # floor(0.2n), exact since 0.2 == 1/5
        train_triads = complete_triads[:-held_out_triad_count]
        held_out_triads = complete_triads[-held_out_triad_count:]

        # Try every candidate L2 strength on the same train/held-out split and
        # keep the one with the lowest held-out NLL -- the actual predictive
        # fit (blueprint §16.2), not the training objective, which trivially
        # prefers the weakest regularization. Fresh instance per candidate:
        # PlackettLuceRanker.fit() only zero-initializes when self.weights is
        # None, so reusing one across fits would start each from the last
        # one's result, breaking the deterministic-zero-init guarantee
        # (ADR-22) for every candidate after the first.
        best_ranker: Optional[PlackettLuceRanker] = None
        for candidate in REGULARIZATION_GRID:
            candidate_ranker = PlackettLuceRanker(fingerprint_dim, regularization=candidate)
            candidate_ranker.fit(train_triads, fingerprints, population_priors=None)
            candidate_nll = compute_nll(held_out_triads, fingerprints, candidate_ranker)
            if held_out_nll is None or candidate_nll < held_out_nll:
                held_out_nll = candidate_nll
                best_ranker = candidate_ranker
                chosen_regularization = candidate

        held_out_pairwise_accuracy = compute_pairwise_accuracy(held_out_triads, fingerprints, best_ranker)

        training_genre_diversity = compute_genre_diversity(complete_triads, genres or {})
        training_language_diversity = compute_language_diversity(complete_triads, languages or {})
        training_director_diversity = compute_director_diversity(complete_triads, directors or {})

    serving_ranker = PlackettLuceRanker(fingerprint_dim, regularization=chosen_regularization)
    # No population_priors source exists yet (no shared/cross-user popularity or
    # critic-prior model in this codebase) -- explicit None rather than omitting
    # the argument, so this gap stays visible instead of silently defaulting away.
    # See PlackettLuceRanker.population_priors and blueprint §7.1 (b(m) term).
    serving_ranker.fit(complete_triads, fingerprints, population_priors=None)
    pairwise_accuracy = compute_pairwise_accuracy(complete_triads, fingerprints, serving_ranker)
    if n >= 5:
        standard_errors = serving_ranker.standard_errors()

    return TrainingResult(
        weights=serving_ranker.weights,
        bias_terms=serving_ranker.bias_terms,
        training_triad_count=n,
        pairwise_accuracy=pairwise_accuracy,
        held_out_triad_count=held_out_triad_count,
        held_out_nll=held_out_nll,
        held_out_pairwise_accuracy=held_out_pairwise_accuracy,
        standard_errors=standard_errors,
        training_genre_diversity=training_genre_diversity,
        training_language_diversity=training_language_diversity,
        training_director_diversity=training_director_diversity,
        chosen_regularization=chosen_regularization,
    )


def train_profile(profile_id: str) -> TrainingResult:
    # override=False: a DATABASE_URL already set in the process environment
    # (e2e spawns the real model service against postgres-test this way)
    # wins over the repo .env's dev-database value; the CLI's own usage,
    # where DATABASE_URL is never pre-set, is unaffected either way.
    load_dotenv(Path(__file__).resolve().parents[3] / ".env", override=False)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    # psycopg2's connection context manager only commits/rolls back the
    # transaction on exit -- it never closes the connection (AUDIT_2026-09-05
    # C2). Fine for the one-shot CLI scripts, but this function also runs
    # inside model_service.py's long-running worker, once per training job,
    # so an unclosed connection here leaks until Postgres's max_connections
    # is exhausted. The try/finally guarantees the close on every exit path,
    # including the ValueError raises below.
    connection = psycopg2.connect(database_url)
    try:
        with connection, connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT "titleIds", ranking
                FROM triads
                WHERE "profileId" = %s AND status = 'completed' AND ranking IS NOT NULL
                ORDER BY COALESCE("answeredAt", "createdAt") ASC
                ''',
                (profile_id,),
            )
            # "ranking" is title ids in ranked order (ADR-15), but the model math
            # below (ranker.py) works with positional indices into titleIds --
            # convert once here, at the DB boundary, so ranker.py never has to
            # know about the storage/API representation.
            # COALESCE("answeredAt", "createdAt"): triads completed before the
            # answeredAt column existed (gap 3) have no recorded answer time --
            # createdAt is still a fair temporal proxy for those legacy rows only.
            triads = [
                (
                    tuple(str(title_id) for title_id in title_ids),
                    ranking_to_indices(tuple(str(title_id) for title_id in title_ids), ranking),
                )
                for title_ids, ranking in cursor.fetchall()
            ]
            if not triads:
                raise ValueError("No completed triads exist for this profile")

            title_ids = sorted({title_id for triad_ids, _ in triads for title_id in triad_ids})
            # Explicit cast: psycopg2 sends a Python list of str as text[] by
            # default, and Postgres has no text = uuid comparison operator, so
            # this raised UndefinedFunction on every real invocation -- caught
            # only by actually running train_profile() against a live database,
            # something no existing test does (found while verifying gap 2).
            cursor.execute('SELECT id, fingerprint, genres, "originalLanguage" FROM titles WHERE id = ANY(%s::uuid[])', (title_ids,))
            rows = cursor.fetchall()
            vectors = {
                str(title_id): fingerprint_vector(json.loads(fingerprint) if isinstance(fingerprint, str) else fingerprint)
                for title_id, fingerprint, _genres, _language in rows
                if fingerprint is not None
            }
            # Only fully described titles enter training; a partial fingerprint is unknown,
            # not zero (ADR-19), so the whole triad is left out rather than distorted.
            fingerprints = {title_id: vector for title_id, vector in vectors.items() if vector is not None}
            # "genres" is TypeORM's simple-array: a comma-joined text column, not
            # a Postgres array -- no title has ever had a genre with a comma in
            # it, so a plain split is exact. A NULL/empty column means no known
            # genres, not zero diversity contributed (compute_genre_diversity
            # treats a missing entry the same way).
            genres = {
                str(title_id): [genre for genre in genre_text.split(',') if genre]
                for title_id, _fingerprint, genre_text, _language in rows
                if genre_text
            }
            # originalLanguage is a single varchar column (unlike genres) --
            # missing means no known language, same "not evidence either way"
            # treatment (compute_language_diversity).
            languages = {
                str(title_id): language
                for title_id, _fingerprint, _genres, language in rows
                if language
            }
            # Director data lives relationally (credits/people, blueprint gap 6,
            # ADR-70), not as a titles column like genre/language -- a separate
            # query, one row per (title, director) credit. A title with no
            # 'director'-role credit contributes no entry, same "unknown, not
            # evidence against diversity" treatment as a missing genre/language.
            cursor.execute(
                'SELECT "titleId", "personId" FROM credits WHERE role = \'director\' AND "titleId" = ANY(%s::uuid[])',
                (title_ids,),
            )
            directors: Dict[str, List[str]] = {}
            for title_id, person_id in cursor.fetchall():
                directors.setdefault(str(title_id), []).append(str(person_id))
            # Order is preserved from the ORDER BY above -- list comprehensions don't reshuffle.
            complete_triads = [
                (triad_ids, ranking)
                for triad_ids, ranking in triads
                if all(title_id in fingerprints for title_id in triad_ids)
            ]
            if not complete_triads:
                raise ValueError("Completed triads need complete fingerprints on all three titles before model training")

            result = train_and_evaluate(complete_triads, fingerprints, genres, languages, directors)
            # posterior holds UserModelSnapshotPosterior's shape (apps/backend's
            # user-model-snapshot.entity.ts) -- keep the two in sync by hand.
            posterior = json.dumps({"standardErrors": result.standard_errors.tolist()}) if result.standard_errors is not None else None
            cursor.execute(
                '''
                INSERT INTO user_model_snapshots
                  ("profileId", weights, "biasTerms", "modelVersion", "trainingTriadCount", "pairwiseAccuracy",
                   "heldOutTriadCount", "heldOutNll", "heldOutPairwiseAccuracy", posterior, "trainingGenreDiversity",
                   "trainingLanguageDiversity", "trainingDirectorDiversity")
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    posterior,
                    result.training_genre_diversity,
                    result.training_language_diversity,
                    result.training_director_diversity,
                ),
            )
    finally:
        connection.close()

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
            f"NLL={result.held_out_nll:.4f}, pairwise accuracy={result.held_out_pairwise_accuracy:.2%}, "
            f"chosen regularization={result.chosen_regularization}"
        )
        print(
            f"Training evidence spanned {result.training_genre_diversity} distinct genre(s), "
            f"{result.training_language_diversity} distinct language(s) and "
            f"{result.training_director_diversity} distinct director(s) (blueprint gap 5)"
        )
    else:
        print("Fewer than 5 completed triads -- no held-out evaluation or posterior/diversity metrics yet (RANKING_ALGORITHM.md §6, blueprint gap 5)")


if __name__ == "__main__":
    main()