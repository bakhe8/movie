import numpy as np
import pytest

from src.enrichment import V2_FEATURES, V3_FEATURES
from src.fingerprint_v2_eval import FEATURE_SETS, evaluate_profile, feature_vector, spearman, temporal_split
from src.training import FINGERPRINT_DIMENSIONS


def _fingerprint(v1_value, v2_value=None, v3_value=None):
    fingerprint = {dimension: v1_value for dimension in FINGERPRINT_DIMENSIONS}
    if v2_value is not None:
        fingerprint["v2"] = {"features": {key: v2_value for key in V2_FEATURES}}
    if v3_value is not None:
        fingerprint["v3"] = {"features": {key: v3_value for key in V3_FEATURES}}
    return fingerprint


def test_feature_sets_have_the_expected_sizes():
    assert len(FEATURE_SETS["v1"]) == 13
    assert len(FEATURE_SETS["v2"]) == 15
    assert len(FEATURE_SETS["v1+v2"]) == 28
    assert len(FEATURE_SETS["v3"]) == 12
    assert len(FEATURE_SETS["v1+v2+v3"]) == 40
    served = next(key for key in FEATURE_SETS if key.startswith("served("))
    assert FEATURE_SETS[served] == tuple(FINGERPRINT_DIMENSIONS)


def test_feature_vector_reads_v1_top_level_and_v2_nested_and_never_imputes():
    fp = _fingerprint(0.5, 0.7)
    assert feature_vector(fp, FEATURE_SETS["v1"]).tolist() == [0.5] * 13
    assert feature_vector(fp, FEATURE_SETS["v2"]).tolist() == [0.7] * 15
    assert feature_vector(_fingerprint(0.5), FEATURE_SETS["v1+v2"]) is None  # no v2 block: unknown, not zero
    assert feature_vector(_fingerprint(0.5, 0.7, 0.9), FEATURE_SETS["v1+v2+v3"]).tolist() == [0.5] * 13 + [0.7] * 15 + [0.9] * 12
    assert feature_vector(_fingerprint(0.5, 0.7), FEATURE_SETS["v1+v2+v3"]) is None  # no v3 block yet
    assert feature_vector(None, FEATURE_SETS["v1"]) is None


def test_temporal_split_matches_the_trainer():
    triads = [(("a", "b", "c"), [0, 1, 2])] * 7
    train, held = temporal_split(triads)
    assert (len(train), len(held)) == (6, 1)
    assert temporal_split(triads[:4]) == (triads[:4], [])


def test_spearman():
    assert spearman({"a": 1, "b": 2, "c": 3}, {"a": 1, "b": 2, "c": 3}) == pytest.approx(1.0)
    assert spearman({"a": 1, "b": 2, "c": 3}, {"a": 3, "b": 2, "c": 1}) == pytest.approx(-1.0)
    assert spearman({"a": 1}, {"a": 1}) is None


def test_v2_only_features_can_explain_a_ranking_v1_cannot():
    # Six titles identical on V1, differing on one V2 feature; the judge ranks by that feature.
    rng = np.random.default_rng(3)
    titles = {}
    for index in range(6):
        fp = _fingerprint(0.5, 0.5)
        fp["v2"]["features"]["tone.irony"] = index / 5
        titles[f"t{index}"] = fp
    ids = list(titles)
    triads = []
    for _ in range(30):
        pick = list(rng.choice(ids, size=3, replace=False))
        ranking = sorted(range(3), key=lambda i: -titles[pick[i]]["v2"]["features"]["tone.irony"])
        triads.append((tuple(pick), ranking))

    results = {r.feature_set: r for r in evaluate_profile(triads, titles, 0.01)}

    # Identical V1 vectors give identical scores; the ranker's pairwise accuracy counts a tie as a miss.
    assert results["v1"].held_out_accuracy <= 0.5
    assert results["v1+v2"].held_out_accuracy > 0.9
    assert results["v2"].held_out_accuracy > 0.9
