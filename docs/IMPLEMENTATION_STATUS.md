# Implementation Status — code versus blueprint

> **Snapshot 2026-09-03, code at `201a02d`** (no application code has changed since `33940df`; only documentation).
> Re-verified for this revision: backend vitest suite **38 tests / 5 files pass**; Python pytest **21 tests pass**; `tsc --noEmit` clean for `apps/backend` and `apps/frontend`. Migrations-applied-locally and the manual browser pass (register → Discover → Rank → My list → Profile → language toggle → logout) were verified in the previous 2026-09-03 snapshot and are carried forward unchanged.
>
> Two verdicts per row, because "the code exists and runs" and "it does what the blueprint requires" are different claims:
>
> | Column | ✅ | 🟡 | ❌ | — |
> |---|---|---|---|---|
> | **Built** | exists in the repo and was exercised (unit/e2e test or the browser pass) | partly built | not built | |
> | **Blueprint** | verified against the cited section of [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) | meets part of it | fails it | the blueprint says nothing specific, so Built is the whole bar |
>
> A row is *done* only when both columns are ✅ (or Built ✅ with Blueprint —). `§` = blueprint section; `ADR-n` = [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md); target contracts are [API.md](API.md), [SCHEMA.md](SCHEMA.md), [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md), [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md).
>
> Phase names follow the blueprint (ADR-18). Everything on this page is the **Phase 0 → Alpha** engineering scope (`§17.1`–`§17.2`, `§18`).

## Blueprint gaps hiding behind working code (fix before adding features)

These run today and contradict or fall short of the blueprint; a green test suite makes them invisible.

1. **Schema covers 7 of the target tables** — `recommendations`, `outcomes`, `watch_events`, `triad_replacements`, `consents`, `privacy_requests`, `source_records`, `content_features`, `localized_titles`, `model_versions`, `experiments`, `audit_log`, `shared_latent_space_versions` are missing (`§13.1`, `§11.1`; [SCHEMA.md](SCHEMA.md) §2.4 migration plan M1–M7).
2. **"Not watched" is treated as an exclusion signal** — `RecommendationsService` removes `not_watched` titles from the candidate pool. `§2.4 #3`: unwatched is unknown exposure; those titles are exactly the candidates.
3. **Missing fingerprint dimension becomes 0** — `training.py` (`fingerprint.get(dim, 0) or 0`) and `RecommendationsService.personalFitScore` (`Number(x) || 0`). `§6`/`§11.3`: absence means unknown (ADR-19).
4. **Model "validation" is in-sample** — `training.py` fits on all completed triads and computes `pairwiseAccuracy` on the same triads. `§8.3`, `§16.1`, `§17.2` require a temporal held-out slice with whole triads (ADR-22).
5. **Triad instruction copy does not fix the meaning** — `§4.3` requires «رتّب هذه الأفلام حسب إعجابك الشخصي، من الأكثر إلى الأقل»; `RankScreen` says «رتّب الأفلام بحسب تفضيلك».
6. **Triad event lacks `shownAt`/`answeredAt`/`modelVersion` columns** (`§13.2`); `POST …/rank` has no idempotency key (`§14`), only a status guard; ranking is index-based (ADR-15 moves to title ids).
7. **Recommendations are never persisted** — no reason, no display propensity, no `experimentId`/`requestId` (`§13.1`, `§14`, `§14.1`). Without the log the post-watch loop (`§4.5`) cannot close and `§16` has nothing to read.
8. **Confidence band is a triad-count heuristic** — `§9.2`/`§9.3` require evidence diversity, held-out prediction success and fingerprint quality (ADR-21).
9. **Fingerprints carry no provenance and cover part of `§6.1`** — the 15 seeded rows leave `confidence` empty; families characters/ending/people/cultural context are absent (V1 is frozen; V2 planned — [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md)).
10. **Onboarding collects no market, platforms, or consent** (`§4.1`, `§13.1`, `§2.4 #9`).
11. **Arabic-first is not the default** — `profiles.preferredLanguage` defaults to `'en'` (the frontend passes `'ar'` explicitly) and `layout.tsx` renders `<html lang="en">` regardless of UI language (`§2`, `§5.1`).
12. **Not a PWA yet** — no web manifest or service worker (`§5.1`, ADR-5).
13. **Enrichment worker diverges from `§15.3` / ADR-23** — Chat Completions instead of the Responses API, no `store=false`, hard-coded default model id, Pydantic field `schema_version` vs TypeScript `schemaVersion`, no provenance fields.
14. **Reproducibility** — the trainer initializes weights with an unseeded random draw; `§18.1` requires every result to be reproducible from the event log and model version (ADR-22).
15. **Stale shared types** — `packages/shared/src/types.ts` still declares a merged `Recommendation.score` + numeric `confidence` and `UserProfile.preferredGenres`, contradicting `§4.4`; nothing imports it, but it is the package that is supposed to be the contract (ADR-1).

---

## Project setup

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Monorepo (Next.js, NestJS, Python, shared types) | ✅ | — | ADR-1 |
| Database schema (PostgreSQL) | 🟡 | ❌ | 7 tables migrated; target set and plan in [SCHEMA.md](SCHEMA.md) §2. pgvector image runs but `embeddings.vector` is `real[]` (`§12.1`) |
| Docker Compose: Postgres + Redis + disposable `postgres-test` | ✅ | — | |
| Environment template | ✅ | — | `FRONTEND_URL` and `OPENAI_FINGERPRINT_MODEL` not yet in `.env.example` |
| Documentation set | ✅ | — | reorganized 2026-09-03; index in [README.md](README.md) |
| Plackett–Luce ranker (Python) | ✅ | ✅ | `§7.2`: listwise event, not three pairwise comparisons |
| Enrichment worker (Python) | ✅ | 🟡 | structured output ✅; gap 13 above; `§15.4` acceptance tests ❌; never run against the catalog |
| Shared TypeScript types package | ✅ | ❌ | gap 15 |
| Makefile | ✅ | — | mirrors npm scripts; `poetry` assumed for Python |
| CI | ❌ | ❌ | `§12.1` |

## Authentication and accounts

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Register / login / JWT (`AuthService`, `AuthController`) | ✅ | 🟡 | `§13.1`: pseudonymous taste id exists (profile); no market/platforms; no `consents` at registration (`§2.4 #9`) |
| Password hashing (bcrypt cost 10), email validation, 8–64 char passwords | ✅ | — | |
| Auth throttling (5 req/min) + global 60 req/min | ✅ | — | `§21.3` |
| Refresh tokens | ❌ | — | ADR-26, before Alpha |
| Roles (`users.role`) for the admin board | ❌ | ❌ | `§5.1` |
| Unit tests | ✅ | — | `auth.service.spec.ts`, 7 tests |
| Frontend: login / register (`AuthScreen`) | ✅ | ❌ | `§4.1` onboarding (language, market, platforms, consent, import) not collected |
| Frontend: session persistence, auto-redirect, logout | ✅ | — | `localStorage` via `lib/session.tsx` |
| Password reset | ❌ | — | |

## Profiles

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| CRUD + owner-only authorization | ✅ | ✅ | proven by `test/idor.e2e-spec.ts` (`§2.4 #9`, `§21.3`) |
| Unique `(userId, name)` | ✅ | — | |
| `market`, `platforms` on profile | ❌ | ❌ | `§4.1` |
| Arabic-first default | ❌ | ❌ | gap 11 |
| Unit tests | ✅ | — | `profiles.service.spec.ts`, 7 tests |
| Frontend: profile screen (name, email, logout) | ✅ | — | |
| Frontend: create/switch/edit/delete profiles | ❌ | — | one profile auto-created; `§2.4 #10` satisfied by the data model, not the UI |

## Catalog

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `TitlesService` list/search/get | ✅ | ❌ | ILIKE on `titleEn`/`titleAr`; `§5.1` alternate titles / `§13.1` `localized_titles` / `§12.1` FTS missing |
| Fingerprint field (`FilmFingerprintV1`, 13 dims) | ✅ | 🟡 | V1 frozen (ADR-19); provenance empty; gap 9 |
| Rights registry (`source_records`) | ❌ | ❌ | `§11.1` — seeded rows carry `licenseStatus: 'unknown'` |
| Admin write endpoints | ❌ | — | no admin role |
| Seed script (15 dev titles) | ✅ | ❌ | `§17.1`: 300–500-film balanced research catalog with rights |
| Fingerprint batch generation | ❌ | ❌ | `§15.3` |
| Tests: search/pagination | ❌ | — | |
| Frontend: search + mark watched (`DiscoverScreen`) | ✅ | 🟡 | live debounced search; existing states not loaded (marks reset per session); no starter set; no CSV import |
| Frontend: work page (fingerprint, fit reason, public quality and availability separate) | ❌ | ❌ | `§5.3` |

## Triads (core loop)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `GET /profiles/:id/triads/current` (creates or returns active) | ✅ | 🟡 | `§14 /triads/next`: watched-only ✅, propensity + policy ✅; no `requestId`/`modelVersion`/`experimentId`; target is `POST /api/v1/triads/next` (ADR-15) |
| `POST /triads/:id/rank` | ✅ | ❌ | `§14`: idempotency key, membership and time checks missing; `§13.2`: `answeredAt`, `modelVersion` not recorded (gap 6) |
| `GET /profiles/:id/triads` (completed) | ✅ | — | |
| Random policy `random-v1` | ✅ | 🟡 | ρ = 1/C(pool,3) ✅, `policyVersion` ✅, independent `displayOrder` ✅ (`§4.3`, `§8.3`); `§8.3` unmet: session limit/fatigue, reserved hold-out, director/language guard |
| Adaptive policy (`§8.1` functions, `§8.2` score, `§7.5` Fisher targeting) | ❌ | ❌ | [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §9 |
| Ranking validation (permutation of [0,1,2]) | ✅ | — | |
| Replacement (`not_watched` / `not_remembered`) | ❌ | ❌ | `§4.3`, `§13.1`, `§14`; semantics fixed in ADR-17; `metadata.replacements` reserved, never written |
| Training trigger from the backend | ❌ | ❌ | `§12.2`; ADR-25 |
| Unit tests | ✅ | — | `triads.service.spec.ts`, 10 tests |
| Frontend: three cards, drag + ↑/↓ (keyboard path), position numbers, save, next round auto-loads | ✅ | 🟡 | `§4.3` RTL/keyboard ✅; instruction copy wrong (gap 5); no poster (no licensed asset); no critic scores ✅ |
| Frontend: two replacement buttons + dialog | ❌ | ❌ | `§4.3` |
| Frontend: progress indicator, periodic "model updated" result | ❌ | — | `§4.3` "periodic, not necessarily per triad"; count open per `App. C` |
| Frontend: N+1 title fetches per triad | 🟡 | — | `RankScreen` fetches each title separately; target `/triads/next` returns items inline |
| Frontend tests | ❌ | — | no test setup |

## Model training (Python)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `PlackettLuceRanker.fit()` via CLI `train-profile` | ✅ | 🟡 | `§7.1`: `b(m)` present as zero placeholder ✅, `θᵀφ` ✅, `δ` as per-title bias ✅, `pᵀq` deferred (allowed); `§7.5` calibration absent; unseeded random init (gap 14) |
| Temporal hold-out and held-out metrics | ❌ | ❌ | gap 4; ADR-22 |
| Unknown-feature handling | ❌ | ❌ | gap 3; ADR-19 |
| BFGS listwise MLE with L2 | ✅ | ✅ | `§7.2` |
| Snapshot persistence (`user_model_snapshots`) | ✅ | 🟡 | `§13.1 taste_profiles`: no posterior, time layers, exceptions, held-out metrics, `calibratedAgainst` |
| Population prior source (Public Quality) | ❌ | ❌ | needs a licensed source ([DATA_LICENSING.md](DATA_LICENSING.md)) |
| Shared latent space (`§7.5`) | ❌ | ❌ | ADR-13; external seed license-blocked without GroupLens permission |
| FastAPI model service (`train`, `triads/select`, `score`, `taste-profile`) | ❌ | ❌ | ADR-25 |
| Python tests | ✅ | — | 21 tests (`test_ranker.py`, `test_training.py`, `test_enrichment.py`) |

## Recommendations

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `GET /profiles/:id/recommendations` (409 until a snapshot exists) | ✅ | ❌ | `§13.1`/`§14`: not persisted, no reason, no propensity, no `requestId` (gap 7) |
| Personal Fit from latest snapshot; dimension-mismatch guard | ✅ | — | |
| Four separate values, never merged | ✅ | ✅ | `§4.4`: Public Quality and Watchability are explicit `null` (no source), not fabricated |
| Three tracks | ❌ | ❌ | every result is `safe` (`§4.4`, ADR-8) |
| Candidate filtering | 🟡 | ❌ | excludes watched ✅ and unfingerprinted ✅, **also excludes `not_watched`** (gap 2); zero-fill (gap 3) |
| Confidence band (verbal, no %) | ✅ | ❌ | band from triad count only (gap 8) |
| Internal rerank blend (`§10.3`, ADR-20) | ❌ | ❌ | |
| Attribution gate + `evidenceSource` | ❌ | ❌ | `§7.6`, `§12.2`, `§14` |
| Outcomes endpoint | ❌ | ❌ | `§13.1 outcomes` |
| Unit tests | ✅ | — | `recommendations.service.spec.ts`, 9 tests |
| Frontend: recommendation list (`ListScreen`) | 🟡 | ❌ | flat title + description list; `§4.4` needs tracks, four values, reason, availability, watchlist, "not relevant" |
| Explanations (template / LLM rephrase) | ❌ | — | `enrichment.py` has an unused generator; `§9.4` rules not implemented |

## Exposure and watch history

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `PATCH …/titles/:titleId/state` (watched / not_watched / watchlist / interested) | ✅ | 🟡 | `§13.1 watch_events`/`§6.2`: no source, edition, audio, subtitles, provider; single state row |
| `GET …/watched-titles`, `GET …/watchlist` | ✅ | — | |
| No in-app rating; `importedRating` + `ratingSource='import'` reserved | ✅ | ✅ | `§2.4 #2`, `§4.2`, `§4.5` |
| `POST /watch-events` with source; `POST /library/imports` | ❌ | ❌ | `§14`, `§4.2` |
| `triadEligible` flag (ADR-17) | ❌ | ❌ | |
| Unit tests | ✅ | — | `user-title-state.service.spec.ts`, 5 tests |
| Frontend: mark watched ✅; not watched ❌; watchlist ❌; history ✅ (`ListScreen`); state shown in search ❌ | 🟡 | 🟡 | `§4.2`, `§5.1` |

## Privacy, consent, admin

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Consent capture (`consents`) | ❌ | ❌ | `§13.1`, `§2.4 #9`; purposes in [PRIVACY.md](PRIVACY.md) §3 |
| Export / delete / reset endpoints | ❌ | ❌ | `§14`, `§18.1`; `DELETE /profiles/:id` cascades one profile only |
| Restrictions (`no_pooled`, `pause_all`) | ❌ | ❌ | [PRIVACY.md](PRIVACY.md) §4 |
| Audit log | ❌ | ❌ | `§21.3` |
| Admin board (`§5.1`, `§17.2`) | ❌ | ❌ | required for Alpha, not optional |
| Privacy documentation | ✅ | 🟡 | [PRIVACY.md](PRIVACY.md) rewritten; counsel review pending |
| PIA, DPO, breach plan, regional residency decision | ❌ | — | [PRIVACY.md](PRIVACY.md) §13 |

## Testing and evaluation

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Backend unit tests (5 files, 38 tests) | ✅ | — | re-run 2026-09-03 |
| Backend e2e: auth guard + IDOR over real HTTP + `postgres-test` | ✅ | ✅ | `§21.3` object-level authorization; not functional coverage |
| Functional API tests (titles, triads, recommendations) | ❌ | — | |
| Frontend tests | ❌ | — | |
| Python tests (21) | ✅ | — | re-run 2026-09-03 |
| Offline evaluation protocol (`§16.1`), metrics beyond in-sample pairwise (`§16.2`), baselines (`§16.3`), acceptance gate (`§16.5`) | ❌ | ❌ | |
| Automated tests for triad, replacement, delete, export (`§18.1`) | 🟡 | ❌ | triad ranking only |
| Performance with 100+ titles / 50+ triads | ❌ | — | |

## Infrastructure and operations

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Local compose (Postgres 5433, Redis 6379, `postgres-test` 5544) | ✅ | — | |
| Indexes beyond PK/unique | ❌ | — | [SCHEMA.md](SCHEMA.md) M1 |
| Redis usage (queue/cache) | ❌ | — | idle by design until `§12.3` (ADR-10, ADR-25) |
| CI/CD, staging, prod, feature flags, model rollback | ❌ | ❌ | `§12.1`, `§18.1`, ADR-24 |
| Observability (OpenTelemetry, Sentry, first-party analytics) | ❌ | ❌ | `§12.1` |
| Backups + restore drill | ❌ | ❌ | `§18.1` |
| CORS from `FRONTEND_URL`; global throttling | ✅ | — | |
| `/api/v1` versioning + response envelope + idempotency | ❌ | ❌ | `§14`, ADR-15 |

## Alpha gate readiness (`§17.2`, `§18.1`)

| Definition-of-Done item | Status |
|---|---|
| New user reaches a first result unaided | ❌ (training is a manual CLI) |
| "Haven't watched" never enters the taste loss | 🟡 (it does not enter training; but `not_watched` is excluded from candidates — gap 2 — and replacement is not built) |
| Every result reproducible from event log + model version | ❌ (unseeded init; recommendations not persisted) |
| Automated tests for triad, replacement, delete, export | ❌ |
| Backup restore drill documented | ❌ |
| No content/images shown without a known license status | 🟡 (no images shown; seeded text is `unknown`) |
| Metrics board separates click, watch, later ranking | ❌ |
| Model rollback + feature flags | ❌ |
| 300–500-film catalog with rights registry | ❌ (15 dev titles) |
| 80–150 Alpha users; accepters complete 20–30 triads | ❌ (no Alpha yet) |

---

**Next milestone (in order):** close the cheap gaps first — triad instruction copy (5), stop excluding `not_watched` (2), unknown ≠ zero (3), seeded deterministic init (14), Arabic default + `lang` attribute (11), shared-types cleanup (15); then migration M1 + `answeredAt`/`modelVersion`/idempotency (6) and the replacement endpoint + two UI buttons (ADR-17); then temporal hold-out in training (4) and a training trigger through the FastAPI service (ADR-25); then M5 + persisted recommendations and outcomes (7) so the post-watch loop can close; then consent/onboarding (10) and the admin board.

**Last updated**: 2026-09-03 · **Status**: core loop (auth → mark watched → rank → train by CLI → recommend) runs locally; fifteen pieces fall short of the blueprint (list at the top).
