# Database Schema

**Status**: Derived from blueprint `§13` (entities and event shapes), `§11` (rights registry), `§7.5`–`§7.6`, `§21`. Two layers, kept apart on purpose:

- **§1 Current physical schema** — exactly what the twelve TypeORM migrations in `apps/backend/src/migrations/` create (verified 2026-09-03). This is the truth for anyone writing SQL today.
- **§2 Target schema** — the `BP §13.1` entity set expressed as tables, plus the migration plan from §1 to §2.

Naming (ADR-16): tables `snake_case` plural; columns are TypeORM's default `camelCase` and therefore **quoted** in raw SQL (`"profileId"`); primary keys `uuid` via `uuid_generate_v4()`; timestamps `TIMESTAMP` (UTC by convention). The one plural-naming exception (`user_title_state`) was renamed to `user_title_states` in M1. Schema changes go through `npm run migration:generate` / `npm run db:migrate` only — `synchronize` is off in every environment.

---

## 1. Current physical schema (migrated)

Migrations, in order: `1788410140231-InitialSchema`, `1788411790951-AddTriadEventFields`, `1788412500000-SplitImportedRatingFromInAppState`, `1788418200000-ArabicFirstProfileDefault`, `1788421102891-AddOneActiveTriadPerProfileConstraint`, `1788424108820-AddHeldOutTrainingMetrics`, `1788425067800-AddTriadEventCompleteness`, `1788428400000-AddTriadReplacements`, `1788432000000-AddProfileMarketAndPlatforms`, `1788435000000-CompleteM1Plan`, `1788438000000-AddM2ConsentAndAuditTables`, `1788440000000-AddM3RightsRegistryAndCatalogProvenance`. Extension: `uuid-ossp`. The `ankane/pgvector` image is used but no column has the `vector` type yet.

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
  weights real[] NOT NULL,                                       -- θᵤ over FINGERPRINT_DIMENSIONS order (13 today)
  "biasTerms" json,                                              -- { titleId: δ }; PlackettLuceRanker.fit() never populates this yet, so it is always {} today
  "modelVersion" varchar NOT NULL, "trainingTriadCount" integer NOT NULL,
  "validationAccuracy" real, "pairwiseAccuracy" real,            -- pairwiseAccuracy is in-sample today
  "heldOutTriadCount" integer, "heldOutNll" real, "heldOutPairwiseAccuracy" real,  -- NULL below the 5-triad floor (ADR-31); heldOutPairwiseAccuracy is the out-of-sample counterpart to pairwiseAccuracy above
  "createdAt" timestamp
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
  id uuid PK, "userId" uuid NOT NULL FK users(id),                -- no ON DELETE clause (matches target DDL) -- see note below
  type varchar NOT NULL,                                         -- 'export' | 'delete' | 'reset'
  status varchar NOT NULL,                                       -- 'requested' | 'verifying' | 'scheduled' | 'running' | 'done' | 'cancelled'
  "requestedAt" timestamp NOT NULL, "executeAfter" timestamp, "completedAt" timestamp,
  "artifactUrl" varchar, "executionLog" json,
  INDEX ("userId")
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
```

Indexes: primary keys and the unique constraints above, the partial unique index on `triads` noted above, `IDX_triad_replacements_triadId`, and the M2/M3 indexes noted inline above. Views: none.

`privacy_requests.userId` has no `ON DELETE` action and `audit_log.actorUserId` has no FK at all, on purpose: PRIVACY.md §5 requires both to survive as a tombstone after the user they name is deleted, which is in tension with a NOT NULL FK to a row a delete flow would remove. No delete flow exists yet (blueprint gap 7) — this is deliberately left for whoever builds it to resolve (`SET NULL` vs. a denormalized snapshot of the deleted user), not decided silently here.

`source_records.titleId` and `content_features.supersededBy` follow the DDL literally too: `source_records` is nullable on `titleId` (a record can describe something other than one title) and both `source_records.supersededBy`/`content_features.supersededBy` are self-referencing FKs with no `ON DELETE` action — a correction is a new row, the old one is never deleted, so there is nothing for a cascade to do.

What is **not** in the database today (see §2 for the target): recommendations log, outcomes, watch events, model versions/experiments, shared latent space versions. (`users.role` exists since M1 but no admin board reads it yet; `consents`/`privacy_requests`/`audit_log` exist since M2 but nothing writes to them yet — that's blueprint gap 7 and PRIVACY.md §5's rights endpoints; `source_records`/`content_features`/`localized_titles`/`title_editions`/`people`/`credits` exist since M3 but nothing populates them yet — that needs licensed sources and a real ingestion pass, blueprint gap 6/9.)

---

## 2. Target schema (`BP §13.1`) and migration plan

### 2.1 Entity map

| Blueprint entity (`§13.1`) | Target table(s) | Status today |
|---|---|---|
| users / identities | `users` (+ `role`, since M1), `profiles` (+ `market`/`platforms` since `AddProfileMarketAndPlatforms`, `pausedAt` since M1) | partial — no admin board or `pause_all` flow reads these columns yet |
| content_items / editions | `titles`, `title_editions` | `title_editions` present since M3, empty; search is still ILIKE on `titles` |
| localized_titles | `localized_titles` | present since M3, empty — search is still ILIKE on two `titles` columns, not yet switched to the GIN index on `localized_titles.title` |
| credits / people | `people`, `credits` | present since M3, empty |
| content_features | `content_features` (per-feature rows) + `titles.fingerprint` (published snapshot) | `content_features` present since M3, empty; `titles.fingerprint` still the only populated provenance |
| watch_events | `watch_events` | folded into `user_title_state.watchedAt` |
| triad_events | `triads` | present; `shownAt`/`answeredAt`/`modelVersion`/`idempotencyKey` exist (ADR-32), `holdout`/`correctsTriadId` since M1 — both always their default today, no policy sets `holdout` and no correction flow exists |
| triad_replacements | `triad_replacements` | present (ADR-17, migration `AddTriadReplacements`) |
| taste_profiles | `user_model_snapshots` (+ posterior, time layers, exceptions) | partial |
| recommendations | `recommendations` | missing |
| outcomes | `outcomes` | missing |
| model_versions / experiments | `model_versions`, `experiments`, `experiment_assignments` | missing |
| consents / privacy_requests | `consents`, `privacy_requests` | present since M2 — no route reads/writes them yet (blueprint gap 7, PRIVACY.md §5) |
| (rights registry, `§11.1`) | `source_records` | present since M3, empty |
| (shared latent space, `§7.5`) | `shared_latent_space_versions` | missing |
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
| M3 ✅ | `source_records`, `content_features`, `localized_titles`, `people`, `credits`, `title_editions` — all applied by `AddM3RightsRegistryAndCatalogProvenance` | rights registry, FTS search, provenance — schema only; nothing populates these tables yet, and search hasn't switched off ILIKE |
| M4 | `model_versions`, `experiments`, `experiment_assignments`; `user_model_snapshots` additions (`posterior`, `recentWeights`, `exceptions`, `calibratedAgainst` — held-out metrics already exist, ADR-31) | reproducibility, calibration |
| M5 | `recommendations`, `outcomes`, `watch_events`, `library_imports` | persisted recommendations, post-watch loop, imports |
| M6 | `public_quality_sources`, `availability_snapshots` | Public Quality and Watchability layers (need licensed sources first) |
| M7 | `shared_latent_space_versions`; `embeddings.vector` → pgvector `vector(n)` + IVFFLAT index | `BP §7.5`; semantic candidate retrieval |

---

**Changelog**
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
