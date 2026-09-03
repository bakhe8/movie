"""
Plackett-Luce ranking model for learning user preferences from triadic comparisons.

This module implements a simple Plackett-Luce model that learns preference weights
from complete rankings of three items (triads). See docs/RANKING_ALGORITHM.md.
"""

import numpy as np
from scipy.special import logsumexp
from scipy.optimize import minimize
from typing import Dict, List, Tuple, Optional


def _require_fingerprint(fingerprints: Dict[str, np.ndarray], title_id: str) -> np.ndarray:
    """
    Look up a title's fingerprint or fail loudly.

    A missing fingerprint is *unknown*, never a zero vector: zero-filling would
    silently score the title as "average on every dimension" and let it into
    training and ranking as if it were described (blueprint §6, §11.3; ADR-19).
    Callers must filter to complete fingerprints before calling the model.
    """
    try:
        return fingerprints[title_id]
    except KeyError as error:
        raise KeyError(
            f"No fingerprint for title {title_id!r}; unknown is not zero -- exclude the title before ranking"
        ) from error


class PlackettLuceRanker:
    """
    Plackett-Luce model for learning user taste weights from triadic rankings.

    The model assumes that given a set of items with associated features (fingerprints),
    a user's preference score for an item is: U_ui = b_i + w_u^T * x_i + delta_ui

    Where:
    - b_i: weak, heavily-shrunk population prior for item i (cold-start smoothing;
      shared across users, never learned by this per-user model — see population_priors
      below). Defaults to 0 for any title without one. Must never be surfaced to the
      user merged with the personal-fit term (blueprint §7.1, §4.4).
    - w_u: user's taste weights
    - x_i: film's fingerprint (feature vector)
    - delta_ui: per-item bias term
    """

    def __init__(self, fingerprint_dim: int, learning_rate: float = 0.01, regularization: float = 0.01):
        """
        Initialize the Plackett-Luce ranker.

        Args:
            fingerprint_dim: Dimensionality of film fingerprints
            learning_rate: Step size for optimization
            regularization: L2 regularization coefficient
        """
        self.fingerprint_dim = fingerprint_dim
        self.learning_rate = learning_rate
        self.regularization = regularization
        self.weights: Optional[np.ndarray] = None
        self.bias_terms: Dict[str, float] = {}
        # Inverse-Hessian approximation from the BFGS optimizer in fit()
        # (blueprint gap 5, BP §9.2's "stable posterior direction"
        # criterion). Populated only after fit() runs -- see standard_errors().
        self.hess_inv: Optional[np.ndarray] = None
        # b_i in the utility formula above. Not fit by this class — it comes from a
        # population-level model shared across users (e.g. a shrunk popularity/critic
        # prior), which doesn't exist yet in this codebase. Defaults to {} (all zero)
        # until that population model is built, per RANKING_ALGORITHM.md: the term
        # stays part of the code/signature from the start rather than being bolted on
        # later, even while it contributes nothing.
        self.population_priors: Dict[str, float] = {}

    def fit(
        self,
        triads: List[Tuple[Tuple[str, str, str], List[int]]],
        fingerprints: Dict[str, np.ndarray],
        population_priors: Optional[Dict[str, float]] = None,
    ) -> None:
        """
        Fit the model to observed triadic rankings.

        Args:
            triads: List of (title_id_1, title_id_2, title_id_3, ranking) tuples
                   where ranking is [0, 1, 2] indicating the preference order
            fingerprints: Dictionary mapping title_id to fingerprint vector. Every
                title in `triads` must be present (see _require_fingerprint).
            population_priors: Optional mapping of title_id to b_i, the shrunk
                population-level prior (see class docstring). Titles missing from
                this mapping are treated as b_i = 0. Stored on the instance so
                later predict_score/predict_ranking calls use the same priors
                without having to pass them again.
        """
        self.population_priors = dict(population_priors) if population_priors else {}

        # Deterministic initialization: the objective is convex (listwise PL
        # log-likelihood + L2), so starting from zero loses nothing, and the same
        # events must reproduce the same weights (blueprint §18.1; ADR-22).
        if self.weights is None:
            self.weights = np.zeros(self.fingerprint_dim)

        # Extract features for all triads
        X_list = []
        y_list = []
        prior_list = []

        for triad_ids, ranking in triads:
            # Create feature matrix for this triad
            X_triad = np.array([_require_fingerprint(fingerprints, tid) for tid in triad_ids])
            X_list.append(X_triad)

            # Ranking: which index is 1st, 2nd, 3rd
            y_list.append(np.array(ranking, dtype=int))

            # b_i per item in this triad, aligned with X_triad's row order
            prior_list.append(np.array([self.population_priors.get(tid, 0.0) for tid in triad_ids]))

        # Optimize weights using MLE
        def negative_log_likelihood(w: np.ndarray) -> float:
            """Negative log likelihood of observed rankings under Plackett-Luce model."""
            nll = 0.0

            for X_triad, ranking, priors in zip(X_list, y_list, prior_list):
                # Compute scores for all items in this triad: b_i + w^T x_i.
                # b_i is fixed (not optimized over) — it doesn't depend on w, so it
                # doesn't need its own gradient term, but it does shift which items
                # look preferable during optimization, same as it will at serving time.
                scores = priors + X_triad @ w

                # Plackett-Luce probability: P(ranking) =
                # exp(score[1st]) / (exp(score[1st]) + exp(score[2nd]) + exp(score[3rd])) *
                # exp(score[2nd]) / (exp(score[2nd]) + exp(score[3rd])) *
                # exp(score[3rd]) / exp(score[3rd])

                # Log-likelihood
                for pos in range(2):
                    idx = ranking[pos]
                    remaining_indices = ranking[pos:]
                    remaining_scores = scores[remaining_indices]

                    # Log probability for this position
                    log_prob = scores[idx] - logsumexp(remaining_scores)
                    nll -= log_prob

            # Add L2 regularization
            nll += self.regularization * np.sum(w ** 2)
            return nll

        # Optimize
        result = minimize(
            negative_log_likelihood,
            self.weights,
            method='BFGS',
            options={'gtol': 1e-4}
        )

        self.weights = result.x
        # scipy's BFGS always returns a dense inverse-Hessian approximation
        # (unlike L-BFGS-B, which doesn't). Because the objective adds the L2
        # term, this optimum is a MAP estimate under a Gaussian prior, so
        # this is the standard Laplace approximation to the posterior
        # covariance -- not the true posterior, but a well-established
        # approximation to it, not an invented statistic.
        self.hess_inv = result.hess_inv

    def standard_errors(self) -> np.ndarray:
        """
        Per-weight standard error from the Laplace approximation to the
        posterior (see the note on `hess_inv` in fit()): sqrt of the inverse
        Hessian's diagonal. A small value means that dimension's weight is
        well-pinned by the data fit() saw; a large one means it could
        plausibly be far from its fitted value under similar evidence
        (blueprint gap 5, BP §9.2 "stable posterior direction").
        """
        if self.hess_inv is None:
            raise ValueError("Model has not been fitted yet")
        return np.sqrt(np.diag(self.hess_inv))

    def predict_score(self, title_id: str, fingerprint: np.ndarray) -> float:
        """
        Predict preference score for a film given its fingerprint: b_i + w^T x_i + delta_i.

        Args:
            title_id: ID of the title (for population-prior and bias lookup)
            fingerprint: Feature vector of the film

        Returns:
            Predicted preference score
        """
        if self.weights is None:
            raise ValueError("Model has not been fitted yet")

        score = self.population_priors.get(title_id, 0.0) + float(fingerprint @ self.weights)
        if title_id in self.bias_terms:
            score += self.bias_terms[title_id]
        return score

    def predict_ranking(self, title_ids: List[str], fingerprints: Dict[str, np.ndarray]) -> List[int]:
        """
        Predict ranking of titles by preference score.

        Args:
            title_ids: List of title IDs
            fingerprints: Mapping of title_id to fingerprint; every id must be present

        Returns:
            Indices sorted by predicted preference (descending)
        """
        scores = [self.predict_score(tid, _require_fingerprint(fingerprints, tid)) for tid in title_ids]
        return np.argsort(scores)[::-1].tolist()


def compute_pairwise_accuracy(
    triads: List[Tuple[Tuple[str, str, str], List[int]]],
    fingerprints: Dict[str, np.ndarray],
    ranker: PlackettLuceRanker
) -> float:
    """
    Evaluate model accuracy on pairwise comparisons.

    Extracts all pairwise comparisons from triadic rankings and measures
    the fraction correctly predicted. This is an evaluation metric only; the
    triad itself is stored and fitted as one listwise event (blueprint §7.2).

    Args:
        triads: List of triadic rankings
        fingerprints: Mapping of title_id to fingerprint; every id must be present
        ranker: Fitted PlackettLuceRanker model

    Returns:
        Pairwise accuracy (0-1)
    """
    correct = 0
    total = 0

    for triad_ids, ranking in triads:
        # Extract all pairwise comparisons
        for i in range(3):
            for j in range(i + 1, 3):
                idx_i, idx_j = ranking[i], ranking[j]
                tid_i, tid_j = triad_ids[idx_i], triad_ids[idx_j]

                # Predict scores
                score_i = ranker.predict_score(tid_i, _require_fingerprint(fingerprints, tid_i))
                score_j = ranker.predict_score(tid_j, _require_fingerprint(fingerprints, tid_j))

                # Check if predicted correctly (i should beat j)
                if score_i > score_j:
                    correct += 1
                total += 1

    return correct / total if total > 0 else 0.0


def compute_nll(
    triads: List[Tuple[Tuple[str, str, str], List[int]]],
    fingerprints: Dict[str, np.ndarray],
    ranker: PlackettLuceRanker,
) -> float:
    """
    Mean negative log-likelihood per triad under a fitted model -- the same
    listwise Plackett-Luce likelihood `fit()` optimizes, but *without* the L2
    term: regularization shapes the optimization objective, it is not part of
    the predictive fit this reports (blueprint §16.2; RANKING_ALGORITHM.md §6
    step 4 "Evaluate on the held-out slice: NLL, ...").

    Args:
        triads: List of triadic rankings to evaluate against -- typically a
            held-out slice the model was NOT fitted on.
        fingerprints: Mapping of title_id to fingerprint; every id must be present.
        ranker: Fitted PlackettLuceRanker model.

    Returns:
        Mean NLL per triad (lower is better); 0.0 for an empty `triads`.
    """
    if not triads:
        return 0.0

    total = 0.0
    for triad_ids, ranking in triads:
        scores = np.array([ranker.predict_score(tid, _require_fingerprint(fingerprints, tid)) for tid in triad_ids])
        for pos in range(2):
            idx = ranking[pos]
            remaining_indices = ranking[pos:]
            remaining_scores = scores[remaining_indices]
            total -= scores[idx] - logsumexp(remaining_scores)

    # Plain Python float, not np.float64: this value is persisted straight to
    # Postgres (training.py), and psycopg2 has no adapter for numpy scalars.
    return float(total / len(triads))
