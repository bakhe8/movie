# Database Schema - Phase 1

## Users & Profiles

### `users` table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `profiles` table (Individual taste profiles)
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- pseudonymous taste id: this is what triads/recommendations/model tables reference
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- account identity; kept separate per blueprint §13.1/§21.1
  name VARCHAR(255) NOT NULL, -- e.g., "My Profile", "Mom's Profile"
  preferred_language VARCHAR(5) DEFAULT 'ar', -- interface/market only: 'ar' or 'en'; never used as a taste prior (blueprint §4.1, §10.2)
  region VARCHAR(10), -- for availability/localization only, not a taste prior
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);
```

> `profiles.id` is the pseudonymous "taste id" the blueprint requires (§13.1: "هوية الحساب منفصلة عن معرف ذوق مستعار"). All model/event tables (triads, recommendations, taste snapshots) join on `profile_id`, not `user_id`, so a data or model export never needs to touch account identity directly.

## Film Catalog

### `titles` table
```sql
CREATE TABLE titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_id VARCHAR(50) UNIQUE NOT NULL, -- Our internal ID (FILM001, FILM002, etc.)
  title_en VARCHAR(255) NOT NULL,
  title_ar VARCHAR(255),
  description TEXT,
  release_year INTEGER,
  genres TEXT[], -- ['Drama', 'Sci-Fi', 'Thriller']
  external_ids JSONB DEFAULT '{}', -- { "imdb": "tt1234567", "tmdb": 12345, "wikidata": "Q..." }
  fingerprint JSONB, -- Stores FilmFingerprintV1 schema
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (internal_id),
  INDEX USING GIN (genres)
);
```

### `embeddings` table (pgvector)
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  vector vector(1536), -- OpenAI embedding dimension
  model_version VARCHAR(50),
  embedding_type VARCHAR(50), -- 'fingerprint' or 'hybrid'
  metadata JSONB DEFAULT '{}', -- { "generatedBy": "openai", "confidence": 0.95 }
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(title_id, embedding_type, model_version),
  INDEX USING IVFFLAT (vector vector_cosine_ops) WITH (lists = 100)
);
```

## User State

### `user_title_state` table
```sql
CREATE TABLE user_title_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  state VARCHAR(50) NOT NULL, -- 'watched', 'not_watched', 'not_remembered', 'watchlist', 'interested'
  watched_date TIMESTAMP,
  watch_source VARCHAR(50), -- 'import' | 'manual' | 'in_app'; how we know they watched it
  watched_audio_language VARCHAR(10), -- the edition/version watched, when known (blueprint §6.2, §13.1 watch_events)
  watched_subtitle_language VARCHAR(10), -- optional; a viewing-experience signal feeding Watchability, never the work-level fingerprint
  watch_provider VARCHAR(100), -- platform/market watched on, when known
  imported_rating NUMERIC(2, 1), -- optional, from an imported list only (e.g. CSV import)
  rating_source VARCHAR(50), -- 'import' only; never written by an in-app post-watch prompt
  notes TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id, title_id),
  INDEX (profile_id, state)
);
```

> Per the blueprint (§4.5, §4.2): the app never asks for a star rating after a watch. The only explicit preference signal is a triad ranking. `imported_rating` exists solely to hold a rating that arrived with an imported watch list (e.g. a CSV of a user's history) — it is a low-confidence auxiliary signal, never a substitute for triads, and no UI flow should collect it directly. `not_remembered` is a distinct neutral state from `not_watched`: both are exposure-unknown, not a negative preference signal, but they trigger different UI copy ("haven't watched" vs "don't recall it well enough to rank"). `watch_source`, `watched_audio_language`, `watched_subtitle_language`, and `watch_provider` are optional and inferred from the provider when possible — the blueprint separates the work itself from the edition/version and the individual watch event, and treats dub/subtitle quality as a viewing-experience signal that feeds Watchability, not a work-level attribute (§6.2, §13.1 `watch_events`).

## Triadic Rankings

### `triads` table (Core event table)
```sql
CREATE TABLE triads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- The three films in this triad
  title_id_1 UUID NOT NULL REFERENCES titles(id),
  title_id_2 UUID NOT NULL REFERENCES titles(id),
  title_id_3 UUID NOT NULL REFERENCES titles(id),
  
  -- Display order on screen (may differ from ranking order)
  display_order INTEGER[] DEFAULT '{0,1,2}', -- [0,1,2] or permutation
  
  -- User's preference ranking (indices: 0=1st place, 1=2nd, 2=3rd)
  ranking INTEGER[] DEFAULT NULL, -- NULL if incomplete/skipped
  
  -- Metadata about the triad
  session_id VARCHAR(50),
  model_version_used VARCHAR(50), -- Which ranker generated this triad
  policy_version VARCHAR(50), -- Which triad-selection policy chose these 3 (blueprint §8, §13.2)
  selection_propensity NUMERIC(10, 8), -- P(policy picked this triad); required for unbiased off-policy eval (blueprint §8.2)
  experiment_id VARCHAR(50),
  reason_for_selection TEXT, -- Why these three were selected
  
  -- Replacements for "haven't watched" / "don't remember" — neutral, never a preference signal
  title_id_1_original UUID REFERENCES titles(id), -- Original before replacement
  title_id_2_original UUID REFERENCES titles(id),
  title_id_3_original UUID REFERENCES titles(id),
  replacements JSONB DEFAULT '{}', -- { "1": {"original_id": "...", "reason": "not_watched" | "not_remembered"} }
  
  -- Status
  status VARCHAR(50) DEFAULT 'completed', -- 'active', 'completed', 'skipped'
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX (profile_id, created_at),
  INDEX (profile_id, status)
);
```

> The full ranking is stored and trained as a single listwise event (A > B > C), never decomposed into three independent pairwise rows in storage — decomposing into pairs is only a post-hoc *evaluation* technique (pairwise accuracy), not how the event is persisted or fit (blueprint §7.2 "قرار رياضي"). A triad and all its pairs stay together in any train/test split (blueprint §16.1).

## Recommendations

### `recommendations` table
```sql
CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES titles(id),
  
  -- Three separate scores; NEVER merged into one number (blueprint §4.4, principle #7)
  personal_fit_score NUMERIC(10, 8),   -- θᵀφ + δ portion: ranking-derived fit, this user only
  public_quality_score NUMERIC(10, 8), -- normalized critic/audience prior, shown independently
  watchability_score NUMERIC(10, 8),   -- availability now: market, platform, dub/subtitle
  confidence_band VARCHAR(20),         -- 'initial' | 'likely' | 'strong' | 'inconclusive' (blueprint §9.3)
  confidence_raw NUMERIC(3, 2),        -- internal only; do not surface as a bare "% you'll like this" until calibrated
  track VARCHAR(20),                   -- 'safe' | 'discovery' | 'outside_usual' (blueprint §4.4)
  explanation TEXT,                    -- no-spoiler, generated only from features that actually drove the score
  
  -- Why this recommendation (top factors)
  top_reasons JSONB DEFAULT '[]', -- [{ dimension: 'ambiguity', weight: 0.8, contribution: 0.64 }]
  similar_titles UUID[],
  
  -- Model that generated this
  model_version VARCHAR(50),
  policy_version VARCHAR(50),
  experiment_id VARCHAR(50),
  selection_propensity NUMERIC(10, 8), -- P(this candidate was shown), for unbiased off-policy eval
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Tracking engagement (implicit outcomes only — save/click/watch/later re-rank; see blueprint §13.1 `outcomes`)
  shown_at TIMESTAMP,
  clicked_at TIMESTAMP,
  watched_at TIMESTAMP,
  -- No like/dislike/thumbs field here: per blueprint principle #2 (§2.4) and §4.5, the triad
  -- ranking is the ONLY explicit preference signal. A watched title's real feedback is captured
  -- by feeding it back into a later triad, not by a direct rating widget on the recommendation.
  
  INDEX (profile_id, personal_fit_score DESC),
  INDEX (profile_id, generated_at DESC)
);
```

> The blueprint forbids collapsing Personal Fit, Public Quality and Watchability into a single displayed number (§4.4), and forbids showing an uncalibrated probability like "91% you'll like this" (§7.2) — the UI shows `confidence_band`'s verbal category (أولي/محتمل/قوي/غير محسوم), not `confidence_raw`, until that number is calibrated against confirmed post-watch outcomes.

## Model Training

### `user_model_snapshots` table
```sql
CREATE TABLE user_model_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Model state
  weights NUMERIC(20, 10)[], -- Weight vector
  bias_terms JSONB DEFAULT '{}', -- { "title_id": 0.1, ... }
  
  -- Training metadata
  model_version VARCHAR(50),
  training_triad_count INTEGER,
  validation_accuracy NUMERIC(5, 4),
  pairwise_accuracy NUMERIC(5, 4),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX (profile_id, created_at DESC)
);
```

### `global_model_versions` table
```sql
CREATE TABLE global_model_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) UNIQUE NOT NULL, -- 'v1', 'v1.1', etc.
  fingerprint_schema_version VARCHAR(50),
  ranker_type VARCHAR(50), -- 'plackett-luce'
  
  -- Fingerprinting model
  fingerprint_model_name VARCHAR(100), -- vendor/model actually used for extraction; not fixed by the blueprint (an implementation choice under §15.3), so don't hard-code an example model name here
  fingerprint_model_version VARCHAR(50),
  
  -- Benchmark results
  avg_pairwise_accuracy NUMERIC(5, 4),
  baseline_comparison JSONB, -- { "popularity": 0.52, "genre": 0.54 }
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN DEFAULT false,
  
  INDEX (active, created_at DESC)
);
```

## Data Lineage (Source Attribution)

### `source_records` table
```sql
CREATE TABLE source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID NOT NULL REFERENCES titles(id),
  field_name VARCHAR(50), -- 'description', 'poster_url', 'fingerprint'
  value TEXT,
  source VARCHAR(100), -- 'manual', 'wikidata', 'openai', 'tmdb'
  license VARCHAR(255), -- 'CC0', 'CC-BY', 'proprietary', etc.
  license_status VARCHAR(50), -- 'commercial_allowed', 'non_commercial_only', 'pending_review'
  confidence NUMERIC(3, 2), -- required per blueprint §11.3 for every extracted attribute
  extractor_version VARCHAR(50), -- schema/model version that produced this value, if generated
  review_status VARCHAR(50), -- 'unreviewed', 'sampled', 'human_verified'
  superseded_by UUID REFERENCES source_records(id), -- prior value is never silently overwritten (blueprint §11.3)
  retrieved_at TIMESTAMP,
  valid_from TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> Blueprint §11.3 rules apply here: a missing value is `NULL`/unknown, never `false` or `0`; no source value is replaced silently — a correction creates a new row (`superseded_by` links back) so the change history survives; every generated (non-manual) value carries `source_ids`, `confidence`, `extractor_version`, and `review_status`.

## Indexes for Performance

```sql
-- Fast lookups
CREATE INDEX idx_titles_internal_id ON titles(internal_id);
CREATE INDEX idx_triads_profile_created ON triads(profile_id, created_at DESC);
CREATE INDEX idx_recommendations_profile_confidence ON recommendations(profile_id, confidence_raw DESC); -- was `confidence`, a leftover from before personal_fit_score/public_quality_score/watchability_score/confidence_band were split apart

-- pgvector similarity search
CREATE INDEX idx_embeddings_vector ON embeddings USING IVFFLAT (vector vector_cosine_ops);

-- Text search (future)
CREATE INDEX idx_titles_fulltext ON titles USING GIN (to_tsvector('english', title_en));
```

## Views (Query Helpers)

### User progress
```sql
CREATE VIEW v_profile_progress AS
SELECT 
  p.id as profile_id,
  u.email,
  COUNT(DISTINCT t.id) as total_triads,
  COUNT(DISTINCT CASE WHEN t.ranking IS NOT NULL THEN t.id END) as completed_triads,
  COUNT(DISTINCT uws.title_id) as titles_watched,
  COUNT(DISTINCT r.id) as recommendations_generated
FROM profiles p
JOIN users u ON p.user_id = u.id
LEFT JOIN triads t ON p.id = t.profile_id
LEFT JOIN user_title_state uws ON p.id = uws.profile_id
LEFT JOIN recommendations r ON p.id = r.profile_id
GROUP BY p.id, u.email;
```

### Model accuracy tracking
```sql
CREATE VIEW v_model_accuracy AS
SELECT 
  v.version,
  v.avg_pairwise_accuracy,
  v.baseline_comparison::TEXT as baselines,
  v.created_at,
  COUNT(DISTINCT s.profile_id) as profiles_using_this
FROM global_model_versions v
LEFT JOIN user_model_snapshots s ON s.model_version = v.version
GROUP BY v.id;
```

## Migration Strategy

1. Create all tables with `CREATE TABLE IF NOT EXISTS`
2. Add extensions (`pgvector`, `uuid-ossp`)
3. Create indexes
4. Create views
5. Seed initial film catalog (300-500 films)
6. Grant appropriate permissions

See `db/migrations/001_init_schema.sql` for full DDL.
