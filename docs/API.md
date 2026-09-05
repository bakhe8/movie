# API Contract

**Status**: Derived from blueprint `§14` (endpoint list), `§12.2` (attribution gate), `§13.2` (event shape). Two layers are documented separately and must not be confused:

- **§1 Implemented today** — exact routes that exist in `apps/backend` as of 2026-09-03. Unversioned, under the global prefix `/api`.
- **§2 Target contract** — the `BP §14` surface under `/api/v1`, with the fields every response must carry. This is what new work implements; §1 routes migrate into it.

Versioning decision (ADR-15): the global prefix stays `/api`; the blueprint's `/v1/...` paths become `/api/v1/...`. The move happens in one step once the first `§2` endpoint lands, because the only client is the in-repo frontend.

Conventions: JSON; `camelCase` fields; UUID ids; timestamps ISO-8601 UTC; errors use NestJS's `{ statusCode, message, error }` shape; auth is `Authorization: Bearer <JWT>`.

---

## 1. Implemented today (`/api`, unversioned)

Verified against `apps/backend/src/modules/**` on 2026-09-03. Every profile-scoped route checks that the profile belongs to the caller and returns `404` otherwise (proven by `apps/backend/test/idor.e2e-spec.ts`).

| Method | Path | Auth | Body / query | Response | Notes |
|---|---|---|---|---|---|
| GET | `/api` | — | — | `{ message }` | |
| GET | `/api/health` | — | — | `{ status: 'ok', catalog: { titles } }` | Railway's health-check path and the post-deploy smoke test. **503** `{ status: 'degraded', reason: 'empty_catalog' }` when `titles` is empty (a release that never seeded, ADR-90 — never a fresh install), **503** `{ status: 'down', reason: 'database_unreachable' }` when the database does not answer |
| POST | `/api/auth/register` | — | `{ email, password(8–64), firstName?, lastName? }` | `{ access_token, refresh_token, token_type: 'Bearer', expires_in, user }` | 5 req/min per IP; the access token lives `JWT_ACCESS_TTL` (15 min by default, ADR-26), the refresh token `JWT_REFRESH_TTL_DAYS` and is stored only as a SHA-256 hash |
| POST | `/api/auth/login` | — | `{ email, password }` | same pair as register | 5 req/min per IP; every login starts a new refresh-token family |
| POST | `/api/auth/refresh` | — | `{ refresh_token }` | `{ access_token, refresh_token, token_type, expires_in }` | 10 req/min per IP. Rotation: the presented token is revoked (`rotated`, `replacedById`) and a new one issued in the same family. A revoked token presented again = reuse: the whole family is revoked (`reuse_detected`), an `audit_log` row is written, 401. Expired or unknown → 401. A deactivated account → 401 and its family is closed (`deactivated`; H2 stays closed at this door too) |
| POST | `/api/auth/logout` | JWT | `{ refresh_token? , all? }` | `{ revoked }` | revokes that refresh token (`logout`) or, with `all: true`, every live one of the account (`logout_all`); the current access token stays valid until it expires (why `JWT_ACCESS_TTL` is short); audited |
| POST | `/api/auth/password-reset/request` | — | `{ email }` | `202 { accepted: true }` | ADR-85. **Always 202**, whether or not the address has an account — the route must not confirm membership (`BP §21.3`). Sends a single-use link (default 30 min) through the configured `Mailer`; today's only transport writes it to the server log. Auth-throttled |
| POST | `/api/auth/password-reset/confirm` | — | `{ token, password }` | `200 { reset: true }` | ADR-85. Spends the token once, sets the password under the same 8–64 rule sign-up uses, and revokes every live refresh token for the account. `400 { reason: 'reset_token_invalid' }` for an unknown, used, revoked or expired token — the four are deliberately indistinguishable. Auth-throttled |
| GET | `/api/auth/profile` | JWT | — | account fields | account, not taste profile |
| POST | `/api/profiles` | JWT | `{ name, preferredLanguage?, market?, platforms? }` | Profile | unique `(userId, name)` → 409; `market` is ISO 3166-1 alpha-2, `platforms` ≤ 20 identifiers ≤ 40 chars — display and Watchability only, never a taste input (`BP §4.1`) |
| GET | `/api/profiles` | JWT | — | Profile[] | caller's profiles only |
| GET | `/api/profiles/:profileId` | JWT | — | Profile | |
| PATCH | `/api/profiles/:profileId` | JWT | `{ name?, preferredLanguage?, preferredAppearance?, market?, platforms? }` | Profile | `preferredAppearance`: `cinema`, `premiere`, or `montage` (ADR-113); only submitted fields are updated; the onboarding screen writes `market`/`platforms` here |
| DELETE | `/api/profiles/:profileId` | JWT | — | 204 | cascades events/models of that profile only |
| GET | `/api/titles` | — | `?query&page&limit(≤100)` | `{ items, page, limit, total, totalPages }` | ILIKE on `titleEn`/`titleAr`; Arabic folding on both sides (hamza forms of alef → ا, ة → ه, ى → ي, tashkeel/shadda/dagger alef/tatweel stripped from query **and** column) so «احلام» finds «أحلام» and «الرسالة» finds «الرِّسالة»; `unaccent` on `titleEn` so «Amelie» finds «Amélie»; alternate titles matched through `localized_titles` with the same folding (ADR-106; nothing populates that table yet) |
| GET | `/api/titles/search` | — | same as above | same | alias of `GET /api/titles` |
| GET | `/api/titles/starter` | JWT | `?limit(≤30, default 12)` | Title[] | the diverse starter list of `BP §4.2`: a deterministic round-robin across primary genres (largest genre first, newest first within a genre) over the first 300 titles by name; no taste input |
| GET | `/api/titles/:titleId` | JWT | — | Title (public columns; never `fingerprint`/`externalIds`) + `posterUrl \| null` + `posterSource: { name, attribution } \| null` (ADR-82, updated 2026-09-05: composed from `posterPath` whenever one is stored, with TMDB's credit as `posterSource`; both null only when the title has no poster — no rights-registry gate during the free period, DATA_LICENSING.md §0 — on **every** route that returns a title) + `publicQuality: { value, votes, sources: [{ source, value, scale, votes, capturedAt, attribution }] } \| null` + `descriptionSource: { name, attribution, url } \| null` | Public Quality per source, never averaged (`BP §10.3`; IMDb since 2026-09-04, ALPHA_PLAN 5.3); the description's credit from the rights registry (5.1); both `null` when nothing displayable, never 0. Also `fingerprintSummary: { key, level: 'low'\|'mid'\|'high' }[] \| null` — the human-reviewed `content_features` dimensions as levels, never the raw number, `null` when none is reviewed (ADR-81) |
| PATCH | `/api/profiles/:profileId/titles/:titleId/state` | JWT | `{ state: watched\|not_watched\|watchlist\|interested, watchedOn?, notes? }` | UserTitleState | never accepts a rating; `watchedOn` (ADR-104) is a plain `'YYYY-MM-DD'` the caller supplies (never a timestamp) — omitted leaves an already-set day alone (PATCH semantics, like `notes`), and `state` other than `watched` clears it. `watchedAt` stays in the response as a legacy timestamp; nothing renders it |
| GET | `/api/profiles/:profileId/watched-titles` | JWT | — | UserTitleState[] (+title) | |
| GET | `/api/profiles/:profileId/watchlist` | JWT | — | UserTitleState[] (+title) | |
| GET | `/api/profiles/:profileId/triads/current` | JWT | — | `Triad & { state: 'ready' }` \| `{ state: 'need_more_watched', needed, message }` | returns the active triad or creates one (`random-v1`) from watched titles that are still `triadEligible`. `needed` is the real remainder (`3 - watched`), never a constant; resting the previous round's titles is a preference, so a profile whose only three watched films were just used gets a `verify` round (worth nothing toward activation, ADR-99) instead of a wall (ADR-108). Both answers are **200**: the not-ready case is a designed state, not an error (ADR-81) — 4xx here means 401 or a profile that is not yours. `state: 'ready'` rides along on the triad object, so a reader of the triad fields is unaffected |
| GET | `/api/profiles/:profileId/triads` | JWT | — | Triad[] | completed only |
| POST | `/api/triads/:triadId/rank` | JWT | `{ ranking: string[3] (titleIds, best first), sessionId? }`, header `Idempotency-Key?` (UUID) | Triad | 400 if already completed or `ranking` isn't exactly this triad's own title ids; a repeated `Idempotency-Key` for the same triad returns the original result instead of erroring; reusing one for a different triad is `409`. Since 2026-09-04 (ADR-68), for each ranked title that was previously recommended, also writes an `outcomes` row (`type: 'ranked_later'`, `triadId`, `rankPosition`) — not on an idempotent replay, only on a fresh completion |
| POST | `/api/triads/:triadId/replace` | JWT | `{ titleId, reason: 'not_watched' \| 'not_remembered' }` | Triad | the two neutral replacement controls (ADR-17): swaps only that item for a random other eligible watched title (never one from the previous completed triad) and redraws `displayOrder`; writes a `triad_replacements` row; `not_watched` sets the title's state to `not_watched` (stays a recommendation candidate), `not_remembered` keeps it watched but clears `triadEligible`; no preference signal. 400 if the triad is not active or `titleId` is not one of its three. Returns `status: 'skipped'` (event still logged with `replacementTitleId: null`) when nothing eligible is left or a 4th replacement is requested on one triad — the client then calls `GET …/triads/current` again |
| POST | `/api/profiles/:profileId/train` | JWT | — | `{ jobId, status, created }` (202) | enqueues a durable `training_jobs` row (ADR-100) and dispatches to the model service (ADR-25) at once; `created: false` when an identical, still-non-terminal request already existed. 400 `{ reason: 'need_more_triads', needed: 1 }` before any completed round; 409 `{ reason: 'paused' }` when `profiles.pausedAt` is set; 503 `{ reason: 'model_service_disabled' }` only when `MODEL_SERVICE_URL` is unset — a model-service blip is no longer a 503 here, the queue's backoff absorbs it. The same request is made automatically, without this route, after the 3rd completed triad and every 5th after that (`TRAINING_FIRST_TRIAD_COUNT` / `TRAINING_EVERY_N_TRIADS`) — a TypeORM subscriber on `triads.status → 'completed'` |
| GET | `/api/profiles/:profileId/training` | JWT | — | `{ state, job, learningRounds, verificationRounds, completedTriads, nextTrainingAt, latestSnapshot }` | `state` (ADR-100, read from the durable `training_jobs` row, never a live call): `disabled` (no `MODEL_SERVICE_URL`) \| `paused` \| `idle` \| `queued` \| `running` \| `succeeded` \| `failed` (`unknown` is defined but unreachable in practice now — the queue's backoff absorbs what used to surface as it); `job` is the row shaped like the model service's own job (`id` is the durable job id, not the model service's; `errorKind: 'invalid'` = nothing trainable yet, `'error'` = a failure, sanitized; `result` carries the held-out metrics, never weights); `learningRounds`/`verificationRounds` split completed rounds by what they are evidence of (ADR-108): a repeat set is `verify` (ADR-99) and counts toward no threshold, so ten rounds over the same three films report as `learningRounds: 1, verificationRounds: 9`; `completedTriads` is an alias of `learningRounds`, kept for existing readers. `nextTrainingAt` = the learning-round count at which the next automatic training fires; `latestSnapshot` = `{ modelVersion, trainingTriadCount, createdAt }` or `null`. What the UI polls while it shows "building your profile" after the third round |
| GET | `/api/privacy/requests` | JWT | — | PrivacyRequest[] | the caller's export/delete/reset requests, newest first (PRIVACY.md §5) |
| POST | `/api/privacy/export` | JWT | `{ password }` | the portable copy (JSON, `meta.format: 'movie-export-v1'`): account, consents, per profile: title states with title refs, triads with replacements, model snapshots (weights keyed by feature), recommendations with outcomes, watch events; plus the request list | identity re-verification with the current password → 403 `{ reason: 'reverification_failed' }` (audited); synchronous at Alpha scale (API.md §2.2's async artifact path deferred); writes a `privacy_requests` row (`done`) and an `audit_log` row |
| POST | `/api/privacy/delete` | JWT | `{ password }` | PrivacyRequest (202) | schedules the purge `executeAfter = now + PRIVACY_DELETE_SAFETY_DAYS` (PRIVACY.md §10), pauses every profile meanwhile (`profiles.pausedAt`), idempotent while one is scheduled; `PRIVACY_DELETE_SAFETY_DAYS=0` purges at once. The purge (a sweep every `PRIVACY_SWEEP_INTERVAL_MS`) deletes the user and cascades profiles, title states, triads/replacements, snapshots, recommendations/outcomes, watch events and consents; the request row survives as a tombstone (`userId` → `NULL`, `subjectKey` = SHA-256 of the user id) with the purged counts in `executionLog`, plus an `audit_log` row (`privacy.delete.executed`, actor `system`) |
| POST | `/api/privacy/delete/:requestId/cancel` | JWT | — | PrivacyRequest | until it runs: `status: 'cancelled'`, the profiles it paused resume; 409 `{ reason: 'not_cancellable', status }` afterwards; 404 for another user's request |
| POST | `/api/privacy/reset` | JWT | `{ profileId }` | `{ request, deleted: { recommendations, triads, modelSnapshots } }` | "reset taste" (PRIVACY.md §5): deletes that profile's triads (and replacements), model snapshots, recommendations (and outcomes); keeps the account, consents, other profiles and the watch history; 404 for a profile the caller does not own; `privacy_requests` row (`reset`, `profileId`) + `audit_log` row |
| GET/PATCH/POST | `/api/admin/**` | JWT + role `admin` | see below | see below | the internal board (`BP §5.1`, SPECIFICATION §5.5). `AdminGuard` after the JWT guard: 401 anonymous, 403 `{ reason: 'admin_required' }` for a signed-in non-admin. Every write leaves an `audit_log` row naming the acting admin. Routes: `GET titles?query&missing=fingerprint\|v2\|license&page&limit` (rows with `hasFingerprint`, `hasV2`, worst `licenseStatus` across `source_records`, `unreviewedFeatures`) · `GET titles/missing-fingerprints` · `GET titles/:id` (full row incl. `fingerprint`/`externalIds`) · `GET titles/:id/provenance` (rights rows + every feature row, current and superseded, grouped by extractor) · `PATCH titles/:id` (source data only: `titleEn`, `titleAr`, `description`, `releaseYear`, `genres`, `originalLanguage`, `externalIds`; never the fingerprint) · `POST titles/:id/source-records` and `PATCH source-records/:id` (rights registry, `BP §11.1`) · `GET content-features?reviewStatus&titleId&featureKey&extractorVersion` (review queue, current rows only) · `GET content-features/sample?size&extractorVersion` (`BP §15.4` random sample) · `POST content-features/:id/review { reviewStatus, correctedValue?, note? }` (a corrected value becomes a new `human-review-v1` row that supersedes the extracted one; originals are never edited) · `GET models` (registered `model_versions` with snapshot stats per version, plus versions seen in `user_model_snapshots` but never registered) · `POST models` · `PATCH models/:version { active?, evalReport?, thresholds? }` (exactly one active version; activating another is the rollback of `BP §18.1`, and serving honours it since ADR-76) · `GET experiments` (with arm counts) · `GET triads/latest?limit` (pseudonymous profile ids only) · `GET users?query` · `PATCH users/:id { active?, role?, reason? }` (an admin cannot change themself, 403 `self_change`; deactivation revokes every live refresh token) · `GET privacy-requests?type&status` · `GET audit-log?actorUserId&action&resource&resourceId` · `GET mail-outbox` (the mail outbox, ADR-97: counts per status and the last 20 rows with kind, status, attempts, next attempt, last error and provider id — never the address or the body) · `GET training-jobs?limit` (ADR-100: the durable training queue, same shape as `mail-outbox` — counts per status and the recent rows with attempts, `errorKind`, sanitized `lastError`, next attempt, pseudonymous `profileId` only) · `GET readiness` (ADR-100: `{ database: { ok }, catalog: { titles, threshold, ok }, fingerprintCoverage: { published, total, percent, ok }, modelService: { configured, reachable, ok } }` — whether training can plausibly succeed right now, not any one profile's own eligibility). The first admin is granted on the server: `npm run admin:grant -- <email>` (audited as `operator`) |
| GET | `/api/admin/metrics` | JWT + role `admin` | `?days(1–3660, default 30)&from&to(ISO-8601)&excludeDomains=demo.local,judge.local` | `{ window, accounts, funnel, triads, recommendations, model, catalog, privacy, daily }` | the metrics board (`BP §18.1`, ARCHITECTURE.md §8). Read-only SQL over the event rows, nothing pre-aggregated. `funnel`: cohort of accounts registered in the window followed to now — registered → onboarded (market set) → watched ≥3 → first triad → three triads → trained → shown a result → returned (activity on two distinct days), each with its share of the previous step. `triads`: completed/skipped/active, replacements and rate, answer seconds (`shownAt`→`answeredAt`: median, p90, mean), by policy. `recommendations`: shown rows, requests, profiles, by track, by band, and **click, watch and later ranking as separate counts and rates** (`clicked`, `saved`, `opened_provider`, `dismissed_not_relevant`, `watched`, `ranked_later` over shown), `rankedLaterPositions` (0 = the recommended title won its triad), median hours from shown to watched. `model`: snapshots in window, profiles with a snapshot, by model version, latest snapshot per profile by evidence bucket (`lt5`, `5-9`, `10-19`, `20+`), mean held-out pairwise accuracy. `catalog`: titles, with fingerprint, with V2, with a known license, unreviewed features. `privacy`: requests by type, pending deletions, audit rows. `daily`: one row per day (registrations, triads completed, recommendations shown, watched outcomes). Accounts whose email is in `excludeDomains` are left out of every account/profile-based number |
| GET | `/api/profiles/:profileId/library/ranking` | JWT | — | LibraryRankingItem[] | the profile's watched, fingerprinted titles ordered by the latest snapshot (`BP §5.3` "ترتيب شخصي"); positions only, the score never leaves the server (ADR-33); same band/demotion rules as recommendations; 409 until a snapshot exists; `[]` when nothing is watched |
| GET | `/api/profiles/:profileId/recommendations` | JWT | `?limit(≤50, default 10)` | `{ state: 'ready', items: Recommendation[] }` \| `{ state: 'pending', needed, training }` \| `{ state: 'paused' }` \| `{ state: 'model_outdated' }` | always **200** for a profile the caller owns (ADR-81): `pending` before the first training run (`needed` = rounds still to answer; `training` = `{ state, jobId, errorKind, completedTriads, nextTrainingAt }`, the same `state` values as `GET …/training`, so that once `needed` is 0 the screen can say whether the rounds are queued, running, failed — `errorKind: 'invalid'` = the ranked titles lack published fingerprints — never requested (`idle`), or on a server with no model service (`disabled`)), `paused` under PRIVACY.md §4's `pause_all`, `model_outdated` for a snapshot predating a fingerprint-dimension change. Excludes watched titles only (`not_watched` stays a candidate); unknown fingerprint dimensions imputed with the pool mean, never zero; persists one `recommendations` row per result, created with `shownAt: null` — being shown is a separate event, recorded by `POST .../recommendations/impressions` (ADR-58, ADR-110); each item carries its own `recommendationId` (ADR-110 — the `recommendations` row it is, which every reported outcome names), `publicQuality`/`publicQualityScore` (ADR-78) and `availability` — always `'unknown'` while no availability data source exists (AVL-01), never `'unavailable'` and never a 0, with `watchabilityScore` staying `null` beside it; neither the market nor any platform is an input to Personal Fit (contract test in `recommendations.service.spec.ts`) |
| POST | `/api/profiles/:profileId/recommendations/impressions` | JWT | `{ recommendationIds: uuid[] }` (1–50) | `{ recorded }` | ADR-110: the separate fact that recommendations reached a screen. Stamps `shownAt` on the caller's own rows that have none — first write wins, so `recorded` is 0 for a list already reported; ids belonging to another profile are ignored, and a profile that is not the caller's is 404. **200**, not 201: it creates nothing |
| GET | `/api/profiles/:profileId/readiness` | JWT | — | `{ rounds, ordinalModel, semanticProfile, recommendation, availability }` (the last four each a `CapabilityReadiness`) | ADR-103 (remediation brief §5.1): four capabilities a single "trained or not" flag used to conflate. Each is `{ status, reason, action, publishedAt, modelVersion }` — `status` one of `not_ready\|eligible\|queued\|processing\|ready\|failed\|stale`; `reason`/`action` stable codes (`insufficient_triads`/`rank_more_triads`, `insufficient_eligible_candidates`/`watch_more_titles`, `model_service_disabled`, `processing_paused`/`resume_processing`, `insufficient_fingerprint_coverage`, `model_service_error`/`retry`, `fingerprint_schema_changed`/`rank_more_triads`, `no_availability_data_source`), never prose. `semanticProfile` equals `ordinalModel` today (one fit produces both); `recommendation` equals `ordinalModel` unless the model is ready but the candidate pool is empty; `availability` is always `not_ready`/`no_availability_data_source` until AVL-01 lands a real source. Each capability also carries `confidenceBand` (ADR-110): the model's own band, `null` where there is no usable model and always `null` for `availability` — a recommendation's own band can be lower, since it is demoted per title by that title's fingerprint coverage. `rounds` (ADR-108) = `{ learningRounds, verificationRounds, firstTrainingAt, nextTrainingAt, watchedTitles, suggestedWatchedTitles }` — where the profile stands, counted server-side so no screen keeps its own tally; `watchedTitles` is the `triadEligible` watched set the rounds are drawn from, and `suggestedWatchedTitles` (9) is what keeps rounds new (three films make exactly one set). Read by the ranking screen and the profile screen |
| GET | `/api/consents` | JWT | — | Consent[] | the caller's own rows only |
| PUT | `/api/consents` | JWT | `{ consents: [{ purpose, version, granted }] }` | Consent[] | upserts per `(userId, purpose, version)`; `purpose` restricted to the six live purposes in [PRIVACY.md](PRIVACY.md) §3 — `email_recommendations`/`taste_card_sharing` (reserved for later) are rejected; `revokedAt` set/cleared on decline/re-grant, `grantedAt` preserved across a revoke (ADR-60). Kept unversioned rather than at the `§2.2` target's `/api/v1/consents` path — ADR-15 migrates the whole API to `/api/v1` in one step, not per-endpoint |
| POST | `/api/profiles/:profileId/watch-events` | JWT | `{ titleId, watchedAt?, watchedOn?, recommendationId?, source: in_app\|import\|manual, audioLanguage?, subtitleLanguage?, provider? }` | WatchEvent | closes BP §4.5's post-watch loop (ADR-66): links the `recommendations` row the client names in `recommendationId` (scoped to this profile and title, ADR-110) or, without one, the most recent row for the same (profile, title), if any, and writes a matching `outcomes` row (`type: 'watched'`); either way also upserts the title's `UserTitleState` to `watched` (reusing `PATCH …/state`'s own logic; `watchedOn` is the client's own local day per ADR-104, falling back to the UTC date of `watchedAt`) so it becomes triad-eligible again; never accepts a rating, `does not imply liking` (whitelist-validated, unknown fields 400). Kept unversioned like every other route built this session rather than the `§14`/`§2.2` target's `/api/v1/watch-events` path (with `profileId` in the body, not the URL) — ADR-15 |
| POST | `/api/profiles/:profileId/analytics/events` | JWT | `{ name, properties?, occurredAt? }` | `202`, empty | first-party product analytics (ADR-86, ALPHA_PLAN 7.5). `name` must be one of the ten `AnalyticsEventName` values — anything else is `400`, since the table is a set of known counters, not a free-form log. **Always `202`, even when nothing is written**: the row is skipped when the profile's `analytics_first_party` consent is not granted, when the profile belongs to another user, or when no property survives sanitising — answering differently would leak the consent state and whether a profile exists. `properties` keeps only finite numbers, booleans and tags of at most 32 characters, at most 12 keys; everything else is dropped rather than stored. `occurredAt` is clamped to now if it is in the future or more than 7 days old. Only events the server cannot observe belong here — `triad_answered` and `watch_marked` are written by the services that already handle those actions and are not accepted from a client |
| POST | `/api/recommendations/:recommendationId/outcome` | JWT | `{ type: saved\|clicked\|dismissed_not_relevant\|opened_provider }` | Outcome | ADR-67, closing gap 4's write side in full except `ranked_later` (needs `TriadsService.rank()` to notice a re-ranked recommended title, separate scope). No `profileId` in the path — ownership comes from the recommendation's own `profileId`, same id-only pattern as `POST /triads/:triadId/rank`; unknown id and another user's recommendation both 404 identically (IDOR-safe). `watched`/`ranked_later` rejected by whitelist validation, not just undocumented — those are system-observed, never caller-reported. Append-only: acting twice writes two rows, not an overwrite |

Response shapes in use (from `apps/frontend/app/lib/api.ts`, which mirrors the entities):

```ts
Profile { id, userId, name, preferredLanguage: 'ar'|'en', preferredAppearance: 'cinema'|'premiere'|'montage'|null, market: string|null /* ISO 3166-1 alpha-2 */, platforms: string[], createdAt, updatedAt }
Title { id, internalId, titleEn, titleAr, description|null, releaseYear|null, genres|null, externalIds?, fingerprint? }
UserTitleState { id, profileId, titleId, state, watchedAt|null, triadEligible /* false after 'not_remembered' (ADR-17) */,
                 importedRating|null, ratingSource:'import'|null, notes|null, updatedAt, title? }
Triad { id, profileId, titleIds: string[3], displayOrder: string[3]|null, items: Title[3] /* in displayOrder; public columns only */,
        ranking: string[3]|null /* titleIds, best first */,
        shownAt|null, answeredAt|null, modelVersion|null /* null under the random policy, which uses no model */, idempotencyKey|null,
        policyVersion|null, selectionPropensity|null, experimentId|null, sessionId|null, metadata|null, status,
        setHash, purpose: 'learn'|'verify', countsTowardActivation /* ADR-99: verify re-asks a set already completed, counts toward nothing */, createdAt }
Recommendation { title, personalFitScore, publicQualityScore|null, watchabilityScore|null,
                 confidenceBand: 'initial'|'likely'|'strong'|'inconclusive',
                 fingerprintCoverage: number /* 0–1 share of known dimensions; < 1 costs one band (ADR-19) */,
                 track: 'safe'|'discovery'|'outside_usual', modelVersion,
                 reason: { features: [{ key: FingerprintDimension, direction: 'higher'|'lower' }] /* ≤ 2, only dimensions that lifted the score (BP §9.4); [] when none did */,
                           evidenceSource: 'individual' } }
LibraryRankingItem { title, position /* 1-based, best fit first */, confidenceBand, fingerprintCoverage, modelVersion,
                     reason /* same shape as Recommendation.reason, relative to the watched set */ }
Consent { id, userId, purpose, version, granted, grantedAt, revokedAt|null }
```

Known gaps versus `BP §14` are tracked row-by-row in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); the target below is the fix.

---

## 2. Target contract (`/api/v1`)

### 2.1 Common envelope (`BP §14`)

Every response that depends on a model or policy carries:

```ts
{
  requestId: string,        // server-generated, logged with the event
  modelVersion: string|null,
  policyVersion: string|null,
  experimentId: string|null,
  ...payload
}
```

Every displayed reason (recommendation reason, taste-profile item) carries `evidenceSource: 'individual' | 'population_enriched'` decided by the attribution gate (`BP §7.6`, `§12.2`). In MVP the gate only ever returns `individual`.

Idempotency: state-changing calls that may be retried by the client (`rank`, `replace`, `watch-events`, `imports`) accept `Idempotency-Key` (UUID). A repeated key returns the original result with `200` and does not create a second event.

### 2.2 Endpoints

| Method | Path | Purpose | Acceptance rules (`BP §14`) | Replaces |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | create account + first consents | body adds `consents: [{ purpose, version }]`, `uiLanguage`, `market`, `platforms[]` (`BP §4.1`) | `/api/auth/register` |
| POST | `/api/v1/auth/login` | login | unchanged | `/api/auth/login` |
| GET/POST/PATCH/DELETE | `/api/v1/profiles[...]` | taste profiles | unchanged; profile gains `market`, `platforms` (display/availability only) | `/api/profiles` |
| GET | `/api/v1/titles?q=&page=&limit=` | search incl. alternate titles | Postgres FTS over `localized_titles` (`BP §5.1`, `§12.1`); results carry `licenseStatus` for poster display | `/api/titles` |
| GET | `/api/v1/titles/:titleId` | work page | fingerprint summary (reviewed features only), Public Quality and Watchability separate (`BP §5.3`) | `/api/titles/:titleId` |
| POST | `/api/v1/triads/next` | return a valid triad for this profile | only confirmed-watched items; returns `selectionPropensity`, `policyVersion`, `displayOrder`, `shownAt`; creates the triad event; `409` with `{ reason: 'need_more_watched', needed }` if the pool is too small | `GET …/triads/current` |
| POST | `/api/v1/triads/:id/rank` | save one complete ranking | checks membership, `answeredAt` window, not already answered; requires `Idempotency-Key`; stores `answeredAt`, `modelVersion` | `/api/triads/:id/rank` |
| POST | `/api/v1/triads/:id/replace` | replace one item | body `{ titleId, reason: 'not_watched' \| 'not_remembered' }`; writes `triad_replacements`; updates exposure per ADR-17; no preference signal; returns the updated triad with the new item and a fresh `displayOrder` | `/api/triads/:triadId/replace` (implemented 2026-09-03; the target adds the envelope, `Idempotency-Key` and items inline) |
| POST | `/api/v1/watch-events` | record a watch (and edition) | body `{ profileId, titleId, watchedAt?, source: 'in_app'\|'import'\|'manual', audioLanguage?, subtitleLanguage?, provider? }`; does not imply liking; if the title was recommended, links an `outcomes` row | `POST /api/profiles/:profileId/watch-events` (implemented 2026-09-03, ADR-66; `profileId` in the URL not the body, matching every other route this session, not the target's exact shape) |
| GET | `/api/v1/taste-profile?profileId=` | tendencies, confidence, unknown areas, exceptions | no uncalibrated percentages; each item has brief evidence, `confidenceBand`, `evidenceSource`, `modelVersion` | new |
| GET | `/api/v1/recommendations?profileId=&track=&limit=` | three tracks | each item: `personalFit`, `publicQuality`, `watchability`, `confidenceBand`, `reason { text, features[], evidenceSource }`, `availability[]`, `selectionPropensity`, `recommendationId`; the call persists a `recommendations` row per item | `GET …/recommendations` |
| POST | `/api/v1/recommendations/:id/outcome` | implicit outcome | body `{ type: 'saved'\|'clicked'\|'dismissed_not_relevant'\|'opened_provider' }`; no thumbs/stars | `POST /api/recommendations/:recommendationId/outcome` (implemented 2026-09-04, ADR-67; no `profileId` in either shape — ownership via the recommendation itself) |
| POST | `/api/v1/library/imports` | start a user-file import | multipart CSV; type/size check; explicit consent flag; async status at `GET /api/v1/library/imports/:id`; raw file deleted per retention (`BP §21.3`) | new |
| POST | `/api/v1/privacy/export` | portable copy | async; `GET /api/v1/privacy/export/:id` for status; identity re-verification | new |
| POST | `/api/v1/privacy/delete` | delete account, events, derivatives | announced safety period; execution log; backup handling per [PRIVACY.md](PRIVACY.md) | new |
| POST | `/api/v1/privacy/reset` | reset taste only | deletes triads, replacements, snapshots, recommendations for the profile; keeps account | new |
| GET/PUT | `/api/v1/consents` | list / update purpose consents and restrictions | one row per purpose per version (`BP §13.1`); restrictions: `no_pooled` = revoke `personalization_pooled`, `pause_all` = set `profiles.pausedAt` ([PRIVACY.md](PRIVACY.md) §4) | new |
| GET | `/api/v1/admin/**` | internal board | role `admin` required; endpoints: `titles/missing-fingerprints`, `titles/:id/provenance`, `models`, `experiments`, `triads/latest`, `profiles/:id/score-test` (`BP §5.1`) | new |

### 2.3 Shapes

```ts
// POST /api/v1/triads/next → 201
{
  requestId, modelVersion, policyVersion, experimentId,
  triad: {
    id, profileId,
    items: [{ titleId, title: { id, titleAr, titleEn, releaseYear, posterUrl|null } }] /* length 3, in displayOrder */,
    displayOrder: string[3], shownAt, selectionPropensity, status: 'active'
  }
}

// POST /api/v1/triads/:id/rank
// request: { ranking: string[3] /* titleIds, best first */, sessionId? }   header Idempotency-Key
// response 200: { requestId, triad: { ...as above, ranking, answeredAt, status: 'completed' } }

// GET /api/v1/recommendations → 200
{
  requestId, modelVersion, policyVersion, experimentId,
  tracks: {
    safe: RecommendationItem[], discovery: RecommendationItem[], outside_usual: RecommendationItem[]
  }
}
RecommendationItem {
  recommendationId, title: {...},
  personalFit: number,                // ordinal score; never shown as a % (ADR-33)
  publicQuality: { value: number|null, votes: number|null, sources: string[] } | null,
  watchability: { available: boolean|null, providers: [{ name, market, audio[], subtitles[], checkedAt }] } | null,
  confidenceBand: 'initial'|'likely'|'strong'|'inconclusive',
  reason: { text: string, features: [{ key, direction: 'higher'|'lower' }], evidenceSource: 'individual'|'population_enriched' },
  selectionPropensity: number
}

// GET /api/v1/taste-profile → 200
{
  requestId, modelVersion,
  core: [{ key, direction, confidenceBand, evidence: string, evidenceSource }],
  conditional: [...same shape...],
  unknown: [{ key, whyUnknown }],
  exceptions: [{ titleId, tagged: boolean }],
  drift: { detected: boolean, since: string|null }
}
```

Ranking is sent as title ids (not indices), on both the unversioned route and the target contract, so a replaced item can never be mis-indexed (ADR-15; closed 2026-09-03, gap 3). The unversioned route's idempotency key is optional (`Idempotency-Key` header, opt-in) rather than required, unlike the target contract's `POST /api/v1/triads/:id/rank`.

### 2.4 Rules that apply to every endpoint

- No endpoint ever accepts or returns a merged single "match score" (`BP §4.4`).
- No endpoint accepts a star/1–10 rating or thumbs (`BP §2.4 #2`). `importedRating` is written only by the import pipeline.
- `not_watched`/`not_remembered` never change `personalFit` inputs (`BP §2.4 #3`).
- The LLM is never called inside a request that returns recommendations or triads (`BP §15.2`).
- Profile-scoped routes are owner-only; admin routes are role-gated; all staff access is audit-logged (`BP §21.3`).

---

**Changelog**
- 1.13 (2026-09-04): `POST /api/triads/:triadId/rank` also writes `outcomes.type: 'ranked_later'` for any ranked title that was previously recommended (blueprint gap 4, done in full, BP §4.5, ADR-68) -- `rankPosition` is the title's index in the final ranking, best first.
- 1.12 (2026-09-04): `POST /api/recommendations/:recommendationId/outcome` (blueprint gap 4 in full except `ranked_later`, BP §4.5/§13.1, ADR-67) -- the four caller-reportable `outcomes` types (`saved`/`clicked`/`dismissed_not_relevant`/`opened_provider`); `watched`/`ranked_later` rejected by validation, system-observed only.
- 1.11 (2026-09-03): `POST /api/profiles/:profileId/watch-events` (blueprint gap 4's other half, BP §4.5, ADR-66) -- records a watch, links the most recent `recommendations` row for the same title if any, writes a matching `outcomes` row, and marks the title watched so it returns to triad eligibility. Does not cover the other `outcomes` types (`saved`/`clicked`/`dismissed_not_relevant`/`opened_provider`, the target's `POST …/recommendations/:id/outcome`) -- still open.
- 1.10 (2026-09-03): `LibraryRankingItem` gains `reason` (the driving dimensions relative to the watched set, BP §9.4).
- 1.9 (2026-09-03): `GET /api/titles/starter` (diverse starter list, `BP §4.2`); catalogue search folds Arabic hamza/taa marbuta/alef maqsura on both sides.
- 1.8 (2026-09-03): `Recommendation` gains `reason` -- the ≤ 2 fingerprint dimensions whose weighted deviation from the candidate pool lifted the score, with a direction, and `evidenceSource: 'individual'` (BP §9.4, ADR-20; wording is the client's).
- 1.7 (2026-09-03): every `Triad` response (`current`, `rank`, `replace`) carries `items` — the three titles in `displayOrder`, public columns only — so the triad screen needs no per-title fetch (the target contract's inline items, brought forward).
- 1.6 (2026-09-03): `Profile` gains `market` and `platforms` (onboarding, `BP §4.1`); accepted by `POST /profiles` and `PATCH /profiles/:profileId`.
- 1.5 (2026-09-03): `GET /api/profiles/:profileId/library/ranking` -- the library's personal ranking, positions only (ADR-33), sharing the recommendation scoring path.
- 1.4 (2026-09-03): replacement endpoint implemented (ADR-17) -- `POST /api/triads/:triadId/replace`; `UserTitleState` gains `triadEligible`; `GET …/triads/current` draws from eligible titles only and its 400 carries `{ reason: 'need_more_watched', needed }`.
- 1.3 (2026-09-03): `personalFit` display note cites ADR-33 (verbal confidence, no percentage on any prediction surface).
- 1.2 (2026-09-03): gap 3 closed -- `POST /api/triads/:triadId/rank` takes title ids (not indices) and an optional `Idempotency-Key`; `Triad` gains `shownAt`, `answeredAt`, `modelVersion`, `idempotencyKey`.
- 1.1 (2026-09-03): `fingerprintCoverage` added to the implemented recommendation shape; candidate filter documented (watched only).
- 1.0 (2026-09-03): first API document; consolidates the previously scattered endpoint lists (ADR-11, QUICKSTART, PRIVACY, SPECIFICATION) into one implemented-vs-target contract.
