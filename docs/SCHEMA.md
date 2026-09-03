# Database Schema

**Status**: Derived from blueprint `§13` (entities and event shapes), `§11` (rights registry), `§7.5`–`§7.6`, `§21`. Two layers, kept apart on purpose:

- **§1 Current physical schema** — exactly what the three TypeORM migrations in `apps/backend/src/migrations/` create (verified 2026-09-03). This is the truth for anyone writing SQL today.
- **§2 Target schema** — the `BP §13.1` entity set expressed as tables, plus the migration plan from §1 to §2.

Naming (ADR-16): tables `snake_case` plural; columns are TypeORM's default `camelCase` and therefore **quoted** in raw SQL (`"profileId"`); primary keys `uuid` via `uuid_generate_v4()`; timestamps `TIMESTAMP` (UTC by convention). One exception to plural naming exists today (`user_title_state`); it is renamed in step M1 below. Schema changes go through `npm run migration:generate` / `npm run db:migrate` only — `synchronize` is off in every environment.

---

## 1. Current physical schema (migrated)

Migrations, in order: `1788410140231-InitialSchema`, `1788411790951-AddTriadEventFields`, `1788412500000-SplitImportedRatingFromInAppState`. Extension: `uuid-ossp`. The `ankane/pgvector` image is used but no column has the `vector` type yet.

```sql
users (
  id uuid PK, email varchar UNIQUE NOT NULL, password varchar NOT NULL,   -- bcrypt hash
  "firstName" varchar, "lastName" varchar, active boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
)

profiles (                      -- the pseudonymous taste id (BP §13.1, §21.1)
  id uuid PK, "userId" uuid NOT NULL FK users(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL, "preferredLanguage" varchar(5) NOT NULL DEFAULT 'en',
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

user_title_state (                                               -- exposure + list state, one row per (profile, title)
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE, "titleId" uuid NOT NULL FK titles ON DELETE CASCADE,
  state varchar NOT NULL,                                        -- 'watched' | 'not_watched' | 'watchlist' | 'interested'
  "watchedAt" timestamp,
  "importedRating" real, "ratingSource" varchar,                 -- import-only auxiliary signal; never written by the API (BP §4.2)
  notes text, "updatedAt" timestamp,
  UNIQUE ("profileId", "titleId")
)

triads (                                                         -- one listwise event per row (BP §7.2, §13.2)
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE,
  "titleIds" uuid[] NOT NULL, "displayOrder" uuid[],             -- displayOrder shuffled independently of titleIds
  ranking integer[],                                             -- indices into titleIds, best first; NULL while active
  "policyVersion" varchar, "selectionPropensity" real, "experimentId" varchar,
  "sessionId" varchar, metadata json,                            -- { replacements?, reasonForSelection?, modelVersion? } — replacements never written yet
  status varchar NOT NULL DEFAULT 'active',                      -- 'active' | 'completed' | 'skipped'
  "createdAt" timestamp                                          -- doubles as shownAt today; no answeredAt column
)

user_model_snapshots (                                           -- one row per training run (BP §13.1 taste_profiles, partial)
  id uuid PK, "profileId" uuid NOT NULL FK profiles ON DELETE CASCADE,
  weights real[] NOT NULL,                                       -- θᵤ over FINGERPRINT_DIMENSIONS order (13 today)
  "biasTerms" json,                                              -- { titleId: δ }
  "modelVersion" varchar NOT NULL, "trainingTriadCount" integer NOT NULL,
  "validationAccuracy" real, "pairwiseAccuracy" real,            -- pairwiseAccuracy is in-sample today
  "createdAt" timestamp
)
```

Indexes: primary keys and the unique constraints above only. Views: none.

What is **not** in the database today (see §2 for the target): recommendations log, outcomes, watch events, triad replacements, consents/privacy requests, rights registry (`source_records`), per-feature content features, localized titles, model versions/experiments, shared latent space versions, audit log, admin roles.

---

## 2. Target schema (`BP §13.1`) and migration plan

### 2.1 Entity map

| Blueprint entity (`§13.1`) | Target table(s) | Status today |
|---|---|---|
| users / identities | `users`, `profiles` (+ `market`, `platforms`, `role`) | partial |
| content_items / editions | `titles`, `title_editions` | `titles` only |
| localized_titles | `localized_titles` | missing (search is ILIKE on two columns) |
| credits / people | `people`, `credits` | missing |
| content_features | `content_features` (per-feature rows) + `titles.fingerprint` (published snapshot) | fingerprint JSON only, no provenance rows |
| watch_events | `watch_events` | folded into `user_title_state.watchedAt` |
| triad_events | `triads` | present, missing `answeredAt`, `modelVersion` column, idempotency key |
| triad_replacements | `triad_replacements` | missing |
| taste_profiles | `user_model_snapshots` (+ posterior, time layers, exceptions) | partial |
| recommendations | `recommendations` | missing |
| outcomes | `outcomes` | missing |
| model_versions / experiments | `model_versions`, `experiments`, `experiment_assignments` | missing |
| consents / privacy_requests | `consents`, `privacy_requests` | missing |
| (rights registry, `§11.1`) | `source_records` | missing |
| (shared latent space, `§7.5`) | `shared_latent_space_versions` | missing |
| (audit, `§21.3`) | `audit_log` | missing |

### 2.2 Target DDL

Types follow the conventions above. Columns marked `-- BP` are required by the cited section; unmarked columns are this repo's elaboration.

```sql
-- Accounts and taste ids -----------------------------------------------------------
ALTER TABLE users    ADD COLUMN role varchar NOT NULL DEFAULT 'user';            -- 'user' | 'admin' (BP §5.1 admin board)
ALTER TABLE profiles ADD COLUMN market varchar(2),                              -- ISO 3166-1; display/availability only (BP §4.1)
                     ADD COLUMN platforms text[] NOT NULL DEFAULT '{}',         -- user-declared providers (BP §4.1, App. C)
                     ADD COLUMN "pausedAt" timestamp;                           -- 'pause_all' restriction (PRIVACY.md §4)
ALTER TABLE profiles ALTER COLUMN "preferredLanguage" SET DEFAULT 'ar';         -- Arabic-first (BP §2)

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
ALTER TABLE user_title_states ADD COLUMN "triadEligible" boolean NOT NULL DEFAULT true;  -- false after 'not_remembered' (ADR-17)
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
ALTER TABLE triads ADD COLUMN "shownAt" timestamp,                              -- BP §13.2
                   ADD COLUMN "answeredAt" timestamp,                           -- BP §13.2
                   ADD COLUMN "modelVersion" varchar,                           -- BP §13.2 (out of metadata json)
                   ADD COLUMN "idempotencyKey" uuid UNIQUE,                     -- BP §14
                   ADD COLUMN "correctsTriadId" uuid FK triads(id),             -- append-only corrections (BP §13.2)
                   ADD COLUMN "holdout" boolean NOT NULL DEFAULT false;         -- reserved for validation, never trained on (BP §8.3, §16.1)
CREATE INDEX ON triads ("profileId", "createdAt");
CREATE INDEX ON triads ("profileId", status);

triad_replacements (                                                            -- BP §4.3, §13.1
  id uuid PK, "triadId" uuid NOT NULL FK triads ON DELETE CASCADE,
  "replacedTitleId" uuid NOT NULL FK titles, "replacementTitleId" uuid FK titles,
  reason varchar NOT NULL,             -- 'not_watched' | 'not_remembered'
  "createdAt" timestamp NOT NULL DEFAULT now()
)

-- Models -----------------------------------------------------------------------------
ALTER TABLE user_model_snapshots
  ADD COLUMN posterior json,                                                    -- per-weight uncertainty (BP §13.1)
  ADD COLUMN "recentWeights" real[],                                            -- recent-window layer (BP §7.3); NULL in MVP
  ADD COLUMN exceptions json,                                                   -- [{ titleId, delta, tagged }] (BP §7.4)
  ADD COLUMN "heldOutTriadCount" integer, ADD COLUMN "heldOutNll" real,
  ADD COLUMN "heldOutPairwiseAccuracy" real,                                    -- replaces in-sample pairwiseAccuracy as the reported metric
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
| M1 | rename `user_title_state` → `user_title_states`; `profiles.market/platforms`; `preferredLanguage` default `'ar'`; `users.role`; `triads.shownAt/answeredAt/modelVersion/idempotencyKey/holdout/correctsTriadId` + indexes; `triad_replacements`; `user_title_states.triadEligible` | replacement endpoint, event completeness (`BP §13.2`, `§14`) |
| M2 | `consents`, `privacy_requests`, `audit_log` | onboarding consent, export/delete/reset |
| M3 | `source_records`, `content_features`, `localized_titles`, `people`, `credits`, `title_editions` | rights registry, FTS search, provenance |
| M4 | `model_versions`, `experiments`, `experiment_assignments`; `user_model_snapshots` additions | reproducibility, held-out metrics |
| M5 | `recommendations`, `outcomes`, `watch_events`, `library_imports` | persisted recommendations, post-watch loop, imports |
| M6 | `public_quality_sources`, `availability_snapshots` | Public Quality and Watchability layers (need licensed sources first) |
| M7 | `shared_latent_space_versions`; `embeddings.vector` → pgvector `vector(n)` + IVFFLAT index | `BP §7.5`; semantic candidate retrieval |

---

**Changelog**
- 2.0 (2026-09-03): rewritten. The previous version described an aspirational snake_case DDL that did not match the migrated schema, named a `db/migrations/001_init_schema.sql` that does not exist, and mixed `not_remembered` into the title-state enum; it is replaced by the current-vs-target split above.
