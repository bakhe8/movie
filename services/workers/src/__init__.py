"""Movie recommendation workers package."""

# Deliberately does not import .enrichment here (H3): that module builds an
# OpenAI client, and importing it eagerly meant `python -m src.training` --
# which has nothing to do with OpenAI -- couldn't even start on a machine
# without OPENAI_API_KEY set. Import it directly (`from src.enrichment import
# ...`) where it's actually needed.
from .ranker import PlackettLuceRanker, compute_pairwise_accuracy

__all__ = [
    "PlackettLuceRanker",
    "compute_pairwise_accuracy",
]
