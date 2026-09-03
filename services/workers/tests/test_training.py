import numpy as np

from src.ranker import PlackettLuceRanker
from src.training import (
    FINGERPRINT_DIMENSIONS,
    compute_genre_diversity,
    compute_language_diversity,
    fingerprint_vector,
    ranking_to_indices,
    train_and_evaluate,
)


def make_triads(n: int):
    """
    `n` synthetic, temporally-ordered (oldest first) triads over a
    perfectly-learnable 1-D fingerprint space (C > B > A on every one), each
    tagged with its position so a test can tell which ones a given fit() call
    actually received.
    """
    triads = [((f"A{i}", f"B{i}", f"C{i}"), [2, 1, 0]) for i in range(n)]
    fingerprints = {}
    for i in range(n):
        fingerprints[f"A{i}"] = np.array([0.1])
        fingerprints[f"B{i}"] = np.array([0.5])
        fingerprints[f"C{i}"] = np.array([0.9])
    return triads, fingerprints


def complete_fingerprint(**overrides):
    fingerprint = {dim: index / 10 for index, dim in enumerate(FINGERPRINT_DIMENSIONS)}
    fingerprint.update(overrides)
    return fingerprint


class TestFingerprintVector:
    def test_orders_values_to_match_fingerprint_dimensions(self):
        vector = fingerprint_vector(complete_fingerprint())

        expected = np.array([index / 10 for index in range(len(FINGERPRINT_DIMENSIONS))])
        np.testing.assert_allclose(vector, expected)

    def test_vector_length_matches_dimension_count(self):
        vector = fingerprint_vector(complete_fingerprint())

        assert len(vector) == len(FINGERPRINT_DIMENSIONS)

    # Absence means unknown, never zero (blueprint §6, §11.3; ADR-19): an
    # incompletely described title yields no vector at all, so the trainer
    # excludes the triad instead of fitting against fabricated values.
    def test_missing_dimension_makes_the_fingerprint_unknown(self):
        fingerprint = complete_fingerprint()
        del fingerprint["warmth"]

        assert fingerprint_vector(fingerprint) is None

    def test_explicit_none_value_makes_the_fingerprint_unknown(self):
        assert fingerprint_vector(complete_fingerprint(pacing=None)) is None

    def test_non_numeric_value_makes_the_fingerprint_unknown(self):
        assert fingerprint_vector(complete_fingerprint(pacing="0.7")) is None
        assert fingerprint_vector(complete_fingerprint(pacing=True)) is None

    def test_non_finite_value_makes_the_fingerprint_unknown(self):
        assert fingerprint_vector(complete_fingerprint(pacing=float("nan"))) is None

    def test_extra_keys_such_as_themes_are_ignored(self):
        vector = fingerprint_vector(complete_fingerprint(themes=["loss"], confidence={}))

        assert len(vector) == len(FINGERPRINT_DIMENSIONS)


class TestRankingToIndices:
    # triads.ranking is title ids in ranked order (ADR-15); ranker.py's math
    # still works with positions into triad_ids -- this is the DB-boundary
    # conversion between the two.
    def test_converts_title_ids_to_their_position_in_triad_ids(self):
        triad_ids = ("A", "B", "C")

        assert ranking_to_indices(triad_ids, ["C", "A", "B"]) == [2, 0, 1]

    def test_identity_when_ranking_matches_triad_id_order(self):
        triad_ids = ("A", "B", "C")

        assert ranking_to_indices(triad_ids, ["A", "B", "C"]) == [0, 1, 2]

    def test_stringifies_non_str_ids_before_looking_up_the_position(self):
        # psycopg2's uuid[] typecaster (register_uuid()) returns uuid.UUID
        # objects for the ranking column but plain str for triad_ids here
        # (already cast at the call site in train_profile()) -- str() makes
        # the lookup work regardless of which one arrives as which type.
        class FakeUuid:
            def __str__(self):
                return "B"

        triad_ids = ("A", "B", "C")

        assert ranking_to_indices(triad_ids, ["C", FakeUuid(), "A"]) == [2, 1, 0]


class TestComputeGenreDiversity:
    # Blueprint gap 5 (BP §9.2): "sufficient effective evidence (not one
    # series repeated)" and "diversity of ... genres" read together.
    def test_counts_distinct_genres_across_every_title_in_every_triad(self):
        triads, _ = make_triads(2)
        genres = {
            "A0": ["Thriller"], "B0": ["Drama"], "C0": ["Thriller", "Romance"],
            "A1": ["Comedy"], "B1": ["Drama"], "C1": ["Comedy"],
        }

        assert compute_genre_diversity(triads, genres) == 4  # Thriller, Drama, Romance, Comedy

    def test_one_genre_repeated_across_every_title_scores_one(self):
        triads, _ = make_triads(3)
        genres = {tid: ["Thriller"] for triad_ids, _ in triads for tid in triad_ids}

        assert compute_genre_diversity(triads, genres) == 1

    def test_a_title_missing_from_the_genres_mapping_contributes_nothing_not_a_failure(self):
        triads, _ = make_triads(1)  # ("A0", "B0", "C0")
        genres = {"A0": ["Thriller"], "B0": ["Drama"]}  # C0 has no known genres

        assert compute_genre_diversity(triads, genres) == 2

    def test_no_titles_have_any_known_genre_scores_zero(self):
        triads, _ = make_triads(2)

        assert compute_genre_diversity(triads, {}) == 0


class TestComputeLanguageDiversity:
    # Blueprint gap 6/gap 5 (BP §9.2): the second named diversity axis,
    # mirroring TestComputeGenreDiversity exactly -- same rule, single value
    # per title instead of a list.
    def test_counts_distinct_languages_across_every_title_in_every_triad(self):
        triads, _ = make_triads(2)
        languages = {
            "A0": "ar", "B0": "en", "C0": "ar",
            "A1": "fr", "B1": "en", "C1": "fr",
        }

        assert compute_language_diversity(triads, languages) == 3  # ar, en, fr

    def test_one_language_repeated_across_every_title_scores_one(self):
        triads, _ = make_triads(3)
        languages = {tid: "ar" for triad_ids, _ in triads for tid in triad_ids}

        assert compute_language_diversity(triads, languages) == 1

    def test_a_title_missing_from_the_languages_mapping_contributes_nothing_not_a_failure(self):
        triads, _ = make_triads(1)  # ("A0", "B0", "C0")
        languages = {"A0": "ar", "B0": "en"}  # C0 has no known language

        assert compute_language_diversity(triads, languages) == 2

    def test_no_titles_have_any_known_language_scores_zero(self):
        triads, _ = make_triads(2)

        assert compute_language_diversity(triads, {}) == 0


class TestTrainAndEvaluate:
    # RANKING_ALGORITHM.md §6 step 2: below 5 completed triads there isn't
    # enough data left after a split to make held-out metrics meaningful, so
    # none are reported at all -- not computed on a 0-1 triad slice.
    def test_below_five_triads_trains_on_everything_and_reports_no_held_out_metrics(self):
        triads, fingerprints = make_triads(4)

        result = train_and_evaluate(triads, fingerprints)

        assert result.training_triad_count == 4
        assert result.held_out_triad_count == 0
        assert result.held_out_nll is None
        assert result.held_out_pairwise_accuracy is None
        # Blueprint gap 5: too little data for either to mean anything either,
        # same floor as the held-out metrics above (ADR-31).
        assert result.standard_errors is None
        assert result.training_genre_diversity is None
        assert result.training_language_diversity is None

    def test_five_or_more_triads_holds_out_floor_0_2n_most_recent(self):
        for n, expected_held_out in [(5, 1), (9, 1), (10, 2), (25, 5)]:
            triads, fingerprints = make_triads(n)

            result = train_and_evaluate(triads, fingerprints)

            assert result.held_out_triad_count == expected_held_out, f"n={n}"
            assert result.held_out_nll is not None
            assert result.held_out_pairwise_accuracy is not None
            assert result.standard_errors is not None
            assert result.standard_errors.shape == (1,)  # one per fingerprint dimension
            # No genres/languages passed in this test -- absence, not zero diversity.
            assert result.training_genre_diversity == 0
            assert result.training_language_diversity == 0

    def test_genre_diversity_reflects_the_genres_mapping_passed_in(self):
        triads, fingerprints = make_triads(5)
        genres = {"A0": ["Thriller"], "B1": ["Drama"], "C2": ["Comedy"]}

        result = train_and_evaluate(triads, fingerprints, genres)

        assert result.training_genre_diversity == 3

    def test_language_diversity_reflects_the_languages_mapping_passed_in(self):
        triads, fingerprints = make_triads(5)
        languages = {"A0": "ar", "B1": "en", "C2": "fr"}

        result = train_and_evaluate(triads, fingerprints, genres=None, languages=languages)

        assert result.training_language_diversity == 3

    def test_served_weights_are_still_fit_on_every_triad_not_just_the_training_slice(self):
        # Step 6: the held-out split affects only which metrics get reported;
        # the model actually served is always refit on all of it.
        triads, fingerprints = make_triads(10)

        result = train_and_evaluate(triads, fingerprints)

        assert result.training_triad_count == 10
        # A perfectly-learnable dataset fit on all of it should be perfectly accurate in-sample.
        assert result.pairwise_accuracy == 1.0

    def test_holds_out_the_temporally_last_slice_not_the_first(self, monkeypatch):
        triads, fingerprints = make_triads(10)
        seen_triad_sets = []
        original_fit = PlackettLuceRanker.fit

        def spy_fit(self, triads_arg, fingerprints_arg, population_priors=None):
            seen_triad_sets.append(list(triads_arg))
            return original_fit(self, triads_arg, fingerprints_arg, population_priors)

        monkeypatch.setattr(PlackettLuceRanker, "fit", spy_fit)

        train_and_evaluate(triads, fingerprints)

        # First fit() call is the eval fit, trained on the training slice only.
        eval_fit_triads = seen_triad_sets[0]
        assert eval_fit_triads == triads[:8]  # the 2 most recent (last) triads held out
        assert eval_fit_triads != triads[2:]  # not the first 2 dropped instead

    def test_deterministic_for_the_same_events(self):
        # Reproducibility from the event log alone (blueprint §18.1; ADR-22)
        # must hold for the held-out metrics too, not just the served weights.
        triads, fingerprints = make_triads(10)

        first = train_and_evaluate(triads, fingerprints)
        second = train_and_evaluate(triads, fingerprints)

        np.testing.assert_array_equal(first.weights, second.weights)
        assert first.held_out_nll == second.held_out_nll
        assert first.held_out_pairwise_accuracy == second.held_out_pairwise_accuracy
