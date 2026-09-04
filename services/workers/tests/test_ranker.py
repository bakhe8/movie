import math

import numpy as np
import pytest

from src.ranker import PlackettLuceRanker, compute_nll, compute_pairwise_accuracy, pairwise_credit


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

    def test_fit_is_deterministic_for_the_same_events(self):
        # Every result must be reproducible from the event log and model version
        # (blueprint §18.1; ADR-22): no random initialization.
        triads, fingerprints = make_triad_dataset()
        first = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)
        second = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)

        first.fit(triads, fingerprints)
        second.fit(triads, fingerprints)

        np.testing.assert_array_equal(first.weights, second.weights)

    def test_predict_ranking_orders_by_descending_learned_score(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)
        ranker.fit(triads, fingerprints)

        order = ranker.predict_ranking(["A", "B", "C"], fingerprints)

        assert order[0] == 2  # "C" (highest fingerprint value) predicted first


class TestPlackettLuceRankerStandardErrors:
    # Blueprint gap 5 (BP §9.2 "stable posterior direction"): the Laplace
    # approximation to the posterior, from fit()'s BFGS inverse Hessian.
    def test_raises_before_the_model_has_been_fitted(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)

        with pytest.raises(ValueError):
            ranker.standard_errors()

    def test_returns_one_positive_finite_value_per_dimension_after_fitting(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)
        ranker.fit(triads, fingerprints)

        errors = ranker.standard_errors()

        assert errors.shape == (1,)
        assert np.isfinite(errors[0])
        assert errors[0] > 0

    def test_a_clearly_informative_dimension_is_stable_relative_to_its_own_uncertainty(self):
        # A weight several standard errors from zero is the "beyond a pre-set
        # threshold" signal RecommendationsService.confidenceBand() uses --
        # this pins that the ratio is actually large for unambiguous evidence,
        # not just that the method returns *something*.
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1, regularization=0.001)
        ranker.fit(triads, fingerprints)

        z_score = abs(ranker.weights[0]) / ranker.standard_errors()[0]

        assert z_score > 1.0


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

    def test_missing_fingerprint_raises_instead_of_silently_scoring_it_as_zero(self):
        # Unknown is not zero (blueprint §11.3, ADR-19): callers must exclude
        # undescribed titles, so a lookup miss is a bug, not a neutral score.
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([1.0])

        with pytest.raises(KeyError):
            ranker.predict_ranking(["unknown-title"], {})

    def test_fit_refuses_a_triad_with_an_undescribed_title(self):
        triads, fingerprints = make_triad_dataset()
        del fingerprints["B"]
        ranker = PlackettLuceRanker(fingerprint_dim=1)

        with pytest.raises(KeyError):
            ranker.fit(triads, fingerprints)


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

    # M2 (AUDIT_2026-09-05): an exact tie earns half credit, the same rule
    # evaluation.pairwise_hits applies, so a model with nothing to say scores
    # chance rather than looking worse than random.
    def test_a_model_with_all_zero_weights_scores_chance_not_zero(self):
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([0.0])  # every utility identical: every pair a tie

        assert compute_pairwise_accuracy(triads, fingerprints, ranker) == 0.5


class TestPairwiseCredit:
    def test_agreement_disagreement_and_tie(self):
        assert pairwise_credit(2.0, 1.0) == 1.0
        assert pairwise_credit(1.0, 2.0) == 0.0
        assert pairwise_credit(1.0, 1.0) == 0.5


class TestComputeNll:
    def test_no_triads_returns_zero_instead_of_dividing_by_zero(self):
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([1.0])

        assert compute_nll([], {}, ranker) == 0.0

    def test_zero_weights_give_the_uniform_baseline_nll(self):
        # With every score tied, each Plackett-Luce step is a uniform draw:
        # P(1st of 3) = 1/3, P(1st of remaining 2) = 1/2, so NLL per triad is
        # exactly ln(3) + ln(2) = ln(6) -- a precise value to pin the formula
        # against, not just a directional check.
        triads, fingerprints = make_triad_dataset()
        ranker = PlackettLuceRanker(fingerprint_dim=1)
        ranker.weights = np.array([0.0])

        assert compute_nll(triads, fingerprints, ranker) == pytest.approx(math.log(6))

    def test_a_better_aligned_model_scores_a_lower_nll_than_an_inverted_one(self):
        triads, fingerprints = make_triad_dataset()
        aligned = PlackettLuceRanker(fingerprint_dim=1)
        aligned.weights = np.array([1.0])  # matches the ground-truth ordering
        inverted = PlackettLuceRanker(fingerprint_dim=1)
        inverted.weights = np.array([-1.0])  # exactly backwards

        assert compute_nll(triads, fingerprints, aligned) < compute_nll(triads, fingerprints, inverted)
