import json
import math
from types import SimpleNamespace

import pytest

from src.train_demo import (
    DEFAULT_PERSONAS,
    DemoProfile,
    acceptance,
    cosine,
    format_table,
    hidden_theta,
    load_personas,
    train_demo_profiles,
)
from src.training import FINGERPRINT_DIMENSIONS, FINGERPRINT_V1_DIMENSIONS


def test_cosine_is_one_for_parallel_and_none_for_a_zero_vector():
    assert cosine([1, 2, 3], [2, 4, 6]) == pytest.approx(1.0)
    assert cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert cosine([0, 0], [1, 1]) is None
    with pytest.raises(ValueError):
        cosine([1], [1, 2])


def test_committed_personas_fixture_is_valid():
    fixture = load_personas(DEFAULT_PERSONAS)
    slugs = [persona["slug"] for persona in fixture["personas"]]
    assert slugs == ["slow-burn", "spectacle", "warm-talky", "newcomer"]
    # Regenerated on all 28 keys (2026-09-04, after ADR-69): every theta spans the model.
    assert all(len(persona["theta"]) == len(FINGERPRINT_DIMENSIONS) for persona in fixture["personas"])
    assert fixture["temperature"] == 0.4
    assert fixture["emailDomain"] == "demo.local"


def _fixture(tmp_path):
    fixture = {
        "emailDomain": "demo.local",
        "personas": [
            {"slug": "rich", "theta": [1.0] + [0.0] * 12, "triads": 25, "expectedBand": "strong"},
            {"slug": "newcomer", "theta": [0.0] * 13, "triads": 2, "expectedBand": "inconclusive"},
        ],
    }
    path = tmp_path / "personas.json"
    path.write_text(json.dumps(fixture), encoding="utf-8")
    return load_personas(path)


def _result(weights, triads=25, held_out=5, acc=0.85):
    return SimpleNamespace(
        weights=weights,
        training_triad_count=triads,
        held_out_triad_count=held_out,
        held_out_pairwise_accuracy=acc,
        held_out_nll=0.9,
        training_genre_diversity=7,
    )


def test_recovery_uses_the_personas_hidden_theta_and_survives_one_failure(tmp_path):
    fixture = _fixture(tmp_path)
    profiles = [DemoProfile("rich", "rich@demo.local", "p1"), DemoProfile("newcomer", "newcomer@demo.local", "p2")]

    def trainer(profile_id):
        if profile_id == "p2":
            raise ValueError("No completed triads exist for this profile")
        return _result([0.9] + [0.05] * 12)

    rows = train_demo_profiles(profiles, fixture, trainer=trainer)

    assert rows[0].recovery == pytest.approx(cosine([0.9] + [0.05] * 12, [1.0] + [0.0] * 12))
    assert rows[0].recovery_v1 == pytest.approx(rows[0].recovery)  # 13 weights: no V2 block to separate
    assert rows[0].v2_weight_share is None
    assert rows[0].genre_diversity == 7
    assert rows[0].language_diversity is None  # the attribute was absent on this result: unknown, not 0
    assert rows[1].error and "No completed triads" in rows[1].error
    table = format_table(rows, fixture)
    assert "rich" in table and "FAILED" in table and "strong" in table


def test_acceptance_checks_only_the_richest_persona(tmp_path):
    fixture = _fixture(tmp_path)
    profiles = [DemoProfile("rich", "rich@demo.local", "p1"), DemoProfile("newcomer", "newcomer@demo.local", "p2")]
    good = train_demo_profiles(profiles, fixture, trainer=lambda _pid: _result([1.0] + [0.0] * 12))
    assert acceptance(good, fixture) == []

    bad = train_demo_profiles(profiles, fixture, trainer=lambda _pid: _result([0.0] * 12 + [1.0], acc=0.5))
    problems = acceptance(bad, fixture)
    assert any("recovery" in problem for problem in problems)
    assert any("held-out" in problem for problem in problems)
    # The newcomer's theta is all zeros: no recovery is asserted for it.
    assert not any(problem.startswith("newcomer") for problem in problems)


def test_hidden_theta_pads_v1_personas_with_zero_v2_weight_and_refuses_longer():
    n_v1, n_all = len(FINGERPRINT_V1_DIMENSIONS), len(FINGERPRINT_DIMENSIONS)
    padded = hidden_theta([1.0] * n_v1, n_all)
    assert padded == [1.0] * n_v1 + [0.0] * (n_all - n_v1)
    assert hidden_theta([0.5] * n_all, n_all) == [0.5] * n_all
    with pytest.raises(ValueError):
        hidden_theta([0.5] * (n_all + 1), n_all)


def test_load_personas_accepts_v1_or_full_theta_only(tmp_path):
    n_v1, n_all = len(FINGERPRINT_V1_DIMENSIONS), len(FINGERPRINT_DIMENSIONS)
    for length, ok in ((n_v1, True), (n_all, True), (n_v1 + 1, False)):
        path = tmp_path / f"p{length}.json"
        path.write_text(json.dumps({"personas": [{"slug": "x", "theta": [0.1] * length, "triads": 1, "expectedBand": "?"}]}), encoding="utf-8")
        if ok:
            load_personas(path)
        else:
            with pytest.raises(ValueError):
                load_personas(path)


def test_recovery_under_the_28_dimension_model_splits_v1_from_spurious_v2(tmp_path):
    fixture = _fixture(tmp_path)
    n_v1, n_all = len(FINGERPRINT_V1_DIMENSIONS), len(FINGERPRINT_DIMENSIONS)
    # V1 part points exactly at theta; the V2 block carries spurious weight of equal norm.
    weights = [1.0] + [0.0] * (n_v1 - 1) + [1.0] + [0.0] * (n_all - n_v1 - 1)
    rows = train_demo_profiles([DemoProfile("rich", "rich@demo.local", "p1")], fixture, trainer=lambda _pid: _result(weights))
    assert rows[0].recovery_v1 == pytest.approx(1.0)
    assert rows[0].recovery == pytest.approx(1 / math.sqrt(2))
    assert rows[0].v2_weight_share == pytest.approx(1 / math.sqrt(2))
    # A 13-key persona is judged on its V1 recovery: the model recovers it on its
    # own dimensions, so it passes even though the full-vector cosine is below the floor.
    assert rows[0].theta_covers_model is False
    assert acceptance(rows, fixture) == []
    # A 28-key persona is judged on the full vector: the same weights now fail the bar.
    full = {**fixture, "personas": [{**fixture["personas"][0], "theta": [1.0] + [0.0] * (n_all - 1)}, fixture["personas"][1]]}
    rows_full = train_demo_profiles([DemoProfile("rich", "rich@demo.local", "p1")], full, trainer=lambda _pid: _result(weights))
    assert rows_full[0].theta_covers_model is True
    assert rows_full[0].recovery == pytest.approx(1 / math.sqrt(2))
    assert any("recovery" in problem and "V1" not in problem for problem in acceptance(rows_full, full))
    table = format_table(rows, fixture)
    assert "rec-v1" in table and "v2-share" in table and "lambda" in table
    assert rows[0].chosen_regularization is None  # the fake result carries no such field: unknown, not 0
