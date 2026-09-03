import numpy as np

from src.training import FINGERPRINT_DIMENSIONS, fingerprint_vector


class TestFingerprintVector:
    def test_orders_values_to_match_fingerprint_dimensions(self):
        fingerprint = {dim: index / 10 for index, dim in enumerate(FINGERPRINT_DIMENSIONS)}

        vector = fingerprint_vector(fingerprint)

        expected = np.array([index / 10 for index in range(len(FINGERPRINT_DIMENSIONS))])
        np.testing.assert_allclose(vector, expected)

    def test_missing_dimensions_default_to_zero(self):
        vector = fingerprint_vector({"pacing": 0.7})

        assert vector[FINGERPRINT_DIMENSIONS.index("pacing")] == 0.7
        assert vector[FINGERPRINT_DIMENSIONS.index("warmth")] == 0.0

    def test_explicit_none_values_default_to_zero_rather_than_crashing(self):
        vector = fingerprint_vector({"pacing": None, "warmth": 0.4})

        assert vector[FINGERPRINT_DIMENSIONS.index("pacing")] == 0.0
        assert vector[FINGERPRINT_DIMENSIONS.index("warmth")] == 0.4

    def test_vector_length_matches_dimension_count(self):
        vector = fingerprint_vector({})

        assert len(vector) == len(FINGERPRINT_DIMENSIONS)
