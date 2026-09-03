import json
from types import SimpleNamespace

import pytest

from src.train_demo import DEFAULT_PERSONAS, DemoProfile, acceptance, cosine, format_table, load_personas, train_demo_profiles
from src.training import FINGERPRINT_DIMENSIONS


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
    assert all(len(persona["theta"]) == len(FINGERPRINT_DIMENSIONS) for persona in fixture["personas"])
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
