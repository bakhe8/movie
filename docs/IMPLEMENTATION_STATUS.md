# Implementation Status — code versus blueprint

> **Snapshot 2026-09-03, after the "close the six cheap gaps" change, a security/code-quality audit, a NestJS 10→11 migration, a dev-tooling security bump, a `SCHEMA.md` doc-sync fix, closing blueprint gaps 9, 2 and 3, an independent audit's H1 (triad pool exhaustion), H2 (deactivated account access), H3 (trainer required an OpenAI key), H4 (malformed path ids returned 500, partial) and H5 (`docker compose` never read the root `.env`) fixed, plus a frontend ↔ backend boundary assessment (documentation only), and the two replacement controls + rebuilt triad screen (ADR-17)** (base `093a1d3` on `main`).
> Verified for this revision: backend vitest suite **72 tests / 6 files pass**; backend e2e suite **25 tests / 4 files pass** over real HTTP against `postgres-test` with all eight migrations applied; Python pytest **39 tests pass** (+2 gap 9, +8 gap 2, +3 gap 3); `tsc --noEmit` clean for `apps/backend`, `apps/frontend` and `packages/shared`; `eslint` clean for both `apps/frontend` and `apps/backend`; `ruff` clean for `services/workers`; `npm audit` clean — 0 vulnerabilities, production and dev. (The counts include the triad-replacement feature, ADR-17, which landed in the same working tree the same day — its 12 unit and 3 e2e tests were run together with everything else.) `train-profile` was run **manually against the real local dev database** for the first time in this codebase's history (both the ≥5-triad and <5-triad paths, then again after gap 3's ranking-format change), which is how two previously-undiscovered, always-failing bugs in it were found and fixed (`uuid[]` parsing, a numpy-float leak into a psycopg2 parameter) — see the gap-2 table below. Gap 3 (title-id ranking, `Idempotency-Key`) was verified the same way as the manual browser pass below, freshly re-run today: register → Discover (mark 3 watched) → Rank (reorder, save) → confirmed via the network tab that the persisted triad carried real title-id `ranking`, `shownAt` < `answeredAt`, `modelVersion: null`, and the generated idempotency key; My list → Profile → language toggle → logout carried forward from an earlier snapshot, unaffected by today's changes. H1, H2, H3, H4 and H5 (a concurrent independent audit's findings, [AUDIT_2026-09-03.md](AUDIT_2026-09-03.md)) were all independently reproduced before fixing — H1 and H2 re-verified with new e2e tests over real HTTP, H3 by re-running `python -m src.training --help` with `OPENAI_API_KEY` unset before and after the fix, H4 by curling all four fixed routes against a temporary instance on the real dev DB before and after the fix (500 → 400), H5 by comparing `docker compose ... config`'s resolved `POSTGRES_PASSWORD` before and after adding `--project-directory` (`postgres` → `dev_password_change_in_production`), deliberately without running a real `up` against the shared dev container. The rebuilt triad screen (ADR-17) was verified in the in-app browser at 375×812 with touch emulation against a fresh backend build on a side port: pointer-driven reorder (lift, drop-slot highlight, release), the ↑/↓ path, «لم أشاهده» and «لا أتذكره» each through their inline confirmation, save → next round, the "no replacement left → round skipped" path, and the structured "mark one more film" message — each cross-checked in the network log and directly in the dev database (`triad_replacements` rows, `user_title_state.state`/`triadEligible`, triad `status`).
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
| `@nestjs/core`'s own moderate CVE-2026-35515 (unreachable in this app — no SSE routes — but `npm audit --omit=dev` still flagged it, 3 remaining vulnerabilities, all moderate) | `@nestjs/*` family upgraded 10 → **11.2.3** (not 12: `npm audit`'s suggested fix target was 12.0.1, but the advisory's real patched version is 11.1.18, and `@nestjs/throttler` — guarding `/auth/login`/`/auth/register` — has no published version declaring peer support for `@nestjs/common@^12.0.0`; ADR-29). `@nestjs/config`/`passport`/`typeorm` bumped to their latest majors (all declare peer support for `common@^11.0.0`); Express pulled to 5.x as part of the same bump (happens at Nest 11, not 12, so v11 costs the same migration effort as v12) | `npm audit --omit=dev`: 3 → **0**; new `test/throttling.e2e-spec.ts` proves the 6th `/auth/login` attempt in a minute still returns 429 (the exact compatibility question ADR-29 turned on); full suite green; a real `node dist/main.js` boot (not just the Nest testing module) verified DB queries, CORS and rate-limit headers over actual HTTP |

**Also closed, same day**: the 10 dev-tooling-only vulnerabilities above (1 critical, 7 high, 2 moderate — `@typescript-eslint/eslint-plugin`/`parser` via a `minimatch` ReDoS chain, unreachable except by a developer linting their own machine; `vitest` via CVE-2026-47429, a critical vitest-UI-server file-read/RCE that needs `vitest --ui`/browser mode or `api.host` exposed to the network — this repo's `test`/`test:cov`/`test:e2e` scripts only ever call `vitest run`, no server, so it was never reachable either, but cheap to close and easy to trip into later on a Windows dev box, which this one is). `@typescript-eslint/eslint-plugin`/`parser` bumped 6.21.0 → **8.69.0** (peer-compatible with the existing `eslint@8.57.1` and `typescript@5.9.3` — no ESLint flat-config migration needed); `vitest` bumped 1.6.1 → **3.2.7**, the minimal patched line (not `npm audit`'s suggested 4.1.11) since the advisory's earliest fix is 3.2.6 and this project's `vitest.config.ts`/`vitest.e2e.config.ts` only use the small, version-stable `defineConfig`/`plugins`/`test.include` surface. `npm audit` (full, including dev): 10 → **0**.

Nothing left open from this line of audit.

## Blueprint gaps hiding behind working code (fix before adding features)

These run today and contradict or fall short of the blueprint; a green test suite makes them invisible.

1. **Schema covers 8 of the target tables** — `recommendations`, `outcomes`, `watch_events`, `consents`, `privacy_requests`, `source_records`, `content_features`, `localized_titles`, `model_versions`, `experiments`, `audit_log`, `shared_latent_space_versions` are missing (`§13.1`, `§11.1`; [SCHEMA.md](SCHEMA.md) §2.4 migration plan M1–M7).
4. **Recommendations are never persisted** — no reason, no display propensity, no `experimentId`/`requestId` (`§13.1`, `§14`, `§14.1`). Without the log the post-watch loop (`§4.5`) cannot close and `§16` has nothing to read.
5. **Confidence band is a triad-count heuristic** — `§9.2`/`§9.3` require evidence diversity, held-out prediction success and fingerprint quality (ADR-21). The fingerprint-quality and held-out-prediction inputs now exist (gaps 6's one-band demotion, gap 2); the rest does not.
6. **Fingerprints carry no provenance and cover part of `§6.1`** — the 15 seeded rows leave `confidence` empty; families characters/ending/people/cultural context are absent (V1 is frozen; V2 planned — [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md)).
7. **Onboarding collects no market, platforms, or consent** (`§4.1`, `§13.1`, `§2.4 #9`).
8. **Not a PWA yet** — no web manifest or service worker (`§5.1`, ADR-5).

(Numbering keeps gaps 1, 4–8 as originally assigned; gaps 2, 3 and 9 are closed — see the tables below.)

## Closed on 2026-09-03 (gap 9 — enrichment worker)

| Gap | What changed | Proof |
|---|---|---|
| Enrichment worker diverged from `§15.3`/ADR-23: Chat Completions instead of the Responses API, no `store=false`, hard-coded default model id, Pydantic field `schema_version` vs TypeScript `schemaVersion`, no provenance fields | `enrichment.py` rewritten onto `client.responses.parse()`/`.create()` with `store=False`; `FilmEnrichmentWorker` now requires `OPENAI_FINGERPRINT_MODEL`/`OPENAI_EXPLANATION_MODEL` (raises if unset, no hard-coded default — added to `.env.example`); Pydantic field renamed `schemaVersion`; `generate_fingerprint()` stamps `generatedBy`/`generatedAt`/`modelVersion`/`extractorVersion`/`sourceIds` after the call (the model can't know these about itself) and `licenseStatus: 'unknown'`/`reviewStatus: 'unreviewed'` (honest placeholders — no `source_records`/review queue exists yet, gap 1) | `services/workers/tests/test_enrichment.py` rewritten against the new API shape, 2 new tests (provenance stamping, missing-config error); 28 Python tests pass |

Still open: `§15.4` acceptance tests, and the worker has still never run against the actual catalog (only unit-tested against a mocked client) — both need the rights registry from gap 1 first.

## Closed on 2026-09-03 (gap 2 — temporal hold-out in training)

| Gap | What changed | Proof |
|---|---|---|
| Model "validation" was in-sample: `training.py` fit on every completed triad and reported `pairwiseAccuracy` on that same set — not a validation metric (`§8.3`, `§16.1`, `§17.2`; ADR-22) | `train_and_evaluate()` (new, pure function in `training.py`) holds out the most recent `max(1, n // 5)` completed triads when `n ≥ 5` (RANKING_ALGORITHM.md §6), ordered by `createdAt` as an interim stand-in for the not-yet-existing `answeredAt` (ADR-31); fits a fresh `PlackettLuceRanker` on the training slice for held-out NLL (`compute_nll()`, new) and pairwise accuracy, then a second fresh instance on all triads for the actually-served weights, unchanged from before. Migration `AddHeldOutTrainingMetrics` adds `heldOutTriadCount`/`heldOutNll`/`heldOutPairwiseAccuracy` to `user_model_snapshots` (all `NULL` below the 5-triad floor) | 8 new Python tests (temporal split direction verified via a `fit()` spy, determinism, the below-floor path); **manually run against the local dev database end-to-end** with synthetic data (`docker exec` + `python -m src.training <profileId>`) for both the ≥5 and <5 cases, confirming the persisted row matches; 36 Python tests pass |

While verifying this end-to-end, found and fixed two independent, previously-undiscovered bugs that made `train-profile` fail on **every** real invocation, `git blame`-old: (1) psycopg2 has no default typecaster for a `uuid[]` column, so `triads."titleIds"` came back as raw Postgres array text and was silently iterated character-by-character everywhere the code expected a list — `psycopg2.extras.register_uuid()` now fixes the read, with every id re-cast to `str` right after so the rest of the module is unaffected; (2) `compute_nll()`'s result stayed a numpy `float64`, which psycopg2 cannot adapt as a query parameter — cast to a native `float`. Neither bug is unit-testable without a real database, which is exactly why `train_profile()` itself was never covered — only its pure `fingerprint_vector()` sub-function was.

## Closed on 2026-09-03 (gap 3 — triad event completeness)

| Gap | What changed | Proof |
|---|---|---|
| `triads` had no `shownAt`/`answeredAt`/`modelVersion` columns (`§13.2`); `POST …/rank` had no idempotency key (`§14`), only a status guard; ranking was index-based, not title-id-based (ADR-15's already-decided target) | Migration `AddTriadEventCompleteness` (ADR-32) adds the three columns plus `idempotencyKey`, and converts `ranking` from `integer[]` to `uuid[]` with a data backfill. `shownAt` set once at creation, `answeredAt` once at `rank()`; `modelVersion` stays `NULL` under `random-v1` (no model used — not fabricated). `Idempotency-Key` is an optional request header: a retry with the same key for the same triad replays the prior result instead of erroring; reusing one for a different triad is `409`. `TriadsService.rank()` now validates the submitted ranking is exactly the fetched triad's own three title ids. `packages/shared/src/types.ts`, `apps/frontend/app/lib/api.ts`, `RankScreen.tsx` (mints `crypto.randomUUID()` per submit) updated to match | 8 new backend unit tests (56 total); new `test/triad-rank.e2e-spec.ts` — title-id ranking accepted, a foreign title id rejected, a retried request with the same key returns the same result (16 e2e total); **manually verified in a real browser**: network tab showed the exact persisted row (real title UUIDs in `ranking`, `shownAt` < `answeredAt`, `modelVersion: null`, the generated `idempotencyKey`) |

`training.py`'s `ORDER BY` now uses `COALESCE("answeredAt", "createdAt")` (was `createdAt` alone, ADR-31's interim stand-in) — real `answeredAt` for triads completed after this migration, the old proxy only for legacy rows with none recorded. Still open: `triads.holdout`/`correctsTriadId` (same M1 plan step, [SCHEMA.md](SCHEMA.md) §2.4) — no selection policy sets `holdout` yet regardless.

## Closed on 2026-09-03 (H1 — triad pool exhaustion, from an independent audit)

Not one of the originally numbered gaps below — found by a concurrent independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H1), reproduced and confirmed independently before fixing (see ADR-34).

| Bug | What changed | Proof |
|---|---|---|
| `TriadsService.getCurrent()` excluded every title that had ever appeared in *any* completed triad for the profile — a title entered at most one triad, ever. With W watched titles: `floor(W/3)` triads for life (5 max on the 15-title seed catalog); the `likely`/`strong` confidence bands and the ≥5-triad hold-out (gap 2) were unreachable in dev; a user with exactly 3 watched titles who had just ranked them got "mark at least three films" back — false, they already had. Violates `§8.2` (`Repeat` is a penalty term, `-λr·Repeat`, not a hard filter) and `§8.1` (re-testing a past comparison is one of six intended triad functions) | `getCurrent()` now excludes only the immediately previous completed triad's three titles (ADR-34) — `random-v1` has no scoring function to apply `Repeat` as a soft penalty through, so a one-triad lookback is its policy-appropriate stand-in until the adaptive policy exists. The two failure cases now get distinct messages: "mark at least three" only when genuinely fewer than 3 are watched; "mark another film" when 3+ are watched but all were just used | 3 new backend unit tests (59 total) — older-triad titles stay eligible, no filter when there's no previous triad, the corrected message; new e2e test in `test/triad-rank.e2e-spec.ts` — 6 watched titles, three real ranking rounds over real HTTP, round 3 lands back on round 1's exact titles (would have 400'd before the fix); 17 e2e total |

While adding the e2e test, found and fixed an unrelated, pre-existing test-fragility bug in the gap-3 idempotency e2e test: it used a hard-coded `Idempotency-Key`, which collides with a leftover row from an earlier run because `postgres-test`'s `tmpfs` volume survives a container stop/start cycle (only a true recreate wipes it) — reproduced (a second consecutive `npm run test:e2e` failed with `409` instead of `201`) and fixed with a fresh `randomUUID()` per run.

---

## Closed on 2026-09-03 (H2 — deactivated account access, from an independent audit)

Not one of the originally numbered gaps below — found by a concurrent independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H2), reproduced and confirmed independently before fixing (see ADR-35).

| Bug | What changed | Proof |
|---|---|---|
| `AuthService.login()` already rejected `active=false` (`§21.3`), but `login()` isn't what runs on every other guarded request — `JwtStrategy.validate()` calls `AuthService.validateUser()`, which never checked `active` at all. A still-unexpired JWT issued before deactivation kept full API access for the rest of its 7-day lifetime; deactivating an account only blocked *new* logins, not the token already in the user's hand | `validateUser()` now returns `null` when `!user.active`, exactly as it already does for "no such user" — Passport turns that into a 401 the same way (ADR-35) | New unit test in `auth.service.spec.ts` (60 total) — a deactivated user's id resolves to `null`, not the safe-user projection; new e2e test in `idor.e2e-spec.ts` (18 total) — the same token that got 200 pre-deactivation gets 401 immediately after, no re-login involved |

---

## Closed on 2026-09-03 (H3 — trainer could not start without an OpenAI key, from an independent audit)

Not one of the originally numbered gaps below — found by a concurrent independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H3), reproduced and confirmed independently before fixing (see ADR-36).

| Bug | What changed | Proof |
|---|---|---|
| `services/workers/src/enrichment.py` built `openai.OpenAI(...)` at module import time, and `src/__init__.py` imported `enrichment` unconditionally — so `python -m src.training <id>`, which has no dependency on OpenAI at all, died at import on any machine without `OPENAI_API_KEY` set, before `load_dotenv()` in `train_profile()` ever ran. [QUICKSTART.md](QUICKSTART.md) §Prerequisites already (correctly) says the core loop needs no OpenAI key; this bug made that untrue in practice, and only worked on the original dev machine because a real key happened to be exported in that shell | `src/__init__.py` no longer imports `enrichment`; `FilmEnrichmentWorker` now builds its OpenAI client lazily on first real use (`_get_client()`, cached), not at import or construction time (ADR-36) | Reproduced before fixing: `env -u OPENAI_API_KEY python -m src.training --help` raised `openai.OpenAIError`; passes after. All 39 Python tests still pass (`test_enrichment.py` updated to mock the worker's lazily-built client instead of a module-level one); `ruff` clean |

---

## Closed on 2026-09-03 (H4 — malformed path ids returned 500, from an independent audit)

Not one of the originally numbered gaps below — found by a concurrent independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H4), reproduced and confirmed independently before fixing (see ADR-37). **Partial fix**: `TriadsController` was excluded because another session was concurrently editing that exact file (a triad-replacement feature) while this fix was made — its `:triadId`/`:profileId` params still 500 on a malformed id and are a tracked follow-up.

| Bug | What changed | Proof |
|---|---|---|
| No controller validated that a UUID-shaped path param (`profileId`, `titleId`) was actually a UUID before TypeORM handed it to Postgres — a malformed id (e.g. `not-a-uuid`) failed the SQL cast and Nest's default filter turned that into an unhandled `500 {"statusCode":500,"message":"Internal server error"}`. Wrong contract (should be `400`), and cheap noise for error monitoring | `@Param(name, ParseUUIDPipe)` added to every UUID path param in `ProfilesController`, `UserTitleStateController`, `TitlesController`, `RecommendationsController` (ADR-37). Per-param, not a global pipe, so a future non-UUID param stays unaffected | Reproduced live before fixing (`GET /api/titles/not-a-uuid` → `500`, `GET /api/profiles/not-a-uuid` → `500`) against a temporary instance on an alternate port against the real dev DB, not the other session's running server. 4 new e2e tests in `idor.e2e-spec.ts` (17 total) covering all four fixed routes; re-verified live after the fix, all four now `400`. Valid-but-wrong-owner ids still `404` via the service layer, unchanged (existing IDOR tests still pass) |

---

## Closed on 2026-09-03 (H5 — `docker compose` never read the root `.env`, from an independent audit)

Not one of the originally numbered gaps below — found by a concurrent independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H5), reproduced and confirmed independently before fixing (see ADR-38).

| Bug | What changed | Proof |
|---|---|---|
| Every `docker compose` invocation (`docker:up`/`docker:down` at the repo root, `test:e2e:up` in `apps/backend`, `docker-logs` in the `Makefile`) passed only `-f docker/docker-compose.yml`, so Compose derived its `.env`-lookup directory from the compose file's own directory (`docker/`, which has no `.env`) instead of the repo root (which does). `docker-compose.yml`'s `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}` silently fell back to `postgres` on a fresh volume's `initdb` — a password the backend's own root `.env` (`dev_password_change_in_production`) never uses, so a fresh clone's `npm run docker:up && npm run db:migrate` fails Postgres authentication. `postgres-test` is unaffected (hard-coded credentials, not interpolated) | Added `--project-directory .` (root scripts, `Makefile`) / `--project-directory ../..` (`apps/backend`) to every compose invocation (ADR-38) | Reproduced before fixing: `docker compose -f docker/docker-compose.yml config` resolved `POSTGRES_PASSWORD: postgres`. After the fix, both the root and `apps/backend` invocations resolve `POSTGRES_PASSWORD: dev_password_change_in_production` from the root `.env`, verified via `config` from each cwd. Deliberately **not** applied to this machine's already-running `movie-postgres` container (its volume was already initialized under different, working conditions, and a real `docker compose up` here would risk recreating a container a concurrent session may be using) — verified via `config` only, never `up`. `QUICKSTART.md` §9 gained a troubleshooting row with the manual recovery path for anyone already holding a volume initialized under the old behavior |

---

## Closed on 2026-09-03 (ADR-17 — the two replacement controls and the rebuilt triad screen)

The "next milestone" of the previous snapshot. Built as one change because the screen's spec (SPECIFICATION §5.2) requires the two neutral controls, and those need the endpoint. Prompted by [UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md) §6.

| Gap | What changed | Proof |
|---|---|---|
| No replacement endpoint; `not_watched`/`not_remembered` had no semantics in code; `triadEligible` did not exist; the triad screen used HTML5 drag-and-drop (does not fire on touch) and had one generic path for "can't rank this" (`§4.3`, `§13.1`, `§14`; ADR-17) | Migration `AddTriadReplacements`: `triad_replacements` (append-only, FK-cascaded, indexed on `triadId`) and `user_title_state.triadEligible`. `POST /api/triads/:triadId/replace { titleId, reason }` (`TriadsService.replace()`): owner + active + membership checks; picks a random eligible watched title outside the triad and outside the previous completed triad (the ADR-34 lookback); one transaction writes the state change (`not_watched` → state `not_watched`, `watchedAt` null; `not_remembered` → `triadEligible` false, watch kept), the event row, and the triad (same slot, fresh `displayOrder`); when nothing eligible is left or a 4th replacement is requested the event is still logged with `replacementTitleId: null` and the triad becomes `skipped`. `getCurrent()` now draws only from `triadEligible` titles and its 400 carries `{ reason: 'need_more_watched', needed }`. `RankScreen` rebuilt: pointer-event reorder (touch/pen/mouse, `touch-action: none` handle, live drop-slot highlight) plus ↑/↓ buttons as the keyboard path; two separate neutral buttons per card with an inline confirmation that states the swap is not an opinion; skeleton/blocked/failed states; the blocked state says exactly how many more films to mark; 44 px targets; CSS module. `api.ts` gains `replaceTriadItem` and `ApiError.details`; shared types updated | 12 new backend unit tests (72 total; the transaction's three writes, both reasons, the exclusion set, the skipped path, the limit, the eligibility filter, the structured 400); new `test/triad-replace.e2e-spec.ts` (3 tests, 25 e2e total) over real HTTP + Postgres; **manually verified in the browser** — see the snapshot note above |

Still open from the same ADR: `maxReplacementsPerTriad` is an interim constant (3) rather than a policy parameter set by the Phase 0 test; replacement rate is not yet on any metrics board (`§17.1`, `§21.2`); the triad still carries ids only (the client fetches the three titles separately — target contract returns items inline).

---

## Project setup

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Monorepo (Next.js, NestJS, Python, shared types) | ✅ | — | ADR-1 |
| Database schema (PostgreSQL) | 🟡 | ❌ | 8 tables, 8 migrations (the 5th–7th add constraints/columns; the 8th adds `triad_replacements` and `triadEligible`, ADR-17); target set and plan in [SCHEMA.md](SCHEMA.md) §2. pgvector image runs but `embeddings.vector` is `real[]` (`§12.1`) |
| Docker Compose: Postgres + Redis + disposable `postgres-test` | ✅ | — | |
| Environment template | ✅ | — | `FRONTEND_URL` not yet in `.env.example`; `OPENAI_FINGERPRINT_MODEL`/`OPENAI_EXPLANATION_MODEL` added 2026-09-03 (gap 9) |
| Documentation set | ✅ | — | reorganized 2026-09-03; index in [README.md](README.md) |
| Plackett–Luce ranker (Python) | ✅ | ✅ | `§7.2`: listwise event, not three pairwise comparisons; deterministic init; refuses undescribed titles |
| Enrichment worker (Python) | ✅ | 🟡 | structured output via the Responses API ✅ (gap 9 closed above); `§15.4` acceptance tests ❌; never run against the actual catalog, only unit-tested |
| Shared TypeScript types package | ✅ | ✅ | API-aligned types, compiles; not yet consumed by the apps (ADR-1) — see *Frontend ↔ backend boundary* |
| Makefile | ✅ | — | mirrors npm scripts; `poetry` assumed for Python |
| CI | ❌ | ❌ | `§12.1` |

## Frontend ↔ backend boundary (assessed 2026-09-03)

Verdict: **separated in responsibilities, not in contract.** Two processes, one JSON channel, no code shared across the line — but the contract between them is kept by hand in three copies and nothing at compile time enforces it. Assessed by reading both apps and grepping every import across the boundary; prompted by the same day's mockup review ([UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md)).

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| One channel: `fetch` + JSON to `NEXT_PUBLIC_API_URL`; CORS restricted to `FRONTEND_URL` | ✅ | — | `apps/frontend/app/lib/api.ts`, `apps/backend/src/main.ts`; the `/api` prefix and the URL are kept in step by a comment, not by shared config |
| No code import across the line (frontend ↛ backend or `packages/shared`; backend ↛ frontend) | ✅ | — | grep over both `src` trees, 2026-09-03 |
| Backend is the trust boundary: `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), owner checks, `SafeUser`, throttling | ✅ | ✅ | `§21.3`; IDOR and throttling e2e suites |
| Frontend holds no business logic: no scoring, sorting or filtering; only the UI reorder and the `Idempotency-Key` | ✅ | ✅ | `§12.2`: ranking and scores come from the backend; `ListScreen` renders title and description only |
| Backend holds no presentation: no views, no static files, no UI copy (only the `ar`/`en` language code) | ✅ | — | |
| Next.js server layer unused: every component is `'use client'`, no `app/api`, no server actions — no second backend hiding in the frontend | ✅ | — | a static export is possible; the PWA shell is gap 8 |
| Contract enforced at compile time | ❌ | — | three hand-kept copies: `packages/shared/src/types.ts` (consumed by nobody), backend entities + `title-fingerprint.type.ts` ("keep both copies in sync by hand"), `apps/frontend/app/lib/api.ts` ("mirrors backend shapes"); drift is caught only by the backend e2e suite and the frontend has no tests. Fix per ADR-11: emit the OpenAPI description from the controllers, generate the frontend client and types from it, delete the copies |
| Response DTO layer (entity shape ≠ public contract) | ❌ | ❌ | `§14`, ADR-15: controllers return TypeORM entities; a new column is public by default; the password hash is stripped by hand in `AuthService` only |
| Triad response carries its items | ❌ | — | see *Triads*: N+1 title fetches |
| Session token handling | 🟡 | — | JWT in `localStorage`, no refresh (ADR-26, before Alpha) — see *Authentication and accounts* |
| Independently deployable | ❌ | — | by decision (ADR-1: release together; compose has no app containers; `npm run dev` runs both) until `§12.3` signals |

## Authentication and accounts

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Register / login / JWT (`AuthService`, `AuthController`) | ✅ | 🟡 | `§13.1`: pseudonymous taste id exists (profile); no market/platforms; no `consents` at registration (`§2.4 #9`) |
| Password hashing (bcrypt cost 10), email validation, 8–64 char passwords | ✅ | — | |
| Auth throttling (5 req/min) + global 60 req/min | ✅ | — | `§21.3` |
| Deactivated accounts locked out of every guarded route, not just login | ✅ | ✅ | `§21.3`; H2 fix, ADR-35 — `validateUser()` (what every guarded request actually runs) now checks `active` too, not only `login()` |
| Refresh tokens | ❌ | — | ADR-26, before Alpha |
| Roles (`users.role`) for the admin board | ❌ | ❌ | `§5.1` |
| Unit tests | ✅ | — | `auth.service.spec.ts`, 10 tests |
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
| `GET /profiles/:id/triads/current` (creates or returns active) | ✅ | 🟡 | `§14 /triads/next`: watched-only ✅ (and `triadEligible` only, ADR-17), structured 400 `{ reason: 'need_more_watched', needed }` ✅, propensity + policy ✅, `shownAt`/`modelVersion`/`experimentId` columns exist (gap 3) though `modelVersion` is `NULL` under `random-v1`; no `requestId` (API envelope, target contract); target is `POST /api/v1/triads/next` (ADR-15) |
| `POST /triads/:id/rank` | ✅ | 🟡 | `§14`: optional `Idempotency-Key` header ✅ (gap 3, ADR-32); membership check ✅ (ranking must be the triad's own title ids); no time/window check; `§13.2`: `answeredAt`, `modelVersion` recorded ✅ |
| `GET /profiles/:id/triads` (completed) | ✅ | — | |
| Random policy `random-v1` | ✅ | 🟡 | ρ = 1/C(pool,3) ✅, `policyVersion` ✅, independent `displayOrder` ✅ (`§4.3`, `§8.3`); titles are reusable after one intervening triad, not excluded for life (H1, ADR-34); `§8.3` still unmet: session limit/fatigue, reserved hold-out, director/language guard |
| Adaptive policy (`§8.1` functions, `§8.2` score, `§7.5` Fisher targeting) | ❌ | ❌ | [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §9 |
| Ranking validation (title ids, ADR-15) | ✅ | ✅ | exactly 3 distinct ids matching the fetched triad's own `titleIds`; was index-based before gap 3 |
| Replacement (`not_watched` / `not_remembered`) | ✅ | ✅ | `POST /triads/:id/replace` per ADR-17 (closed above): swaps one item, fresh `displayOrder`, `triad_replacements` row, `not_watched` clears exposure, `not_remembered` clears `triadEligible`; never a preference signal; `skipped` when nothing is left. `metadata.replacements` stays reserved and unused — the table is the record |
| Training trigger from the backend | ❌ | ❌ | `§12.2`; ADR-25 |
| Unit tests | ✅ | — | `triads.service.spec.ts`, 35 tests |
| Frontend: instruction copy fixed to `§4.3` («حسب إعجابك الشخصي، من الأكثر إلى الأقل») | ✅ | ✅ | `lib/copy.ts` |
| Frontend: three cards, pointer-driven reorder (touch/pen/mouse) + ↑/↓ (keyboard path), position numbers, save, next round auto-loads | ✅ | 🟡 | rebuilt 2026-09-03 (ADR-17 table above); RTL ✅, 44 px targets ✅; touch reorder verified with dispatched `PointerEvent`s in the browser (the pane's own drag emulation hangs — noted in the snapshot); no licensed poster on the card (`§4.3`, none is licensed yet — text card); no critic scores ✅; progress/"model updated" still open below |
| Frontend: two replacement buttons + inline confirmation | ✅ | ✅ | `§4.3`: «لم أشاهده» / «لا أتذكره» per card, each confirming with copy that says the swap is not an opinion; skipped round → reload → the structured "mark one more film" message |
| Frontend: progress indicator, periodic "model updated" result | ❌ | — | `§4.3` "periodic, not necessarily per triad"; count open per `App. C` |
| Frontend: N+1 title fetches per triad | 🟡 | — | `RankScreen` fetches each title separately; target `/triads/next` returns items inline |
| Frontend tests | ❌ | — | no test setup |

## Model training (Python)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `PlackettLuceRanker.fit()` via CLI `train-profile` | ✅ | 🟡 | `§7.1`: `b(m)` present as zero placeholder ✅, `θᵀφ` ✅, `δ` wired end to end (persisted, read by `RecommendationsService`) but `bias_terms` is never populated by `fit()` — always `{}` today, so δ contributes nothing yet; `pᵀq` deferred (allowed); deterministic zero init ✅ (ADR-22); `§7.5` calibration absent. First real (non-mocked) run against a live database was 2026-09-03, verifying gap 2 below — see that row for two bugs it surfaced |
| Temporal hold-out and held-out metrics | ✅ | ✅ | gap 2 closed above; ADR-22, ADR-31; `RANKING_ALGORITHM.md` §6 |
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
| `triadEligible` flag (ADR-17) | ✅ | ✅ | migration `AddTriadReplacements`; cleared only by a `not_remembered` replacement; read by the triad pool query; never by training |
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
| Backend unit tests (6 files, 72 tests) | ✅ | — | re-run 2026-09-03; +8 with the gap-3 triad rework, +3 with the H1 title-reuse fix, +12 with the ADR-17 replacement endpoint |
| Backend e2e: auth guard + IDOR + rate limiting + triad ranking + triad replacement over real HTTP + `postgres-test` (4 files, 25 tests) | ✅ | ✅ | `§21.3` object-level authorization; re-run 2026-09-03 with all eight migrations; `test/throttling.e2e-spec.ts` (ADR-29), `test/triad-rank.e2e-spec.ts` (gap 3/ADR-32, H1/ADR-34) and `test/triad-replace.e2e-spec.ts` (ADR-17) added today; still not full functional coverage of every route |
| Functional API tests (titles, triads, recommendations) | ❌ | — | |
| Frontend tests | ❌ | — | |
| Python tests (36) | ✅ | — | re-run 2026-09-03; +2 with the gap-9 enrichment-worker fix, +8 with the gap-2 temporal hold-out |
| Offline evaluation protocol (`§16.1`), metrics beyond in-sample pairwise (`§16.2`), baselines (`§16.3`), acceptance gate (`§16.5`) | ❌ | ❌ | |
| Automated tests for triad, replacement, delete, export (`§18.1`) | 🟡 | ❌ | triad ranking and replacement; delete/export not built |
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
| "Haven't watched" never enters the taste loss | ✅ (never enters training; `not_watched` stays a recommendation candidate; the two replacement controls exist end to end and record exposure only, ADR-17) |
| Every result reproducible from event log + model version | 🟡 (training is deterministic; triads now carry `modelVersion` (`NULL` under `random-v1`, gap 3) but recommendations are still not persisted) |
| Automated tests for triad, replacement, delete, export | ❌ |
| Backup restore drill documented | ❌ |
| No content/images shown without a known license status | 🟡 (no images shown; seeded text is `unknown`) |
| Metrics board separates click, watch, later ranking | ❌ |
| Model rollback + feature flags | ❌ |
| 300–500-film catalog with rights registry | ❌ (15 dev titles) |
| 80–150 Alpha users; accepters complete 20–30 triads | ❌ (no Alpha yet) |

---

**Next milestone (in order):** `triads.holdout`/`correctsTriadId` and the rest of M1 ([SCHEMA.md](SCHEMA.md) §2.4; the replacement endpoint and its two UI buttons, ADR-17, shipped ahead of it); then a training trigger through the FastAPI service (ADR-25) and the real confidence-band criteria now that held-out metrics exist (gap 5); then M5 + persisted recommendations and outcomes (gap 4) so the post-watch loop can close; then consent/onboarding (gap 7) and the admin board. Gaps 2, 3 and 9 are done.

**Last updated**: 2026-09-03 · **Status**: core loop (auth → mark watched → rank → train by CLI → recommend) runs locally. Closed today: the original six cheap gaps, five security/code-quality audit findings, the NestJS 10→11 migration (ADR-29), a dev-tooling security bump (ADR-30), blueprint gaps 9 (enrichment worker), 2 (temporal hold-out, ADR-31) and 3 (triad event completeness, ADR-32), and an independent audit's H1 (permanent title exclusion across triads, ADR-34), H2 (deactivated accounts kept API access via `validateUser()`, ADR-35), H3 (`python -m src.training` couldn't start without an OpenAI key, ADR-36), H4 (malformed path ids returned 500, `ParseUUIDPipe` added everywhere except `TriadsController`, ADR-37, partial) and H5 (`docker compose` never read the root `.env`, `--project-directory` added to every invocation, ADR-38) findings, and the two replacement controls with the rebuilt, touch-first triad screen (ADR-17). `npm audit` clean end to end. Six blueprint-conformance gaps still fall short: 1 (schema), 4 (recommendations not persisted), 5 (confidence band), 6 (fingerprint provenance/V2), 7 (onboarding), 8 (PWA) — list above. Assessed today: the frontend ↔ backend boundary — separated in responsibilities, not in contract (section above).
