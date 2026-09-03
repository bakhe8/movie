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
| GET | `/api/health` | — | — | `{ status: 'ok' }` | |
| POST | `/api/auth/register` | — | `{ email, password(8–64), firstName, lastName }` | `{ access_token, user }` | 5 req/min per IP |
| POST | `/api/auth/login` | — | `{ email, password }` | `{ access_token, user }` | 5 req/min per IP |
| GET | `/api/auth/profile` | JWT | — | account fields | account, not taste profile |
| POST | `/api/profiles` | JWT | `{ name, preferredLanguage?, market?, platforms? }` | Profile | unique `(userId, name)` → 409; `market` is ISO 3166-1 alpha-2, `platforms` ≤ 20 identifiers ≤ 40 chars — display and Watchability only, never a taste input (`BP §4.1`) |
| GET | `/api/profiles` | JWT | — | Profile[] | caller's profiles only |
| GET | `/api/profiles/:profileId` | JWT | — | Profile | |
| PATCH | `/api/profiles/:profileId` | JWT | `{ name?, preferredLanguage?, market?, platforms? }` | Profile | the onboarding screen writes `market`/`platforms` here; `market` stays `null` until chosen |
| DELETE | `/api/profiles/:profileId` | JWT | — | 204 | cascades events/models of that profile only |
| GET | `/api/titles` | — | `?query&page&limit(≤100)` | `{ items, page, limit, total, totalPages }` | ILIKE on `titleEn`/`titleAr` only |
| GET | `/api/titles/search` | — | same as above | same | alias of `GET /api/titles` |
| GET | `/api/titles/:titleId` | — | — | Title (incl. `fingerprint`) | |
| PATCH | `/api/profiles/:profileId/titles/:titleId/state` | JWT | `{ state: watched\|not_watched\|watchlist\|interested, watchedAt?, notes? }` | UserTitleState | never accepts a rating |
| GET | `/api/profiles/:profileId/watched-titles` | JWT | — | UserTitleState[] (+title) | |
| GET | `/api/profiles/:profileId/watchlist` | JWT | — | UserTitleState[] (+title) | |
| GET | `/api/profiles/:profileId/triads/current` | JWT | — | Triad | returns the active triad or creates one (`random-v1`) from watched titles that are still `triadEligible`; 400 with `{ reason: 'need_more_watched', needed }` (alongside the default `statusCode`/`message`/`error`) when fewer than 3 are eligible or all were just used in the previous triad |
| GET | `/api/profiles/:profileId/triads` | JWT | — | Triad[] | completed only |
| POST | `/api/triads/:triadId/rank` | JWT | `{ ranking: string[3] (titleIds, best first), sessionId? }`, header `Idempotency-Key?` (UUID) | Triad | 400 if already completed or `ranking` isn't exactly this triad's own title ids; a repeated `Idempotency-Key` for the same triad returns the original result instead of erroring; reusing one for a different triad is `409` |
| POST | `/api/triads/:triadId/replace` | JWT | `{ titleId, reason: 'not_watched' \| 'not_remembered' }` | Triad | the two neutral replacement controls (ADR-17): swaps only that item for a random other eligible watched title (never one from the previous completed triad) and redraws `displayOrder`; writes a `triad_replacements` row; `not_watched` sets the title's state to `not_watched` (stays a recommendation candidate), `not_remembered` keeps it watched but clears `triadEligible`; no preference signal. 400 if the triad is not active or `titleId` is not one of its three. Returns `status: 'skipped'` (event still logged with `replacementTitleId: null`) when nothing eligible is left or a 4th replacement is requested on one triad — the client then calls `GET …/triads/current` again |
| GET | `/api/profiles/:profileId/library/ranking` | JWT | — | LibraryRankingItem[] | the profile's watched, fingerprinted titles ordered by the latest snapshot (`BP §5.3` "ترتيب شخصي"); positions only, the score never leaves the server (ADR-33); same band/demotion rules as recommendations; 409 until a snapshot exists; `[]` when nothing is watched |
| GET | `/api/profiles/:profileId/recommendations` | JWT | `?limit(≤50, default 10)` | Recommendation[] | 409 until a model snapshot exists; excludes watched titles only (`not_watched` stays a candidate); unknown fingerprint dimensions imputed with the pool mean, never zero; results not persisted |

Response shapes in use (from `apps/frontend/app/lib/api.ts`, which mirrors the entities):

```ts
Profile { id, userId, name, preferredLanguage: 'ar'|'en', market: string|null /* ISO 3166-1 alpha-2 */, platforms: string[], createdAt, updatedAt }
Title { id, internalId, titleEn, titleAr, description|null, releaseYear|null, genres|null, externalIds?, fingerprint? }
UserTitleState { id, profileId, titleId, state, watchedAt|null, triadEligible /* false after 'not_remembered' (ADR-17) */,
                 importedRating|null, ratingSource:'import'|null, notes|null, updatedAt, title? }
Triad { id, profileId, titleIds: string[3], displayOrder: string[3]|null, items: Title[3] /* in displayOrder; public columns only */,
        ranking: string[3]|null /* titleIds, best first */,
        shownAt|null, answeredAt|null, modelVersion|null /* null under random-v1, which uses no model */, idempotencyKey|null,
        policyVersion|null, selectionPropensity|null, experimentId|null, sessionId|null, metadata|null, status, createdAt }
Recommendation { title, personalFitScore, publicQualityScore|null, watchabilityScore|null,
                 confidenceBand: 'initial'|'likely'|'strong'|'inconclusive',
                 fingerprintCoverage: number /* 0–1 share of known dimensions; < 1 costs one band (ADR-19) */,
                 track: 'safe'|'discovery'|'outside_usual', modelVersion,
                 reason: { features: [{ key: FingerprintDimension, direction: 'higher'|'lower' }] /* ≤ 2, only dimensions that lifted the score (BP §9.4); [] when none did */,
                           evidenceSource: 'individual' } }
LibraryRankingItem { title, position /* 1-based, best fit first */, confidenceBand, fingerprintCoverage, modelVersion }
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
| POST | `/api/v1/watch-events` | record a watch (and edition) | body `{ profileId, titleId, watchedAt?, source: 'in_app'\|'import'\|'manual', audioLanguage?, subtitleLanguage?, provider? }`; does not imply liking; if the title was recommended, links an `outcomes` row | `PATCH …/state` (state stays for watchlist/interested) |
| GET | `/api/v1/taste-profile?profileId=` | tendencies, confidence, unknown areas, exceptions | no uncalibrated percentages; each item has brief evidence, `confidenceBand`, `evidenceSource`, `modelVersion` | new |
| GET | `/api/v1/recommendations?profileId=&track=&limit=` | three tracks | each item: `personalFit`, `publicQuality`, `watchability`, `confidenceBand`, `reason { text, features[], evidenceSource }`, `availability[]`, `selectionPropensity`, `recommendationId`; the call persists a `recommendations` row per item | `GET …/recommendations` |
| POST | `/api/v1/recommendations/:id/outcome` | implicit outcome | body `{ type: 'saved'\|'clicked'\|'dismissed_not_relevant'\|'opened_provider' }`; no thumbs/stars | new |
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
- 1.8 (2026-09-03): `Recommendation` gains `reason` -- the ≤ 2 fingerprint dimensions whose weighted deviation from the candidate pool lifted the score, with a direction, and `evidenceSource: 'individual'` (BP §9.4, ADR-20; wording is the client's).
- 1.7 (2026-09-03): every `Triad` response (`current`, `rank`, `replace`) carries `items` — the three titles in `displayOrder`, public columns only — so the triad screen needs no per-title fetch (the target contract's inline items, brought forward).
- 1.6 (2026-09-03): `Profile` gains `market` and `platforms` (onboarding, `BP §4.1`); accepted by `POST /profiles` and `PATCH /profiles/:profileId`.
- 1.5 (2026-09-03): `GET /api/profiles/:profileId/library/ranking` -- the library's personal ranking, positions only (ADR-33), sharing the recommendation scoring path.
- 1.4 (2026-09-03): replacement endpoint implemented (ADR-17) -- `POST /api/triads/:triadId/replace`; `UserTitleState` gains `triadEligible`; `GET …/triads/current` draws from eligible titles only and its 400 carries `{ reason: 'need_more_watched', needed }`.
- 1.3 (2026-09-03): `personalFit` display note cites ADR-33 (verbal confidence, no percentage on any prediction surface).
- 1.2 (2026-09-03): gap 3 closed -- `POST /api/triads/:triadId/rank` takes title ids (not indices) and an optional `Idempotency-Key`; `Triad` gains `shownAt`, `answeredAt`, `modelVersion`, `idempotencyKey`.
- 1.1 (2026-09-03): `fingerprintCoverage` added to the implemented recommendation shape; candidate filter documented (watched only).
- 1.0 (2026-09-03): first API document; consolidates the previously scattered endpoint lists (ADR-11, QUICKSTART, PRIVACY, SPECIFICATION) into one implemented-vs-target contract.
