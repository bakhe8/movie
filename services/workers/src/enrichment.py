"""
Film fingerprinting worker using the OpenAI Chat Completions API.

This module generates film fingerprints using OpenAI's language models
with structured outputs (Pydantic schema enforcement).
"""

import os
from typing import Dict, Optional

import openai
from pydantic import BaseModel, Field

# Initialize OpenAI client
openai_client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


class FilmFingerprintV1(BaseModel):
    """Structured output schema for film fingerprints."""

    schema_version: str = Field("film-fingerprint-v1", description="Schema version identifier")

    # Tempo and rhythm
    pacing: float = Field(..., description="Pacing score 0-1 (slow to fast)")
    rhythmVariance: float = Field(..., description="Rhythm variance 0-1 (consistent to varied)")

    # Emotional/thematic
    ambiguity: float = Field(..., description="Ambiguity 0-1 (clear to ambiguous)")
    psychologicalDepth: float = Field(..., description="Psychological depth 0-1")
    warmth: float = Field(..., description="Emotional warmth 0-1 (cold to warm)")
    darkness: float = Field(..., description="Darkness 0-1 (light to dark)")

    # Narrative
    linearity: float = Field(..., description="Narrative linearity 0-1 (linear to fragmented)")
    dialogueDensity: float = Field(..., description="Dialogue density 0-1")
    actionIntensity: float = Field(..., description="Action intensity 0-1")
    plotComplexity: float = Field(..., description="Plot complexity 0-1")

    # Aesthetic
    visualComplexity: float = Field(..., description="Visual complexity 0-1")
    soundscapeComplexity: float = Field(..., description="Soundscape complexity 0-1")
    colorSaturation: float = Field(..., description="Color saturation 0-1")

    # Themes
    themes: list[str] = Field(default_factory=list, description="Primary themes identified")

    # Confidence scores
    confidence: Dict[str, float] = Field(default_factory=dict, description="Confidence per dimension")


class FilmEnrichmentWorker:
    """Worker for generating film fingerprints using OpenAI."""

    def __init__(self, model: str = "gpt-4o"):
        """
        Initialize the enrichment worker.

        Args:
            model: OpenAI model to use for fingerprinting
        """
        self.model = model

    def generate_fingerprint(
        self,
        title: str,
        description: str,
        plot_summary: str,
        additional_context: Optional[str] = None,
    ) -> FilmFingerprintV1:
        """
        Generate a film fingerprint using OpenAI structured outputs.

        Args:
            title: Film title
            description: Short film description
            plot_summary: Detailed plot summary
            additional_context: Optional additional context (cast, director, etc.)

        Returns:
            FilmFingerprintV1 object with computed fingerprint

        Raises:
            ValueError: If the API call fails or returns no parsed fingerprint
        """

        context = f"Title: {title}\n"
        context += f"Description: {description}\n"
        context += f"Plot Summary: {plot_summary}\n"
        if additional_context:
            context += f"Additional Context: {additional_context}\n"

        messages = [
            {
                "role": "system",
                "content": """You are an expert film analyst specializing in semantic film analysis.

Analyze the given film and generate a detailed fingerprint across multiple dimensions.
Score each dimension on a 0-1 scale with high confidence scores only where you have clear evidence from the plot/description.
Focus on objective aspects that can be inferred from the plot, themes, and narrative structure.""",
            },
            {
                "role": "user",
                "content": f"""Analyze this film and provide its fingerprint:

{context}

Provide scores for all dimensions. For dimensions you're less confident about, provide lower confidence scores.""",
            },
        ]

        try:
            completion = openai_client.beta.chat.completions.parse(
                model=self.model,
                max_tokens=1024,
                messages=messages,
                response_format=FilmFingerprintV1,
            )
        except openai.OpenAIError as error:
            raise ValueError(f"OpenAI fingerprint request failed: {error}") from error

        parsed = completion.choices[0].message.parsed
        if parsed is None:
            refusal = completion.choices[0].message.refusal
            raise ValueError(f"OpenAI did not return a parsed fingerprint: {refusal or 'unknown reason'}")

        return parsed

    def generate_recommendation_explanation(
        self,
        user_preferences: Dict[str, float],
        recommended_title: str,
        fingerprint: Dict[str, float],
        similar_titles: list[str],
    ) -> str:
        """
        Generate a natural language explanation for a recommendation.

        Args:
            user_preferences: User's learned preference weights
            recommended_title: Title being recommended
            fingerprint: Film's fingerprint
            similar_titles: Similar films the user liked

        Returns:
            Natural language explanation

        Raises:
            ValueError: If the API call fails or returns no explanation text
        """

        # Compute contribution of each dimension
        dimensions = {k: v for k, v in fingerprint.items() if isinstance(v, (int, float))}
        contributions = {
            dim: user_preferences.get(dim, 0) * dimensions.get(dim, 0)
            for dim in dimensions
        }

        # Get top contributing dimensions
        top_dims = sorted(contributions.items(), key=lambda x: abs(x[1]), reverse=True)[:3]
        dim_text = ", ".join([f"{dim}" for dim, _ in top_dims[:2]])

        similar_text = ""
        if similar_titles:
            similar_text = f" Your previous favorites like {', '.join(similar_titles[:2])} suggest you'd enjoy this."

        messages = [
            {
                "role": "system",
                "content": "You are a friendly film recommendation assistant. Explain why a film was recommended in 1-2 sentences, focusing on the key dimensions and relating it to the user's preferences.",
            },
            {
                "role": "user",
                "content": f"""Explain why "{recommended_title}" is recommended to someone who prefers films with high {dim_text}.{similar_text}

Keep it concise and friendly.""",
            },
        ]

        try:
            response = openai_client.chat.completions.create(
                model=self.model,
                max_tokens=150,
                messages=messages,
            )
        except openai.OpenAIError as error:
            raise ValueError(f"OpenAI explanation request failed: {error}") from error

        content = response.choices[0].message.content
        if content is None:
            raise ValueError("OpenAI response did not include explanation text")

        return content
