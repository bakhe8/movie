# Architectural Decisions & Rationale

A reference guide explaining the key technical decisions and their tradeoffs.

---

## Overview

> See [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) for the product foundation these decisions must stay consistent with. A few entries below have been annotated where the blueprint adds a constraint this doc didn't originally carry.

This document answers "Why did we choose X over Y?" for all major architectural decisions. Each decision includes:
- **Context**: Problem we're solving
- **Options Considered**: Alternatives evaluated
- **Decision**: What we chose
- **Rationale**: Why it's optimal
- **Tradeoffs**: What we gave up
- **Migration Path**: How to change later if needed

---

## 1. Monorepo vs. Separate Repositories

### Context
Need to organize Next.js frontend, NestJS backend, Python workers, and shared types.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Monorepo** (chosen) | Shared types, single deploy, easy refactoring | Harder CI/CD, single version number |
| **Separate repos** | Clear boundaries, independent deployments | Type duplication, version hell, merge conflicts |
| **Microservices from start** | Full independence | Operational complexity, network latency |

### Decision
**Monorepo with npm workspaces** (`apps/`, `packages/`, `services/`)

### Rationale
1. **Shared TypeScript types** (`packages/shared/`) = single source of truth
2. **Frontend & backend deployed together** = simpler DevOps initially
3. **Python workers in same repo** = easier to test, build, and deploy
4. **Shared development environment** = faster onboarding
5. **Refactoring = apply everywhere** = less technical debt

### Tradeoffs Given Up
- ❌ Can't deploy frontend without backend
- ❌ Database migrations tied to API releases
- ❌ Large monorepo (but small for MVP)

### Migration Path
If monorepo becomes bottleneck later:
```
Phase 3+: Extract to polyrepo
├── movie-frontend (Next.js only)
├── movie-backend (NestJS only)
├── movie-workers (Python only)
└── movie-types (shared, published to npm)
```

---

## 2. PostgreSQL + pgvector vs. Separate Vector Database

### Context
Need to store film fingerprints and enable semantic similarity search for recommendations.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **PostgreSQL + pgvector** (chosen) | Single DB, simple backups, no new infra | Slower than specialized vector DB |
| **Pinecone** | Fast semantic search, fully managed | Expensive ($0.04/1K vectors), vendor lock-in |
| **Weaviate** | Open source, good UX | Another service to operate and scale |
| **Elasticsearch** | Hybrid search, popular | Complex setup, overkill for MVP |
| **Local embeddings** (e.g., Faiss) | Offline, super fast | Synchronization headaches, not scalable |

### Decision
**PostgreSQL with pgvector extension** (pgvector installed automatically)

### Rationale
1. **Single database** = easier backup/restore/compliance
2. **No new operational complexity** = one connection string, one credentials set
3. **Good enough performance** for MVP (500K vectors < 1M)
4. **Supports migration** = can export vectors to Pinecone later if needed
5. **Free** = no ongoing vendor costs
6. **SQL integration** = easy to join with titles table

### Tradeoffs Given Up
- ❌ Slower similarity search than specialized DBs (~100ms vs 10ms per query)
- ❌ Limited to ~1M vectors before scaling issues

### Migration Path
```
Phase 2+: If similarity search becomes bottleneck
├── Keep PostgreSQL as primary
├── Add Pinecone for real-time search
├── Sync embeddings via background job
└── Fall back to PG if Pinecone fails
```

---

## 3. Plackett-Luce Statistical Model vs. Neural Networks

### Context
Learn user taste preferences from triadic rankings. Need simple, interpretable, efficient model.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Plackett-Luce** (chosen) | Interpretable weights, proven, fast | Assumes linear preferences |
| **Neural Network** | Flexible, learns complex patterns | Black box, needs more data (100+ triads) |
| **Collaborative Filtering** | Leverages other users | Requires many users, cold-start problem |
| **Content-based + heuristics** | Simple rules, explainable | Limited personalization, manual tuning |

### Decision
**Plackett-Luce MLE** (linear model trained on triadic rankings)

> Blueprint amendment (§7.1): the full utility model is $s(u,m) = b(m) + \theta_u^\top\phi_m + p_u^\top q_m + \delta_{u,m}$ — a shrunk population prior $b(m)$ and a collaborative term $p_u^\top q_m$ sit alongside the personal weight term. $b(m)$ should be in the model from the start for cold-start smoothing, and must never be surfaced to the user merged with personal fit.
>
> **Correction to "the collaborative term stays deferred" above**: that's still true for $p_u^\top q_m$ specifically — collaborative filtering built from *this product's own* accumulated user interactions correctly waits for sufficient internal data (matches this decision's "Phase 2+" framing below). But blueprint §7.5 adds a second, earlier-arriving collaborative mechanism: a shared latent space seeded from *external* proxy data before real users exist, used silently from Alpha (blueprint §17.2) for candidate generation and triad selection — not deferred to Phase 2+. See Decision 13 below; don't read this entry as saying no cross-user signal exists until Phase 2.

### Rationale
1. **Proven in literature** = well-studied, understood failure modes
2. **Interpretable** = can show users exactly why they got recommendation (weight vector)
3. **Sample efficient** = works with 15-20 triads (vs 100+ for neural nets)
4. **Fast training** = BFGS converges in < 1 second
5. **Lightweight** = trivial to serve (matrix multiply)
6. **Explainable** = "You like films with high ambiguity and psychological depth" = weights

### Tradeoffs Given Up
- ❌ Cannot capture nonlinear preferences (e.g., "I like action XOR drama, but not both")
- ❌ Assumes weights are global (not context/mood dependent)

### Migration Path
```
Phase 2+: Enhance with neural layer
├── Keep Plackett-Luce as baseline
├── Add neural network on top of weights
├── Learn context embeddings (mood, time, etc.)
└── Fallback to PL if NN fails or underfits
```

---

## 4. Triadic Ranking vs. Dyadic or Absolute Ratings

### Context
How do users provide preference signals? Options: rank 2 films, rank 3 films, rate 1-10, etc.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Triadic ranking** (chosen) | Rich data, no rating ambiguity, fun | Requires 3 films, slower per feedback |
| **Dyadic (A vs B)** | Fast, simple | Less information per comparison |
| **1-10 rating** | Familiar to users | Ambiguous (is 7 "good" or "average"?), doesn't reflect relative taste |
| **Star rating (1-5)** | Simple | Same ambiguity issues |
| **Implicit ranking** (clicks, watches) | Passive, non-intrusive | Sparse data, confounded by availability |

### Decision
**Complete triadic ranking** (A > B > C on demand)

> Blueprint amendment (§2.4 principle #2, §4.3): triad ranking is the *only* explicit preference question the product ever asks — no 1-10 rating, no post-watch star prompt, no separate survey. "Haven't watched" and "don't remember" are both neutral replacement triggers, never a preference signal, and are tracked as two distinct states (different UI copy, same neutral handling).

### Rationale
1. **Rich preference signal** = one triad = 3 pairwise comparisons
2. **Unambiguous** = "A is better than B" is clear (not interpretation of rating number)
3. **Matches Plackett-Luce** = model naturally trained on complete rankings
4. **Feels like game** = users engage more than rating
5. **No rating scale calibration** = each user's scale is relative, not absolute
6. **Fewer triads needed** = 15 triads = 45 pairwise comparisons vs 60 dyadic comparisons

### Tradeoffs Given Up
- ❌ Slower (user needs to rank 3 films vs typing one number)
- ❌ More cognitive load (comparing 3 vs rating one)

### Mitigation
- Show progress ("3 of 15 triads done")
- Make UI fast and responsive
- Only ask triadic rankings after users understand preference model

### Migration Path
```
Phase 2+: Hybrid feedback
├── Keep triadic ranking as the ONLY explicit preference question — permanently,
│   not just an MVP simplification (blueprint §2.4 principle #2, non-negotiable)
├── Add implicit signals (clicks, watch time) — engagement only, low confidence
└── An imported rating (from a user-provided list) may already exist as an
    auxiliary low-confidence signal (blueprint §4.2) — but never solicited
    in-app, and never a 1-10 prompt after a watch
```

---

## 5. PWA vs. Native Mobile App

### Context
Need to serve users on mobile and desktop. React Native (Expo) or Next.js PWA?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **PWA (Next.js)** (chosen first) | Single codebase, instant updates, no app store | Less native feel, offline limited |
| **Native iOS + Android** | Best UX, access to all OS features | Maintain 2-3 codebases, app store delays |
| **React Native (Expo)** | Share code, 2 platforms | Still requires platform-specific testing |
| **Flutter** | Excellent performance, fast compile | Not JavaScript, fragmented from backend |

### Decision
**PWA (Next.js) first.** Native (React Native/Expo) is not a scheduled next phase — it is built only if the PWA proves a real need for performance or push notifications that the PWA cannot meet (blueprint §5.2: "تطبيقات iOS/Android أصلية: تُبنى فقط إذا أثبتت PWA حاجة أداء أو إشعارات"). The "Phase 2" rationale and migration steps below describe what that native build would look like *if* that gate is crossed, not a committed roadmap item.

### Rationale (Phase 1)
1. **Fastest time to MVP** = single codebase
2. **No app store delay** = push updates immediately
3. **Works on desktop + mobile** = covers all users
4. **Instant testing** = share link to users, no installation
5. **Easier A/B testing** = change UI without coordination

### Rationale (Phase 2) — only if the gate below is crossed
1. **Share types with backend** = TypeScript throughout
2. **Share business logic** = recommendation algorithm unchanged
3. **Native performance** = only relevant if PWA measurably feels slow (the actual trigger, per blueprint §5.2)
4. **App store presence** = credibility + discoverability
5. **Offline support** = critical for some markets

### Tradeoffs Given Up (Phase 1)
- ❌ Less native feel (no haptic feedback, different animations)
- ❌ Limited offline support
- ❌ Not in app stores

### Migration Path
```
Only if the PWA proves insufficient — measured performance or push-notification
need it cannot meet (blueprint §5.2), not a default "after MVP" step:
├── Create apps/mobile (React Native + Expo)
├── Share packages/shared (TypeScript types)
├── Reuse services/workers (Python, no change)
├── Keep apps/frontend as web fallback
└── Deploy both simultaneously (same API)
```

---

## 6. OpenAI API for Fingerprinting vs. Custom Model

### Context
Need to generate film fingerprints (30+ semantic dimensions). Train custom model or use LLM?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **OpenAI API** (chosen) | High quality, handles ambiguity, multilingual | Cost per film, vendor lock-in |
| **Custom ML model** | Full control, one-time cost | Requires labeled data (1000s of films), maintenance |
| **Heuristic rules** | Free, deterministic | Shallow analysis, manual work |
| **Hybrid** (rules + LLM) | Best of both | More complex, harder to debug |

### Decision
**OpenAI Responses API with structured JSON output**

### Rationale
1. **Quality** = GPT-4o understands nuance (ambiguity, psychological depth, etc.)
2. **Structured output** = JSON schema enforcement (no hallucinated dimensions)
3. **Multilingual** = Arabic + English from same prompt
4. **One-time cost** = fingerprint once per film, reuse forever
5. **Batch API discount** = 50% cheaper for initial seeding
6. **Minimal maintenance** = OpenAI handles updates

### Cost Analysis
```
Initial seeding (Phase 1b):
- 500 films × $0.01 per film (batch) = $5
- Batch API runs 1x, discounted 50%

Incremental (Phase 2+):
- New films: 10/week × $0.01 = $0.10/week = $5/year
- Explanations: Optional, ~$0.05 per explanation

Annual cost (small): ~$200-500 (negligible vs operations)
```

### Tradeoffs Given Up
- ❌ Dependent on OpenAI API availability
- ❌ Costs scale with catalog size
- ❌ Cannot guarantee fingerprint stability (model updates)

### Mitigation
- Store model version with each fingerprint
- Re-fingerprint on schema version change (batch job)
- Fall back to heuristics if API fails (graceful degradation)

### Migration Path
```
Phase 3+: If costs become concern
├── Keep OpenAI fingerprints as ground truth
├── Train distillation model (smaller, local LLM)
├── Use local model for new films
├── Periodically re-verify with OpenAI
```

---

## 7. Individual Profiles vs. Family Accounts

### Context
Should families share a single account or each get individual profiles?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Individual profiles** (chosen) | Clean preferences, clear data, shareable link | More accounts, less convenient |
| **Family account** | One login, shared watchlist | Preference mixing, privacy concerns |
| **Hybrid** | Flexibility | Complex logic, bugs |

### Decision
**Individual profiles only** (one person = one profile)

> Blueprint amendment (§13.1, §21.1): a profile's id must function as a pseudonymous "taste id" kept separate from account identity — model/event tables (triads, recommendations, snapshots) should reference `profile_id`, not reach back to `user_id`/email, so exports and model training don't need to touch account identity.

### Rationale
1. **Data quality** = no mixing of dad's + mom's preferences
2. **Recommender quality** = pure signal per person
3. **Privacy** = kids' watches separate from parents'
4. **Compliance** = PDPL: clear data attribution per person
5. **Simpler UI** = no switching logic
6. **Fair evaluation** = MVP hypothesis tests pure model

### Tradeoffs Given Up
- ❌ Inconvenient for families sharing device
- ❌ More accounts to manage
- ❌ Less apparent data per account (GDPR-like concerns resolved)

### Workaround
- Show "Create another profile on this device?"
- Allow quick switching
- Share login link with family members

### Migration Path
```
Phase 3+: If requested
├── Keep individual profiles as primary
├── Add family "groups" (optional, opt-in)
├── Groups are aggregation layer only (no shared model)
└── Each person still has individual preferences
```

---

## 8. Deterministic Ranking vs. Serendipity (Exploration vs. Exploitation)

### Context
Should recommendations be purely personalized or include surprise/discovery?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Deterministic (score-based)** (chosen) | Predictable, measurable, simple | Can get stuck in loops |
| **Stochastic (sample from distribution)** | Exploration, serendipity | Harder to evaluate, user frustration |
| **Bandit algorithm** (Thompson sampling) | Principled exploration | Complex, needs more data |
| **Diversity constraint** | Variety in recommendations | Heuristic, may remove favorites |

### Decision
**Deterministic scoring within each of three tracks, from MVP** (revised — see blueprint amendment below)

> Blueprint amendment (§4.4, §5.1): the blueprint puts three recommendation tracks — safe / discovery / outside-usual — in MVP scope, not Phase 2. This isn't full bandit-style stochastic ranking; each track is still deterministically score-ranked internally, but "discovery" and "outside-usual" exist specifically to prevent the filter-bubble risk this decision's original Phase-1 plan accepted as a known tradeoff. Treat the "Phase 2" step below (mix-it-up button, 10% randomness A/B) as optional polish on top of the three tracks, not as the thing that first introduces exploration.

### Rationale (MVP)
1. **Measurable** = can evaluate if each track's picks are better than baselines
2. **Simple to explain** = each track has a clear framing (safe / discovery / outside-usual, blueprint §4.4), each internally ranked by our model
3. **Fast implementation** = deterministic scoring per track, no bandit complexity
4. **Aligns with hypothesis** = "Can we find users' true preferences?", while the discovery/outside-usual tracks guard against the filter-bubble risk from day one

### Tradeoffs Given Up
- Full stochastic/bandit exploration (still deferred — the three tracks mitigate but don't replace it)
- May recommend similar films repeatedly within the "safe" track

### Migration Path
```
MVP: Three tracks (safe / discovery / outside-usual), each deterministically ranked (blueprint §4.4)
Phase 2 (after confirming model works):
├── Add "Mix it up" button (random from top 50) as optional polish
├── Track: did user watch surprise recommendations?
├── A/B test: current three-track approach vs. added randomness
└── Phase 3: Implement bandit algorithm if beneficial
```

---

## 9. Centralized Model vs. Federated (User-Level Training)

### Context
Should user preference models be trained on our servers or on users' devices?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Centralized** (chosen) | Simple, controlled, consistent | Privacy concerns, user data stored |
| **Federated learning** | User data never leaves device | Complex, slower inference, debugging hard |
| **Hybrid** | Privacy + benefits | Most complex, most bugs |

### Decision
**Centralized training** with privacy controls

### Rationale
1. **PDPL compliant** = users consent to centralized processing; we provide export/delete
2. **Simpler** = single source of truth for model quality
3. **Debugging** = easy to track why recommendation failed
4. **Monitoring** = can detect model degradation
5. **Cost** = training once on server vs. on 1000 devices

### Privacy Safeguards
```
1. Explicit consent: "Use my rankings to improve recommendations"
2. Data minimization: Only store rankings + weights (no email/IP)
3. Right to delete: DELETE /api/users/{id} → wipe all data
4. Audit logs: Track who accessed what and when
5. Encryption: In transit (TLS) + at rest (RDS encryption)
6. No sharing: Never share or sell user data (policy + tech)
```

> **Amendment**: "Centralized" here originally meant one profile's rankings training only that profile's own model. Blueprint §7.5 adds a second centralized process — a shared latent space batch-trained on *pooled* pseudonymous triads across profiles (used to calibrate individual $w_u$, not just to train it in isolation). That's a distinct processing purpose from #1 above ("use my rankings to improve *my* recommendations" doesn't, on its face, disclose "and pool them into a model that also shapes other people's triads/candidates"). See [privacy.md](privacy.md)'s consent-model update — this needs its own disclosure, not a silent extension of safeguard #1.

### Tradeoffs Given Up
- ❌ User data on our servers (mitigated by consent + privacy controls)
- ❌ Privacy risk if breach (mitigated by encryption + minimal data)

### Migration Path
```
Phase 3+ (if privacy becomes priority):
├── Implement differential privacy (add noise to weights)
├── Store only encrypted fingerprints, not rankings
├── Compute gradients, not full model on server
└── Later: Full federated learning if required
```

---

## 10. Real-Time Recommendations vs. Batch

### Context
When should recommendations be computed? On-demand or scheduled?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Real-time (on-demand)** (chosen) | Fresh, responsive, simple | Higher compute cost, cache misses |
| **Batch (scheduled)** | Cheaper, predictable load | Stale recommendations, complex scheduling |
| **Hybrid** | Balance | Most complex |

### Decision
**Real-time with Redis caching**

### Rationale
1. **Fresh after ranking** = user ranks, immediately sees updated recommendations
2. **Simple** = no background jobs to manage
3. **Responsive** = < 100ms response (cache hit)
4. **Scales to 10K users** = cache + computation fast enough
5. **Better UX** = instant feedback loop

### Caching Strategy
```
GET /recommendations/{profileId}
└─ Check Redis cache
   ├─ Hit: Return cached (< 10ms)
   ├─ Miss: Compute model + score films (< 1s)
   │   └─ Store in Redis (TTL: 1 hour)
   └─ Return

Invalidation: After each RANK triad request
```

### Tradeoffs Given Up
- ❌ Per-request compute cost
- ❌ Need Redis (extra dependency)

### Mitigation
- Cache aggressively (TTL: 1 hour)
- Lazy computation (compute only if requested)
- Fallback to old cache if compute fails

### Migration Path
```
Phase 2+ (if compute becomes bottleneck):
├── Keep caching strategy
├── Add pre-computation (scheduled daily)
├── Store precomputed recs in database
├── Real-time = update cache only if changed significantly
└── Batch = refresh stale caches at 2 AM
```

---

## 11. REST API vs. GraphQL

### Context
How should frontend communicate with backend?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **REST** (chosen) | Simple, well-understood, fast | Over-fetching/under-fetching |
| **GraphQL** | Precise data fetching, exploration | Complexity, caching harder, N+1 queries |
| **RPC** | Direct function calls | Tight coupling |

### Decision
**REST with careful endpoint design**

### Rationale
1. **Simplicity** = fewer libraries, easier debugging
2. **Performance** = no GraphQL parsing overhead
3. **Caching** = standard HTTP caching (ETag, Last-Modified)
4. **Monitoring** = easy to log and track endpoints
5. **Team familiar** = NestJS has good REST support

### Endpoint Design
```
GET    /profiles/{id}              → User profile
POST   /profiles                   → Create profile
GET    /profiles/{id}/triads/next  → Next triad to rank
POST   /triads/{id}/rank           → Submit ranking
GET    /recommendations/{id}        → Top recommendations
POST   /recommendations/{id}/feedback → Log feedback
```

### Tradeoffs Given Up
- ❌ Frontend requests might over-fetch data
- ❌ No single query language for flexibility

### Mitigation
- Design endpoints carefully based on UI needs
- Use query parameters for filtering: `?limit=10&sort=score`

### Migration Path
```
Phase 3+ (if data fetching becomes complex):
├── Keep REST as primary
├── Add GraphQL alongside (optional)
├── Use GraphQL only for complex queries
└── Gradually migrate if needed
```

---

## 12. SQL vs. NoSQL

### Context
Should user data be stored in relational (PostgreSQL) or document (MongoDB) database?

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **PostgreSQL (SQL)** (chosen) | ACID, joins, complex queries, pgvector | Rigid schema |
| **MongoDB** | Flexible schema, scalable | No ACID (until recently), no pgvector, more complex |
| **Firebase** | Fully managed, real-time | Vendor lock-in, privacy concerns, costs |

### Decision
**PostgreSQL with TypeORM**

### Rationale
1. **ACID guarantees** = data consistency critical for rankings
2. **Joins** = easy to correlate users, profiles, triads, titles
3. **pgvector** = semantic search on same DB
4. **Schema migrations** = control and audit
5. **Compliance** = PDPL easier with SQL audit trail
6. **Backup/restore** = simpler with PostgreSQL
7. **Team experience** = most teams know SQL

### Tradeoffs Given Up
- ❌ Schema changes require migrations
- ❌ Requires more planning upfront

### Mitigation
- Use TypeORM for easy schema management
- Test migrations before production
- Keep schema versioning in Git

### Migration Path
```
Phase 3+ (if sharding needed):
├── Keep PostgreSQL as primary
├── Add read replicas for analytics
├── Shard by user_id if > 10M users
└── Consider citus (PostgreSQL extension) for distributed queries
```

---

## 13. Per-User-Only Fitting vs. Shared Latent Space Calibration

### Context
Section 3's Plackett-Luce model, as originally scoped, fits $w_u \in \mathbb{R}^{30-50}$ independently per profile from a handful of triads. That's a real identifiability problem (see [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md)'s "Data Requirements"): a few triads can't reliably resolve 30-50 correlated dimensions. Blueprint §7.5 (added alongside this decision) resolves it architecturally, not by asking users for more triads.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Per-user fitting only** (original) | Simple, no shared infra, fully isolated per profile | Needs 15-20+ triads before $w_u$ stabilizes; can't discover cross-genre axes from one person's data alone |
| **Shared latent space + per-user calibration** (chosen, blueprint §7.5) | Fewer triads needed for a stable position; enables cross-genre insight the individual data alone can't support | Needs batch-retraining infra, a bootstrap data source, and new privacy/licensing surface area |
| **Full collaborative filtering from day one** | Simplest single mechanism | Blueprint §7.1 already rejected this — no cold-start data to train it on |

### Decision
**Shared latent space, externally-seeded, with per-user MIRT/CAT-style calibration** (blueprint §7.5), gated by a strict silent-computation/disclosed-attribution split (blueprint §7.6) so users are never told about a cross-user pattern before it's validated on their own held-out data.

### Rationale
1. Directly fixes the identifiability problem this decision's own §3 entry left open
2. External seeding avoids waiting on internal data the product doesn't have yet at launch
3. The §7.6 attribution gate keeps this from degrading the trust promise Decision 9's privacy safeguards depend on
4. Reuses existing infra: a scheduled batch job in the Python model service (no new service per §12.3's "when do we split services" criteria), and the existing `triads.selection_propensity` column for the feedback-loop controls this reuses (blueprint §21.2)

### Tradeoffs Given Up
- ❌ Not yet implementable as designed: the proposed external seed source is confirmed blocked, not merely unreviewed — GroupLens' license requires prior written permission for any commercial/revenue-bearing use of MovieLens/Tag Genome (verified against the dataset READMEs; see [DATA_LICENSING.md](DATA_LICENSING.md)), and this design's "silent" use still counts as that commercial use
- ❌ New privacy surface: pooling pseudonymous triads across profiles is a distinct processing purpose needing its own consent disclosure (see [privacy.md](privacy.md))
- ❌ A cohort-level acceptance gate (blueprint §16.5 via §17.3) must pass before *any* user sees a disclosed cross-user insight — slower to reach the "enrichment" phase than a naive design would promise

### Migration Path
```
Pre-Alpha: Request written permission from GroupLens for the external bootstrap
           (MovieLens/Tag Genome) — required by their license, confirmed, not optional
           diligence. Proceed with the external seed ONLY once granted; otherwise
           seed from nothing and let the space start empty
Alpha (blueprint §17.2): Shared space in silent use only; internal pᵤᵀqₘ (Decision 3) still deferred
Beta closed (blueprint §17.3): Cohort-level acceptance gate evaluated; only then can
           any individual user's own §7.6 phase-3 gate unlock a disclosed claim
Fallback if the legal review never clears external data: seed from Alpha-cohort
           internal triads only — slower cold start, no licensing risk, same architecture
```

---

## Summary Table

| Decision | Chosen | Rationale | Revisit If |
|----------|--------|-----------|-----------|
| Monorepo | npm workspaces | Shared types | Scaling devops |
| Database | PostgreSQL + pgvector | Single DB, vector search | Need 10M+ vectors |
| Ranking | Plackett-Luce | Interpretable, proven | Need neural nets |
| Feedback | Triadic ranking | Rich data, unambiguous | Never — the only explicit preference question, permanently (blueprint §2.4 #2); only UX mechanics like tie-handling are open to testing (Appendix C) |
| Frontend | PWA (Next.js) | Fast iteration | PWA proves insufficient performance or push-notification need (blueprint §5.2) |
| Fingerprints | OpenAI API | Quality, structured output | Costs too high |
| Profiles | Individual only | Clean data, privacy | User demand for family |
| Recommendations | Real-time + cache | Fresh, responsive | Compute bottleneck |
| API | REST | Simple, fast | Very complex queries |
| Per-user model | Shared latent space + calibration | Fixes identifiability, enables cross-genre insight | MovieLens legal review blocks external seed (Decision 13) |

---

## Decision-Making Framework

When evaluating future architectural choices:

1. **MVP First**: What's simplest to ship in 4 weeks?
2. **Hypothesis**: Does it test the core idea (Plackett-Luce works)?
3. **Measurement**: Can we evaluate if it's better/worse?
4. **Migration**: Can we change it later if needed?
5. **Compliance**: Does it satisfy PDPL/privacy requirements?
6. **Cost**: Is it sustainable?

**Apply this framework to any new decision.**

---

**Last Updated**: 2025-01-02  
**Next Review**: After Phase 1 completion
