import math

import numpy as np

from src.evaluation import load_profiles
from src.evaluation import (
    BASELINES,
    MODEL_NAME,
    RANDOM_NLL,
    GateThresholds,
    ProfileData,
    build_report,
    cluster_bootstrap,
    constant_scorer,
    evaluate_profile,
    evidence_bucket,
    genre_match_scorer,
    pairwise_hits,
    pooled_accuracy,
    run,
    temporal_split,
    top1_hit,
    triad_language,
    triad_nll,
)

DIM = 28
V1_DIM = 13


def test_pairwise_and_top1_give_ties_half_credit_and_random_its_expected_values():
    triad = (("a", "b", "c"), [0, 1, 2])
    correct, total = pairwise_hits(triad, constant_scorer())
    assert (correct, total) == (1.5, 3)
    assert top1_hit(triad, constant_scorer()) == 1 / 3
    scorer = {"a": 3.0, "b": 2.0, "c": 1.0}.__getitem__
    assert pairwise_hits(triad, scorer) == (3.0, 3)
    assert top1_hit(triad, scorer) == 1.0
    reversed_scorer = {"a": 1.0, "b": 2.0, "c": 3.0}.__getitem__
    assert pairwise_hits(triad, reversed_scorer) == (0.0, 3)


def test_triad_nll_is_log6_for_equal_utilities_and_small_for_a_confident_correct_order():
    triad = (("a", "b", "c"), [0, 1, 2])
    assert math.isclose(triad_nll(triad, constant_scorer()), RANDOM_NLL)
    confident = {"a": 10.0, "b": 5.0, "c": 0.0}.__getitem__
    assert triad_nll(triad, confident) < 0.05


def test_genre_match_scorer_rewards_the_profiles_winning_genres():
    train = [(("w", "m", "l"), [0, 1, 2])]
    genres = {"w": ["Drama"], "m": ["Comedy"], "l": ["Action"], "x": ["Drama", "Action"], "y": ["Comedy"]}
    scorer = genre_match_scorer(train, genres)
    assert scorer("x") == 0.0  # +1 Drama −1 Action
    assert scorer("y") == 0.0  # Comedy never won or lost
    assert scorer("w") == 1.0 and scorer("l") == -1.0
    assert scorer("unknown-title") == 0.0


def test_slices_and_split():
    assert triad_language(("a", "b", "c"), {"a": "ar", "b": "ar", "c": "ar"}) == "ar"
    assert triad_language(("a", "b", "c"), {"a": "fr", "b": "ja", "c": "de"}) == "other"
    assert triad_language(("a", "b", "c"), {"a": "ar", "b": "en", "c": "ar"}) == "mixed"
    assert triad_language(("a", "b", "c"), {"a": "ar", "b": None, "c": "ar"}) == "unknown"
    assert [evidence_bucket(n) for n in (3, 5, 12, 40)] == ["lt5", "5-9", "10-19", "20+"]
    triads = [((f"t{i}", f"u{i}", f"v{i}"), [0, 1, 2]) for i in range(12)]
    train, held = temporal_split(triads)
    assert (len(train), len(held)) == (10, 2)
    assert held == triads[-2:]
    assert temporal_split(triads[:4]) == (triads[:4], [])


def _synthetic_profile(rng: np.random.Generator, profile_id: str, rounds: int, noise: float, language: str) -> ProfileData:
    """Rankings sampled from a Plackett–Luce model with a hidden theta over 28 keys."""
    theta = rng.normal(size=DIM)
    titles = {f"{profile_id}-t{k}": rng.uniform(size=DIM) for k in range(rounds * 3)}
    fingerprints = titles
    fingerprints_v1 = {t: v[:V1_DIM] for t, v in titles.items()}
    genres = {t: [rng.choice(["Drama", "Comedy", "Action", "Horror"])] for t in titles}
    languages = {t: language for t in titles}
    ids = list(titles)
    triads = []
    for r in range(rounds):
        triple = tuple(ids[r * 3 : r * 3 + 3])
        utilities = np.array([theta @ titles[t] for t in triple]) + rng.gumbel(scale=noise, size=3)
        ranking = list(np.argsort(-utilities))
        triads.append((triple, [int(i) for i in ranking]))
    return ProfileData(profile_id, triads, fingerprints, fingerprints_v1, genres, languages)


def test_evaluate_profile_scores_every_held_out_triad_for_model_and_baselines():
    rng = np.random.default_rng(1)
    profile = _synthetic_profile(rng, "p1", rounds=15, noise=0.05, language="ar")
    scores = evaluate_profile(profile, popularity={})
    assert len(scores) == 3  # 15 // 5
    for s in scores:
        assert set(s.pairwise) == {MODEL_NAME, *BASELINES}
        assert s.language == "ar" and s.evidence == "10-19"
        assert MODEL_NAME in s.nll and "random" in s.nll and "pl_v1" in s.nll
    assert evaluate_profile(_synthetic_profile(rng, "p2", rounds=4, noise=0.1, language="en"), {}) == []


def test_gate_passes_when_the_model_clearly_learns_and_reports_slices_and_intervals():
    rng = np.random.default_rng(7)
    profiles = [_synthetic_profile(rng, f"p{k}", rounds=15, noise=0.02, language="ar" if k % 2 else "en") for k in range(6)]
    report = run(profiles, popularity={}, thresholds=GateThresholds(min_triads=15, min_profiles=3, bootstrap=200, seed=3), label="test")
    assert report["heldOut"] == {"triads": 18, "profiles": 6}
    assert report["scorers"][MODEL_NAME]["pairwiseAccuracy"] > 0.7
    assert report["scorers"]["random"]["pairwiseAccuracy"] == 0.5
    assert math.isclose(report["scorers"]["random"]["nll"], RANDOM_NLL)
    assert report["gate"]["passed"] is True
    assert set(report["slices"]["language"]) == {"ar", "en"}
    lo, hi = report["differenceCi95"]
    assert lo is not None and lo > 0 and hi >= lo
    assert all(c["passed"] is True for c in report["gate"]["checks"])


def test_gate_is_insufficient_below_the_minimums_and_fails_on_noise():
    rng = np.random.default_rng(11)
    one = [_synthetic_profile(rng, "solo", rounds=10, noise=0.02, language="en")]
    report = run(one, {}, GateThresholds(min_triads=30, min_profiles=3, bootstrap=50), "test")
    assert report["gate"]["sufficient"] is False and report["gate"]["passed"] is False
    assert report["gate"]["checks"][2]["passed"] is None  # not judged without enough data

    noisy = [_synthetic_profile(rng, f"n{k}", rounds=10, noise=50.0, language="en") for k in range(5)]
    report = run(noisy, {}, GateThresholds(min_triads=8, min_profiles=3, bootstrap=100), "test")
    assert report["gate"]["sufficient"] is True
    assert report["gate"]["passed"] is False
    failed = {c["name"] for c in report["gate"]["checks"] if c["passed"] is False}
    assert "beats_best_baseline_by_margin" in failed or "difference_ci_excludes_zero" in failed


def test_cluster_bootstrap_is_deterministic_and_needs_two_profiles():
    rng = np.random.default_rng(5)
    profiles = [_synthetic_profile(rng, f"b{k}", rounds=6, noise=0.05, language="en") for k in range(3)]
    scores = [s for p in profiles for s in evaluate_profile(p, {})]
    a = cluster_bootstrap(scores, lambda s: pooled_accuracy(s, MODEL_NAME), 100, 0)
    b = cluster_bootstrap(scores, lambda s: pooled_accuracy(s, MODEL_NAME), 100, 0)
    assert a == b and a[0] is not None
    assert cluster_bootstrap(scores[:1], lambda s: pooled_accuracy(s, MODEL_NAME), 100, 0) == (None, None)


def test_build_report_on_no_scores_is_insufficient_not_an_error():
    report = build_report([], GateThresholds(), "empty")
    assert report["heldOut"] == {"triads": 0, "profiles": 0}
    assert report["gate"]["sufficient"] is False
    assert report["bestBaseline"] is None


class FakeCursor:
    def __init__(self):
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append(" ".join(sql.split()))

    def fetchall(self):
        return []


# H4 (AUDIT_2026-09-05): the gate must count and load exactly the triads
# training would -- holdout rows excluded from the >= 5 threshold too,
# through training.py's own predicate.
def test_load_profiles_counts_only_trainable_triads_excluding_holdout():
    cursor = FakeCursor()

    profiles, popularity = load_profiles(cursor, ["demo.local"])

    assert profiles == [] and popularity == {}
    assert "NOT holdout" in cursor.executed[0]
    assert "purpose = 'learn'" in cursor.executed[0]
    assert "status = 'completed'" in cursor.executed[0]
