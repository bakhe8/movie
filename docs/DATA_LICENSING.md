# Data Sources & Licensing Guide

**Critical**: Proper licensing prevents legal issues and ensures sustainable business model.

> Consistent with [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) §11: every field, image, and availability record needs its own source/license/confidence/version record (not just a per-provider note) — see `source_records` in [schema.md](schema.md), which now carries `license_status`, `confidence`, `extractor_version`, and `review_status` per row. No scraping of IMDb/TMDB is allowed under any circumstance, licensed or not (blueprint §11.1) — this document's guidance below already reflects that; it hasn't changed.

---

## Summary Matrix

| Source | License | Cost | Commercial Use | Arabic Support | MVP Use | Notes |
|--------|---------|------|-----------------|-----------------|---------|-------|
| **Wikidata** | CC0 (Public Domain) | Free | ✅ Yes | ✅ Yes | ✅ YES | Best for MVP |
| **IMDb Free** | Personal use only | Free | ❌ No | ⚠️ Limited | ❌ NO | Illegal in production |
| **IMDb Commercial** | AWS Data Exchange | $$$$ | ✅ Yes | ⚠️ Limited | ❌ Phase 3+ | Expensive |
| **TMDB Free** | Custom ToS, attribution required (not CC0) | Free | ⚠️ Conditional | ✅ Yes | ❌ Not for ML/recs (display-only, w/ attribution) | Requires written agreement |
| **TMDB Commercial** | Partnership | $$$$ | ✅ Yes | ✅ Yes | ❌ Phase 2+ | Best overall but needs negotiation |
| **JustWatch** | Partnership | $$$$ | ✅ Conditional | ✅ Saudi Arabia | ❌ Phase 2+ | Critical for availability |
| **MovieLens / Tag Genome** | GroupLens research license — commercial/revenue-bearing use requires prior written permission from a GroupLens faculty member (confirmed by reading the README) | Free | ❌ **BLOCKED without permission** | ⚠️ Weak | ❌ Research/offline only until permission obtained | See "❌ Commercial Use Blocked" below — do not seed a live-serving component before permission is documented |

---

## Detailed Analysis

### Wikidata (✅ RECOMMENDED FOR MVP)

**What It Is**: Community-maintained knowledge base (like Wikipedia's database)

**License**: CC0 (Public Domain) - Use freely for any purpose

**Key Facts**:
```
- Movie titles in Arabic and English
- Release dates, directors, genres
- Basic plot descriptions
- Links to IMDb/TMDB/other IDs
- Structured, queryable API
```

**Advantages**:
- ✅ Completely free to use
- ✅ Arabic language support excellent
- ✅ No licensing negotiations needed
- ✅ Can use in production apps immediately
- ✅ Can build derivatives (fingerprints, embeddings)

**Limitations**:
- Less comprehensive than IMDb (500K movies vs 10M)
- Data quality varies (depends on contributors)
- Less detailed reviews/cast info
- Images less consistent

**MVP Strategy**:
```
1. Curate 300-500 popular films manually
2. Fetch base metadata from Wikidata API
3. Add Arabic titles (often available)
4. Enrich with OpenAI fingerprints
5. Later: merge IMDb/TMDB when licensed
```

**API Example**:
```bash
curl "https://www.wikidata.org/w/api.php?action=query&titles=Inception&format=json"

# Get film with Arabic title:
curl "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q23092&props=claims&languages=en|ar"
```

**Legal**: Safe to use, no license agreement needed

---

### IMDb (⚠️ COMPLEX - AVOID FREE VERSION)

#### Free Data Dumps
**Available**: Daily TSV files (movies, ratings, credits)

**License**: "Available for personal use only"

**The Problem**:
```
Personal use = private, non-commercial
❌ Cannot use in web application
❌ Cannot use in monetized app
❌ Cannot sell/distribute derived data
❌ Publishing rankings counts as distribution

"Personal use" means: local analysis on your machine, not public-facing
```

**Legal Risk**: Using free IMDb data in production web app = potential DMCA takedown

**Why It's Tempting**:
- Comprehensive (10M+ movies)
- Trusted ratings
- Arabic translations available

**Why We Can't Use It**:
- ToS explicitly forbids commercial use
- No gray area: it's black-and-white

#### Commercial IMDb (AWS Data Exchange)

**What It Is**: IMDb's official commercial API via AWS

**Cost**: $$$$ (AWS charges per query + volume)

**Features**:
- GraphQL API
- Real-time data
- Commercial use licensed
- Official support

**Advantages**:
- ✅ Legal, guaranteed safe
- ✅ Comprehensive data
- ✅ Official support
- ✅ Real-time updates

**Disadvantages**:
- ❌ Expensive (not viable for MVP)
- ❌ Ongoing licensing costs
- ❌ Arabic support unclear
- ❌ Complex setup (AWS ecosystem)

**When to Use**: Phase 3+ if monetized and profitable

**Action for MVP**: Don't use; defer to Phase 3

---

### TMDB (The Movie Database) (⚠️ CONDITIONAL - READ CAREFULLY)

**What It Is**: Community-maintained movie database (like IMDb but open)

**Free Developer Key**: Available for registration

**The Trap**:
```
Free key ≠ Commercial use
Many developers assume "open" = "free to use everywhere"
This is WRONG for commercial AI/recommendations
```

**TMDB Free Tier ToS Issues**:

1. **AI/ML Restriction**: ToS states restrictions on "training algorithms"
2. **Derivative Works**: Unclear if fingerprints/embeddings count as "derivatives"
3. **Commercial Use**: Requires "explicit written agreement"
4. **Attribution**: Images/data must show "Powered by TMDB"

**Quote from TMDB Terms**:
> "Any data relating to a collection, credit, image, or content must include the link and/or name attribution."

> "Use of Content is subject to additional restrictions and prohibitions, including...commercial exploitation through machine learning algorithms or similar processes that derive value from The Movie Database Content."

**What This Means**:
- ❌ Can't train ranking model on TMDB data
- ❌ Can't generate embeddings from TMDB descriptions
- ✅ Can display search results (with attribution)
- ✅ Can show movie info (with attribution)

### TMDB Commercial Partnership

**If Proceeding with TMDB**:

**Must Negotiate**:
1. Written agreement (not just ToS)
2. **Explicit permission for**:
   - Commercial recommendation engine
   - Training machine learning models
   - Generating embeddings/fingerprints
   - Sending plot summaries to OpenAI
   - Arabic localization
   - Storing derivatives in our database
   - Using for 2+ years
3. **Attribution scope** (how prominently to display "TMDB")
4. **Data retention** (how long to keep copies)
5. **Sublicensing** (if reselling to partners)

**Cost**: Typically $$$-$$$$$ annually (not available publicly; negotiate)

**Timeline**: 4-12 weeks for agreement (start early)

**MVP Decision**: Don't use TMDB free tier in production; wait for commercial agreement

---

### JustWatch (Where to Watch)

**What It Is**: Database of where films are available (streaming services, rental, purchase)

**Critical for Saudi Arabia**: JustWatch covers Saudi streaming landscape

**Partners**: Netflix, Apple TV+, StarzPlay, OSN, others (Saudi-specific)

**Free Tier**: API available but with restrictions

**Commercial Partnership**:
- API access with data export
- Real-time availability updates
- Streaming service links (affiliate?)
- Required for phase 2

### JustWatch Integration Strategy

**Phase 1 (MVP)**: Skip automated integration
```
- Show link: "Where to watch? [Search JustWatch]"
- Manual research by user or team
- No real-time availability
```

**Phase 2**: Partner with JustWatch
```
1. Contact JustWatch "Content Partner" program
2. Get API key + data export
3. Verify Saudi Arabia is supported
4. Update top 10-20 recommendations with real-time availability
5. Show "Available now on [service]"
6. Track "checked_at" timestamp
7. Handle "currently unavailable" gracefully
```

**Key Rules**:
- ✅ Use availability as a filter, not a ranking factor
- ❌ Don't weight "available in Saudi Arabia" in preference model
- ✅ Rank best film first, then filter by availability

---

### MovieLens / Tag Genome (❌ COMMERCIAL USE BLOCKED — confirmed, not merely suspected)

**What It Is**: GroupLens Research (University of Minnesota) rating/tag datasets, proposed elsewhere in this repo's docs (blueprint §7.5, §17.2; RANKING_ALGORITHM.md's "Population Latent Space & Calibration" section) as the pre-launch seed for the shared latent taste space.

**Verified license terms** (checked directly against the GroupLens dataset READMEs — MovieLens 100k, 20M, 25M, 32M, and the standalone Tag Genome dataset all carry the same clause):

> "The user may not use this information for any commercial or revenue-bearing purposes without first obtaining permission from a faculty member of the GroupLens Research Project at the University of Minnesota."

Some dataset versions additionally restrict redistribution without separate permission (wording varies slightly by version — check the README of the *specific* dataset file actually downloaded, not this summary, before use).

**What this means concretely**: this is not a gray area needing interpretation — it is an explicit prior-permission requirement. "Silent" backend use (blueprint §7.6) does not exempt it: seeding a factor model that shapes live triads/recommendations for a commercial product *is* the "commercial or revenue-bearing purpose" the clause is about, regardless of whether the affected user ever sees it disclosed. Tag Genome carries the identical restriction — it is not separately licensed or more permissive than the base MovieLens data.

**Required action before any production use** (mirrors the TMDB Commercial Partnership pattern above — same kind of ask, different counterparty):
1. Contact the GroupLens Research Project (a faculty member, per the license text — https://grouplens.org/datasets/movielens/) and request explicit written permission covering: seeding a production recommendation feature; training a derived factor/embedding model from the ratings and Tag Genome data; that model influencing live commercial recommendations and triad selection; retention duration; attribution requirements.
2. Until that permission is obtained and documented here, MovieLens/Tag Genome are **research/offline use only** — safe for prototyping the factor-model methodology, benchmarking, or internal validation, never for the weights that actually ship in the shared latent space (blueprint §7.5).
3. If permission is not obtained before Alpha needs the bootstrap, seed the shared latent space from the platform's own Alpha-cohort internal data only (slower cold start, zero licensing risk) — already documented as the fallback in blueprint §17.2 and ARCHITECTURE_DECISIONS.md Decision 13.

**Action**: reflected in the Legal Checklist below and in blueprint §17.2's Alpha gate — the population latent space's external bootstrap is blocked on this permission, not merely "worth reviewing."

Sources: [GroupLens MovieLens Datasets](https://grouplens.org/datasets/movielens/), [MovieLens ml-latest README](https://files.grouplens.org/datasets/movielens/ml-latest-README.html), [MovieLens ml-25m README](https://files.grouplens.org/datasets/movielens/ml-25m-README.html), [Tag Genome README](https://files.grouplens.org/datasets/tag-genome/README.html)

---

## MVP Implementation Strategy

### Film Catalog: Build First, License Later

```
Phase 1 Data Strategy:
├── Step 1: Curate 300-500 films manually
│   ├── Include: Popular, diverse, accessible
│   ├── Source: Personal knowledge, IMDB reader, critics lists
│   └── Create internal IDs (FILM_001, FILM_002, etc.)
│
├── Step 2: Fetch base metadata
│   ├── Primary: Wikidata API (CC0, free)
│   ├── Secondary: Google Knowledge Graph (verify its ToS/usage limits before
│   │   relying on it — "free to query" is not a usage license per blueprint
│   │   §11.1; give it its own source_records entry like every other source)
│   └── Fallback: Manual entry
│
├── Step 3: Create fingerprints
│   ├── Use: OpenAI Responses API (with store: false)
│   ├── Based on: Wikidata plot + director + themes
│   └── Store with: model version + confidence
│
├── Step 4: Add external IDs
│   ├── IMDb IDs (from Wikidata links)
│   ├── TMDB IDs (from Wikidata links)
│   ├── Wikidata IDs
│   └── JustWatch IDs (manual for now)
│
└── Step 5: Negotiate commercial licenses
    ├── Contact TMDB (if want comprehensive data)
    ├── Contact JustWatch (for availability layer)
    ├── Keep internal IDs primary (don't depend on them)
    └── Launch Phase 2+ with proper agreements
```

### Database Schema: Support All Sources

```sql
CREATE TABLE titles (
  id UUID PRIMARY KEY,
  internal_id VARCHAR UNIQUE,  -- FILM_001, FILM_002
  
  title_en VARCHAR,
  title_ar VARCHAR,
  
  -- Fingerprint (computed once, reused forever)
  fingerprint JSONB,
  fingerprint_model_version VARCHAR,
  
  -- External IDs (can change, can be null, can be added)
  external_ids JSONB DEFAULT '{
    "imdb": null,
    "tmdb": null,
    "wikidata": "Q123456",
    "justwatch": null
  }',
  
  -- Track data sources for compliance
  data_sources JSONB DEFAULT '{
    "title": "manual|wikidata",
    "plot": "wikidata|openai",
    "genres": "wikidata|manual"
  }'
);

-- Simplified excerpt; schema.md's `source_records` definition is authoritative.
CREATE TABLE source_records (
  id UUID PRIMARY KEY,
  title_id UUID REFERENCES titles,
  field_name VARCHAR,  -- 'plot', 'poster_url'
  value TEXT,
  source VARCHAR,  -- 'wikidata', 'openai', 'manual'
  license VARCHAR,  -- 'CC0', 'proprietary'
  license_status VARCHAR,  -- 'commercial_allowed', 'non_commercial_only', 'pending_review'
  confidence NUMERIC,  -- required per blueprint §11.3 for every extracted attribute
  extractor_version VARCHAR,  -- schema/model version that produced this value, if generated
  review_status VARCHAR,  -- 'unreviewed', 'sampled', 'human_verified'
  retrieved_at TIMESTAMP
);
```

### Rationale: Why Internal IDs First?

**Example of Bad Design**:
```sql
-- BAD: Primary key is TMDB ID
CREATE TABLE titles (
  tmdb_id INTEGER PRIMARY KEY,
  title VARCHAR,
  ...
);

-- Problem: If TMDB partnership fails, schema breaks
-- Problem: If switching to IMDb, need to migrate everything
```

**Better Design**:
```sql
-- GOOD: Internal ID is primary
CREATE TABLE titles (
  internal_id VARCHAR PRIMARY KEY,  -- FILM_001
  external_ids JSONB,              -- tmdb: 12345, imdb: "tt123"
  ...
);

-- Can replace any external source
-- User data always points to internal_id (stable)
-- Can negotiate multiple licenses
```

---

## Legal Checklist Before Launch

- [ ] **Wikidata**: Confirm CC0 license applies to chosen films
- [ ] **OpenAI**: Verify `store: false` in all fingerprinting calls
- [ ] **TMDB** (if using):
  - [ ] Written commercial agreement signed
  - [ ] Arabic use case explicitly allowed
  - [ ] AI/ML use explicitly allowed
  - [ ] Fingerprinting/embedding explicitly allowed
  - [ ] Attribution requirements documented
- [ ] **JustWatch** (if using):
  - [ ] Partnership agreement signed
  - [ ] Saudi Arabia explicitly included
  - [ ] API key and data export access confirmed
- [ ] **IMDb**: Confirmed NOT using free data in production
- [ ] **MovieLens/Tag Genome**: Written permission obtained from a GroupLens faculty member (license requires this for any commercial/revenue-bearing use — confirmed, see detailed section above) BEFORE using it to seed the production shared latent space (blueprint §7.5); confirmed NOT used for live serving until that permission is documented; research/offline use only in the meantime
- [ ] **Privacy**: Data retention/licensing disclosed to users
- [ ] **Attribution**: All data sources credited in UI/docs

---

## If Launch Is Imminent

**Minimum Viable Licensing**:
1. ✅ Wikidata (CC0) - use freely
2. ✅ OpenAI (store: false) - safe
3. ✅ Manual film curation - 100% your IP
4. ❌ Skip TMDB/IMDb/JustWatch for MVP
5. ✅ Add "Data from Wikidata" to credits

**Note**: This approach limits initial catalog but keeps you legally safe.

---

## Red Flags: What NOT to Do

| ❌ Action | ⚠️ Risk | ✅ Better |
|----------|---------|-----------|
| Use IMDb free dumps | DMCA takedown | Use Wikidata + Fallback manual |
| Assume TMDB free tier allows ML | Contract violation | Get written commercial agreement |
| Scrape IMDb/TMDB | Legal action | Use licensed APIs |
| Use TMDB images without attribution | IP violation | Show "Powered by TMDB" + link |
| Send user data to OpenAI | Privacy violation | Set store: false + minimize data |
| Train model on TMDB descriptions | Contract violation | Train on Wikidata + OpenAI output |
| Seed the production shared latent space (blueprint §7.5) from MovieLens/Tag Genome without written GroupLens permission | License violation — commercial use requires prior permission per the README | Get written permission first, or seed from Alpha-cohort internal data only |

---

## Next Steps

1. **Immediate**:
   - [ ] Select 300-500 films manually
   - [ ] Create internal IDs
   - [ ] Document which films to use

2. **Week 1-2**:
   - [ ] Test Wikidata API integration
   - [ ] Build fingerprinting pipeline
   - [ ] Verify OpenAI store: false

3. **Week 3-4** (Parallel):
   - [ ] Seed film catalog in database
   - [ ] Draft TMDB partnership inquiry
   - [ ] Draft JustWatch partnership inquiry

4. **Pre-Launch**:
   - [ ] Legal review of all data sources
   - [ ] Finalize privacy policy
   - [ ] Prepare licensing disclosures

---

**Questions?**
- Licensing: Contact legal team
- Technical: Check platform docs (Wikidata API, OpenAI docs)
- Business: Contact platform partnerships teams
