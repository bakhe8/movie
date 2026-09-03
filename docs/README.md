# Documentation Index

Everything needed to build the product without guessing: one normative product document, a set of derived engineering contracts, and one honest status page. Start here.

**Governance (ADR-14)**

- **Normative**: [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) (Arabic, v1.2). It alone defines the product. Every other file cites it as `BP §x.y` and is corrected — not annotated — when it disagrees.
- **Derived**: the English documents below. They turn blueprint sections into contracts (API, schema, model, fingerprint), controls (privacy, licensing), and decisions (ADRs). Anything they add beyond the blueprint (types, file layout, thresholds) is this repository's engineering choice and is recorded as an ADR.
- **Narrative**: [product_journey_ar.md](product_journey_ar.md) (Arabic) — non-normative reading companion; its own "limits" section lists where it simplifies.
- **Status**: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) — what the code does today versus the blueprint, two verdicts per row, re-verified against the test suites.

Languages: product/vision in Arabic; engineering contracts in English; UI copy in both. Dates are real calendar dates (the blueprint is dated 2026-09-02); every document ends with a changelog. Phase names are the blueprint's (Phase 0, Alpha, Closed Beta, Public Arabic Beta, Economics test) — never "Phase 1/2/3".

---

## Document map

| File | Language | Type | What it settles |
|---|---|---|---|
| [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) | AR | normative | vision, non-negotiable principles, UX, math, data, architecture, evaluation, privacy, roadmap and gates, open experiments (App. C) |
| [product_journey_ar.md](product_journey_ar.md) | AR | narrative | the story from idea to protocol to math to architecture; four core objections and their resolution |
| [SPECIFICATION.md](SPECIFICATION.md) | EN | derived | engineering reading of the principles, scope, canonical glossary, UX contract, integration contracts, phases and gates, non-functional requirements, open experiments |
| [API.md](API.md) | EN | contract | implemented routes today (`/api`) and the target `/api/v1` contract with envelope, idempotency and shapes |
| [SCHEMA.md](SCHEMA.md) | EN | contract | current migrated tables and the target `BP §13.1` schema with a numbered migration plan |
| [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) | EN | contract | utility model, listwise Plackett–Luce, calibration onto the shared space, exceptions, training/evaluation protocol, triad selection policy, confidence, tracks and rerank, attribution gate, model-service interface |
| [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) | EN | contract | data layers, fingerprint V1 (frozen, 13 features) and V2 family plan, unknown handling, enrichment pipeline and acceptance tests |
| [ARCHITECTURE.md](ARCHITECTURE.md) | EN | derived | components as built vs target, request flows, code layout, security model, environments, split triggers, observability |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) | EN | decisions | ADR-1…33 — every engineering choice with its blueprint anchor and revisit trigger |
| [PRIVACY.md](PRIVACY.md) | EN | controls | PDPL-aligned data inventory, consent purposes, rights and endpoints, processors, security controls, residency, retention, deletion, breach response, pre-launch checklist |
| [DATA_LICENSING.md](DATA_LICENSING.md) | EN | controls | rights registry rule, source-by-source terms and allowed use, Phase 0 catalog steps, attribution, legal checklist, red flags |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | EN | status | built vs blueprint per feature; the 15 gaps hiding behind working code; Alpha gate readiness; next milestone |
| [AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) | EN | audit | independent audit of `3f60884`: verified results, ranked findings with reproductions, documentation drift by line, ordered fix plan |
| [UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md) | EN | review | review of the external «بصمة الذوق» mobile mockup against the blueprint: rendered and touch-tested, keep/drop list, the display-rule clarifications that became ADR-33 |
| [QUICKSTART.md](QUICKSTART.md) | EN | how-to | local setup and the full loop (migrate, seed, run, train, test) |
| [../README.md](../README.md) | EN | entry | repository overview and pointers |

## Reading order

**Everyone (first day)**: blueprint executive summary and `§2.4` → [SPECIFICATION.md](SPECIFICATION.md) §1–§4 → [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) top list → [QUICKSTART.md](QUICKSTART.md).

| Role | Then read |
|---|---|
| Backend | [API.md](API.md), [SCHEMA.md](SCHEMA.md), [ARCHITECTURE.md](ARCHITECTURE.md) §3–§5, ADR-15/16/17/25/26 |
| Frontend | [SPECIFICATION.md](SPECIFICATION.md) §5, [API.md](API.md), blueprint `§4`, `§9.3`–`§9.4`, ADR-5/20/21/33, [UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md) |
| Model / ML | [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md), [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md), blueprint `§7`–`§10`, `§16`, ADR-3/13/19/21/22 |
| Data / content | [DATA_LICENSING.md](DATA_LICENSING.md), [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md), blueprint `§6`, `§11`, `§15` |
| Product / lead | blueprint in full, [SPECIFICATION.md](SPECIFICATION.md) §9–§11, [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), ADR summary table |
| Legal / privacy | [PRIVACY.md](PRIVACY.md), [DATA_LICENSING.md](DATA_LICENSING.md), blueprint `§11`, `§21`, App. B |
| DevOps | [ARCHITECTURE.md](ARCHITECTURE.md) §6–§8, ADR-24, blueprint `§12`, `§18.1` |

## Keeping documents in sync with code

| Change in code | Update first |
|---|---|
| a route, DTO, response shape | [API.md](API.md) (§1 if implemented, §2 if target) |
| an entity or migration | [SCHEMA.md](SCHEMA.md) §1 must equal the migration chain; §2.4 plan step marked done |
| fingerprint fields (all three copies) | [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §2 |
| model, policy, confidence, evaluation | [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) + the snapshot/model-version columns |
| consent purpose, retention, processor | [PRIVACY.md](PRIVACY.md) §2–§3, §9 |
| a data source | [DATA_LICENSING.md](DATA_LICENSING.md) §2 + a `source_records` row |
| any engineering choice not derivable from the blueprint | a new ADR in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) |
| a feature lands or a gap closes | the row in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), with evidence (test or browser pass) |
| a product principle | the blueprint itself (Arabic), then its changelog; derived docs follow |

Rules: never add an endpoint list, schema fragment or threshold to a second document — link to the owning one. Never write a specific model name, cloud vendor or price into a document (ADR-6, ADR-24). Never introduce "Phase 1/2/3". Every new document gets a row in the map above and a changelog.

## Open housekeeping

- No `LICENSE` file exists at the repository root although `apps/backend/package.json` declares MIT; choose a license before any public release.
- `.env.example` lacks `FRONTEND_URL` and `OPENAI_FINGERPRINT_MODEL` (see [QUICKSTART.md](QUICKSTART.md) §2 and ADR-23).

## Version history

| Date | Change |
|---|---|
| 2026-09-02 | blueprint v1.0 and first English drafts (dated "2025-01-02" by mistake) |
| 2026-09-03 | blueprint v1.1 (`§7.5`–`§7.6`); documentation audit: English set rewritten as derived contracts, four files renamed (`architecture.md`→`ARCHITECTURE.md`, `schema.md`→`SCHEMA.md`, `privacy.md`→`PRIVACY.md`, `PHASE1_CHECKLIST.md`→`IMPLEMENTATION_STATUS.md`), `API.md` and `FINGERPRINT_SCHEMA.md` added, ADR-14…26 added, journey document marked non-normative and reconciled, dangling links (`deployment.md`, `db/migrations/001_init_schema.sql`) removed |
| 2026-09-03 | independent code/infra/docs audit added ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md)); its §5 lists the lines in this set that must be corrected |
| 2026-09-03 | UI mockup review added ([UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md)); ADR-33 (prediction display formats) and an ADR-4 consequence (no post-watch expectation question); SPECIFICATION §5.2–§5.4 and the API `personalFit` note updated; IMPLEMENTATION_STATUS gains a *Frontend ↔ backend boundary* section |
| 2026-09-03 | blueprint v1.2: App. C gains the "display order after a replacement" question, observed when the ADR-17 replacement controls shipped; mirrored in SPECIFICATION §11 and ADR-17 |
