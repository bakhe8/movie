# Implementation Status — code versus blueprint

> **Snapshot 2026-09-03, after the "close the six cheap gaps" change plus a security/code-quality audit** (base `a405b0e`; the audit fixes below were uncommitted at time of writing).
> Verified for this revision: backend vitest suite **48 tests / 6 files pass**; backend e2e suite **12 tests pass** over real HTTP against `postgres-test` with all five migrations applied; Python pytest **26 tests pass**; `tsc --noEmit` clean for `apps/backend`, `apps/frontend` and `packages/shared`; `eslint` clean for **both** `apps/frontend` and `apps/backend` (backend `eslint` could not even run before today — see the audit table below); the new migrations applied to the local dev database; `npm audit --omit=dev` down from 14 (1 critical, 5 high, 7 moderate, 1 low) to 3, all moderate (0 critical, 0 high, 0 low) — the sole remainder is `@nestjs/core`'s own CVE, fixed only by a NestJS 10→12 major upgrade (not attempted; see the audit table below). The manual browser pass (register → Discover → Rank → My list → Profile → language toggle → logout) was verified in an earlier snapshot and is carried forward; nothing in today's audit touched the frontend UI.
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

## Closed on 2026-09-03 (the six cheap gaps)

| Gap | What changed | Proof |
|---|---|---|
| Triad instruction copy did not fix the meaning (`§4.3`) | `apps/frontend/app/lib/copy.ts` holds the fixed instruction in both languages; `RankScreen` uses it | lint + type-check; copy matches `§4.3` verbatim |
| `not_watched` excluded from recommendation candidates (`§2.4 #3`) | `RecommendationsService` excludes `watched` only | `recommendations.service.spec.ts` asserts the query |
| Missing fingerprint dimension became 0 (`§6`, `§11.3`, ADR-19) | trainer drops triads with incomplete fingerprints; ranker raises on undescribed titles; scorer imputes the candidate-pool mean, reports `fingerprintCoverage`, demotes the band one step | 4 new Python tests, 3 new backend tests |
| Unseeded random initialization (`§18.1`, ADR-22) | `PlackettLuceRanker` starts from zero | determinism test (two fits, identical weights) |
| Not Arabic-first (`§2`, `§5.1`) | entity + service default `'ar'`; migration `1788418200000-ArabicFirstProfileDefault`; `<html lang="ar" dir="rtl">` synced to the UI language | profiles spec; migration ran on dev and test DBs |
| Stale shared types (`§4.4`, ADR-1) | `packages/shared/src/types.ts` rewritten to the API shapes (no merged score, no `preferredGenres`); committed build artifacts removed; package compiles | `tsc --noEmit -p packages/shared` |

## Also closed on 2026-09-03 (security and code-quality audit)

Found by an independent audit of the code itself (not blueprint conformance — these are general engineering-integrity defects with no blueprint section to cite), fixed the same day.

| Issue | What changed | Proof |
|---|---|---|
| Backend `eslint` had never run successfully in this repo — `npm run lint` in `apps/backend` failed outright with "ESLint couldn't find the plugin `@typescript-eslint/eslint-plugin`" | `.eslintrc.json` moved from the repo root into `apps/backend/` (its only real consumer — the frontend has its own flat `eslint.config.mjs`, `packages/shared` has no lint script — so plugin resolution now happens where the plugin is actually installed); root `package.json` gained the `lint` script it never had (`make lint` was calling a script that didn't exist) | `npm run lint` from the repo root now exits 0 across both workspaces |
| 14 known vulnerabilities in production dependencies (`npm audit --omit=dev`): 1 critical (`tar`/`node-pre-gyp`, pulled in by `bcrypt`), 5 high, 7 moderate, 1 low | `bcrypt` replaced with `bcryptjs` (identical `hash`/`compare` API, pure JS, no native compile step); `qs`, `lodash`, `uuid`, `body-parser`, `multer`, `file-type` pinned to patched, same-line versions via root `package.json` `overrides` | `npm audit --omit=dev`: 14 → 3 (all moderate); full backend test suite (48 unit + 12 e2e, including a real register→login HTTP round trip) still green |
| `JwtStrategy.validate()` put the full `User` entity — bcrypt hash included — on `req.user` for every guarded route (not exploited today; every controller only reads `.id`, but a latent leak risk) | `AuthService.validateUser()` now returns a `SafeUser` projection (`Omit<User, 'password'>`) instead of the raw entity; `JwtStrategy`/`AuthController` typed (`JwtPayload`, `{user:{id:string}}`) instead of `any` | new test: `validateUser` never returns `password` (`auth.service.spec.ts`) |
| `TriadsService.getCurrent()` race: two concurrent requests for a profile with no active triad could both pass the check and both insert one | DB partial unique index `IDX_triads_one_active_per_profile` on `triads(profileId) WHERE status='active'` (migration `AddOneActiveTriadPerProfileConstraint`); the service now catches the resulting `23505` on the losing insert and returns the winner's row instead of erroring or duplicating | new tests in `triads.service.spec.ts`; migration applied cleanly to both `postgres-test` and the local dev DB (no pre-existing duplicates) |
| `PATCH /profiles/:id {name: ""}` silently blanked a profile's name — `UpdateProfileDto` lacked the `@IsNotEmpty()` that `CreateProfileDto` has | added `@IsNotEmpty()` to `UpdateProfileDto.name` | new `update-profile.dto.spec.ts` (DTO validation runs at the `ValidationPipe` boundary, not inside the service, so this needed its own test) |

Not fixed, left open: `@nestjs/core`'s own moderate CVE (GHSA-36xv-jgw5-4q75) and a chain of `@nestjs/cli`-only dev-tooling vulnerabilities, both of which require a NestJS 10→12 major-version migration — a real framework upgrade with regression risk beyond what today's test suite would catch, so it needs its own dedicated pass rather than folding into an audit-fix session.

## Blueprint gaps hiding behind working code (fix before adding features)

These run today and contradict or fall short of the blueprint; a green test suite makes them invisible.

1. **Schema covers 7 of the target tables** — `recommendations`, `outcomes`, `watch_events`, `triad_replacements`, `consents`, `privacy_requests`, `source_records`, `content_features`, `localized_titles`, `model_versions`, `experiments`, `audit_log`, `shared_latent_space_versions` are missing (`§13.1`, `§11.1`; [SCHEMA.md](SCHEMA.md) §2.4 migration plan M1–M7).
2. **Model "validation" is in-sample** — `training.py` fits on all completed triads and computes `pairwiseAccuracy` on the same triads. `§8.3`, `§16.1`, `§17.2` require a temporal held-out slice with whole triads (ADR-22).
3. **Triad event lacks `shownAt`/`answeredAt`/`modelVersion` columns** (`§13.2`); `POST …/rank` has no idempotency key (`§14`), only a status guard; ranking is index-based (ADR-15 moves to title ids).
4. **Recommendations are never persisted** — no reason, no display propensity, no `experimentId`/`requestId` (`§13.1`, `§14`, `§14.1`). Without the log the post-watch loop (`§4.5`) cannot close and `§16` has nothing to read.
5. **Confidence band is a triad-count heuristic** — `§9.2`/`§9.3` require evidence diversity, held-out prediction success and fingerprint quality (ADR-21). The fingerprint-quality input now exists (one-band demotion); the rest does not.
6. **Fingerprints carry no provenance and cover part of `§6.1`** — the 15 seeded rows leave `confidence` empty; families characters/ending/people/cultural context are absent (V1 is frozen; V2 planned — [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md)).
7. **Onboarding collects no market, platforms, or consent** (`§4.1`, `§13.1`, `§2.4 #9`).
8. **Not a PWA yet** — no web manifest or service worker (`§5.1`, ADR-5).
9. **Enrichment worker diverges from `§15.3` / ADR-23** — Chat Completions instead of the Responses API, no `store=false`, hard-coded default model id, Pydantic field `schema_version` vs TypeScript `schemaVersion`, no provenance fields.

---

## Project setup

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Monorepo (Next.js, NestJS, Python, shared types) | ✅ | — | ADR-1 |
| Database schema (PostgreSQL) | 🟡 | ❌ | 7 tables, 5 migrations (the 5th adds a constraint, not a table); target set and plan in [SCHEMA.md](SCHEMA.md) §2. pgvector image runs but `embeddings.vector` is `real[]` (`§12.1`) |
| Docker Compose: Postgres + Redis + disposable `postgres-test` | ✅ | — | |
| Environment template | ✅ | — | `FRONTEND_URL` and `OPENAI_FINGERPRINT_MODEL` not yet in `.env.example` |
| Documentation set | ✅ | — | reorganized 2026-09-03; index in [README.md](README.md) |
| Plackett–Luce ranker (Python) | ✅ | ✅ | `§7.2`: listwise event, not three pairwise comparisons; deterministic init; refuses undescribed titles |
| Enrichment worker (Python) | ✅ | 🟡 | structured output ✅; gap 9 above; `§15.4` acceptance tests ❌; never run against the catalog |
| Shared TypeScript types package | ✅ | ✅ | API-aligned types, compiles; not yet consumed by the apps (ADR-1) |
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
| Arabic-first default (`preferredLanguage`, `<html lang/dir>`) | ✅ | ✅ | entity + migration + service; `page.tsx` syncs `lang`/`dir` on toggle (`§2`, `§4.3`) |
| Unit tests | ✅ | — | `profiles.service.spec.ts`, 7 tests |
| Frontend: profile screen (name, email, logout) | ✅ | — | |
| Frontend: create/switch/edit/delete profiles | ❌ | — | one profile auto-created; `§2.4 #10` satisfied by the data model, not the UI |

## Catalog

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `TitlesService` list/search/get | ✅ | ❌ | ILIKE on `titleEn`/`titleAr`; `§5.1` alternate titles / `§13.1` `localized_titles` / `§12.1` FTS missing |
| Fingerprint field (`FilmFingerprintV1`, 13 dims) | ✅ | 🟡 | V1 frozen (ADR-19); provenance empty; gap 6 |
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
| `POST /triads/:id/rank` | ✅ | ❌ | `§14`: idempotency key, membership and time checks missing; `§13.2`: `answeredAt`, `modelVersion` not recorded (gap 3) |
| `GET /profiles/:id/triads` (completed) | ✅ | — | |
| Random policy `random-v1` | ✅ | 🟡 | ρ = 1/C(pool,3) ✅, `policyVersion` ✅, independent `displayOrder` ✅ (`§4.3`, `§8.3`); `§8.3` unmet: session limit/fatigue, reserved hold-out, director/language guard |
| Adaptive policy (`§8.1` functions, `§8.2` score, `§7.5` Fisher targeting) | ❌ | ❌ | [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §9 |
| Ranking validation (permutation of [0,1,2]) | ✅ | — | |
| Replacement (`not_watched` / `not_remembered`) | ❌ | ❌ | `§4.3`, `§13.1`, `§14`; semantics fixed in ADR-17; `metadata.replacements` reserved, never written |
| Training trigger from the backend | ❌ | ❌ | `§12.2`; ADR-25 |
| Unit tests | ✅ | — | `triads.service.spec.ts`, 10 tests |
| Frontend: instruction copy fixed to `§4.3` («حسب إعجابك الشخصي، من الأكثر إلى الأقل») | ✅ | ✅ | `lib/copy.ts` |
| Frontend: three cards, drag + ↑/↓ (keyboard path), position numbers, save, next round auto-loads | ✅ | 🟡 | RTL/keyboard ✅; no licensed poster on the card (`§4.3`); no critic scores ✅ |
| Frontend: two replacement buttons + dialog | ❌ | ❌ | `§4.3` |
| Frontend: progress indicator, periodic "model updated" result | ❌ | — | `§4.3` "periodic, not necessarily per triad"; count open per `App. C` |
| Frontend: N+1 title fetches per triad | 🟡 | — | `RankScreen` fetches each title separately; target `/triads/next` returns items inline |
| Frontend tests | ❌ | — | no test setup |

## Model training (Python)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `PlackettLuceRanker.fit()` via CLI `train-profile` | ✅ | 🟡 | `§7.1`: `b(m)` present as zero placeholder ✅, `θᵀφ` ✅, `δ` as per-title bias ✅, `pᵀq` deferred (allowed); deterministic zero init ✅ (ADR-22); `§7.5` calibration absent |
| Temporal hold-out and held-out metrics | ❌ | ❌ | gap 2; ADR-22 |
| Unknown-feature handling | ✅ | ✅ | trainer excludes triads with incomplete fingerprints; ranker refuses undescribed titles (ADR-19) |
| BFGS listwise MLE with L2 | ✅ | ✅ | `§7.2` |
| Snapshot persistence (`user_model_snapshots`) | ✅ | 🟡 | `§13.1 taste_profiles`: no posterior, time layers, exceptions, held-out metrics, `calibratedAgainst` |
| Population prior source (Public Quality) | ❌ | ❌ | needs a licensed source ([DATA_LICENSING.md](DATA_LICENSING.md)) |
| Shared latent space (`§7.5`) | ❌ | ❌ | ADR-13; external seed license-blocked without GroupLens permission |
| FastAPI model service (`train`, `triads/select`, `score`, `taste-profile`) | ❌ | ❌ | ADR-25 |
| Python tests | ✅ | — | 26 tests (`test_ranker.py`, `test_training.py`, `test_enrichment.py`) |

## Recommendations

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `GET /profiles/:id/recommendations` (409 until a snapshot exists) | ✅ | ❌ | `§13.1`/`§14`: not persisted, no reason, no propensity, no `requestId` (gap 4) |
| Personal Fit from latest snapshot; dimension-mismatch guard | ✅ | — | |
| Four separate values, never merged | ✅ | ✅ | `§4.4`: Public Quality and Watchability are explicit `null` (no source), not fabricated |
| Three tracks | ❌ | ❌ | every result is `safe` (`§4.4`, ADR-8) |
| Candidate filtering | ✅ | ✅ | excludes `watched` and unfingerprinted only; `not_watched` stays a candidate (`§2.4 #3`) |
| Unknown dimensions | ✅ | ✅ | pool-mean imputation, `fingerprintCoverage`, one-band demotion (`§11.3`, ADR-19) |
| Confidence band (verbal, no %) | ✅ | ❌ | band from triad count (+ fingerprint-quality demotion) only (gap 5) |
| Internal rerank blend (`§10.3`, ADR-20) | ❌ | ❌ | |
| Attribution gate + `evidenceSource` | ❌ | ❌ | `§7.6`, `§12.2`, `§14` |
| Outcomes endpoint | ❌ | ❌ | `§13.1 outcomes` |
| Unit tests | ✅ | — | `recommendations.service.spec.ts`, 12 tests |
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
| Backend unit tests (6 files, 48 tests) | ✅ | — | re-run 2026-09-03 |
| Backend e2e: auth guard + IDOR over real HTTP + `postgres-test` (12 tests) | ✅ | ✅ | `§21.3` object-level authorization; re-run 2026-09-03 with all five migrations; not functional coverage |
| Functional API tests (titles, triads, recommendations) | ❌ | — | |
| Frontend tests | ❌ | — | |
| Python tests (26) | ✅ | — | re-run 2026-09-03 |
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
| "Haven't watched" never enters the taste loss | 🟡 (it never enters training, and `not_watched` is no longer excluded from candidates; the replacement control itself is not built) |
| Every result reproducible from event log + model version | 🟡 (training is deterministic; recommendations are not persisted and triads lack `modelVersion`) |
| Automated tests for triad, replacement, delete, export | ❌ |
| Backup restore drill documented | ❌ |
| No content/images shown without a known license status | 🟡 (no images shown; seeded text is `unknown`) |
| Metrics board separates click, watch, later ranking | ❌ |
| Model rollback + feature flags | ❌ |
| 300–500-film catalog with rights registry | ❌ (15 dev titles) |
| 80–150 Alpha users; accepters complete 20–30 triads | ❌ (no Alpha yet) |

---

**Next milestone (in order):** migration M1 with `shownAt`/`answeredAt`/`modelVersion`/idempotency on triads (gap 3) and the replacement endpoint + two UI buttons (ADR-17); then temporal hold-out in training (gap 2) and a training trigger through the FastAPI service (ADR-25); then M5 + persisted recommendations and outcomes (gap 4) so the post-watch loop can close; then consent/onboarding (gap 7) and the admin board; the enrichment worker fixes (gap 9) can run in parallel.

**Last updated**: 2026-09-03 · **Status**: core loop (auth → mark watched → rank → train by CLI → recommend) runs locally; six blueprint gaps and five security/code-quality audit findings closed today; nine blueprint-conformance pieces still fall short (list above); one moderate framework CVE deliberately left open pending a NestJS major-version migration.
