# Architecture Decision Records

**Status**: Living log. Every decision cites the blueprint section it serves (`BP §x.y`) or states that it is this repository's own engineering choice within the blueprint's constraints. A decision that contradicts the blueprint is a bug in this file. Product-level open questions that must be settled by experiment are **not** decided here — they are listed in `BP App. C` and [SPECIFICATION.md §11](SPECIFICATION.md).
**Version**: 3.2 — 2026-09-03 (ADR-1…13 rewritten for consistency; ADR-14…26 added to close the gaps found in the documentation audit; ADR-27…28 added from a code-quality/security audit; ADR-29 added for the NestJS 10→11 migration; ADR-30 added for the `@typescript-eslint`/`vitest` dev-tooling bump; ADR-31 added for the training temporal hold-out, gap 2; ADR-32 added for triad event completeness, gap 3; ADR-33 added for prediction display formatting; ADR-34 added for the H1 triad-reuse fix; ADR-35 added for the H2 deactivated-account fix; ADR-36 added for the H3 lazy-OpenAI-client fix; ADR-37 added for the H4 `ParseUUIDPipe` fix, updated to record its `TriadsController` caveat closed; ADR-38 added for the H5 `docker compose --project-directory` fix; ADR-39…41 added for the M2/M3/M11 fixes).

Format: **Context · Decision · Rationale · Consequences · Revisit when**.

---

## ADR-1 — Monorepo with npm workspaces

**Context.** Next.js frontend, NestJS backend, Python model service and shared types.
**Decision.** One repository: `apps/frontend`, `apps/backend`, `services/workers`, `packages/shared`; npm workspaces; Poetry for Python.
**Rationale.** One place for contracts and docs; refactors land everywhere; matches `BP §12` "start simple".
**Consequences.** Frontend and backend release together; the backend keeps a hand-synced copy of the fingerprint type because there is no project-reference build yet (see [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §2).
**Revisit when.** `BP §12.3` team/deploy-boundary signals appear.

## ADR-2 — PostgreSQL as the single store: relational + FTS + pgvector

**Context.** Need transactional event storage, alternate-title search and vector candidate retrieval (`BP §12.1`).
**Decision.** One PostgreSQL; full-text search over `localized_titles`; `pgvector` columns for embeddings; no separate search or vector service.
**Rationale.** One backup/compliance surface; joins between events, titles and models; adequate for the MVP catalog size.
**Consequences.** The `ankane/pgvector` image is already used, but embeddings are stored as `real[]` and no FTS index exists — migration M3/M7 in [SCHEMA.md](SCHEMA.md).
**Revisit when.** Search or similarity exceeds measured Postgres capacity (`BP §12.3`).

## ADR-3 — Plackett–Luce linear utility as the core ranker

**Context.** Learn interpretable taste from few listwise rankings (`BP §7.1`–`§7.2`).
**Decision.** Utility $s(u,m)=b(m)+\theta_u^\top\phi_m+p_u^\top q_m+\delta_{u,m}$; listwise PL likelihood; MLE/MAP with regularization; $b(m)$ in the code path from day one; $p^\top q$ from internal data only when enough exists; $\delta$ strongly shrunk.
**Rationale.** Interpretable weights → honest explanations; sample-efficient; fast; a well-studied model with fair baselines (`BP §16.3`).
**Consequences.** Non-linear interactions are not captured in MVP; person and cultural effects are separate shrunk blocks, not dense features.
**Revisit when.** A candidate model beats it on the `BP §16.5` gate.

## ADR-4 — The triad ranking is the only explicit preference question

**Context.** `BP §2.4 #2`, `§4.3`.
**Decision.** No star, 1–10, thumbs or like/dislike input anywhere, permanently. "Haven't watched" and "don't remember" are neutral replacement controls. Imported ratings are auxiliary, low-confidence, never solicited.
**Rationale.** Rankings avoid scale ambiguity; a single fixed question keeps the meaning of the answer stable; the blueprint makes this non-negotiable.
**Consequences.** The claim "a triad teaches more per minute than a pair or a single rating" is `BP` Gate 1 — an **experiment**, not an assumption; a triad is never treated as three independent pairwise observations (`BP §7.2`). Post-watch (2026-09-03, [UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md) §5.2): the surface after a watch takes only watch facts (`watch-events`) and outcomes (`outcomes`) as typed in [API.md](API.md); it never asks how the film compared with expectation, better or worse than expected, or any two-point liking question — those are ratings without stars. The loop closes as `BP §4.5` says: the watched title re-enters a later triad.
**Revisit when.** Never for the question itself; only UX mechanics (ties, partial order) via `BP App. C`.

## ADR-5 — PWA first; native apps only on evidence

**Context.** `BP §5.1`–`§5.2`.
**Decision.** Next.js PWA (installable, offline shell) for web and mobile. Native iOS/Android are built only if the PWA measurably fails a performance or push-notification need.
**Consequences.** The current frontend is a plain Next.js app without manifest or service worker — PWA work is a listed gap.
**Revisit when.** PWA telemetry proves the need.

## ADR-6 — LLM enrichment through OpenAI Responses API with Structured Outputs

**Context.** `BP §15`.
**Decision.** Background-only use: fingerprint extraction and post-hoc explanation rephrasing via the Responses API with JSON-Schema structured outputs; `store=false`; model id from configuration (`OPENAI_FINGERPRINT_MODEL`, `OPENAI_EXPLANATION_MODEL`); batch endpoints where available for bulk seeding; versioned re-extraction only on schema/model change.
**Rationale.** Structured output prevents invented dimensions; multilingual; one-time cost per title-version.
**Consequences.** No model name or price appears in docs (they change); the worker's Chat Completions call and its hard-coded default model are gaps. Costs are tracked per film and per 1,000 explanations against a phase budget (`BP §15.4`), not estimated here.
**Revisit when.** Cost or vendor risk justifies a distilled local extractor.

## ADR-7 — Individual profiles with a pseudonymous taste id

**Context.** `BP §2.4 #10`, `§13.1`, `§21.1`.
**Decision.** One person = one profile; `profiles.id` is the pseudonymous taste id; every event/model table references `profileId`, never `userId`. Group matching later merges rankings, never profiles.
**Consequences.** Exports and model jobs never touch account identity.

## ADR-8 — Three deterministic tracks with a declared exploration share

**Context.** `BP §4.4`, `§8.3`, `§14.1`.
**Decision.** Recommendations are split into `safe` / `discovery` / `outside_usual`; each track is deterministically ordered; exploration is a small, declared, logged share; every shown item logs `selectionPropensity`.
**Rationale.** Measurable, explainable, prevents the filter bubble without a full bandit.
**Revisit when.** Off-policy evaluation shows a bandit policy beats it on the `BP §16.5` gate.

## ADR-9 — Centralized training with explicit purpose consents

**Context.** `BP §21.1`, `§7.5`.
**Decision.** Models are trained server-side on pseudonymous events under purpose-specific consents. Pooled cross-profile training for the shared latent space is a **separate consent purpose** with an opt-out that does not remove individual personalization ([PRIVACY.md](PRIVACY.md)).
**Consequences.** Export, delete, reset and audit are product features, not afterthoughts.
**Revisit when.** Privacy requirements justify differential privacy or federated approaches.

## ADR-10 — Recommendations computed per request from precomputed model state, then persisted

**Context.** `BP §12.2`, `§13.1`, `§14.1`.
**Decision.** No LLM or training on the request path. Scores come from the latest snapshot via the model service; every served list is persisted (`recommendations` rows) so outcomes can close the loop. A Redis cache is added only if latency measurements require it.
**Consequences.** Redis is currently idle by design. Today's on-the-fly, unpersisted list is a gap.

## ADR-11 — REST + OpenAPI, single contract document

**Context.** `BP §12.1`, `§14`.
**Decision.** REST/JSON with an OpenAPI description generated from the NestJS controllers; the human-readable contract is [API.md](API.md) and nothing else lists endpoints.
**Rationale.** Simple, cacheable, easy to log and audit.

## ADR-12 — TypeORM with migrations only

**Decision.** `synchronize: false` in every environment; schema changes through generated migrations run by `npm run db:migrate`; the CLI data source is `apps/backend/src/data-source.ts`.
**Consequences.** [SCHEMA.md](SCHEMA.md) §1 must always equal the migration chain.

## ADR-13 — Shared latent space with per-profile calibration

**Context.** Estimating tens of correlated weights per profile from a handful of triads is an identifiability problem (`BP §7.5`).
**Decision.** Build one population factor space (~15–30 factors) from all profiles' triads and fingerprints, retrained on a schedule inside the model service; calibrate each profile onto it (MIRT/CAT-style); seed it before launch **only** from data licensed for commercial use — otherwise from Alpha-cohort data; gate any disclosed cross-user claim behind `BP §7.6` and the cohort gate in `BP §17.3`.
**Consequences.** MovieLens/Tag Genome are blocked without written GroupLens permission ([DATA_LICENSING.md](DATA_LICENSING.md)); pooled training needs its own consent purpose; feedback-loop controls apply to the retraining data (`BP §21.2`).

## ADR-14 — Names, languages and document governance

**Context.** The repository used four product names and two phase-numbering systems, and English docs drifted from the Arabic blueprint.
**Decision.**
- Normative document: [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md). [product_journey_ar.md](product_journey_ar.md) is a non-normative narrative companion. Every English document is derived and cites `BP §`.
- Working names: UI brand **Reel**; repo/package `movie`; Arabic formal title as in the blueprint. Branding is a later decision; nothing in code depends on the name.
- Product/vision writing is Arabic; engineering contracts are English; UI copy exists in both.
- Dates use the real calendar (the blueprint is dated 2026-09-02); every document carries a changelog.
- Document set and reading order are fixed in [README.md](README.md); no new doc without an entry there.
**Consequences.** Pre-blueprint English drafts were rewritten or deleted rather than annotated.

## ADR-15 — API versioning and envelope

**Decision.** Global prefix `/api`; the `BP §14` contract lives under `/api/v1`; current unversioned routes migrate in one step when the first v1 endpoint ships (the only client is in-repo). Responses carry `requestId`, `modelVersion`, `policyVersion`, `experimentId`; displayed reasons carry `evidenceSource`; retried mutations use `Idempotency-Key`; rankings are submitted as title ids, not indices.
**Rationale.** `BP §14` requires the envelope and idempotency; ids survive replacements.

## ADR-16 — Naming conventions

**Decision.** SQL tables `snake_case` plural (`user_title_state` is renamed to `user_title_states` in migration M1); SQL columns TypeORM-default `camelCase`, always quoted in raw SQL; JSON/TypeScript `camelCase`; Python `snake_case` internally with camelCase at the DB/JSON boundary; V2 feature keys `family.feature`; enum values `snake_case` strings (`not_watched`, `outside_usual`).
**Rationale.** Matches what the migrations already created; avoids a disruptive rename of every column.

## ADR-17 — Replacement semantics ("haven't watched" / "don't remember")

**Context.** `BP §4.3`, `§13.1`, `§14`; the two controls must be neutral and distinct.
**Decision.**
- `POST /triads/:id/replace { titleId, reason }` writes a `triad_replacements` row and swaps only that item; the triad gets a fresh `displayOrder`.
- `reason = not_watched` → `user_title_states.state` becomes `not_watched` (exposure unknown): the title stays a recommendation candidate and leaves the triad pool.
- `reason = not_remembered` → the title stays `watched` (it is not recommendable) and `triadEligible` becomes `false`.
- Neither reason enters any loss, prior or score. A triad exceeding `maxReplacementsPerTriad` (a policy parameter set before the Phase 0 test) is marked `skipped`. Replacement rate is a Phase 0/Alpha metric (`BP §17.1`, `§21.2`).
**Consequences.** Implemented 2026-09-03 (migration `AddTriadReplacements`, `TriadsService.replace()`, the two buttons on the triad screen). Observed on the first browser pass: because `displayOrder` is redrawn, a replacement reshuffles all three cards under a user who had already started ranking — correct for the position-bias log, costly for the user. Recorded as a `BP App. C` question ("display order after a replacement", blueprint v1.2) rather than changed here.
**Revisit when.** The `BP App. C` tie/weak-memory experiment reports, or its "display order after a replacement" question decides for keeping the in-progress order.

## ADR-18 — Phase naming

**Decision.** Use the blueprint's names only: Phase 0, Alpha, Closed Beta, Public Arabic Beta, Economics test, Controlled expansion. "Phase 1/2/3" and "Phase 1b" are retired; the old checklist is now [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## ADR-19 — Fingerprint V1 frozen; V2 by families; unknown ≠ zero

**Decision.** V1 = the 13 implemented numeric features + themes + confidence + provenance, frozen. V2 adds the missing `BP §6.1` families as namespaced per-feature rows with provenance. Missing values are unknown: excluded from training, mean-imputed with a confidence penalty for scoring, never cited in a reason. Model snapshots are pinned to a `fingerprintSchemaVersion`.
**Consequences.** Zero-filling in the current trainer and scorer is a bug to fix, not a convention.

## ADR-20 — Internal blend vs displayed separation

**Context.** `BP §10.3` allows an internal rerank blend of Public Quality and Personal Fit; `BP §4.4` forbids showing a merged number.
**Decision.** The rerank score $\lambda_u\cdot PQ+(1-\lambda_u)\cdot PF+\text{ContextFit}+\text{Exploration}$ decides what is shown; the API and UI expose only the four separate values plus a reason that names the dominant component ("widely praised; we don't know your taste yet" vs "fits your taste specifically"). $\lambda_u$ decays with reliable evidence.

## ADR-21 — Confidence band: interim heuristic, target criteria

**Decision.** The triad-count banding in `RecommendationsService` is an explicitly temporary heuristic. Before Alpha reporting, bands must come from the `BP §9.2` criteria (posterior stability, effective evidence, diversity, held-out prediction, fingerprint quality). A numeric probability is shown only after Brier/ECE calibration against confirmed post-watch outcomes.

## ADR-22 — Training and evaluation protocol

**Decision.** Per profile: temporal split with whole triads on one side; policy-reserved `holdout` triads never train; deterministic initialization; features frozen at the cutoff; held-out NLL/top-1/pairwise/Kendall τ stored on the snapshot; served weights refit on all non-reserved triads. Trigger: every 3 completed triads, on demand, or nightly. Any model version ships only through the `BP §16.5` gate against the baselines in `BP §16.3`.

## ADR-23 — OpenAI usage rules

**Decision.** Responses API only; `store=false`; zero-data-retention when the organization is eligible; model ids from configuration; prompts contain licensed evidence and schema only — never user ids, rankings, preferences or account data; retries with validation; every published output versioned. Documented in [PRIVACY.md](PRIVACY.md) §6 and [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §5.

## ADR-24 — Hosting undecided; requirements fixed

**Decision.** No cloud vendor is chosen. Required before Alpha regardless of vendor: CI with tests and migrations, staging, managed Postgres with PITR and encryption at rest, backups with a restore drill, TLS, secrets management, feature flags, model rollback, OpenTelemetry + Sentry + first-party analytics, cost monitoring, KSA/regional data residency preference ([PRIVACY.md](PRIVACY.md) §8).
**Rationale.** `BP §12.1`, `§18.1` set requirements, not vendors; earlier AWS/Vercel diagrams were speculation.

## ADR-25 — Backend ↔ model service interface

**Context.** `BP §12.1` names "Python + FastAPI/worker"; today the trainer is a CLI the backend never calls.
**Decision.** The Python service exposes HTTP (FastAPI): `POST /train` (async from the backend), `POST /triads/select` and `POST /score` (synchronous on the request path), `GET /taste-profile/{profileId}`, `POST /shared-space/retrain`. A Redis/BullMQ queue is introduced only when `BP §12.3` triggers fire (long imports/enrichment or training contention).
**Rationale.** Lets the backend invoke Python without queue infrastructure; keeps the monolith simple.

## ADR-26 — Authentication and authorization

**Decision.** JWT bearer tokens (as built) with refresh tokens added before Alpha; bcrypt passwords (library choice: ADR-27); per-endpoint throttling on auth; owner-only profile routes verified by the e2e IDOR suite on every change; `users.role` (`user`/`admin`) gates the internal board; staff actions are audit-logged; optional MFA later (`BP §21.3`).

## ADR-27 — Password hashing library: `bcryptjs`, not `bcrypt`

**Context.** `bcrypt` compiles a native module via `node-pre-gyp`, which pulls in `tar`; a 2026-09-03 dependency audit found this chain carried a critical path-traversal advisory (`tar <=7.5.20`, e.g. GHSA-34x7-hfp2-rc4v) with no fix available inside `bcrypt`'s current major version.
**Decision.** Use `bcryptjs` — a pure-JavaScript implementation of the same bcrypt algorithm, with the same `hash`/`compare` API — instead of `bcrypt`. No native compile step, so no `node-pre-gyp`/`tar` dependency chain at all.
**Rationale.** Removes a critical, unpatchable-without-a-major-bump vulnerability from the production dependency tree at zero API cost; this app's request volume does not need native `bcrypt`'s raw hashing throughput.
**Consequences.** Hashing/comparison is measurably slower per call than the native binding (acceptable at this scale, verified by the e2e auth suite over real HTTP); ADR-26's "bcrypt passwords" still holds exactly — same algorithm, same cost factor, different implementation.
**Revisit when.** Login-endpoint throughput becomes measurably bottlenecked by hash cost.

## ADR-28 — At most one active triad per profile, enforced by a DB constraint

**Context.** `TriadsService.getCurrent()` checks for an existing active triad and creates one when there is none; without a database-level constraint, two concurrent requests for the same profile can both pass that check and both insert an active row. Found by a 2026-09-03 code audit — the blueprint assumes one open ranking round per profile (`BP §4.3`) without specifying how to enforce it under concurrency.
**Decision.** A Postgres partial unique index, `IDX_triads_one_active_per_profile` on `triads(profileId) WHERE status = 'active'`, makes the invariant a database guarantee instead of an application-level assumption. `TriadsService.getCurrent()` catches the resulting unique-violation on the losing request and returns the winning row instead of erroring or silently creating a duplicate.
**Rationale.** A check-then-insert pattern in application code cannot be made race-free without either a DB constraint or an explicit lock; a partial unique index is the standard Postgres tool for "at most one row matching a condition" and costs nothing on the read path.
**Consequences.** Any future change to the triad lifecycle must keep `'active'` meaning "the one open round for this profile" — a second concurrently-valid "in progress" status would need its own partial index or a rethink of this constraint.
**Revisit when.** The triad lifecycle grows a second concurrently-valid in-progress status (e.g. simultaneous ranking modes).

## ADR-29 — NestJS 10 → 11, not 12

**Context.** `@nestjs/core <=11.1.17` carries CVE-2026-35515 (GHSA-36xv-jgw5-4q75, moderate: unsanitized newlines in Server-Sent Events `type`/`id` fields inside `SseStream._transform()` — this app has no SSE routes at all, so it was never actually reachable, but `npm audit` offered no non-major fix). `npm audit`'s suggested fix target was `@nestjs/core@12.0.1`, but the advisory's real patched version is `11.1.18`. Checking peer dependencies directly on npm: `@nestjs/throttler` (guards `/auth/login` and `/auth/register` against brute-force, `ARCHITECTURE_DECISIONS.md` ADR-26) has no published version whose `peerDependencies` include `@nestjs/common@^12.0.0` — its latest, `6.5.0`, only declares support up to `^11.0.0`.
**Decision.** Upgrade the `@nestjs/*` family to the 11.2.x line — `@nestjs/common`/`core`/`platform-express`/`testing` at `^11.2.3`; `@nestjs/config` `^12.0.0`, `@nestjs/passport` `^12.0.0`, `@nestjs/typeorm` `^12.0.1` (all three declare peer support for `@nestjs/common@^11.0.0`, so using their latest majors alongside Nest 11 is still inside their supported range); `@nestjs/throttler` unchanged at `^6.5.0` — instead of jumping to the 12.x line. `@nestjs/platform-express@11.x` already pulls Express 5 (the breaking change happens at 11, not 12), so targeting v11 costs the same migration effort as v12 while staying inside every dependency's officially-declared peer range.
**Rationale.** Same CVE fix, same Express-5 migration cost, zero unverified peer-dependency combinations — particularly for the rate limiter, which is a security control guarding the login endpoint, not a cosmetic dependency.
**Consequences.** `apps/backend/package.json` now declares `engines.node >= 20.19.0` (the strictest floor in the tree, from `@nestjs/typeorm@12.0.1`). A dedicated e2e test, `test/throttling.e2e-spec.ts`, proves the 6th `/auth/login` attempt within a minute still returns `429` under the new `@nestjs/throttler`/Nest-11 combination — verifying the exact compatibility question this decision turned on, not just that the app boots. `npm audit --omit=dev`: 3 moderate → 0.
**Revisit when.** `@nestjs/throttler` publishes a release whose `peerDependencies` include `@nestjs/common@^12.0.0`, or another dependency forces a 12.x requirement anyway.

## ADR-30 — Dev-tooling security bump: `@typescript-eslint` and `vitest`, minimal patched line

**Context.** Two backend devDependency chains carried `npm audit` findings unrelated to NestJS: `@typescript-eslint/eslint-plugin`/`parser@^6.19.0` pulled a `minimatch` ReDoS chain (high, reachable only by a developer linting their own machine — no attacker-controlled input); `vitest@^1.1.0` (resolved `1.6.1`) was vulnerable to CVE-2026-47429 (critical, GHSA-5xrq-8626-4rwp: arbitrary file read/RCE via the Vitest UI server, but only when `vitest --ui`/browser mode is run or `api.host` is exposed to the network — this repo's `test`/`test:cov`/`test:e2e` scripts only ever call plain `vitest run`, which starts no server, so it was never reachable as configured, though a developer running `--ui` manually to debug on Windows — this project's own dev platform — would trip it).
**Decision.** `@typescript-eslint/eslint-plugin`/`parser` bumped to `^8.69.0` (peer-compatible with the existing `eslint@8.57.1` and `typescript@5.9.3` — confirmed no ESLint flat-config migration is required). `vitest` bumped to `^3.2.7`, not `npm audit`'s suggested `4.1.11`: the advisory's earliest patched line is `3.2.6`, and jumping only to 3.x avoids an unforced second major bump (Vite 6→7/8, `@types/node` floor, Node engine floor) for no additional security benefit.
**Rationale.** Same reasoning as ADR-29 (bcryptjs, ADR-27) — take the smallest version step that actually closes the advisory, verified against this repository's specific dependency/config surface rather than assumed from the tool's own suggested "safe" target.
**Consequences.** `vitest.config.ts`/`vitest.e2e.config.ts` needed no changes (both only use the small, version-stable `defineConfig`/`plugins`/`test.include` surface). Full backend suite (unit + e2e) and lint re-verified green under the new versions. `npm audit`, full (including dev): 10 → 0.
**Revisit when.** A future `test:cov`/`--ui` workflow is actually adopted — worth re-confirming the vitest version in use still isn't in CVE-2026-47429's affected range before turning on any network-exposed vitest server.

## ADR-31 — Temporal hold-out in training (gap 2); `createdAt` stands in for `answeredAt`

**Context.** `training.py` fit on every completed triad and reported `pairwiseAccuracy` on that same set — an in-sample number, not a validation metric (`BP §8.3`, `§16.1`, `§17.2`; RANKING_ALGORITHM.md §6). Implementing §6's real protocol exactly needs `triads.answeredAt` for temporal ordering and `triads.holdout` for policy-reserved rows — neither column exists yet (gap 3, `IMPLEMENTATION_STATUS.md`).
**Decision.** Order completed triads by `createdAt` instead: with the one-active-triad-per-profile constraint (ADR-28), a profile's triads are created and completed in strict sequence, so creation order already equals answer order today — an accurate stand-in until gap 3 adds the real column, not an approximation of something else. `train_and_evaluate()` (services/workers/src/training.py) holds out the most recent `max(1, n // 5)` triads when `n ≥ 5` (§6 step 2, `floor(0.2n)` computed exactly via integer division since 0.2 = 1/5); below that, no held-out metrics are computed or persisted (`NULL`, not a metric over 0–1 triads). Two separate `PlackettLuceRanker` instances are used — one fit on the training slice only (for the held-out metrics), a fresh second one fit on all `complete_triads` for the actually-served weights (§6 step 6) — because `fit()` only zero-initializes when `self.weights is None`, so reusing one instance across two fits would silently break ADR-22's determinism guarantee for the second fit. `compute_nll()` (new, `ranker.py`) reports mean NLL per held-out triad, without the L2 term (that shapes the optimization objective, not the predictive fit being reported).
**Consequences.** Migration `AddHeldOutTrainingMetrics` adds `heldOutTriadCount`/`heldOutNll`/`heldOutPairwiseAccuracy` to `user_model_snapshots` (nullable; `pairwiseAccuracy` is kept, unchanged, as the in-sample number). Running this end-to-end against a real database — for the first time in this codebase's history, since no test exercises `train_profile()` itself, only the pure `fingerprint_vector()` — surfaced two independent, previously-undiscovered bugs that made `train-profile` fail on every real invocation: (1) psycopg2 has no default typecaster for a `uuid[]` column and returned it as raw Postgres text, silently iterated character-by-character wherever the code expected a list (fixed with `psycopg2.extras.register_uuid()`, with every id re-cast to `str` immediately after fetching so the rest of the module's `str`-keyed logic is unaffected); (2) `compute_nll()`'s return value stayed a numpy `float64`, which psycopg2 cannot adapt as a query parameter (fixed by casting to a native Python `float`). Both would have blocked *any* use of `train-profile` against a real database, hold-out or not.
**Revisit when.** ~~Gap 3 adds `triads.answeredAt`/`holdout`~~ — done same day (ADR-32): `train_profile()`'s query now orders by `COALESCE("answeredAt", "createdAt")`, real `answeredAt` for triads completed after that migration, the `createdAt` stand-in only for legacy rows with none recorded. Still open: exclude `holdout = true` rows once gap 3's `holdout` column and a policy that sets it exist (neither does yet).

## ADR-32 — Triad event completeness: `shownAt`/`answeredAt`/`modelVersion`, `Idempotency-Key`, ranking by title id (gap 3)

**Context.** `triads` had no `shownAt`/`answeredAt`/`modelVersion` columns (`BP §13.2`), `POST …/rank` had no idempotency key (`BP §14`, only a status guard), and `ranking` stored positions into `titleIds` rather than the title ids themselves, contrary to ADR-15's already-decided target.
**Decision.** Migration `AddTriadEventCompleteness` adds `shownAt`/`answeredAt`/`modelVersion`/`idempotencyKey` and converts `ranking` from `integer[]` to `uuid[]` with a data backfill (`titleIds[ranking[i]+1]` per row, Postgres arrays being 1-indexed). `shownAt` is set once, at triad creation; `answeredAt` once, at `rank()`; `modelVersion` stays `NULL` under `random-v1`, which selects no model — not a fabricated version string. `Idempotency-Key` is an optional request header (not a body field, matching the header-based convention `BP §14` implies): omitted, behavior is unchanged from before; if sent and a row with that key already exists for the *same* triad, that row's result is returned instead of erroring on "already submitted"; for a *different* triad, `409` (a real conflict — the client reused a key it must not have). `TriadsService.rank()` validates the submitted ranking is exactly the fetched triad's own three title ids (a check that needs the triad row, so it runs after the shape-only checks that don't).
**Rationale.** Header-based idempotency avoids polluting the ranking payload's schema and matches how most HTTP idempotency-key conventions work (e.g. Stripe); scoping the uniqueness/replay check to `(idempotencyKey)` globally rather than per-triad is what lets a concurrent duplicate retry be caught by the DB's own unique constraint (`23505`) and resolved the same way ADR-28 already resolved the analogous triad-creation race — return the winner's row, not an error.
**Consequences.** `packages/shared/src/types.ts`, `apps/frontend/app/lib/api.ts` and `docs/API.md`/`docs/SCHEMA.md` updated to match (`ranking: string[]`, not `number[]`). `RankScreen.tsx` mints a fresh `crypto.randomUUID()` per submit attempt and sends it as `Idempotency-Key`, so a network retry or double-click is safe. Verified over real HTTP against a real Postgres (new `test/triad-rank.e2e-spec.ts`: title-id ranking accepted, a foreign title id rejected, a retried request with the same key returns the same result) and manually in a browser (network tab showed the exact persisted row: real title UUIDs in `ranking`, `shownAt` < `answeredAt`, `modelVersion: null`, the generated `idempotencyKey`).
**Revisit when.** `holdout`/`correctsTriadId` (still-missing `triads` columns, same M1 plan step) are added — nothing here needs to change for that.

## ADR-33 — Prediction display: verbal confidence on every prediction surface; Personal Fit never a percentage

**Context.** `BP §7.2` states that a relative ranking gives no absolute "liked" anchor and that the product does not show «سيعجبك بنسبة 91%» until the number is calibrated on later watch outcomes; `BP §4.4` fixes what a recommendation shows ("سبب قوي، ثقة لفظية، وتوفر") and forbids merging the values into one percentage; `BP §9.3` defines the four visible confidence bands with their copy; `BP §2.4 #6`–`#7`. The 2026-09-03 mockup review ([UI_MOCKUP_REVIEW_2026-09-03.md](UI_MOCKUP_REVIEW_2026-09-03.md), §5.1) raised the question whether the `§7.2` sentence applies only to the triad screen. It does not: `§7.2` sits in the model chapter and constrains what the ranking's *output* may claim; the triad screen shows no prediction at all (SPECIFICATION §5.2: poster, title, year); and `§4.4` repeats the rule for the recommendation surface itself. What the blueprint leaves open is the display *format* of Personal Fit — the engineering choice recorded here.
**Decision.**
1. *Scope*: every surface that displays a prediction or an inference — recommendation cards, taste profile, work page, library ranking, post-watch and library banners, share cards. Not the triad screen, which displays none.
2. *Confidence* is always one of the four `BP §9.3` bands (`initial` / `likely` / `strong` / `inconclusive`, API `confidenceBand`), rendered as its copy in the UI language; never a number, a percentage, or a bar labelled with a number.
3. *Personal Fit* is displayed in a relative form only: a verbal level (high / medium / low), an ordinal position inside its track, or an unlabelled bar; never `NN%` and never a decimal that reads as a probability. [API.md](API.md) already types it `personalFit: number // ordinal score; never shown as a %`.
4. *Public Quality* and *Watchability* keep their native forms (a source-attributed score with its vote count; provider and market) in their own cells; no cell repeats a value shown elsewhere on the card, and nothing is merged (ADR-20).
5. Formatting goes through one shared helper per value (`formatConfidence`, `formatPersonalFit`) in the frontend so that a `%` cannot reach the screen by accident; the `§9.3` copy lives in the i18n dictionaries in both languages.
**Rationale.** The Plackett–Luce model learns "A above B above C"; its output is a relative utility, not a probability of liking. A percentage promises a calibration that does not exist before post-watch outcomes are collected ([RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §7: Brier, ECE), and after 3–5 seed triads the posterior is wide — "initial" is honest, "88%" is false precision. A broken numeric promise costs trust in the product, not only in the item.
**Consequences.** Recommendation, taste-profile and work-page components accept `confidenceBand` and a Personal Fit level, never raw scores. The mockup cells «ملاءمة 94%» and «ثقة التوقع 88%» are replaced by a level and a band. SPECIFICATION §5.2–§5.4 carry the UX contract. Implemented 2026-09-03 for the recommendations screen: `apps/frontend/app/lib/format.ts` (`formatConfidence`, `formatPersonalFit`, `formatNumber`) is the only path from a model value to the screen; `CONFIDENCE_BAND_COPY` and `TRACK_COPY` in `lib/copy.ts` carry the `§9.3`/`§4.4` copy in both languages; `RecommendationsScreen` (the home view) renders the four labelled cells and shows unknown as unknown.
**Revisit when.** The `BP App. C` "confidence display" experiment (SPECIFICATION §11 open-experiments table: verbal only vs calibrated % later) runs, after calibration against post-watch outcomes passes the `BP §16.5` gate with Brier/ECE reported per cohort. Until then the display is verbal.

## ADR-34 — Random policy excludes only the previous triad's titles, not every title ever ranked (H1)

**Context.** `TriadsService.getCurrent()` excluded every title that had ever appeared in *any* completed triad for the profile, so a title could enter at most one triad, ever: with W watched titles a profile got `floor(W/3)` triads for its entire lifetime (5 max on the 15-title seed catalog), the `likely`/`strong` confidence bands and the ≥5-triad hold-out (ADR-31) became unreachable in dev, and a user with exactly 3 watched titles who had just ranked them got "mark at least three films" back — a false message; they already had. Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H1), reproduced and confirmed independently before fixing.
**Decision.** `getCurrent()` now excludes only the immediately previous completed triad's three titles, not the full history. `BP §8.2`'s selection score treats repetition as a penalty term ("`-λr·Repeat`"), not a hard filter, and `BP §8.1` names "verification/refutation in an independent context" — a deliberate *re-test* of a past comparison — as one of six intended triad functions; a permanent ban contradicts both. `random-v1` has no scoring function to apply a soft, graduated penalty through, so "not the triad that was just completed" is its policy-appropriate stand-in until the adaptive policy (`BP §8.1`–`§8.2`, still gap territory) exists to compute a real `Repeat` term. The "fewer than 3 watched" and "3+ watched but the pool is temporarily empty because they were all just used" cases now get distinct messages instead of one misleading one.
**Consequences.** A title can be reused after just one intervening triad. `random-v1`'s other `BP §8.3` gaps (session limit/fatigue, reserved hold-out, director/language guard) are unchanged and still open.
**Revisit when.** The adaptive policy lands and can express repetition as a real scored penalty instead of a fixed one-triad lookback.

## ADR-35 — `AuthService.validateUser()` checks `active` (H2)

**Context.** `login()` already rejected a deactivated account (`§21.3` account takeover controls), but `validateUser()` — what `JwtStrategy` actually runs on *every other* guarded request — did not check `active` at all. A deactivated account's still-unexpired JWT kept full API access for the rest of its 7-day lifetime; only re-authenticating was blocked. Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H2), reproduced and confirmed independently before fixing.
**Decision.** `validateUser()` now returns `null` when `!user.active`, exactly as it already does for "no such user" — Passport treats a `null` return from a JWT strategy's `validate()` as authentication failure (`401`), so this reuses a mechanism that already existed rather than adding a new one.
**Consequences.** No behavior change for active accounts. A newly deactivated account is locked out of every guarded route on its very next request, not just at its next login.
**Revisit when.** ADR-26's refresh-token work lands — re-verify the refresh path also re-checks `active` and doesn't reintroduce this gap through a second code path.

## ADR-36 — `services/workers`: the OpenAI client is built lazily, not at import time (H3)

**Context.** `src/enrichment.py` built `openai.OpenAI(...)` at module import time, and `src/__init__.py` imported `enrichment` unconditionally — so importing the `src` package at all (including `python -m src.training`, which has no dependency on OpenAI) raised `openai.OpenAIError` on any machine without `OPENAI_API_KEY` set. [QUICKSTART.md](QUICKSTART.md) §Prerequisites already (correctly) documents that the core loop needs no OpenAI key; this bug just made that untrue in practice. Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H3), reproduced independently before fixing (`env -u OPENAI_API_KEY python -m src.training --help` raised before the fix, exits 0 after).
**Decision.** Two changes, both from the audit's suggested fix: (1) `src/__init__.py` no longer imports `enrichment` — callers reach it directly via `from src.enrichment import ...`, same as the existing test file already did; (2) `FilmEnrichmentWorker` builds its OpenAI client lazily, cached on first use in a private `_get_client()`, instead of module scope. A key is now only ever required at the point a call to OpenAI is actually about to happen.
**Consequences.** `import src`, `import src.training`, and `import src.enrichment` all succeed with no `OPENAI_API_KEY` set; so does constructing a `FilmEnrichmentWorker()`. The key is still required — unchanged — to actually call `generate_fingerprint()` / `generate_recommendation_explanation()`. No behavior change for the enrichment worker's real callers, which always have the key set before running it.
**Revisit when.** Never, barring a redesign of how workers share OpenAI clients across multiple worker instances (not needed today — one process runs one worker at a time).

## ADR-37 — `ParseUUIDPipe` on every UUID path param (H4)

**Context.** No controller validated that a UUID-shaped path param (`profileId`, `titleId`) was actually a UUID before handing it to TypeORM. Postgres rejected the cast with a raw SQL error, which Nest's default exception filter turned into an unhandled `500 {"statusCode":500,"message":"Internal server error"}` — the wrong contract (should be `400`) and a cheap noise generator for error monitoring. Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H4), reproduced independently before fixing (`GET /api/titles/not-a-uuid` and `GET /api/profiles/not-a-uuid` both returned `500`).
**Decision.** `@Param('id', ParseUUIDPipe)` on every UUID path param in `ProfilesController`, `UserTitleStateController`, `TitlesController`, `RecommendationsController` and (closed 2026-09-03, see below) `TriadsController` — a malformed id now fails validation before it ever reaches a service or the database, and Nest's `ParseUUIDPipe` throws `BadRequestException` (`400`) by default. Per-param, not a global pipe: explicit at each call site, and safe against a future route that legitimately takes a non-UUID param.
**Consequences.** `GET /titles/not-a-uuid`, `GET /profiles/not-a-uuid`, `PATCH /profiles/:id/titles/not-a-uuid/state`, `GET /profiles/not-a-uuid/recommendations`, `GET /profiles/not-a-uuid/triads(/current)`, `POST /triads/not-a-uuid/rank` and `POST /triads/not-a-uuid/replace` now all return `400` instead of `500`. No behavior change for well-formed ids (valid-but-nonexistent or valid-but-wrong-owner ids still resolve through the service layer to `404`, unchanged — verified against the existing IDOR e2e suite).
**Closed 2026-09-03.** `TriadsController`'s `:triadId`/`:profileId` params were originally left out — another session was concurrently editing that exact file (the triad-replacement feature) while this fix was first made. Closed once that work landed (`ADR-17`): reproduced live first (all four routes still `500`ing on a malformed id), then the same `ParseUUIDPipe` treatment applied, with 4 new e2e tests (33 e2e total) and a live before/after check against a temporary instance.
**Revisit when.** Never, barring a new route with a non-UUID path param that needs a different pipe.

## ADR-38 — `docker compose` invocations pin `--project-directory .` (H5)

**Context.** Every compose invocation (`npm run docker:up`/`docker:down` at the repo root, `test:e2e:up` in `apps/backend`, `docker-logs` in the `Makefile`) passed only `-f docker/docker-compose.yml`. Compose derives the *project directory* — where it looks for a `.env` to interpolate `${VAR}` references — from the directory of the first `-f` file when `--project-directory` isn't given, i.e. `docker/`, which has no `.env`. Only the repo root does (`POSTGRES_PASSWORD=dev_password_change_in_production`), so `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}` in `docker-compose.yml` silently fell back to `postgres` on `postgres`'s *first* `initdb` (a fresh clone) — a password the backend's own `.env` never uses, so `npm run docker:up && npm run db:migrate` fails authentication on a clean checkout. The `postgres-test` service is unaffected (its credentials are hard-coded, not interpolated). Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §2 H5), reproduced independently before fixing: `docker compose -f docker/docker-compose.yml config` resolved `POSTGRES_PASSWORD: postgres`; adding `--project-directory .` resolved the correct `dev_password_change_in_production` from the root `.env`.
**Decision.** Add `--project-directory <path-to-repo-root>` to every compose invocation: `.` where the script's cwd is already the repo root (root `package.json`, `Makefile`), `../..` where it's `apps/backend`. Chosen over moving `docker-compose.yml` to the repo root (the audit's alternative) to avoid touching an unrelated, working file layout for what is purely an invocation-flag fix.
**Consequences.** A fresh clone's first `docker:up` now initializes Postgres with the password the rest of the stack (backend, seed, CLI, trainer `.env`) actually expects, closing the authentication-failure trap. No effect on this development machine's already-running `movie-postgres` container — its data volume was already initialized (evidently under different, working conditions; see the audit) and Postgres passwords are fixed at `initdb` time, not re-read from `POSTGRES_PASSWORD` on every restart — so this fix was deliberately *not* forced onto the live container (no `docker compose up` was run for real; verified via `config` only) to avoid disrupting a concurrently-running session's database connections. Documented as a `QUICKSTART.md` §9 troubleshooting row with the manual recovery path (`down -v` + re-run) for anyone who already has a volume initialized under the old, broken behavior.
**Revisit when.** Never, barring a repo-layout change that moves `docker-compose.yml` (at which point re-derive the relative `--project-directory` paths, or drop the flag if the file moves to the root).

## ADR-39 — Catalog reads require auth; fingerprint/externalIds never leave the DB (M2)

**Context.** `TitlesController` (`GET /titles`, `GET /titles/search`, `GET /titles/:id`) had no guard, and `TitlesService` returned the raw `Title` entity — the full 13-dimension fingerprint plus provenance, and third-party `externalIds` (IMDb/TMDb/Wikidata) — to anyone, with only the global 60 req/min throttle in the way. `BP §21.3` lists API scraping with quotas as a threat model; `BP §5.3` says the work page shows only a *reviewed summary* of the fingerprint, never the raw dimensions; [DATA_LICENSING.md](DATA_LICENSING.md) treats the derived fingerprint as a licensed asset, not something to hand out for free. Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §3 M2), reproduced independently before fixing: an unauthenticated `curl` against the live dev server's `/api/titles` returned the full fingerprint and `externalIds` for every item.
**Decision.** Two changes. (1) `@UseGuards(AuthGuard('jwt'))` on `TitlesController` — the only client is this app, and every screen that reads titles already holds a token by the time it renders (behind `SessionProvider`), so this has no effect on the frontend. (2) `TitlesService.findAll()`/`findOne()` now `select` only the public columns (`id`, `internalId`, `titleEn`, `titleAr`, `description`, `releaseYear`, `genres`, `createdAt`, `updatedAt`) — `fingerprint` and `externalIds` are never fetched from Postgres at all, not merely stripped from the response afterward. A `PublicTitle = Omit<Title, 'fingerprint' | 'externalIds'>` type makes the guarantee visible at the type level. The frontend's own `Title` type (`api.ts`) already excluded both fields, so it needed no change.
**Consequences.** `GET /titles*` now `401`s without a token. An authenticated response never carries `fingerprint`/`externalIds`, proven by a real end-to-end round trip (e2e), not just a unit-level projection check. A reviewed fingerprint *summary* on the work page (`BP §5.3`) remains a separate, not-yet-built feature — this fix only closes the leak of the raw dimensions, it doesn't add the summary.
**Revisit when.** The work page's reviewed-summary feature is built — it will need its own, deliberately narrower field, not a relaxation of this guard.

## ADR-40 — `AuthService.register()` catches the concurrent-duplicate race (M3)

**Context.** `register()` did `findOne(email)` then `save(user)` with no guard between them — two concurrent registrations for the same email could both pass the `findOne` check before either saved, so the loser hit the raw `users.email` unique-constraint violation (`23505`) as an unhandled `500`, not the `409 Conflict` a duplicate email should produce (which the sequential case already got, via the `findOne` check). `ProfilesService` already catches `23505` the same way for its own unique constraint (`userId, name`) — `AuthService` was simply missing the equivalent. Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §3 M3), reproduced independently before fixing: two genuinely concurrent `POST /auth/register` requests for the same email, fired in parallel against the live dev server, came back `201` + a raw `500`.
**Decision.** Wrap `usersRepository.save(user)` in try/catch; on a `23505` unique-constraint error, throw `ConflictException('Email already registered')` — the same message and exception type the sequential `findOne` check already used, so callers see one consistent error regardless of which path caught the duplicate. Mirrors `ProfilesService.isUniqueConstraintError()` exactly (both now have their own private copy; not extracted to a shared helper for two call sites).
**Consequences.** A concurrent duplicate registration now reliably returns `409`, proven with a real two-in-flight-request e2e test (not simulated sequentially, which wouldn't exercise the race at all) plus a unit test that forces the `save()` rejection path directly. No behavior change for the non-concurrent case.
**Revisit when.** A third unique constraint needs the same treatment — worth extracting `isUniqueConstraintError` to a shared utility at that point, not before (rule of three).

## ADR-41 — Dev-stack ports bind to `127.0.0.1`, not all interfaces (M11)

**Context.** `docker-compose.yml` published Postgres (`5433`), Redis (`6379`) and `postgres-test` (`5544`) as `"<host>:<container>"` with no host IP, which Docker binds to `0.0.0.0` by default — reachable from any device on the same network as the developer's machine, not just `localhost`. None of these services have their own auth worth relying on for network-level exposure (Redis has none at all; Postgres's password is a dev-only placeholder). Found by an independent audit ([AUDIT_2026-09-03.md](AUDIT_2026-09-03.md) §3 M11).
**Decision.** Bind all three port mappings to `127.0.0.1:<host>:<container>` explicitly.
**Consequences.** Verified via `docker compose config` (resolves `host_ip: 127.0.0.1` for all three) and, more directly, on the actual `postgres-test` container recreated during this fix's own e2e run (`docker inspect` shows `HostIp: 127.0.0.1` baked into its real port binding). No effect on this machine's already-running `movie-postgres`/`movie-redis` containers until they are next recreated — deliberately not forced now, to avoid disrupting a concurrently-running session's database connections (same caution as ADR-38/H5).
**Revisit when.** A deployment topology needs these services reachable from another host (should not happen for local dev images with placeholder credentials — reach for a real network/VPN boundary instead of reopening these binds).

---

## Summary

| # | Decision | Serves | Revisit trigger |
|---|---|---|---|
| 1 | Monorepo | `BP §12` | team/deploy boundaries |
| 2 | Postgres + FTS + pgvector | `BP §12.1` | measured capacity |
| 3 | Plackett–Luce utility | `BP §7` | `§16.5` gate |
| 4 | Triad is the only explicit question | `BP §2.4 #2` | never (mechanics via App. C) |
| 5 | PWA first | `BP §5.2` | PWA telemetry |
| 6 | Responses API + structured outputs | `BP §15` | cost/vendor risk |
| 7 | Pseudonymous individual profiles | `BP §13.1`, `§21.1` | — |
| 8 | Three tracks + declared exploration | `BP §4.4`, `§8.3` | off-policy results |
| 9 | Centralized training, purpose consents | `BP §21.1` | privacy needs |
| 10 | Per-request scoring, persisted | `BP §12.2`, `§13.1` | latency |
| 11 | REST + OpenAPI, one API doc | `BP §14` | — |
| 12 | Migrations only | — | — |
| 13 | Shared latent space + calibration | `BP §7.5`–`§7.6` | licensing, cohort gate |
| 14 | Names & doc governance | audit | — |
| 15 | `/api/v1` + envelope + idempotency | `BP §14` | — |
| 16 | Naming conventions | — | — |
| 17 | Replacement semantics | `BP §4.3` | App. C experiment |
| 18 | Blueprint phase names | `BP §17` | — |
| 19 | Fingerprint V1/V2, unknown ≠ zero | `BP §6`, `§11.3` | — |
| 20 | Internal blend vs displayed values | `BP §4.4`, `§10.3` | — |
| 21 | Confidence band criteria | `BP §9` | calibration results |
| 22 | Training/eval protocol | `BP §16` | — |
| 23 | OpenAI rules | `BP §15.3`, `§21` | vendor policy changes |
| 24 | Hosting undecided, requirements fixed | `BP §12.1`, `§18.1` | Alpha prep |
| 25 | FastAPI model service, queue later | `BP §12.1`, `§12.3` | `§12.3` signals |
| 26 | Auth & roles | `BP §21.3` | — |
| 27 | `bcryptjs` over `bcrypt` | audit | throughput bottleneck |
| 28 | One active triad per profile (DB constraint) | `BP §4.3` | second in-progress status |
| 29 | NestJS 11, not 12 | audit | `@nestjs/throttler` v12 support |
| 30 | `@typescript-eslint`/`vitest` minimal patched bump | audit | `--ui`/`--cov` workflow adopted |
| 31 | Temporal hold-out in training; `createdAt` ~ `answeredAt` | `BP §16.1` | done (ADR-32); `holdout` still open |
| 32 | Triad event completeness: timestamps, `Idempotency-Key`, ranking by title id | `BP §13.2`, `§14`, ADR-15 | — |
| 33 | Prediction display: verbal confidence everywhere, Personal Fit never a % | `BP §4.4`, `§7.2`, `§9.3` | App. C confidence-display experiment after calibration |
| 34 | `random-v1` excludes only the previous triad, not full history (H1) | `BP §8.1`, `§8.2` | adaptive policy computes a real `Repeat` penalty |
| 35 | `validateUser()` checks `active` (H2) | `BP §21.3` | refresh-token work (ADR-26) |
| 36 | `services/workers` OpenAI client built lazily, not at import time (H3) | engineering choice | multi-worker client sharing, if ever needed |
| 37 | `ParseUUIDPipe` on every UUID path param (H4) | `BP §21.3` (input handling) | a new route needs a different pipe |
| 38 | `docker compose --project-directory .` on every invocation (H5) | engineering choice (dev environment correctness) | compose file moves in the repo layout |
| 39 | Catalog reads require auth; fingerprint/externalIds never fetched (M2) | `BP §21.3`, `§5.3`; DATA_LICENSING.md | work page's reviewed-summary feature |
| 40 | `register()` catches the concurrent-duplicate-email race (M3) | engineering choice (correctness) | a third unique constraint needs the same treatment |
| 41 | Dev-stack ports bind to `127.0.0.1` (M11) | engineering choice (dev environment correctness) | a deployment topology needs these reachable from another host |

## How to add a decision

1. Check it does not contradict a `BP §2.4` principle or an open `BP App. C` question.
2. Write Context · Decision · Rationale · Consequences · Revisit when; cite the `BP §`.
3. Update the affected contract doc ([API.md](API.md), [SCHEMA.md](SCHEMA.md), [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md), [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md)) in the same change.
4. Add the row to the summary table and a line to [README.md](README.md) if a new document was created.
