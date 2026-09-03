import numpy as np

from src.training import FINGERPRINT_DIMENSIONS, fingerprint_vector


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
