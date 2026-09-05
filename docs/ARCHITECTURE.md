# System Architecture

**Status**: Derived from blueprint `§12` (modular monolith first; PostgreSQL + FTS + pgvector; Python model service; queue later; OpenTelemetry/Sentry; CI/CD with dev/staging/prod and feature flags), `§12.2` (request flow and the two additions for the shared space and attribution gate), `§12.3` (when to split services), `§21.3` (threat model). Decisions: ADR-1, ADR-2, ADR-5, ADR-11, ADR-12, ADR-15, ADR-24, ADR-25, ADR-26.

Two views are kept apart: **as built (2026-09-03)** and **target**. Anything marked *target* does not exist yet; the gap list is [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

---

## 1. Component view

```
┌──────────────────────────────┐        ┌──────────────────────────────────────────┐
│  apps/frontend  (Next.js 16) │  HTTPS │  apps/backend  (NestJS 10, TypeORM)      │
│  React 19, Tailwind 4        │ ─────▶ │  global prefix /api  (target: /api/v1)   │
│  RTL/LTR, Arabic-first       │  JSON  │  modules: app auth profiles titles       │
│  built: one page, 5 views    │        │           triads recommendations         │
│  target: PWA (manifest + SW),│        │           user-title-state               │
│  routed screens, admin       │        │  target: watch-events consents privacy   │
└──────────────────────────────┘        │          library-imports admin           │
                                        │          model-client enrichment-jobs    │
                                        └───────┬───────────────────┬──────────────┘
                                                │ SQL (TypeORM)     │ HTTP (target, ADR-25)
                                                ▼                   ▼
                              ┌──────────────────────────┐   ┌───────────────────────────────┐
                              │ PostgreSQL (pgvector img)│   │ services/workers (Python 3.11+)│
                              │ host 5433 · migrations   │◀──│ built: CLI train-profile      │
                              │ built: 7 tables          │SQL│ target: FastAPI model service │
                              │ target: BP §13.1 set,    │   │   train · select-triad · score │
                              │   FTS, vector columns    │   │   taste-profile · shared-space │
                              └──────────────────────────┘   │   batch · enrichment jobs      │
                                                             └──────────────┬────────────────┘
                                                                            │ HTTPS, org-level retention
                                                                            ▼
                                                                  ┌────────────────────┐
                                                                  │ Anthropic Messages │
                                                                  │ API (enrichment,   │
                                                                  │ explanations)      │
                                                                  └────────────────────┘
```

Test infrastructure: the backend e2e suite runs against `moviedb_test`, a second database inside the same dev Postgres instance (board C-17) — not a separate container.

## 2. Responsibilities

| Component | Built responsibility | Target responsibility (`BP §12.1`) |
|---|---|---|
| Frontend | auth screens, discover/mark watched, rank triad (drag + arrow buttons), watched list + flat recommendation list, profile/logout, language toggle | onboarding (language, market, platforms, import), triad screen with two replacement controls, three-track recommendations with four separate values and reasons, library/ranking/watchlist/timeline, taste profile, privacy actions, admin board, installable PWA |
| Backend | identity (JWT), profiles, catalog read, exposure state, random triad generation + ranking storage, on-the-fly Personal Fit from the latest snapshot, rate limiting, CORS, validation | events (triads, replacements, watch events, outcomes), consents/privacy requests, imports, rights registry, recommendations log, experiments, admin, calls to the model service, attribution gate, audit log, OpenAPI |
| Database | source of truth (7 tables) | full `BP §13.1` entity set, FTS on localized titles, pgvector candidates |
| Model service | CLI training per profile, in-sample metric | training with temporal hold-out, selection policy, scoring, confidence, taste profile, shared-space batch retraining, enrichment jobs |
| Queue / cache | not deployed (ADR-93) | queue for imports/enrichment/recompute; optional cache — introduced when `BP §12.3` says so |
| Object storage (S3-compatible) | — | import files, licensed assets, temporary copies |
| Observability | Nest default logger | OpenTelemetry traces/metrics, Sentry, first-party analytics with the event trail |

## 3. Request flows (`BP §12.2`)

The live path never calls an LLM. Fingerprints and template explanations are precomputed and versioned.

### 3.1 Next triad and ranking

```
POST /api/v1/triads/next
  backend: ownership check → load watched & triadEligible pool, recent triads, active experiment
         → model service POST /triads/select (adaptive-v1) | built: random-v1 in-process
         → persist triad (items, displayOrder, shownAt, policyVersion, selectionPropensity, experimentId, modelVersion)
         → 201 { requestId, triad }

POST /api/v1/triads/:id/rank   (Idempotency-Key)
  backend: ownership + membership + time checks → store ranking, answeredAt → 200
         → after every 3 completed triads: fire-and-forget POST /train to the model service
  built: GET …/triads/current creates or returns the active triad; POST …/rank stores ranking; no training trigger
```

### 3.2 Replacement

```
POST /api/v1/triads/:id/replace { titleId, reason }
  backend: write triad_replacements; apply ADR-17 exposure update; ask policy for a replacement item;
           new displayOrder; return triad. No preference signal is produced.
  built: not implemented
```

### 3.3 Recommendations

```
GET /api/v1/recommendations
  backend: ownership → candidate generation (content similarity; collaborative when mature; public quality; exploration)
         → rights + availability filter → model service POST /score
         → attribution gate → persist recommendations rows (separate scores, reason, propensity, requestId)
         → 200 { tracks: { safe, discovery, outside_usual } }
  built: single 'safe' list computed from the latest snapshot (watched titles excluded; unknown dimensions imputed, never zero); not persisted; 409 without a snapshot
```

### 3.4 Training

```
model service POST /train { profileId }
  temporal hold-out → fit → held-out metrics → user_model_snapshots row (+ model_versions link)
  built: `train-profile <profileId>` CLI run by hand, reads/writes Postgres directly
```

### 3.5 Enrichment

```
admin or scheduler → enrichment job (queue when it exists)
  licensed evidence → Responses API (structured, store=false) → validation → review queue → publish versioned features
  built: worker function exists, never run; no job runner
```

### 3.6 Import, export, delete

```
POST /api/v1/library/imports  → object storage → async parse (sandboxed) → match titles → watch_events(source=import) → delete raw file
POST /api/v1/privacy/export   → async job → artifact → status endpoint
POST /api/v1/privacy/delete   → privacy_requests(scheduled, executeAfter) → purge profiles cascade + derivatives → tombstone in audit_log
  built: none of the three
```

## 4. Code layout

### 4.1 Backend (`apps/backend/src`) — as built

```
main.ts                      bootstrap: global prefix /api, ValidationPipe(whitelist, forbidNonWhitelisted, transform), CORS from FRONTEND_URL
data-source.ts               TypeORM CLI data source (migrations)
config/database.config.ts    connection from .env (POSTGRES_*, DB_HOST, DB_PORT); synchronize: false
config/jwt.config.ts         JWT_SECRET required
entities/                    user, profile, title (+ title-fingerprint.type), embedding, triad, user-model-snapshot, user-title-state
migrations/                  3 migrations (see SCHEMA.md §1)
modules/app                  health + root; ThrottlerGuard 60 req/min global
modules/auth                 register/login/profile, JwtStrategy, bcrypt
modules/profiles             CRUD, owner-only
modules/titles               list/search (ILIKE), get
modules/triads               current (random-v1), completed list, rank
modules/recommendations      Personal Fit from latest snapshot, band heuristic
modules/user-title-state     PATCH state, watched-titles, watchlist
scripts/seed.ts              15 hand-entered titles
test/idor.e2e-spec.ts        cross-user access proof over real HTTP + moviedb_test
```

Target additions: `modules/replacements` (or inside `triads`), `modules/watch-events`, `modules/consents`, `modules/privacy`, `modules/library-imports`, `modules/admin` (role guard), `modules/model-client` (HTTP client to the Python service), `modules/enrichment` (job producer), `common/` (guards, decorators, request-id middleware, audit interceptor). Every profile-scoped handler keeps the existing `assertProfileOwnership` pattern.

### 4.2 Frontend (`apps/frontend/app`) — as built

```
layout.tsx          SessionProvider; <html lang="ar" dir="rtl"> (Arabic-first), kept in sync with the UI language by page.tsx
page.tsx            single client page switching between views: home | rank | discover | list | profile
components/         AuthScreen, DiscoverScreen, RankScreen, ListScreen, ProfileScreen
lib/api.ts          typed fetch client (mirrors backend shapes); lib/session.tsx localStorage session, auto-creates one profile
lib/copy.ts         fixed product copy: the triad instruction (blueprint §4.3), identical in both languages
globals.css         Tailwind 4 + custom CSS; Cairo font for RTL
```

Target: App Router routes (`/onboarding`, `/rank`, `/discover`, `/library`, `/recommendations`, `/profile`, `/privacy`, `/admin/*`), `manifest.webmanifest` + service worker (installable PWA, `BP §5.1`), i18n dictionary with the fixed triad instruction copy, keyboard and screen-reader paths, `lang`/`dir` driven by the profile language.

### 4.3 Model service (`services/workers`) — as built

```
src/ranker.py       PlackettLuceRanker (listwise PL, BFGS, population_priors, bias_terms), compute_pairwise_accuracy
src/training.py     CLI train-profile: loads completed triads + fingerprints (V1 + V2 + V3 keys), fits, writes user_model_snapshots
src/model_service.py FastAPI service the backend calls: POST /train, GET /health (`make model-service`, 127.0.0.1:8001) — built
src/enrichment.py   FilmEnrichmentWorker (Anthropic structured outputs: V1, V2 families, V3 form families; explanation generator; per-call accounting)
src/enrich_catalog.py  batch runner for the demo catalog (--v2, --v3, --ar-evidence, placeholders, reports)
src/fingerprint_v2_eval.py / train_demo.py  offline feature-set evaluation; demo-persona training and recovery
tests/              pytest
```

Target (the rest of `api.py`: triads/select, score, taste-profile, shared-space/retrain), `policy.py`, `confidence.py`, `attribution.py`, `shared_space.py`, `evaluation.py`, `enrichment/` pipeline with validation and review queue. See [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §15.

### 4.4 Shared package (`packages/shared`)

`FilmFingerprintV1` (reference copy) plus API-aligned `Profile`, `Title`, `UserTitleState`, `Triad`, `Recommendation` (four separate values, no merged score) and their enums. Compiles standalone; not yet imported by the apps — the backend keeps a local copy of the fingerprint type and the frontend its own client types. Target: publish via a project-reference build when a second consumer appears (ADR-1).

## 5. Security model (`BP §21.3`)

| Surface | Built | Target |
|---|---|---|
| Account | JWT bearer (no refresh), bcrypt cost 10, 5 req/min on register/login, 8–64 char passwords | refresh tokens, optional MFA, secure session handling, alerts |
| API | global 60 req/min, whitelist validation, owner-only profile routes (e2e proven), CORS to `FRONTEND_URL` | object-level authorization everywhere incl. admin roles, quotas, audit log, `Idempotency-Key`, request ids |
| Import | — | type/size checks, sandboxed parsing, raw file deletion, least privilege |
| Staff | — | RBAC, separation of duties, just-in-time access, audit trail |
| Models | no identity in prompts | membership-inference evaluation, data minimization, isolation |
| Deletion | profile cascade only | traceable workflow, tombstones, declared backup policy |

## 6. Environments and deployment (`BP §12.1`, `§18.1`; ADR-24)

| Environment | Built | Required before Alpha |
|---|---|---|
| Local | `docker compose` Postgres (5433, also hosts `moviedb_test` for e2e — board C-17); `npm run dev` (frontend 3000, backend 3101); Python CLI | unchanged |
| CI | `.github/workflows/ci.yml`: three jobs (backend, frontend, workers) on every push to `main` and every PR; `main` pushes no longer cancel each other (per-commit-sha concurrency group, PR branches still do) | unchanged |
| Staging | `docker/Dockerfile` per service (`apps/backend`, `apps/frontend`, `services/workers`) + `docker/docker-compose.prod.yml`: one-shot `migrate` service before the app containers, secrets as files under `docker/secrets/` (never `.env`) read via `docker/read-secrets.sh`; `docker/backup-postgres.sh` / `restore-postgres.sh`, a full live restore drill run and documented (`ALPHA_PLAN_2026-09-04.md` §8.12) | feature flags |
| Production | same images/compose as staging | managed Postgres with PITR and encryption at rest (ADR-24, still open), TLS, secrets manager, model rollback, OpenTelemetry + Sentry + first-party analytics, cost monitoring; data residency in KSA/region preferred ([PRIVACY.md](PRIVACY.md)) |

Hosting vendor is deliberately undecided (ADR-24); the earlier AWS/Vercel/Lambda diagrams were speculative and are withdrawn.

## 7. When to split services (`BP §12.3`)

| Signal | Change |
|---|---|
| Training competes with API resources | separate worker/model service process and scheduler |
| Long or frequent imports/enrichment | queue + workers + dead-letter handling |
| Search exceeds measured Postgres capacity | search engine after a benchmark |
| Independent teams / deploy boundaries | gradual service split with documented event contracts |
| Large analytical event volume | warehouse/streaming after measuring the need |

Until a signal fires: one NestJS process, one Python service, one Postgres.

## 8. Observability (`BP §12.1`, `§16.2`)

Traces for every request with `requestId`; metrics for API latency, model-service latency, training duration, queue depth, enrichment cost; model metrics sliced by language/country/popularity; product funnel (register → watched ≥3 → first triad → first result → return); alerts on error rate, long jobs, DB capacity, cost anomalies. The metrics board must distinguish click, watch and later ranking (`BP §18.1`).

---

**Changelog**
- 2.0 (2026-09-03): rewritten. Removed the invented module tree (users/admin/common/redis.config that never existed), "Next.js 14 / React 18", express-rate-limit, and the AWS/Vercel/Lambda topology; added as-built vs target views and the flows the blueprint requires.
