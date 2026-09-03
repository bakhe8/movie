"""Movie recommendation workers package."""

# Deliberately does not import .enrichment here (H3): that module builds an
# LLM API client (Anthropic today), and importing it eagerly meant
# `python -m src.training` -- which never talks to any LLM -- couldn't even
# start on a machine without credentials. Import it directly
# (`from src.enrichment import ...`) where it's actually needed.
from .ranker import PlackettLuceRanker, compute_pairwise_accuracy

__all__ = [
    "PlackettLuceRanker",
    "compute_pairwise_accuracy",
]
