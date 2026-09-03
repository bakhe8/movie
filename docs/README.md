# Documentation Index

Complete reference documentation for the Movie Recommendation System. Start here to find what you need.

> **Foundational document**: [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) (Arabic, v1.0) is the product's source of truth — vision, non-negotiable principles, UX, math, data, architecture, evaluation, privacy, and rollout. Every other document in this folder is an implementation detail that must stay consistent with it. Where a document below conflicts with the blueprint (numeric targets, scoring model, post-watch rating, etc.), the blueprint wins — flag and fix the conflict rather than follow the older doc.

---

## Quick Navigation

### 🚀 Getting Started
1. **[QUICKSTART.md](QUICKSTART.md)** - 5-minute setup guide
   - Prerequisites
   - Environment setup
   - Starting dev servers
   - Troubleshooting

2. **[README.md](../README.md)** - Project overview
   - Feature summary
   - Tech stack
   - Project structure
   - Next steps

### 📋 Understanding the System

3. **[SPECIFICATION.md](SPECIFICATION.md)** - Complete technical specification
   - Executive summary
   - Technology stack rationale
   - Film data sources
   - Fingerprint schema
   - Ranking engine (Plackett-Luce)
   - Database design
   - Recommendation engine
   - OpenAI integration
   - Privacy & compliance
   - Implementation phases

4. **[ARCHITECTURE.md](architecture.md)** - System design & data flows
   - Architecture diagram
   - Data flow examples
   - Deployment topology
   - Module organization
   - Security model
   - Scalability considerations

5. **[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)** - Why we chose what
   - Decision-making rationale for all major choices
   - Tradeoffs for each decision
   - Migration paths if we change later
   - Decision framework for future choices

### 🔧 Implementation

6. **[PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md)** - Detailed implementation tasks
   - Feature-by-feature breakdown
   - Subtasks and dependencies
   - Testing requirements
   - Success metrics
   - Launch readiness checklist

7. **[RANKING_ALGORITHM.md](RANKING_ALGORITHM.md)** - Plackett-Luce model deep dive
   - Mathematical foundation
   - Implementation details (Python/NumPy)
   - Numerical stability tricks
   - Evaluation metrics
   - Training workflow
   - Performance optimization
   - Common pitfalls & solutions

8. **[schema.md](schema.md)** - Database schema reference
   - All tables with DDL
   - Indexes and views
   - Migration strategy
   - Entity relationships

### 🔐 Compliance & Business

9. **[DATA_LICENSING.md](DATA_LICENSING.md)** - Data sources & legal compliance
   - Wikidata (CC0, recommended for MVP)
   - IMDb (free vs. commercial)
   - TMDB (free tier limitations)
   - JustWatch (availability integration)
   - MVP data strategy
   - Legal checklist
   - What NOT to do

10. **[privacy.md](privacy.md)** - Privacy & Saudi Arabia PDPL
    - User rights (access, delete, export, correct)
    - Consent model
    - Data minimization
    - Automated decision-making disclosure
    - OpenAI API privacy
    - Data retention policy
    - International transfers
    - Breach response

---

## By Role

### 👨‍💻 Backend Developer
1. Start: [QUICKSTART.md](QUICKSTART.md)
2. Then: [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Backend section
3. Reference: [schema.md](schema.md) for database
4. Reference: [ARCHITECTURE.md](architecture.md) for module organization
5. Understand: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) for ranker integration

### 👩‍💻 Frontend Developer
1. Start: [QUICKSTART.md](QUICKSTART.md)
2. Then: [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Frontend section
3. Reference: [ARCHITECTURE.md](architecture.md) for data flows
4. Understand: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) for recommendation page

### 🐍 Python / ML Developer
1. Start: [QUICKSTART.md](QUICKSTART.md)
2. Then: [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Film Fingerprinting + Testing sections
3. Deep dive: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) for implementation
4. Reference: [schema.md](schema.md) for database storage

### 📊 Product Manager / Lead
1. Overview: [SPECIFICATION.md](SPECIFICATION.md)
2. Timeline: [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md)
3. Success metrics: PHASE1_CHECKLIST.md → Success Metrics section
4. Compliance: [privacy.md](privacy.md)
5. Tech decisions: [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)

### ⚖️ Legal / Compliance
1. Privacy: [privacy.md](privacy.md) (complete PDPL guide)
2. Data sources: [DATA_LICENSING.md](DATA_LICENSING.md) (licensing & legal issues)
3. Check: Audit log in [schema.md](schema.md)

### 🚀 DevOps / Infrastructure
1. Architecture: [ARCHITECTURE.md](architecture.md) → Deployment Topology
2. Database: [schema.md](schema.md)
3. Setup: [QUICKSTART.md](QUICKSTART.md) (Docker setup)
4. Decisions: [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) (tech choices)

---

## By Topic

### Understanding the Algorithm
→ [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md)
- Mathematical model
- Training from triads
- Evaluation metrics
- Code examples

### Building the Interface
→ [SPECIFICATION.md](SPECIFICATION.md) + [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md)
- Triadic ranking UI: "Rank these 3 films"
- Recommendations page
- User flow diagrams

### Data & Database
→ [schema.md](schema.md) + [DATA_LICENSING.md](DATA_LICENSING.md)
- Table structure
- Event-based design
- Film data sources
- Legal compliance

### OpenAI Integration
→ [SPECIFICATION.md](SPECIFICATION.md) (Section 8)
- Film fingerprinting
- Structured outputs (JSON schema)
- Recommendation explanations
- Cost control

### Privacy & Compliance
→ [privacy.md](privacy.md) + [DATA_LICENSING.md](DATA_LICENSING.md)
- User rights implementation
- Saudi Arabia PDPL
- Consent model
- Data export/delete

### Testing & Quality
→ [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Testing section
→ [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) → Testing section
- Unit tests
- API tests
- E2E tests
- Manual testing checklist

### Deployment
→ [ARCHITECTURE.md](architecture.md) → Deployment Topology
→ [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Deployment Preparation
- Local development (Docker)
- Staging
- Production

---

## Key Concepts Explained

### Triadic Ranking
User sees 3 films and ranks them 1st, 2nd, 3rd.
- Why 3? Rich signal (3 pairwise comparisons), manageable for user
- Why not rating? Unambiguous ("A > B" vs rating scale confusion)
- Data → Plackett-Luce model learns preferences
- See: [SPECIFICATION.md](SPECIFICATION.md) Section 7, [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md)

### Film Fingerprint
30-50 semantic dimensions of a film (pacing, ambiguity, warmth, psychological depth, etc.)
- Generated by OpenAI (one-time per film)
- Stored in PostgreSQL fingerprint field
- Used to score recommendations
- See: [SPECIFICATION.md](SPECIFICATION.md) Section 3

### Plackett-Luce Model
Statistical model that learns user taste weights from complete rankings
- Input: Film fingerprints + triadic rankings
- Output: Weight vector for each user
- Training: Maximum Likelihood Estimation (BFGS)
- Evaluation: Pairwise accuracy on hold-out test set
- See: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) (full math + code)

### Preference Score
`score_i = weights · fingerprint_i`
- Computed real-time for recommendations
- Cached in Redis
- Deterministic (no randomness in MVP)
- See: [SPECIFICATION.md](SPECIFICATION.md) Section 6

### Event-Based Architecture
Store triadic ranking events, rebuild model from events
- Enables deletion (soft-delete events, keep audit)
- Reproducibility (same events + algorithm = same model)
- Data integrity (events are immutable)
- See: [schema.md](schema.md) + [SPECIFICATION.md](SPECIFICATION.md) Section 5

---

## Common Tasks

### "I want to understand how recommendations work"
1. Read: [SPECIFICATION.md](SPECIFICATION.md) Section 6 (Recommendation Engine)
2. Then: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) (implementation)
3. Check: [ARCHITECTURE.md](architecture.md) (data flow diagram)

### "I'm implementing the backend API"
1. Check: [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) for endpoint list
2. Reference: [schema.md](schema.md) for database models
3. Code: [ARCHITECTURE.md](architecture.md) → Module Organization

### "I'm implementing the frontend UI"
1. Check: [SPECIFICATION.md](SPECIFICATION.md) Section 7 (UX Flow)
2. Check: [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Frontend section
3. Reference: [ARCHITECTURE.md](architecture.md) for data flows

### "I'm seeding the film catalog"
1. Check: [DATA_LICENSING.md](DATA_LICENSING.md) (legal issues first!)
2. Read: [SPECIFICATION.md](SPECIFICATION.md) Section 2 (data sources)
3. Implement: Film fingerprinting (Python workers)

### "I'm implementing the Plackett-Luce ranker"
1. Read math: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) Sections 1-3
2. Code reference: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) Section 4
3. Test: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) Testing section

### "I need to ensure PDPL compliance"
1. Start: [privacy.md](privacy.md)
2. Checklist: [privacy.md](privacy.md) → Privacy Impact Assessment
3. Implementation: [schema.md](schema.md) → Audit log table

---

## Document Statistics

| Document | Length | Purpose |
|----------|--------|---------|
| SPECIFICATION.md | ~12,000 words | Complete technical spec (read once, reference often) |
| RANKING_ALGORITHM.md | ~8,000 words | Math + code for Plackett-Luce (deep reference) |
| ARCHITECTURE_DECISIONS.md | ~5,000 words | Why decisions were made (understand rationale) |
| DATA_LICENSING.md | ~4,000 words | Licensing guide (critical for compliance) |
| PHASE1_CHECKLIST.md | ~3,000 words | Implementation tasks (daily reference) |
| privacy.md | ~3,000 words | Privacy + PDPL (compliance guide) |
| ARCHITECTURE.md | ~2,500 words | System diagrams + data flows (reference) |
| schema.md | ~2,000 words | Database DDL (reference) |
| QUICKSTART.md | ~1,000 words | Setup guide (one-time read) |

**Total**: ~41,000 words of comprehensive documentation

---

## Updates & Maintenance

### Adding New Features
1. Update [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → add to appropriate section
2. Update [schema.md](schema.md) → add database changes
3. Update [ARCHITECTURE.md](architecture.md) if data flows change
4. Update [SPECIFICATION.md](SPECIFICATION.md) if major change (rarely needed)

### After Phase 1 Complete
1. Archive this as "Phase 1 Specification"
2. Create new "Phase 2 Specification" based on learnings
3. Update [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) with retrospective

### Keeping in Sync with Code
- Schema changes: Update [schema.md](schema.md) first, then code
- API changes: Update [SPECIFICATION.md](SPECIFICATION.md) API section + [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md)
- Algorithm changes: Update [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md)

---

## Glossary

| Term | Definition | Reference |
|------|-----------|-----------|
| **Fingerprint** | 30+ semantic dimensions of a film | SPECIFICATION.md §3 |
| **Plackett-Luce** | Statistical model for preference learning | RANKING_ALGORITHM.md |
| **Triad** | Three films ranked by user | SPECIFICATION.md §7 |
| **Preference Score** | Predicted user utility for a film | SPECIFICATION.md §6 |
| **Pairwise Accuracy** | Fraction of film pairs ranked correctly | RANKING_ALGORITHM.md §7 |
| **Fingerprinting** | Using OpenAI to generate film dimensions | SPECIFICATION.md §8 |
| **Embedding** | Vector representation (pgvector) | schema.md |
| **Event-Based** | Storing triads, rebuilding weights from them | SPECIFICATION.md §5 |
| **PWA** | Progressive Web App (Next.js) | SPECIFICATION.md §1 |
| **PDPL** | Saudi Arabia Personal Data Protection Law | privacy.md |

---

## Getting Help

### "I don't know where to start"
→ Start with [README.md](../README.md) then [QUICKSTART.md](QUICKSTART.md)

### "I need to understand a specific decision"
→ [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)

### "I need to implement X"
→ [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) (find X, see what depends on it)

### "I need to know about Y"
→ Use Ctrl+F to search this index for Y, find relevant document

### "I'm stuck on a technical problem"
→ Check [PHASE1_CHECKLIST.md](PHASE1_CHECKLIST.md) → Troubleshooting section

---

## Version History

| Date | Status | Changes |
|------|--------|---------|
| 2025-01-02 | v1.0 | Initial comprehensive documentation complete |
| (Future) | v1.1 | Post-Phase 1 learnings & updates |

---

**Last Updated**: 2025-01-02  
**Status**: Ready for Phase 1 implementation  
**Maintainer**: Development Team  

**Questions?** Check the relevant document above, then ask the team.
