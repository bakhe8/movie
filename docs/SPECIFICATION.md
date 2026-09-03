# Movie Recommendation System - Full Specification

**Version**: 1.0  
**Date**: 2025-01-02  
**Status**: Foundation for Phase 1 MVP

This is the complete technical specification for the movie recommendation system based on the triadic ranking methodology.

> **Supersession notice**: [docs/movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) is the authoritative product foundation. This document is kept as an implementation-detail reference and has been updated to remove points that conflicted with it (merged confidence scores, post-watch star ratings, the utility model missing a population prior, fixed pass/fail accuracy numbers). Where anything below still reads inconsistently with the blueprint, the blueprint wins.

## Executive Summary

A personalized movie recommendation system using triadic rankings and film fingerprinting. Users rank sets of 3 films, training a Plackett-Luce statistical model to learn their taste. The model generates recommendations calibrated to individual preferences without relying on collaborative filtering or external rating systems.

**Launch market**: Arabic-first PWA (RTL), Arabic/Gulf beachhead audience, English support built into the infrastructure from the start (blueprint §2, §3).

**Phased targets** (blueprint §17, planning figures — final go/no-go thresholds for each are fixed experimentally, with confidence intervals, right before that phase's test, not hard-coded here):
- Phase 0 (weeks 1-4): 15-20 people on a clickable prototype, to validate the question/UX and the triad-vs-pair-vs-single-rating comparison — not a product beta.
- Alpha (months 2-3): 80-150 users; accepters complete 20-30 triads across short sessions.
- Closed Beta (months 4-6) → Public Arabic Beta (months 7-9) → Economics test (months 10-12).

---

## 1. Technology Stack

### Why This Stack?

The existing Next.js/NestJS environment is optimal. No need for Flutter, new languages, or complex microservices initially.

### Recommended Architecture

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Frontend** | Next.js + TypeScript (PWA) | Rapid iteration, web + mobile ready |
| **Mobile** (later) | React Native (Expo) | Share types and logic with Next.js |
| **Backend** | NestJS + TypeScript | Modular monolith, minimal ops overhead |
| **Database** | PostgreSQL + pgvector | Semantic search, managed backups |
| **Semantic Search** | pgvector (in PostgreSQL) | No external vector DB needed |
| **Ranking Engine** | Python (NumPy/SciPy) | Plackett-Luce, statistical computation |
| **Background Jobs** | Redis + BullMQ | Task queue, lightweight |
| **LLM Integration** | OpenAI Responses API | Structured film fingerprints |
| **Deployment** | Web/API separate (Lambda/Vercel) | Start simple, no Kubernetes |

### Not Starting With
- ❌ Kubernetes or Docker Swarm
- ❌ Multiple microservices
- ❌ Complex infrastructure
- ❌ Flutter (start with PWA)
- ❌ IMDb free data (licensing issues)
- ❌ Direct IMDb scraping
- ❌ Commercial TMDB without written agreement

---

## 2. Film Data Sources

### Constraint: Licensing First

**Do not use unlicensed data in production applications.**

### IMDb (Commercial)
- **Free Data**: Daily data dumps are for personal/non-commercial use only
- **Commercial**: AWS Data Exchange + GraphQL API (requires agreement)
- **Verdict**: Don't use free dumps in commercial app; defer to Phase 3 if licensing negotiated

### TMDB (The Movie Database)
- **Free Tier**: Developer key available, but ToS restrict commercial AI/recommendation use
- **Requirements for Commercial Use**:
  - Written agreement (not just terms)
  - Explicit permission for:
    - Commercial recommendations
    - AI model training
    - Data derivatives (embeddings, fingerprints)
    - Arabic localization
    - Image/metadata display
    - Sending summaries to LLMs
  - Proper attribution scope
  - Data retention/update terms

**Action**: Contact TMDB early; don't assume free tier allows this use case

### Wikidata (Recommended for MVP)
- **License**: CC0 (public domain)
- **Data**: Structured facts, titles in multiple languages
- **Availability**: APIs + bulk downloads
- **Use**: Base metadata without licensing concerns

### JustWatch (Availability Layer)
- **Data**: Where to watch films in each country (including Saudi Arabia)
- **Partnership API**: Requires agreement + API key
- **Constraint**: Do NOT overweight availability in ranking; compute best film first, then filter by availability
- **Action**: Contact JustWatch for partner access; include Saudi Arabia explicitly

### MVP Data Strategy

**Phase 1 Approach**:
1. Curate 300-500 popular, diverse films internally
2. Assign internal film IDs (independent of external sources)
3. Fetch base metadata from Wikidata (CC0, no restrictions)
4. Generate film fingerprints via OpenAI (our process)
5. Store external IDs (IMDb, TMDB, Wikidata) as foreign keys
6. Negotiate TMDB commercial license in parallel
7. Negotiate JustWatch partnership in parallel

**Never**: Use TMDB IDs as primary key; create internal IDs first

```
Internal ID (FILM_001, FILM_002, ...)
├── imdb_id (if licensed)
├── tmdb_id (if licensed)
├── wikidata_id (CC0)
└── justwatch_id (if partnership active)
```

This allows switching data providers without losing user data.

---

## 3. Film Fingerprint Schema (V1)

> This V1 schema is a practical starting subset. The blueprint (§6.1) defines ten feature families the fingerprint should eventually cover: narrative structure, pacing, tone/emotion, characters, dialogue/information density, style, theme, ending type, people (director/cast/writer, heavily shrunk to avoid false correlation), and cultural context (original language, dialects, production country, story setting — kept separate from UI language and from filming location, which is near-zero weight). V1 below covers narrative/pacing/tone/style reasonably well but is missing explicit people, ending-type, and cultural-context dimensions — add them before V1 is treated as complete, and keep §6.2's split between "the work," "the edition/version," and "the individual watch event" (dub/subtitle quality is a viewing-experience signal, not a work signal).

### Core Concept
Each film is analyzed across ~30-50 semantic dimensions, generating a "fingerprint" that describes its artistic/thematic characteristics, independent of ratings or popularity.

### FilmFingerprintV1 Structure

```typescript
{
  schema_version: "film-fingerprint-v1",
  
  // Tempo & Rhythm (0-1 scale)
  pacing: 0.6,           // Slow (0) → Fast (1)
  rhythmVariance: 0.5,   // Consistent (0) → Varied (1)
  
  // Emotional/Psychological
  ambiguity: 0.8,        // Clear (0) → Ambiguous (1)
  psychologicalDepth: 0.9, // Shallow → Deep
  warmth: 0.2,           // Cold (0) → Warm (1)
  darkness: 0.7,         // Light → Dark
  
  // Narrative Structure
  linearity: 0.4,        // Linear (0) → Fragmented (1)
  dialogueDensity: 0.6,  // Sparse (0) → Dense (1)
  actionIntensity: 0.3,  // Contemplative → Action-heavy
  plotComplexity: 0.8,   // Simple → Complex
  
  // Aesthetic
  visualComplexity: 0.7, // Minimal → Elaborate
  soundscapeComplexity: 0.6,
  colorSaturation: 0.4,  // Desaturated → Vivid
  
  // Thematic Elements
  themes: ["identity", "memory", "loss", "redemption"],
  
  // Confidence Scores
  confidence: {
    pacing: 0.85,
    ambiguity: 0.92,
    psychologicalDepth: 0.89,
    // ... confidence for each dimension
  },
  
  // Metadata
  generatedBy: "openai",
  modelVersion: "gpt-4o",
  generatedAt: "2025-01-02T10:00:00Z"
}
```

### Generation Process

**One-Time Fingerprinting Per Film**

1. Collect film facts from licensed source (plot summary, themes, runtime, etc.)
2. Call OpenAI Responses API with structured JSON schema
3. Model outputs fingerprint according to exact schema
4. Store in PostgreSQL `titles.fingerprint` column
5. Log model version and confidence scores
6. **Never re-fingerprint** unless schema changes

**Cost Control**: Use batch API for initial fingerprinting (~50% discount, 24h turnaround)

### What NOT to Do

- ❌ Don't fingerprint on every request
- ❌ Don't use different models for the same film
- ❌ Don't fingerprint using user preferences
- ❌ Don't send raw IMDb/TMDB data directly to OpenAI
- ✅ Do fingerprint once, store, reuse forever

---

## 4. Ranking Engine: Plackett-Luce Model

### Core Hypothesis

**Hypothesis**: Given film fingerprints and user preferences, can a simple linear model (`score = weights · fingerprint + bias`) trained on triadic rankings outperform baselines (popularity, genre)?

### Mathematical Model

The blueprint's full utility model (§7.1) is:

$$s(u,m) = b(m) + \theta_u^{\top}\phi_m + p_u^{\top}q_m + \delta_{u,m}$$

Phase 1 implements the first, second, and fourth terms; the collaborative term $p_u^\top q_m$ is deferred until enough users/data exist to fit it safely (matches this doc's original "no collaborative filtering in Phase 1" decision below — that decision stands, it's just now explicit in the formula rather than by omission):

$$U_{u,i} = b(i) + w_u^T x_i + \delta_{u,i}$$

Where:
- $b(i)$ = weak population prior / general acceptance for film $i$ (e.g. shrunk popularity or public-quality prior), used mainly to soften cold start; heavily shrunk and never shown to the user as if it were personal fit
- $x_i$ = film fingerprint (vector)
- $w_u$ = user's learned taste weights (vector), starting from a population-hierarchical prior and relaxing toward the individual as evidence accumulates
- $\delta_{u,i}$ = per-film bias term (user finds this film uniquely appealing or unappealing), strongly shrunk so one exceptional film doesn't get generalized into the taste model (blueprint §7.4)

$b(i)$ must stay visibly separate from $w_u^T x_i$ in anything shown to the user — the blueprint bans merging "how well the movie fits you" with "how well-received it is generally" into one score (§2.4 principle 7, §4.4).

### Training from Triadic Rankings

User ranks 3 films: A > B > C (complete ordering)

**Plackett-Luce MLE**:
$$P(A > B > C) = \frac{\exp(U_{u,A})}{\exp(U_{u,A}) + \exp(U_{u,B}) + \exp(U_{u,C})} \cdot \frac{\exp(U_{u,B})}{\exp(U_{u,B}) + \exp(U_{u,C})} \cdot \frac{\exp(U_{u,C})}{\exp(U_{u,C})}$$

**Optimization**: Maximize log-likelihood of observed rankings using BFGS or similar.

**Regularization**: L2 penalty to prevent overfitting.

### Phase 1 Simplifications

- ✅ Fixed question: "Rank by your overall taste" (not mood-dependent)
- ✅ Single global question across all triads
- ✅ Learn $w_u$ only, ignore per-director/actor effects initially
- ✅ Use "haven't watched" as display-only state (don't infer preferences)
- ✅ No collaborative filtering yet

### Phase 2+ Enhancements

After proving Phase 1 works:

$$w_u = w_{global} + w_{similarity\_group} + \Delta w_u$$

- Add director/actor effects
- Add mood/context effects
- Add collaborative filtering
- Implement adaptive question selection

### Evaluation Metrics

**Primary Metric**: Pairwise accuracy on held-out triads
- Extract all pairs (A > B, B > C, A > C)
- Check if model correctly predicts order
- Target: 60-65% after 20-30 triads

**Baselines to Beat**:
1. Popularity ranking (IMDb rating or frequency)
2. Genre-only matching
3. Closest watched film
4. Random Embeddings similarity
5. Simple content model

**Success Threshold**: Model must outperform all baselines by 5+ percentage points on pairwise accuracy

---

## 5. Database Design

### Event-Based Architecture

**Core Principle**: Store raw triadic comparison events, not just derived model weights.

**Why?**:
- Can rebuild all weights from events if model changes
- User deletion is clean (soft-delete events, keep audit trail)
- Data integrity: events are immutable
- Reproducibility: same events + same algorithm = same model

### Key Tables

#### Triads (Core Event Log)
```sql
CREATE TABLE triads (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL,
  
  -- The three films
  title_id_1 UUID, title_id_2 UUID, title_id_3 UUID,
  
  -- User's ranking (0, 1, 2 = 1st, 2nd, 3rd place)
  ranking INTEGER[],
  
  -- Metadata
  session_id VARCHAR,
  model_version_used VARCHAR,
  reason_for_selection TEXT,
  
  -- Replacements for "haven't watched"
  replacements JSONB,
  
  created_at TIMESTAMP
);
```

**Important**: Store complete rankings, not as separate pairs

#### User Model Snapshots
```sql
CREATE TABLE user_model_snapshots (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL,
  
  weights NUMERIC[],      -- Weight vector
  bias_terms JSONB,       -- Per-film biases
  
  training_triad_count INTEGER,
  validation_accuracy NUMERIC,
  pairwise_accuracy NUMERIC,
  
  created_at TIMESTAMP
);
```

#### Global Model Versions
```sql
CREATE TABLE global_model_versions (
  id UUID PRIMARY KEY,
  version VARCHAR,        -- 'v1', 'v1.1', etc.
  fingerprint_schema_version VARCHAR,
  
  avg_pairwise_accuracy NUMERIC,
  baseline_comparison JSONB,  -- vs popularity, genre, etc.
  
  active BOOLEAN,
  created_at TIMESTAMP
);
```

See [docs/schema.md](schema.md) for full DDL.

---

## 6. Recommendation Engine

### Scoring (Real-Time, Lightweight)

```
For each film i:
  personal_fit_i   = b(i)-independent part: w_u · fingerprint_i + bias_i   (ranking-derived, this user only)
  public_quality_i = normalized critic/audience prior (independent source, own uncertainty)
  watchability_i    = availability now: market, platform, dub/subtitle

Sort candidates by personal_fit descending
Filter: not watched, not in watchlist
Select top 10, split across three tracks: safe / discovery / outside-usual (blueprint §4.4)
Return personal_fit, public_quality, watchability, and a confidence BAND
  (not a raw percentage — see Confidence below) plus top contributing dimensions
```

Personal Fit, Public Quality, and Watchability are always returned and displayed as three separate values — they are never combined into a single "match score" (blueprint §4.4, principle #7).

### Confidence: bands, not bare percentages

Until a confidence number has been calibrated against confirmed post-watch outcomes (film recommended → watched → ranked highly in a later triad), the UI shows one of four verbal bands, not a number (blueprint §7.2, §9.3):

| Band | When | Example copy |
|------|------|---------------|
| Initial | 3-5 triads or correlated evidence | "We're starting to notice a pattern... still learning." |
| Likely | Multiple pieces of evidence in a narrow context | "This tends to show up especially when..." |
| Strong | Repeated across contexts, predicts later choices | "This is a fairly stable pattern in your picks." |
| Inconclusive | Conflicting evidence or weak fingerprint | "Not enough signal yet." |

A raw calibrated probability ("you'll rank this highly with X% confidence") can be introduced later, but only after calibration work (Brier score / ECE against real post-watch outcomes) backs it — never as a display default.

**Cache**: Store user weights in Redis, invalidate after new triad

**Never Call OpenAI During Ranking**: Weights are precomputed; OpenAI only explains post-hoc.

### Explanation (Post-Ranking, Optional)

Once top recommendation selected, optionally call OpenAI Responses API:

**Input**:
- Recommended film fingerprint
- User's learned weights
- Top 3 contributing dimensions
- Similar films user previously enjoyed

**Output**: Natural language explanation

```
"We recommend Interstellar because your taste favors 
psychological depth (score: 9/10), complex narratives 
(8/10), and medium pacing (7/10). Your previous favorites 
like Inception and The Prestige show this pattern."
```

### What NOT to Do

- ❌ Never let OpenAI decide the ranking
- ❌ Never call OpenAI on every request
- ❌ Never send user email/ID to OpenAI
- ✅ Do use deterministic weights for scoring
- ✅ Do use LLM only to explain precomputed decisions

---

## 7. User Experience Flow

### Registration & Setup

1. **Account Creation**
   - Email + password
   - Read privacy policy & consent to data use
   - Separate consent for "include me in global trend analysis"

2. **Profile Creation** (Individual, not family)
   - Name: "My Profile", "Mom's Profile", etc.
   - Language: Arabic or English
   - Each person = separate preference model

3. **Watched Films Input**
   - Option 1: Mark films individually from catalog
   - Option 2: Import from a user-provided list (e.g. CSV export they own; not scraped)
   - State: watched / not watched / not remembered (both "not watched" and "not remembered" are neutral exposure-unknown states, never a negative preference signal — blueprint §2.4 principle #3, §4.3)
   - Any rating carried by an imported list is stored only as a low-confidence auxiliary signal; it never substitutes for a triad ranking and is never solicited by an in-app "rate this" prompt (blueprint §4.2, §4.5)

### First Interaction: Seed Triads

4. **Initial Triads** (6-10 structured comparisons)
   - Display diverse films (different genres, styles)
   - Question: "Which would you rather watch right now?"
   - Allow "Haven't watched? Pick replacement" for each
   - Show progress: "3 of 10"

5. **First Recommendations**
   - Show top 10 with clear "Still Learning" label
   - Explain: "Based on 6 rankings, still uncertain"
   - Invite more feedback to improve

### Ongoing Usage

6. **Main Interface: Triadic Ranking**
   - 3 cards visible simultaneously
   - Click/tap to select 1st, then 2nd, then 3rd place
   - Visual feedback (highlight, animation)
   - "Haven't watched? Replace" option for each card
   - Submit → next triad loads immediately

7. **Post-Ranking Update**
   - Show: "Updated your model! Top recommendation now: [Film]"
   - Let user view updated recommendations
   - Option to rank more or explore

8. **Recommendation Page**
   - Top 10, split across safe / discovery / outside-usual tracks (blueprint §4.4), ranked by Personal Fit
   - Show Personal Fit, Public Quality, and Watchability as separate values, plus a confidence band (Initial/Likely/Strong/Inconclusive) — not a merged score or raw percentage
   - Show top 3 reasons (dimensions)
   - "Add to watchlist" → tracked
   - After user watches film → the film returns to the pool of works usable in a later triad; no star-rating prompt is shown (blueprint §4.5)

### No Bells & Whistles (MVP Only)

- ❌ No social sharing
- ❌ No collaborative filtering
- ❌ No email notifications
- ❌ No ads or targeting
- ❌ No trending/popular section
- ✅ Triads → Recommendations cycle

---

## 8. OpenAI Integration

### Correct Usage Pattern

#### ✅ DO THIS: Fingerprint Once, Store Forever

```python
# Async job, runs once per film
fingerprint = enrichment_worker.generate_fingerprint(
    title="Inception",
    description="...",
    plot_summary="..."
)

# Store with metadata
title.fingerprint = fingerprint.model_dump()
title.fingerprint_model_version = "gpt-4o"
title.save()
```

#### ✅ DO THIS: Explain Precomputed Decision

```python
# User sees recommendation
# Score was computed offline
recommendation_score = 0.87  # Already computed

# Optionally, explain in natural language
explanation = enrichment_worker.generate_recommendation_explanation(
    user_weights=user_model.weights,
    recommended_title="Interstellar",
    fingerprint=film.fingerprint,
    similar_titles=["Inception", "The Prestige"]
)
# → "Based on your preference for psychological depth..."
```

#### ❌ DON'T DO THIS: Call OpenAI on Every Rank

```python
# ❌ WRONG: Calling LLM per request
def rank_films_for_user(user_id):
    for film in films:
        # ❌ This is expensive and slow
        response = openai.messages.create(
            messages=[{"role": "user", "content": f"Should user like {film}?"}]
        )
        scores.append(parse_score(response))
    return sorted(scores)
```

### API Best Practices

**Cost Control**:
```python
# Use batch API for offline work (50% discount)
batch_job = openai_client.beta.batch.create(requests=[...])

# Use gpt-4o mini for cheap tasks
# Use gpt-4o for quality fingerprints
# Later: use GPT-5.6 Luna (cost-optimized) for bulk
```

**Data Privacy**:
```python
# ALWAYS set store=false
response = openai_client.messages.create(
    model="gpt-4o",
    messages=[...],
    extra_headers={"openai-internal-store": "false"}
)

# Never send:
# - User email
# - User rankings
# - User ID
# - Personal information

# Only send:
# - Film title (public)
# - Plot summary (public)
# - Reason for explanation (aggregated)
```

---

## 9. Availability & JustWatch Integration

### Constraint: Availability is a Filter, Not a Ranking Factor

**Bad**: Include "available in Saudi Arabia" in preference weights
**Good**: Rank best film first, then filter by availability

### Phase 1 Approach

- ✅ Show "Where to watch?" link (can be researched manually)
- ✅ Allow users to set preferred streaming services
- ✅ Rank by taste, then filter by preference

### Phase 2+: JustWatch Partnership

Once MVP succeeds:
1. Contact JustWatch as content partner
2. Get API key + explicit Saudi Arabia support
3. Check availability for top 10-20 recommendations only
4. Store availability with timestamp ("checked_at")
5. Handle "not available" gracefully

**Differentiate**:
- "Best for you (we predict you'll love this)"
- "Now available in Saudi Arabia"
- "Trending among users like you"

---

## 10. Privacy & Compliance

### Saudi Arabia PDPL Essentials

**Key Requirements**:
- ✅ Clear purpose statement
- ✅ Explicit consent for each use case
- ✅ Right to access, correction, deletion
- ✅ No selling/sharing without consent
- ✅ Impact assessment for automated decisions
- ✅ 30-day breach notification

### User Rights Implementation

1. **Export Data** (Right to Portability)
   ```
   GET /api/profiles/{id}/data/export
   → Download all rankings, preferences, recommendations
   ```

2. **Delete Account** (Right to Erasure)
   ```
   DELETE /api/users/{id}
   → Soft-delete all triads
   → Mark deleted in audit log
   → Cannot recover (permanent)
   ```

3. **Correct Data** (Right to Correction)
   ```
   PATCH /api/triads/{id}/ranking
   → User can adjust past rankings
   ```

4. **Restrict Processing** (Right to Restrict)
   ```
   POST /api/profiles/{id}/restrictions
   {"type": "no_ai_explanations"}
   → Disable certain features
   ```

### Consent Model

```
Account signup
    ↓
Core consent: "I agree to Terms"
    ↓
First login
    ↓
Purpose-specific consent (radio buttons):
  [✓] Use my rankings for recommendations
  [✓] Store my watch history
  [ ] Include my data in trend analysis
  [ ] Send me email recommendations
    ↓
Profile created
```

See [docs/privacy.md](privacy.md) for full compliance checklist.

---

## 11. Implementation Phases

> Renamed/renumbered to line up with the blueprint's own phase names (§17) so the two documents don't imply two different roadmaps. "Phase 1: MVP" below corresponds to the blueprint's **Phase 0 (weeks 1-4) + Alpha (months 2-3)** combined; "Phase 2" corresponds to **Closed Beta**; "Phase 3" corresponds to **Public Arabic Beta and later**. Use the blueprint's §17 gates as the actual go/no-go criteria — the bullet lists below are the engineering task breakdown underneath those gates.

### Phase 0: Foundation (1-2 weeks)
- Setup complete (✅ DONE)
- Select and license film catalog
- Prepare fingerprint schema
- Negotiate TMDB/JustWatch partnerships
- Clickable prototype tested with 15-20 people (blueprint's actual Phase 0, §17.1) — this is UX/question validation, not a product beta

### Phase 1: MVP (4-6 weeks)
**Goal**: Prove core hypothesis at Alpha scale — 80-150 users, accepters completing 20-30 triads across short sessions (blueprint §17.2)

**Components**:
- ✅ User authentication (JWT)
- ✅ Profile creation (individual only)
- ✅ Film search & catalog
- ✅ Triadic ranking interface
- ✅ Plackett-Luce ranker
- ✅ Recommendations engine
- ✅ Admin dashboard for model inspection
- ❌ Mobile app
- ❌ Social features
- ❌ Email
- ❌ Collaborative filtering

**Success Metrics**:
- 65%+ of users complete 15 triads
- Pairwise accuracy 60-65%
- Model beats all baselines by 5+ points
- Session duration > 5 min
- Replacement rate < 40%

**Deployment**: Internal or restricted beta only

### Phase 1b: Film Fingerprints (Parallel)
- Curate 300-500 diverse films
- Generate fingerprints via OpenAI
- Store in PostgreSQL with embeddings

### Phase 2: Scale & Polish (6-8 weeks)
- General user launch
- Public user sign-ups
- Monitor model accuracy
- Collaborative filtering
- Per-user per-director effects
- Mobile app (Expo)
- JustWatch integration
- Email recommendations

### Phase 3: Advanced Features (Later)
- Commercial IMDb integration
- TV series recommendations
- Natural language queries
- Social discovery
- Monetization model

---

## 12. Success Metrics

> Per the blueprint (§17, §16.5), numeric thresholds are not fixed in advance as marketing promises — they are set experimentally, reported with confidence intervals, right before each phase's test, and a model gate requires beating the best simpler baseline plus improving NLL/calibration/learning-per-minute without hurting cross-language coverage (§16.5) — not just clearing one accuracy number. The figures below are illustrative starting points for the Alpha engine gate (blueprint §17.2), not the actual pass/fail bar.

### Alpha gate (80-150 users, 20-30 triads per accepter)

| Metric | Illustrative starting point | Rationale |
|--------|--------|-----------|
| Triad completion | Majority of accepters complete 20-30 triads across short sessions | Matches blueprint §17.2 Alpha scope |
| Pairwise accuracy vs. best simpler baseline | Statistically significant margin, not an absolute number | Blueprint §16.5: must beat a simpler alternative, not just clear a threshold |
| Haven't-watched / not-remembered rate | Low enough not to degrade triad reliability | Data quality; tracked as a triad-selection safety constraint (blueprint §8.3) |
| Session duration & fatigue | No worse than a non-adaptive baseline policy | Blueprint §16.4: adaptive vs. semi-fixed triad selection experiment |
| First useful result | Reached within 3-5 triads | Blueprint's early-value gate (§8, gate 2) |

### Phase 2 Scale (100-1000 users)

| Metric | Target |
|--------|--------|
| User retention (7-day) | 40%+ |
| Triads per active user | 30+ |
| Recommendation CTR | 15%+ |
| User-generated feedback on recommendations | 50%+ |

### Long-Term

| Metric | Target |
|--------|--------|
| Watch-through rate of recommended films | 70%+ |
| User satisfaction with recommendations | 4.0/5.0+ |
| Time between sessions | < 7 days (engaged users) |

---

## 13. Technical Debt & Risks

### Known Limitations (Phase 1)

1. **Limited Data**: 300-500 films initially (vs IMDb's 10M+)
   - Mitigation: Focus on popular, diverse titles
   - Expand based on user requests

2. **No Collaborative Filtering**: Pure content-based model
   - Mitigation: Proves individual model first
   - Add later once proven

3. **Fingerprint Manual Review**: Can't scale auto-fingerprinting initially
   - Mitigation: Use Batch API, spot-check results
   - Plan: Add human review loop

4. **Single Model per User**: No mood/context adaptation
   - Mitigation: Fixed question ("your overall taste")
   - Later: Add context-specific models

5. **No Cold-Start Solutions**: New users need 15+ triads
   - Mitigation: Show "still learning" honestly
   - Later: Intelligent triad selection to minimize needed data

### Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| OpenAI API costs high | Medium | Moderate | Use batch API, cache results |
| User recruitment slow | Medium | High | Focus on niche (film enthusiasts) |
| Model doesn't beat baselines | Low-Medium | Critical | Do not ship on schedule anyway — per the blueprint (§16.5, §22.2), passing the model gate is a release condition, not a date; if the gate fails, redesign the measurement/policy before continuing (blueprint §17.1 explicitly allows this outcome for Phase 0) |
| TMDB/JustWatch licensing delays | Medium | Medium | Proceed without them; add later |
| Data privacy audit fails | Low | Critical | Engage DPO/legal early |

---

## 14. Decision Log

### Why Plackett-Luce Over Other Approaches?

✅ **Pros**:
- Proven in preference learning literature
- Handles full rankings naturally
- Simple to implement and debug
- Scales with user population
- Interpretable weights

❌ **Cons**:
- Assumes independence (no multi-way interactions initially)
- Sensitive to outliers (need robust loss)
- Needs ~20-30 triads to stabilize

**Alternative Considered**: Probabilistic ranking (Bradley-Terry-Luce) - similar, not chosen to keep MVP simpler

### Why No Collaborative Filtering in Phase 1?

**Rationale**:
- Adds complexity (nearest-neighbor search, similarity metrics)
- Requires many users with overlapping preferences
- Unclear if benefits individual-level understanding
- Better to prove content-based model works first

**When to Add**: Once 50+ active users with 20+ triads each

### Why PWA Over Native App?

**Rationale**:
- No app store submission delays
- Push updates instantly
- Work on mobile + desktop
- Simpler development (one codebase: Next.js)
- Easy to A/B test UI changes

**When to Switch**: After MVP success, when feature set stabilizes; then build Expo app with shared types

---

## Appendix: Detailed Specs

- [Database Schema](schema.md) - Full DDL, migrations, views
- [Architecture](architecture.md) - Diagrams, data flows, deployment
- [Privacy & Compliance](privacy.md) - PDPL requirements, user rights, consent
- [Phase 1 Checklist](PHASE1_CHECKLIST.md) - Detailed tasks and checkboxes
- [Quick Start Guide](QUICKSTART.md) - Dev environment setup

---

**Last Updated**: 2025-01-02  
**Maintainer**: Development Team  
**Next Review**: After Phase 1 completion
