# Database Schema

**Status**: Derived from blueprint `§13` (entities and event shapes), `§11` (rights registry), `§7.5`–`§7.6`, `§21`. Two layers, kept apart on purpose:

- **§1 Current physical schema** — exactly what the eighteen TypeORM migrations in `apps/backend/src/migrations/` create (verified 2026-09-04). This is the truth for anyone writing SQL today.
- **§2 Target schema** — the `BP §13.1` entity set expressed as tables, plus the migration plan from §1 to §2.

Naming (ADR-16): tables `snake_case` plural; columns are TypeORM's default `camelCase` and therefore **quoted** in raw SQL (`"profileId"`); primary keys `uuid` via `uuid_generate_v4()`; timestamps `TIMESTAMP` (UTC by convention). The one plural-naming exception (`user_title_state`) was renamed to `user_title_states` in M1. Schema changes go through `npm run migration:generate` / `npm run db:migrate` only — `synchronize` is off in every environment.

---

## 1. Current physical schema (migrated)

Migrations, in order: `1788410140231-InitialSchema`, `1788411790951-AddTriadEventFields`, `1788412500000-SplitImportedRatingFromInAppState`, `1788418200000-ArabicFirstProfileDefault`, `1788421102891-AddOneActiveTriadPerProfileConstraint`, `1788424108820-AddHeldOutTrainingMetrics`, `1788425067800-AddTriadEventCompleteness`, `1788428400000-AddTriadReplacements`, `1788432000000-AddProfileMarketAndPlatforms`, `1788435000000-CompleteM1Plan`, `1788438000000-AddM2ConsentAndAuditTables`, `1788440000000-AddM3RightsRegistryAndCatalogProvenance`, `1788442000000-AddM4ModelVersioningAndExperiments`, `1788444000000-AddM5RecommendationsAndWatchEvents`, `1788446000000-AddM6PublicQualityAndAvailability`, `1788448000000-AddM7SharedLatentSpaceVersions`, `1788450000000-AddTrainingGenreDiversity`, `1788452000000-AddTrainingLanguageDiversity`. Extension: `uuid-ossp`. The `ankane/pgvector` image is used but no column has the `vector` type yet — `embeddings.vector` is still `real[]`, deliberately unconverted (see the note below §1's DDL block).

```sql
users (
  id uuid PK, email varchar UNIQUE NOT NULL, password varchar NOT NULL,   -- bcrypt hash
  "firstName" varchar, "lastName" varchar, active boolean NOT NULL DEFAULT true,
  role varchar NOT NULL DEFAULT 'user',                          -- 'user' | 'admin' (BP §5.1); no route reads this yet -- the admin board isn't built
  "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
)

profiles (                      -- the pseudonymous taste id (BP §13.1, §21.1)
  id uuid PK, "userId" uuid NOT NULL FK users(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL, "preferredLanguage" varchar(5) NOT NULL DEFAULT 'ar',   -- Arabic-first (BP §2)
  market varchar(2),                                             -- ISO 3166-1 alpha-2; NULL until chosen at onboarding (BP §4.1); display/availability only
  platforms text[] NOT NULL DEFAULT '{}',                        -- platform identifiers the user can watch on (BP §4.1); display/availability only
  "pausedAt" timestamp,                                          -- 'pause_all' restriction (PRIVACY.md §4); NULL = not paused; no route reads/writes this yet
  "createdAt" timestamp, "updatedAt" timestamp,
  UNIQUE ("userId", name)
)

titles (
  id uuid PK, "internalId" varchar UNIQUE NOT NULL,             -- FILM001…
  "titleEn" varchar NOT NULL, "titleAr" varchar NOT NULL, description varchar,
  "releaseYear" integer, genres text,                            -- TypeORM simple-array (comma-joined)
  "externalIds" json,                                            -- { imdb?, tmdb?, wikidata? }
  fingerprint json,                                              -- FilmFingerprintV1 or NULL (see FINGERPRINT_SCHEMA.md)
  "originalLanguage" varchar,                                    -- Wikidata P364, single value; NULL for titles ingested before this column existed or with no recorded language (gap 5/gap 6, ADR-64)
  "createdAt" timestamp, "updatedAt" timestamp
)

embeddings (
  id uuid PK, "titleId" uuid NOT NULL FK titles(id) ON DELETE CASCADE,
  vector real[] NOT NULL,                                        -- NOT pgvector yet
  "modelVersion" varchar NOT NULL, "embeddingType" varchar NOT NULL, metadata json, "createdAt" timestamp
)

user_title_states (                                              -- exposure + list state, one row per (profile, title); renamed from user_title_state (M1, ADR-16 plural naming)
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  state varchar NOT NULL,                                        -- 'watched' | 'not_watched' | 'watchlist' | 'interested'
  "watchedAt" timestamp,
  "triadEligible" boolean NOT NULL DEFAULT true,                 -- false after a 'not_remembered' replacement (ADR-17): still watched, never asked about again
  "importedRating" real, "ratingSource" varchar,                 -- import-only auxiliary signal; never written by the API (BP §4.2)
  notes text, "updatedAt" timestamp,
  UNIQUE ("profileId", "titleId")
)

triads (                                                         -- one listwise event per row (BP §7.2, §13.2)
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE,
  "titleIds" uuid[] NOT NULL, "displayOrder" uuid[],             -- displayOrder shuffled independently of titleIds
  ranking uuid[],                                                -- titleIds, best first, not indices (ADR-15); NULL while active
  "shownAt" timestamp,                                           -- set once, at creation
  "answeredAt" timestamp,                                        -- set once, at POST .../rank; NULL for triads completed before this column existed (ADR-32)
  "modelVersion" varchar,                                        -- which snapshot selected this triad; NULL under random-v1, which uses no model
  "idempotencyKey" uuid UNIQUE,                                  -- optional; a repeated key for the same triad replays the prior result (BP §14)
  "policyVersion" varchar, "selectionPropensity" real, "experimentId" varchar,
  "sessionId" varchar, metadata json,                            -- { replacements?, reasonForSelection? } — the replacements key is superseded by triad_replacements below and never written
  status varchar NOT NULL DEFAULT 'active',                      -- 'active' | 'completed' | 'skipped' (skipped: abandoned by a replacement with nothing left to swap in)
  "correctsTriadId" uuid FK triads(id),                          -- append-only correction (BP §13.2); NULL for every triad today -- no correction flow built yet
  holdout boolean NOT NULL DEFAULT false,                        -- reserved validation split (BP §8.3, §16.1); always false -- random-v1 has no holdout concept, training.py's temporal split (ADR-31) covers evaluation instead
  "createdAt" timestamp,
  UNIQUE ("profileId") WHERE status = 'active',                  -- partial index; at most one active triad per profile (ADR-28)
  INDEX ("profileId", "createdAt"), INDEX ("profileId", status)  -- M1
)

triad_replacements (                                             -- one append-only row per neutral replacement (BP §4.3, §13.1, ADR-17)
  id uuid PK, "triadId" uuid NOT NULL FK triads ON DELETE CASCADE,
  "replacedTitleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  "replacementTitleId" uuid FK titles ON DELETE CASCADE,         -- NULL when nothing eligible was left and the triad was skipped instead
  reason varchar NOT NULL,                                       -- 'not_watched' | 'not_remembered'; never a preference signal
  "createdAt" timestamp NOT NULL DEFAULT now()
)

user_model_snapshots (                                           -- one row per training run (BP §13.1 taste_profiles, partial)
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE,
  weights real[] NOT NULL,                                       -- θᵤ over FINGERPRINT_DIMENSIONS order (40 since ADR-75: 13 V1 + 15 V2 + 12 V3)
  "biasTerms" json,                                              -- { titleId: δ }; PlackettLuceRanker.fit() never populates this yet, so it is always {} today
  "modelVersion" varchar NOT NULL, "trainingTriadCount" integer NOT NULL,
  "validationAccuracy" real, "pairwiseAccuracy" real,            -- pairwiseAccuracy is in-sample today
  "heldOutTriadCount" integer, "heldOutNll" real, "heldOutPairwiseAccuracy" real,  -- NULL below the 5-triad floor (ADR-31); heldOutPairwiseAccuracy is the out-of-sample counterpart to pairwiseAccuracy above
  posterior json,                                                -- { standardErrors: real[] }; per-weight uncertainty (BP §13.1, gap 5). NULL below the 5-triad floor -- above it, training.py populates it from ranker.py's BFGS inverse Hessian (ADR-62)
  "recentWeights" real[],                                        -- recent-window layer (BP §7.3); NULL in MVP
  exceptions json,                                                -- [{ titleId, delta, tagged }] (BP §7.4); never populated
  "calibratedAgainst" varchar,                                   -- FK shared_latent_space_versions(version) once M7 creates that table (M4, ADR-54); plain column until then
  "trainingGenreDiversity" integer,                              -- distinct genre count across the training triads (gap 5); NULL below the 5-triad floor (ADR-62)
  "trainingLanguageDiversity" integer,                           -- distinct titles.originalLanguage count across the training triads (gap 5/gap 6); NULL below the same floor (ADR-64)
  "trainingDirectorDiversity" integer,                           -- distinct director (credits.role='director') count across the training triads (gap 5, closed in full); NULL below the same floor (ADR-71)
  "createdAt" timestamp,
  INDEX ("profileId", "createdAt" DESC)                          -- M4
)

consents (                                                       -- one grant/revoke record per (user, purpose, policy version) (BP §13.1)
  id uuid PK, "userId" uuid NOT NULL FK users ON DELETE CASCADE,
  purpose varchar NOT NULL,                                      -- closed list, PRIVACY.md §3; enforced at the application layer only
  version varchar NOT NULL,                                      -- policy text version the user saw
  granted boolean NOT NULL, "grantedAt" timestamp NOT NULL, "revokedAt" timestamp,
  UNIQUE ("userId", purpose, version),
  INDEX ("userId")
)

privacy_requests (                                               -- export/delete/reset lifecycle (BP §13.1, §14, PRIVACY.md §5)
  id uuid PK, "userId" uuid FK users(id) ON DELETE SET NULL,      -- nullable since PrivacyRequestsTombstone (gap 7's delete flow, ALPHA_PLAN 2.1) -- see note below
  "subjectKey" varchar(64),                                      -- sha256(userId), written on every request; survives the row's userId going NULL (PRIVACY.md §9's "permanent record without personal data")
  "profileId" uuid,                                              -- bare uuid, no FK -- which profile a 'reset' request applied to; the profile may be gone by the time this is read
  type varchar NOT NULL,                                         -- 'export' | 'delete' | 'reset'
  status varchar NOT NULL,                                       -- 'requested' | 'verifying' | 'scheduled' | 'running' | 'done' | 'cancelled'
  "requestedAt" timestamp NOT NULL, "executeAfter" timestamp, "completedAt" timestamp,
  "artifactUrl" varchar, "executionLog" json,
  INDEX ("userId"), INDEX ("subjectKey")
)

refresh_tokens (                                                 -- ADR-26: rotated refresh tokens with family-level reuse detection
  id uuid PK, "userId" uuid NOT NULL FK users ON DELETE CASCADE, -- a privacy purge takes every session with the account
  "tokenHash" varchar(64) UNIQUE NOT NULL,                       -- sha256 of the raw token; the raw value is never stored
  "familyId" uuid NOT NULL,                                      -- one rotation chain; reusing a superseded token revokes the whole family
  "expiresAt" timestamp NOT NULL, "revokedAt" timestamp, "revokedReason" varchar,
  "replacedById" uuid,                                           -- bare uuid, no FK -- points at the token this one rotated into
  "ipHash" varchar, "createdAt" timestamp NOT NULL DEFAULT now(),
  INDEX ("userId"), INDEX ("familyId")
)

audit_log (                                                      -- append-only, BP §21.1/§21.3
  id uuid PK, "actorUserId" uuid, "actorRole" varchar,           -- bare uuid, no FK -- must outlive the actor it names
  action varchar NOT NULL, resource varchar NOT NULL, "resourceId" uuid,
  status varchar NOT NULL, reason varchar(500), "ipHash" varchar,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  INDEX ("actorUserId"), INDEX (resource, "resourceId")
)

people (id uuid PK, name varchar NOT NULL, "externalIds" json)  -- BP §13.1

source_records (                                                -- rights registry, BP §11.1/§11.3; never overwritten in place
  id uuid PK, "titleId" uuid FK titles ON DELETE CASCADE,        -- nullable: a record need not describe one title
  "fieldName" varchar NOT NULL, value text, source varchar NOT NULL,
  license varchar, "licenseStatus" varchar NOT NULL,             -- 'commercial_allowed' | 'non_commercial_only' | 'pending_review' | 'unknown'
  "allowsStorage" boolean, "allowsDerivation" boolean, "allowsTraining" boolean, "attributionRequired" boolean,
  "retentionUntil" timestamp, "fallbackPlan" varchar,
  confidence real, "extractorVersion" varchar, "reviewStatus" varchar,  -- 'unreviewed' | 'sampled' | 'human_verified'
  "supersededBy" uuid FK source_records(id),                     -- self-reference; a correction points the old row here instead of overwriting it
  "retrievedAt" timestamp, "validFrom" timestamp, "createdAt" timestamp NOT NULL DEFAULT now(),
  INDEX ("titleId")
)

localized_titles (                                               -- BP §11.3, §13.1
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  title varchar NOT NULL, language varchar(5) NOT NULL, region varchar(2),
  kind varchar NOT NULL,                                         -- 'original' | 'official' | 'alternate' | 'transliteration'
  "displayPriority" integer NOT NULL DEFAULT 0, "sourceRecordId" uuid FK source_records,
  INDEX ("titleId"), INDEX USING GIN (to_tsvector('simple', title))
)

title_editions (                                                 -- BP §6.2 (work vs. edition)
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  kind varchar NOT NULL,                                         -- 'theatrical' | 'directors_cut' | 'dub' | 'subtitled' | 'other'
  "audioLanguage" varchar(5), "subtitleLanguage" varchar(5), notes text,
  INDEX ("titleId")
)

credits (
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE, "personId" uuid NOT NULL FK people,
  role varchar NOT NULL, "creditOrder" integer, "sourceRecordId" uuid FK source_records,
  INDEX ("titleId"), INDEX ("personId")
)

content_features (                                               -- BP §13.3, provenance behind titles.fingerprint
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  "featureKey" varchar NOT NULL, value real, distribution json,  -- value NULL = unknown, never 0 (BP §11.3)
  uncertainty real, "sourceIds" text[] NOT NULL DEFAULT '{}',
  "extractorVersion" varchar NOT NULL, "licenseStatus" varchar NOT NULL, "reviewStatus" varchar NOT NULL,
  "validFrom" timestamp NOT NULL, "supersededBy" uuid FK content_features(id),
  UNIQUE ("titleId", "featureKey", "extractorVersion")
)

model_versions (                                                 -- BP §13.1
  version varchar PK, "rankerType" varchar NOT NULL, "fingerprintSchemaVersion" varchar NOT NULL,
  "codeRef" varchar, "dataCutoff" timestamp, features json, thresholds json,
  "evalReport" json,                                             -- BP §16.2 metrics incl. slices and baselines
  active boolean NOT NULL DEFAULT false, "createdAt" timestamp NOT NULL DEFAULT now()
)

experiments (
  id varchar PK, hypothesis text NOT NULL, status varchar NOT NULL, "startedAt" timestamp, "endedAt" timestamp, config json
)

experiment_assignments (
  "experimentId" varchar NOT NULL FK experiments, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE,
  arm varchar NOT NULL, "assignedAt" timestamp,
  PRIMARY KEY ("experimentId", "profileId")
)

library_imports (
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, status varchar NOT NULL,
  "fileName" varchar, "rowCount" integer, "matchedCount" integer, "consentVersion" varchar NOT NULL,
  "rawDeletedAt" timestamp, "createdAt" timestamp, "completedAt" timestamp,
  INDEX ("profileId")
)

recommendations (                                                -- BP §13.1, §14, §14.1; written since 2026-09-03, ADR-58 (blueprint gap 4's write side)
  id uuid PK, "requestId" uuid NOT NULL, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, "titleId" uuid NOT NULL FK titles,
  track varchar NOT NULL,                                        -- 'safe' | 'discovery' | 'outside_usual'
  "personalFit" real, "publicQuality" real, watchability real,   -- separate, never merged (BP §4.4)
  "confidenceBand" varchar NOT NULL, "confidenceRaw" real,        -- raw is internal until calibrated (BP §7.2)
  reason json NOT NULL,                                          -- { text, features[], evidenceSource }
  "evidenceSource" varchar NOT NULL DEFAULT 'individual',
  "candidateSource" varchar, "modelVersion" varchar NOT NULL, "policyVersion" varchar NOT NULL, "experimentId" varchar,
  "selectionPropensity" real, "shownAt" timestamp, "createdAt" timestamp NOT NULL DEFAULT now(),
  INDEX ("profileId", "createdAt" DESC)
)

outcomes (                                                        -- BP §13.1; implicit signals only
  id uuid PK, "recommendationId" uuid NOT NULL FK recommendations ON DELETE CASCADE,
  type varchar NOT NULL,                                         -- 'saved' | 'clicked' | 'opened_provider' | 'dismissed_not_relevant' | 'watched' | 'ranked_later'
  "triadId" uuid FK triads,                                       -- for 'ranked_later'
  "rankPosition" integer,                                        -- 0..2 in that triad
  "occurredAt" timestamp NOT NULL DEFAULT now(),
  INDEX ("recommendationId")
)

watch_events (                                                    -- BP §6.2, §13.1
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, "titleId" uuid NOT NULL FK titles,
  "watchedAt" timestamp, source varchar NOT NULL,                 -- 'in_app' | 'import' | 'manual'
  "editionId" uuid FK title_editions, "audioLanguage" varchar(5), "subtitleLanguage" varchar(5), provider varchar,
  "importId" uuid,                                                -- no FK, matches the target DDL literally
  "recommendationId" uuid FK recommendations,                     -- closes the loop (BP §4.5)
  "createdAt" timestamp NOT NULL DEFAULT now(),
  INDEX ("profileId"), INDEX ("recommendationId")
)

public_quality_sources (                                          -- BP §10.3: per-source, never averaged into one number
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  source varchar NOT NULL, market varchar(2), value real, scale varchar, votes integer, polarization real,
  "capturedAt" timestamp NOT NULL, "sourceRecordId" uuid NOT NULL FK source_records,
  INDEX ("titleId")
)

availability_snapshots (                                          -- BP §6 (access layer); dated snapshots from a licensed partner
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  market varchar(2) NOT NULL, provider varchar NOT NULL, "offerType" varchar,
  "audioLanguages" text[], "subtitleLanguages" text[], "checkedAt" timestamp NOT NULL, "validUntil" timestamp,
  "sourceRecordId" uuid NOT NULL FK source_records,
  INDEX ("titleId")
)

shared_latent_space_versions (                                   -- BP §7.5
  version varchar PK, "nFactors" integer, "seedDataSources" json NOT NULL DEFAULT '[]',   -- each with licenseStatus; must be 'commercial_allowed' to be active
  "trainingCohortSize" integer, "acceptanceGateMetrics" json, active boolean NOT NULL DEFAULT false, "createdAt" timestamp
)
```

Indexes: primary keys and the unique constraints above, the partial unique index on `triads` noted above, `IDX_triad_replacements_triadId`, and the M2–M6 indexes noted inline above. Views: none.

`user_model_snapshots.calibratedAgainst` now carries its FK to `shared_latent_space_versions(version)`, added by M7 once the target table existed (see the note above about the M4/M7 ordering split, ADR-54).

`embeddings.vector` is still `real[]`, not the `vector(n)` pgvector type §2.4's plan row names for M7: unlike every other item across all seven steps, SCHEMA.md's target DDL never specified a literal dimension `n`, because no document or code in this repository commits to one — no embedding-generation code exists anywhere, and the table is empty in every environment. Converting the column now would mean inventing a product/vendor decision (which embedding model, hence cost and lock-in) with no grounding. Asked the user directly rather than guessing (2026-09-03); decided to defer this one item — it is the only piece of the entire seven-step plan still open (ADR-57).

`privacy_requests.userId` is resolved (`PrivacyRequestsTombstone`, ALPHA_PLAN 2.1): nullable with `ON DELETE SET NULL`, plus `subjectKey` (a `sha256(userId)` written on every request, surviving the purge) so an operator can still answer "was this account deleted, and when?" from the id alone without keeping the id itself after deletion — PRIVACY.md §9's "permanent record without personal data", the `SET NULL` option this note originally left open. `audit_log.actorUserId` still has no FK at all, on purpose, for the identical reason — still deliberately left open, since no code writes a delete-triggered row there yet that would force the question.

`source_records.titleId` and `content_features.supersededBy` follow the DDL literally too: `source_records` is nullable on `titleId` (a record can describe something other than one title) and both `source_records.supersededBy`/`content_features.supersededBy` are self-referencing FKs with no `ON DELETE` action — a correction is a new row, the old one is never deleted, so there is nothing for a cascade to do.

`user_model_snapshots.calibratedAgainst` is a plain `varchar` today, not yet the FK to `shared_latent_space_versions(version)` that §2.2's target DDL specifies: that table is M7's, three steps after M4, so the target DDL itself describes a column referencing a table that doesn't exist yet at the point it's added. The constraint is deferred to M7's migration, once the target table exists (ADR-54); every intermediate migration state stays valid this way, and nothing writes the column either way today.

What is **not** in the database today (see §2 for the target): nothing — every table across the seven-step plan (M1–M7) now exists; only `embeddings.vector`'s pgvector conversion (M7's other item) remains deliberately deferred, see above. (`users.role` exists since M1 but no admin board reads it yet; `consents`/`privacy_requests`/`audit_log` exist since M2 but nothing writes to them yet — that's blueprint gap 7 and PRIVACY.md §5's rights endpoints; `source_records`/`content_features`/`localized_titles`/`title_editions`/`people`/`credits` exist since M3 but nothing populates them yet — that needs licensed sources and a real ingestion pass, blueprint gap 6/9; `model_versions`/`experiments`/`experiment_assignments` exist since M4 but nothing writes to them yet — random-v1 runs no experiments and `training.py` doesn't stamp a model-version row; `recommendations`/`outcomes`/`watch_events`/`library_imports` exist since M5 — `recommendations` (`RecommendationsService.findForProfile()`, ADR-58), `outcomes` and `watch_events` (`WatchEventsService`, ADR-66) are written since 2026-09-03; `library_imports` still isn't (blueprint gap 4's other half, the CSV import path itself, unbuilt); `public_quality_sources`/`availability_snapshots` exist since M6 but nothing populates them yet — both need a licensed data source that doesn't exist; `shared_latent_space_versions` exists since M7 but no version has ever been created.)

---

## 2. Target schema (`BP §13.1`) and migration plan

### 2.1 Entity map

| Blueprint entity (`§13.1`) | Target table(s) | Status today |
|---|---|---|
| users / identities | `users` (+ `role`, since M1), `profiles` (+ `market`/`platforms` since `AddProfileMarketAndPlatforms`, `pausedAt` since M1) | partial — no admin board or `pause_all` flow reads these columns yet |
| content_items / editions | `titles`, `title_editions` | `title_editions` present since M3, empty; search is still ILIKE on `titles` |
| localized_titles | `localized_titles` | present since M3, empty — search is still ILIKE on two `titles` columns, not yet switched to the GIN index on `localized_titles.title` |
| credits / people | `people`, `credits` | present since M3; populated 2026-09-04 — 232 people, 313 director credits (`role: 'director'`) across 295 of 300 demo titles, loaded from a Wikidata fetch (ADR-65/ADR-70). Only the `director` role exists; `cast`/`writer` are unbuilt |
| content_features | `content_features` (per-feature rows) + `titles.fingerprint` (published snapshot) | `content_features` present since M3, empty; `titles.fingerprint` still the only populated provenance |
| watch_events | `watch_events` | present since M5, empty — watches are still folded into `user_title_states.watchedAt` only |
| triad_events | `triads` | present; `shownAt`/`answeredAt`/`modelVersion`/`idempotencyKey` exist (ADR-32), `holdout`/`correctsTriadId` since M1 — both always their default today, no policy sets `holdout` and no correction flow exists |
| triad_replacements | `triad_replacements` | present (ADR-17, migration `AddTriadReplacements`) |
| taste_profiles | `user_model_snapshots` (+ posterior, time layers, exceptions since M4) | partial — the M4 columns exist but `PlackettLuceRanker.fit()` never populates them |
| recommendations | `recommendations` | present since M5; written since 2026-09-03 — `RecommendationsService.findForProfile()` persists one row per shown result (ADR-58); `outcomes` recording against it still missing (blueprint gap 4's other half) |
| outcomes | `outcomes` | present since M5, empty |
| model_versions / experiments | `model_versions`, `experiments`, `experiment_assignments` | present since M4; `model_versions` written by `POST /admin/models`/`PATCH /admin/models/:version` since `b9bd39b`, and `active` is now read by `RecommendationsService.loadSnapshot()` too (ADR-76) — `training.py` still stamps no model-version row itself; `experiments`/`experiment_assignments` still empty, random-v1 runs no experiments |
| consents / privacy_requests | `consents`, `privacy_requests` | present since M2 — no route reads/writes them yet (blueprint gap 7, PRIVACY.md §5) |
| (rights registry, `§11.1`) | `source_records` | present since M3; 313 rows since 2026-09-04, one per director credit (`fieldName: 'director'`, `source: 'wikidata'`, `license: 'CC0'`) (ADR-70). No row cites any other field yet |
| (Public Quality / Watchability, `§10.3`, `§6`) | `public_quality_sources`, `availability_snapshots` | present since M6, empty — both need a licensed data source that doesn't exist |
| (shared latent space, `§7.5`) | `shared_latent_space_versions` | present since M7, empty — `user_model_snapshots.calibratedAgainst`'s FK now points here (added by M7) but no version has ever been created |
| (audit, `§21.3`) | `audit_log` | present since M2 — nothing writes to it yet |

### 2.2 Target DDL

Types follow the conventions above. Columns marked `-- BP` are required by the cited section; unmarked columns are this repo's elaboration.

```sql
-- Accounts and taste ids -----------------------------------------------------------
ALTER TABLE users    ADD COLUMN role varchar NOT NULL DEFAULT 'user';            -- 'user' | 'admin' (BP §5.1 admin board)
-- profiles.market / profiles.platforms already exist in §1 (migration AddProfileMarketAndPlatforms) -- not repeated here.
ALTER TABLE profiles ADD COLUMN "pausedAt" timestamp;                           -- 'pause_all' restriction (PRIVACY.md §4)

consents (                                                                      -- BP §13.1
  id uuid PK, "userId" uuid NOT NULL FK users ON DELETE CASCADE,
  purpose varchar NOT NULL,            -- see PRIVACY.md §3 for the closed list
  version varchar NOT NULL,            -- policy text version the user saw
  granted boolean NOT NULL, "grantedAt" timestamp NOT NULL, "revokedAt" timestamp,
  UNIQUE ("userId", purpose, version)
)

privacy_requests (                                                              -- BP §13.1, §14
  id uuid PK, "userId" uuid NOT NULL FK users, type varchar NOT NULL,           -- 'export' | 'delete' | 'reset'
  status varchar NOT NULL,             -- 'requested' | 'verifying' | 'scheduled' | 'running' | 'done' | 'cancelled'
  "requestedAt" timestamp NOT NULL, "executeAfter" timestamp, "completedAt" timestamp,
  "artifactUrl" varchar, "executionLog" json
)

audit_log (                                                                     -- BP §21.1, §21.3
  id uuid PK, "actorUserId" uuid, "actorRole" varchar, action varchar NOT NULL,
  resource varchar NOT NULL, "resourceId" uuid, status varchar NOT NULL, reason varchar(500),
  "ipHash" varchar, "createdAt" timestamp NOT NULL DEFAULT now()
)

-- Catalog -----------------------------------------------------------------------------
localized_titles (                                                              -- BP §11.3, §13.1
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  title varchar NOT NULL, language varchar(5) NOT NULL, region varchar(2),
  kind varchar NOT NULL,               -- 'original' | 'official' | 'alternate' | 'transliteration'
  "displayPriority" integer NOT NULL DEFAULT 0, "sourceRecordId" uuid FK source_records
)
CREATE INDEX ON localized_titles USING GIN (to_tsvector('simple', title));

title_editions (                                                                -- BP §6.2 (work vs edition)
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  kind varchar NOT NULL,               -- 'theatrical' | 'directors_cut' | 'dub' | 'subtitled' | 'other'
  "audioLanguage" varchar(5), "subtitleLanguage" varchar(5), notes text
)

people (id uuid PK, name varchar NOT NULL, "externalIds" json)
credits (
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE, "personId" uuid NOT NULL FK people,
  role varchar NOT NULL, "creditOrder" integer, "sourceRecordId" uuid FK source_records
)

source_records (                                                                -- rights registry, BP §11.1, §11.3
  id uuid PK, "titleId" uuid FK titles ON DELETE CASCADE,
  "fieldName" varchar NOT NULL,        -- 'description' | 'posterUrl' | 'genres' | 'fingerprint' | 'publicQuality' | 'availability' | …
  value text,
  source varchar NOT NULL,             -- 'manual' | 'wikidata' | 'openai' | 'tmdb' | 'justwatch' | …
  license varchar,                     -- 'CC0' | 'CC-BY' | 'proprietary' | …
  "licenseStatus" varchar NOT NULL,    -- 'commercial_allowed' | 'non_commercial_only' | 'pending_review' | 'unknown'
  "allowsStorage" boolean, "allowsDerivation" boolean, "allowsTraining" boolean, "attributionRequired" boolean,
  "retentionUntil" timestamp, "fallbackPlan" varchar,
  confidence real, "extractorVersion" varchar, "reviewStatus" varchar,          -- 'unreviewed' | 'sampled' | 'human_verified'
  "supersededBy" uuid FK source_records(id),                                    -- never overwrite silently (BP §11.3)
  "retrievedAt" timestamp, "validFrom" timestamp, "createdAt" timestamp NOT NULL DEFAULT now()
)

content_features (                                                              -- BP §13.3, one row per (title, feature, version)
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  "featureKey" varchar NOT NULL,       -- e.g. 'pacing', 'narrative.ambiguity'
  value real, distribution json,       -- value NULL = unknown, never 0 (BP §11.3)
  uncertainty real, "sourceIds" text[] NOT NULL DEFAULT '{}',
  "extractorVersion" varchar NOT NULL, "licenseStatus" varchar NOT NULL, "reviewStatus" varchar NOT NULL,
  "validFrom" timestamp NOT NULL, "supersededBy" uuid FK content_features(id),
  UNIQUE ("titleId", "featureKey", "extractorVersion")
)
-- titles.fingerprint stays as the published, versioned snapshot the model reads; content_features is its provenance.

public_quality_sources (                                                        -- BP §10.3: per-source, never averaged into one number
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  source varchar NOT NULL, market varchar(2), value real, scale varchar, votes integer, polarization real,
  "capturedAt" timestamp NOT NULL, "sourceRecordId" uuid NOT NULL FK source_records
)

availability_snapshots (                                                        -- BP §6 (access layer); dated snapshots from a licensed partner
  id uuid PK, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  market varchar(2) NOT NULL, provider varchar NOT NULL, "offerType" varchar,
  "audioLanguages" text[], "subtitleLanguages" text[], "checkedAt" timestamp NOT NULL, "validUntil" timestamp,
  "sourceRecordId" uuid NOT NULL FK source_records
)

-- Exposure and watches ------------------------------------------------------------
ALTER TABLE user_title_state RENAME TO user_title_states;
-- "triadEligible" already exists in §1 (migration AddTriadReplacements, ADR-17) -- not repeated here.
-- state keeps: 'watched' | 'not_watched' | 'watchlist' | 'interested'

watch_events (                                                                  -- BP §6.2, §13.1
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, "titleId" uuid NOT NULL FK titles,
  "watchedAt" timestamp, source varchar NOT NULL,                                -- 'in_app' | 'import' | 'manual'
  "editionId" uuid FK title_editions, "audioLanguage" varchar(5), "subtitleLanguage" varchar(5), provider varchar,
  "importId" uuid, "recommendationId" uuid FK recommendations,                  -- closes the loop (BP §4.5)
  "createdAt" timestamp NOT NULL DEFAULT now()
)

library_imports (
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, status varchar NOT NULL,
  "fileName" varchar, "rowCount" integer, "matchedCount" integer, "consentVersion" varchar NOT NULL,
  "rawDeletedAt" timestamp, "createdAt" timestamp, "completedAt" timestamp
)

-- Triads -----------------------------------------------------------------------------
-- shownAt/answeredAt/modelVersion/idempotencyKey already exist in §1
-- (migration AddTriadEventCompleteness, ADR-32) -- not repeated in this ALTER.
ALTER TABLE triads ADD COLUMN "correctsTriadId" uuid FK triads(id),             -- append-only corrections (BP §13.2)
                   ADD COLUMN "holdout" boolean NOT NULL DEFAULT false;         -- reserved for validation, never trained on (BP §8.3, §16.1)
CREATE INDEX ON triads ("profileId", "createdAt");
CREATE INDEX ON triads ("profileId", status);

-- triad_replacements already exists in §1 (migration AddTriadReplacements, ADR-17) -- not repeated here.

-- Models -----------------------------------------------------------------------------
-- heldOutTriadCount/heldOutNll/heldOutPairwiseAccuracy already exist in §1
-- (migration AddHeldOutTrainingMetrics, ADR-31) -- not repeated in this ALTER.
ALTER TABLE user_model_snapshots
  ADD COLUMN posterior json,                                                    -- per-weight uncertainty (BP §13.1)
  ADD COLUMN "recentWeights" real[],                                            -- recent-window layer (BP §7.3); NULL in MVP
  ADD COLUMN exceptions json,                                                   -- [{ titleId, delta, tagged }] (BP §7.4)
  ADD COLUMN "calibratedAgainst" varchar FK shared_latent_space_versions(version);
CREATE INDEX ON user_model_snapshots ("profileId", "createdAt" DESC);

model_versions (                                                                -- BP §13.1
  version varchar PK, "rankerType" varchar NOT NULL, "fingerprintSchemaVersion" varchar NOT NULL,
  "codeRef" varchar, "dataCutoff" timestamp, features json, thresholds json,
  "evalReport" json,                   -- BP §16.2 metrics incl. slices and baselines
  active boolean NOT NULL DEFAULT false, "createdAt" timestamp NOT NULL DEFAULT now()
)

experiments (
  id varchar PK, hypothesis text NOT NULL, status varchar NOT NULL, "startedAt" timestamp, "endedAt" timestamp, config json
)
experiment_assignments (
  "experimentId" varchar FK experiments, "profileId" uuid FK profiles ON DELETE CASCADE, arm varchar NOT NULL, "assignedAt" timestamp,
  PRIMARY KEY ("experimentId", "profileId")
)

shared_latent_space_versions (                                                  -- BP §7.5
  version varchar PK, "nFactors" integer, "seedDataSources" json NOT NULL DEFAULT '[]',   -- each with licenseStatus; must be 'commercial_allowed' to be active
  "trainingCohortSize" integer, "acceptanceGateMetrics" json, active boolean NOT NULL DEFAULT false, "createdAt" timestamp
)

-- Recommendations and outcomes --------------------------------------------------------
recommendations (                                                               -- BP §13.1, §14, §14.1
  id uuid PK, "requestId" uuid NOT NULL, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, "titleId" uuid NOT NULL FK titles,
  track varchar NOT NULL,              -- 'safe' | 'discovery' | 'outside_usual'
  "personalFit" real, "publicQuality" real, watchability real,                  -- separate, never merged (BP §4.4)
  "confidenceBand" varchar NOT NULL, "confidenceRaw" real,                      -- raw is internal until calibrated (BP §7.2)
  reason json NOT NULL,                -- { text, features[], evidenceSource }
  "evidenceSource" varchar NOT NULL DEFAULT 'individual',
  "candidateSource" varchar,           -- 'content_similarity' | 'collaborative' | 'public_quality' | 'exploration' (BP §14.1)
  "modelVersion" varchar NOT NULL, "policyVersion" varchar NOT NULL, "experimentId" varchar,
  "selectionPropensity" real, "shownAt" timestamp, "createdAt" timestamp NOT NULL DEFAULT now()
)
CREATE INDEX ON recommendations ("profileId", "createdAt" DESC);

outcomes (                                                                      -- BP §13.1; implicit signals only
  id uuid PK, "recommendationId" uuid NOT NULL FK recommendations ON DELETE CASCADE,
  type varchar NOT NULL,               -- 'saved' | 'clicked' | 'opened_provider' | 'dismissed_not_relevant' | 'watched' | 'ranked_later'
  "triadId" uuid FK triads,            -- for 'ranked_later'
  "rankPosition" integer,              -- 0..2 in that triad
  "occurredAt" timestamp NOT NULL DEFAULT now()
)
```

### 2.3 Rules the schema enforces or the application must enforce

- **Append-only events**: `triads`, `triad_replacements`, `watch_events`, `recommendations`, `outcomes`, `audit_log` are never updated after creation except for the `ranking`/`answeredAt`/`status` fill-in of an active triad. Corrections create new rows (`BP §13.2`).
- **Whole-triad splits**: `triads.holdout` is decided at creation time by the policy (`BP §8.3`) or by the temporal split in training (`BP §16.1`); a triad's pairs are never split across train/test.
- **Unknown ≠ zero**: nullable numeric feature and score columns mean unknown; readers must skip, not coerce to 0 (`BP §11.3`).
- **Pseudonymity**: no table other than `profiles` references `users`; exports and model jobs join on `profileId` only (`BP §21.1`).
- **Rights before display**: a poster or public score is displayable only if its `source_records.licenseStatus = 'commercial_allowed'` (`BP §11.3`, `§18.1`).
- **Deletion**: `POST /privacy/delete` runs after the safety period; cascades through `profiles`; `audit_log` and `privacy_requests` keep a tombstone with no personal data (`BP §21.3`).

### 2.4 Migration plan (from §1 to §2)

Each step is one TypeORM migration; none require data backfill beyond defaults because there is no production data yet.

| Step | Contents | Unblocks |
|---|---|---|
| M1 ✅ | rename `user_title_state` → `user_title_states`; `profiles.pausedAt`; `users.role`; `triads.holdout`/`correctsTriadId` + two indexes — all applied by `CompleteM1Plan` (`market`/`platforms` were already done by `AddProfileMarketAndPlatforms`; `shownAt`/`answeredAt`/`modelVersion`/`idempotencyKey` by `AddTriadEventCompleteness`, ADR-32; `triad_replacements`/`triadEligible` by `AddTriadReplacements`, ADR-17) | event completeness (`BP §13.2`, `§14`) — closed. No application logic reads `role`/`pausedAt`/`holdout`/`correctsTriadId` yet; that's the admin board, `pause_all`, and a future correction flow respectively, none built |
| M2 ✅ | `consents`, `privacy_requests`, `audit_log` — all applied by `AddM2ConsentAndAuditTables` | onboarding consent, export/delete/reset — schema only; no application logic writes to these tables yet |
| M3 ✅ | `source_records`, `content_features`, `localized_titles`, `people`, `credits`, `title_editions` — all applied by `AddM3RightsRegistryAndCatalogProvenance` | rights registry, FTS search, provenance — `people`/`credits`/`source_records` populated 2026-09-04 (director credits, ADR-70); `content_features`, `localized_titles`, `title_editions` still schema-only, and search hasn't switched off ILIKE |
| M4 ✅ | `model_versions`, `experiments`, `experiment_assignments`; `user_model_snapshots` additions (`posterior`, `recentWeights`, `exceptions`, `calibratedAgainst` — held-out metrics already exist, ADR-31) — all applied by `AddM4ModelVersioningAndExperiments` | reproducibility, calibration — schema only; `calibratedAgainst`'s FK to `shared_latent_space_versions` is deferred to M7 (that table doesn't exist yet, ADR-54) |
| M5 ✅ | `recommendations`, `outcomes`, `watch_events`, `library_imports` — all applied by `AddM5RecommendationsAndWatchEvents` | persisted recommendations, post-watch loop, imports — schema step only; `recommendations` (ADR-58), `outcomes` and `watch_events` (ADR-66) are now written, `library_imports` still isn't |
| M6 ✅ | `public_quality_sources`, `availability_snapshots` — all applied by `AddM6PublicQualityAndAvailability` | Public Quality and Watchability layers — schema only; still need licensed sources before anything can populate them |
| M7 🟡 | `shared_latent_space_versions` — applied by `AddM7SharedLatentSpaceVersions`, plus the `calibratedAgainst` FK deferred from M4 (ADR-54); `embeddings.vector` → pgvector `vector(n)` + IVFFLAT index — **not done**, no dimension `n` is specified anywhere in this repo, deferred rather than guessed (ADR-57) | `BP §7.5`; semantic candidate retrieval — partially closed |

---

**Changelog**
- 2.23 (2026-09-04): no migration -- application code and JSON-column shape only (`titles.fingerprint` is already `json`; the new `v3` key is additive within it, no DDL change). `training.py`/`recommendations.service.ts` grow `FINGERPRINT_DIMENSIONS` from 28 (V1+V2) to 40 (V1+V2+12 namespaced V3 "form family" dimensions, ADR-75, FINGERPRINT_SCHEMA.md §3.3) and now read `fingerprint.v3.features` for the third block. `UserModelSnapshot.weights`'s existing length guard (`loadSnapshot()`) already refuses a pre-this-change (28-length) snapshot -- no migration or backfill needed for correctness. Verified with a real `python -m src.training` run against `movie-postgres` (71 completed triads), persisted row read back confirming 40 weights and `modelVersion: plackett-luce-v3`.
- 2.22 (2026-09-04): twentieth migration `AddTrainingDirectorDiversity` applied -- adds `user_model_snapshots.trainingDirectorDiversity integer` (blueprint gap 5, ADR-71). The third and last of `BP §9.2`'s three named diversity axes, closing the criterion in full: `training.py`'s `train_profile()` now queries `credits`/`people` (`role = 'director'`) alongside `genres`/`languages` and writes `trainingDirectorDiversity` the same way the other two are written; `RecommendationsService.confidenceBand()` demotes to `inconclusive` below 2 distinct directors, mirroring the genre/language checks exactly. Verified with a real `python -m src.training` run against `movie-postgres`'s highest-triad-count demo profile (49 distinct directors across 47 completed triads), read back from the persisted row; full backend (211/211 unit) and Python (139/139) suites green.
- 2.21 (2026-09-04): no migration -- application code, `apps/backend/src/scripts/load-director-credits.ts` (ADR-70). Joins ADR-65's staged Wikidata director fetch to the now-loaded catalog (WS3): writes `people` (232 new rows, deduped by `externalIds.wikidata`), `credits` (313 rows, `role: 'director'`) and `source_records` (313 rows, `license: 'CC0'`, `licenseStatus: 'commercial_allowed'`, DATA_LICENSING.md §3.1) for 295 of 300 demo titles -- the first real ingestion pass into any of M3's rights-registry/provenance tables, closing blueprint gap 6. Verified with a real (non-dry-run) run against `movie-postgres`, read back with `SELECT count(*)` matching the script's own summary exactly, and the full e2e suite green after.
- 2.20 (2026-09-04): no migration -- application code and JSON-column shape only (`titles.fingerprint` is already `json`; the new `v2` key is additive within it, no DDL change). `training.py`/`recommendations.service.ts` grow `FINGERPRINT_DIMENSIONS` from 13 (V1) to 28 (V1 + 15 namespaced V2 families, ADR-69) and now read `fingerprint.v2.features` for the second half. `UserModelSnapshot.weights`'s existing length guard (`loadSnapshot()`) already refuses a pre-this-change (13-length) snapshot -- no migration or backfill needed for correctness.
- 2.19 (2026-09-04): no migration -- application code. `TriadsService.rank()` (ADR-68) writes `outcomes.type: 'ranked_later'` (using `triadId`/`rankPosition`, both columns since M5, unused until now) for any ranked title that traces back to a `recommendations` row -- the last `Outcome` type without a writer. Blueprint gap 4 is closed in full.
- 2.18 (2026-09-04): no migration -- application code. `OutcomesService.create()` (new `POST /api/recommendations/:recommendationId/outcome`, ADR-67) writes `outcomes` for the four caller-reportable types (`saved`/`clicked`/`dismissed_not_relevant`/`opened_provider`); `watched` already written by `WatchEventsService` (ADR-66), `ranked_later` still has no writer (needs `TriadsService.rank()` instrumentation). `library_imports` remains M5's only fully unwritten table.
- 2.17 (2026-09-03): no migration -- application code. `WatchEventsService.create()` (new `POST /api/profiles/:profileId/watch-events`, ADR-66) writes to `watch_events` and, when the title traces back to a shown recommendation, `outcomes` (`type: 'watched'`) -- the second and third of M5's four tables to actually be written (after `recommendations`, ADR-58); `library_imports` is the only one still unwritten. §1's note on what's not populated yet, and the M5 migration-plan row, updated to match.
- 2.16 (2026-09-03): eighteenth migration `AddTrainingLanguageDiversity` applied -- adds `titles.originalLanguage varchar` and `user_model_snapshots.trainingLanguageDiversity integer` (blueprint gap 5/gap 6, ADR-64). The second of `BP §9.2`'s three named diversity axes (genre, ADR-62, above): `originalLanguage` is Wikidata P364, a structured field the demo catalog fixture already carries per title, so unlike director (still blocked -- people/credits/source_records stay empty until a real ingestion pass runs against the loaded catalog) this axis needed only a column. `training.py`'s `train_profile()` now reads `originalLanguage` alongside `genres` and writes `trainingLanguageDiversity` the same way `trainingGenreDiversity` is written; `RecommendationsService.confidenceBand()` demotes to `inconclusive` below 2 distinct languages, mirroring the genre check exactly. Verified with a real `up()`/`down()`/`up()` round trip against `postgres-test`, the full backend suite (139/139) and Python suite (96/96).
- 2.15 (2026-09-03): seventeenth migration `AddTrainingGenreDiversity` applied -- adds `user_model_snapshots.trainingGenreDiversity integer` (blueprint gap 5, ADR-62). Same migration lands alongside `posterior` finally being populated (schema unchanged -- that column has existed since M4): `training.py` now writes real per-weight standard errors and a training-genre-diversity count above the same 5-triad floor `heldOutTriadCount` uses. §1's `user_model_snapshots` DDL comments updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test`, the full e2e suite (45/45), and a real (non-automated) `train_profile()` run against `postgres-test` confirming both columns round-trip correctly through actual Postgres.
- 2.14 (2026-09-03): no migration -- application code. `RecommendationsService.findForProfile()` now writes one `recommendations` row per shown result (ADR-58), the first write to any M2–M7 table since the schema plan closed. §1's `recommendations` DDL comment, the entity map and the M5 plan row updated to say so.
- 2.13 (2026-09-03): sixteenth migration `AddM7SharedLatentSpaceVersions` applied -- closes the table half of M7: `shared_latent_space_versions` created, and the `FK_user_model_snapshots_calibratedAgainst` constraint M4 deferred (ADR-54) added now that the target table exists. The other M7 item, converting `embeddings.vector` from `real[]` to pgvector's `vector(n)`, is deliberately not done: no document or code in this repository specifies a dimension `n` -- unlike every other item across all seven steps, this one had no literal target DDL to implement, because no embedding-generation code exists and the table is empty everywhere. Asked the user rather than inventing a product/vendor decision; deferred (ADR-57). This is the only item left open across the entire seven-step migration plan. §1 DDL, the entity map and the M7 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after.
- 2.12 (2026-09-03): fifteenth migration `AddM6PublicQualityAndAvailability` applied -- closes the M6 step in full: `public_quality_sources` and `availability_snapshots` both created (`titleId` cascading with its title, `sourceRecordId` required and pointing at M3's rights registry). Schema only, and further behind than every other step: no licensed public-quality or availability partner is integrated, so nothing can populate either table yet, unlike the other six steps where an application-layer gap is the only thing blocking use. §1 DDL, the entity map and the M6 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after. Only M7 (`shared_latent_space_versions`, pgvector conversion) remains of the original seven-step plan.
- 2.11 (2026-09-03): fourteenth migration `AddM5RecommendationsAndWatchEvents` applied -- closes the M5 step in full: `library_imports`, `recommendations` (with the `("profileId", "createdAt" DESC)` index the DDL specifies), `outcomes`, `watch_events` all created, schema only. `watch_events.importId` carries no FK, matching the target DDL literally even though `library_imports` exists. Nothing writes to any of the four tables yet -- `RecommendationsService` still computes scores per-request without persisting one (blueprint gap 4), and watches are still folded into `user_title_states.watchedAt` only. §1 DDL, the entity map and the M5 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after.
- 2.10 (2026-09-03): thirteenth migration `AddM4ModelVersioningAndExperiments` applied -- closes the M4 step in full: `model_versions`, `experiments`, `experiment_assignments` (composite PK, `FK ... profileId ON DELETE CASCADE`) all created; `user_model_snapshots` gains `posterior`/`recentWeights`/`exceptions`/`calibratedAgainst` plus an index on `("profileId", "createdAt" DESC)`. `calibratedAgainst` is added as a plain `varchar`, not the FK to `shared_latent_space_versions(version)` the target DDL names -- that table is M7's; the constraint itself is deferred to M7 (ADR-54). Schema only. §1 DDL, the entity map and the M4 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after.
- 2.9 (2026-09-03): twelfth migration `AddM3RightsRegistryAndCatalogProvenance` applied -- closes the M3 step in full: `people`, `source_records` (self-referencing `supersededBy`, nullable `titleId`), `localized_titles` (with the `to_tsvector('simple', title)` GIN index the DDL specifies), `title_editions`, `credits`, `content_features` (unique on `titleId`/`featureKey`/`extractorVersion`, self-referencing `supersededBy`) all created, schema only -- no ingestion pass populates them yet, and full-text search hasn't switched off `titles`' ILIKE. §1 DDL, the entity map and the M3 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after.
- 2.8 (2026-09-03): eleventh migration `AddM2ConsentAndAuditTables` applied -- closes the M2 step in full: `consents` (unique on `userId`/purpose/version, `ON DELETE CASCADE`), `privacy_requests` and `audit_log` (no cascade/no FK -- deliberate, see the tombstone note in §1) all created, schema only. §1 DDL, the entity map and the M2 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after.
- 2.7 (2026-09-03): tenth migration `CompleteM1Plan` applied -- closes the M1 step in full: `user_title_state` renamed to `user_title_states` (ADR-16 plural naming), `users.role` (`BP §5.1`), `profiles.pausedAt` (PRIVACY.md §4), `triads.holdout`/`correctsTriadId` (`BP §8.3`/`§13.2`) with two new indexes on `("profileId", "createdAt")` and `("profileId", status)`. §1 DDL, the entity map, and the M1 plan row updated to match; verified with a real `up()`/`down()`/`up()` round trip against `postgres-test` and the full e2e suite (41/41) passing after.
- 2.6 (2026-09-03): ninth migration `AddProfileMarketAndPlatforms` (onboarding, `BP §4.1`) applied -- `profiles.market` (nullable ISO 3166-1 alpha-2) and `profiles.platforms` (text[] default '{}'); §1, the entity map, the target ALTER and the M1 plan updated to match.
- 2.5 (2026-09-03): eighth migration `AddTriadReplacements` (ADR-17) applied -- new `triad_replacements` table (append-only, indexed on `triadId`) and `user_title_state.triadEligible`; §1, the entity map and the M1 plan updated to match.
- 2.4 (2026-09-03): seventh migration `AddTriadEventCompleteness` (ADR-32, gap 3) applied -- `triads.shownAt`/`answeredAt`/`modelVersion`/`idempotencyKey` added, and `ranking` changed from `integer[]` (indices) to `uuid[]` (title ids, ADR-15) with a data backfill. §1, the entity map and the M1 target-plan ALTER updated to match.
- 2.3 (2026-09-03): sixth migration `AddHeldOutTrainingMetrics` (ADR-31, gap 2) applied -- adds `heldOutTriadCount`/`heldOutNll`/`heldOutPairwiseAccuracy` to `user_model_snapshots`; §1 updated and the same three columns removed from the M4 target-plan ALTER (already done, not still pending).
- 2.2 (2026-09-03): fifth migration `AddOneActiveTriadPerProfileConstraint` (ADR-28) applied -- a partial unique index, not a new table; §1's migration count and `triads` DDL updated to match, and the pre-existing "three migrations" text (already stale before this fix -- the list below it named four) corrected. Also noted that `user_model_snapshots.biasTerms` is always `{}` today, since `PlackettLuceRanker.fit()` never populates it (found in the same audit pass).
- 2.1 (2026-09-03): fourth migration `ArabicFirstProfileDefault` applied; `profiles.preferredLanguage` now defaults to `'ar'` in §1, removed from the M1 plan.
- 2.0 (2026-09-03): rewritten. The previous version described an aspirational snake_case DDL that did not match the migrated schema, named a `db/migrations/001_init_schema.sql` that does not exist, and mixed `not_remembered` into the title-state enum; it is replaced by the current-vs-target split above.
