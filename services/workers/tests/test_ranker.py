import numpy as np
import pytest

from src.ranker import PlackettLuceRanker, compute_pairwise_accuracy


def make_triad_dataset():
    """
    Three synthetic 1-D fingerprints where a higher value always wins, so the
    ground-truth preference is unambiguous: C > B > A on every triad below.
    `ranking[k]` is the index (into that triad's id tuple) of the item in
    k-th place, per ranker.py's own docstring.
    """
    fingerprints = {
        "A": np.array([0.1]),
        "B": np.array([0.5]),
        "C": np.array([0.9]),
    }
    triads = [
        (("A", "B", "C"), [2, 1, 0]),  # C, then B, then A
        (("C", "A", "B"), [0, 2, 1]),  # C, then B, then A
        (("B", "C", "A"), [1, 0, 2]),  # C, then B, then A
    ]
    return triads, fingerprints


class TestPlackettLuceRankerFit:
    def test_learns_a_positive_weight_for_the_winning_dimension(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)

        ranker.fit(triads, fingerprints)

        assert ranker.weights is not None
        assert ranker.weights[0] > 0

    def test_predict_ranking_orders_by_descending_learned_score(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)
        ranker.fit(triads, fingerprints)

        order = ranker.predict_ranking(["A", "B", "C"], fingerprints)

        assert order[0] == 2  # "C" (highest fingerprint value) predicted first


class TestPlackettLuceRankerPredictScore:
    def test_raises_before_the_model_has_been_fitted(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)

        with pytest.raises(ValueError):
            ranker.predict_score("A", np.array([0.5]))

    def test_applies_the_per_title_bias_term_on_top_of_the_weighted_score(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([0.0])
        ranker.bias_terms["A"] = 2.5

        assert ranker.predict_score("A", np.array([1.0])) == 2.5
        assert ranker.predict_score("B", np.array([1.0])) == 0.0

    def test_applies_the_population_prior_b_i_on_top_of_the_weighted_score(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([0.0])
        ranker.population_priors["A"] = 1.5

        assert ranker.predict_score("A", np.array([1.0])) == 1.5
        assert ranker.predict_score("B", np.array([1.0])) == 0.0

    def test_population_prior_defaults_to_zero_for_an_unlisted_title(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([2.0])

        assert ranker.predict_score("unlisted", np.array([1.0])) == 2.0

    def test_missing_fingerprint_falls_back_to_zero_vector_not_a_crash(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([1.0])

        order = ranker.predict_ranking(["unknown-title"], {})

        assert order == [0]


class TestPlackettLuceRankerPopulationPriorInFit:
    def test_fit_stores_population_priors_for_later_predict_score_calls(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)

        ranker.fit(triads, fingerprints, population_priors={"A": 0.42})

        assert ranker.population_priors == {"A": 0.42}
        assert ranker.predict_score("A", np.array([0.0])) == pytest.approx(0.42)

    def test_a_strong_prior_can_flip_the_predicted_ranking_even_with_near_zero_weights(self):
        # With weights pinned near zero (regularization dominates in one BFGS step's
        # neighborhood isn't guaranteed, so we set weights directly after fitting to
        # isolate the prior's effect deterministically).
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([0.0])
        ranker.population_priors = {"A": 10.0, "B": 0.0, "C": 0.0}

        order = ranker.predict_ranking(["A", "B", "C"], fingerprints)

        assert order[0] == 0  # "A" wins on prior alone despite the lowest fingerprint value


class TestComputePairwiseAccuracy:
    def test_a_perfectly_aligned_model_scores_100_percent(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([1.0])  # matches the ground-truth ordering exactly

        assert compute_pairwise_accuracy(triads, fingerprints, ranker) == 1.0

    def test_an_inverted_model_scores_0_percent(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([-1.0])  # exactly backwards

        assert compute_pairwise_accuracy(triads, fingerprints, ranker) == 0.0

    def test_no_triads_returns_zero_instead_of_dividing_by_zero(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([1.0])

        assert compute_pairwise_accuracy([], {}, ranker) == 0.0
