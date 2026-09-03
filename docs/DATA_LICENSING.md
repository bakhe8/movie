# Data Sources, Rights and Licensing

**Status**: Derived from blueprint `§11` (rights registry per field, catalog pipeline, data-quality rules), `§4.2` (user imports), `§7.5` (external seed data), `§17.1` (research catalog), `App. B` (pre-launch checklist), `App. D` (sources). Decisions: ADR-13, ADR-19, ADR-23.
**Not legal advice.** Terms quoted or paraphrased here were read on the dates stated; they change. Gate 4 (`BP` executive summary) requires a documented rights registry and a legal review **before any commercial launch**.
**Version**: 2.0 — 2026-09-03.

---

## 1. The rule: access is not a license (`BP §11.1`)

Every field, image, clip, score and availability record has a row in the rights registry (`source_records` in [SCHEMA.md](SCHEMA.md)) with: source, right type, attribution required, permission to store / derive / train, retention, and fallback plan. Nothing is displayed, derived from, or trained on without a registry row whose `licenseStatus` allows that use. Missing values are `NULL`, never `0`/`false` (`BP §11.3`). Scraping IMDb, TMDB or any provider is prohibited in every phase, licensed or not.

## 2. Summary matrix

| Source | What it gives | Terms (as understood; verify) | Allowed use for us | Phase |
|---|---|---|---|---|
| **Wikidata** | ids, titles in many languages incl. Arabic, year, credits, countries, links to other ids | CC0 | display, store, derive, train | Phase 0 seed ([م14]) |
| **IMDb non-commercial datasets** | titles, ratings, credits | personal/non-commercial only ([م15]) | offline research and baselines only; **never** in a served component | research |
| **IMDb commercial (AWS Data Exchange)** | licensed metadata/ratings | paid agreement | anything the contract allows | later, if economics justify |
| **TMDB API** | metadata, alternate titles, languages, images | free key for non-commercial use; commercial use requires an agreement; attribution required; the terms restrict use of TMDB content for AI/ML purposes — exact scope to be confirmed by counsel ([م16], [م26]) | none in production until a written commercial agreement covers display, storage, derivation, fingerprinting and Arabic localization | Closed Beta+ if agreed |
| **Availability provider (e.g. JustWatch partner program)** | where to watch per market, audio/subtitles | partner agreement; no public free API; no scraping | dated availability snapshots for Watchability; filter/context only, never a taste feature | Closed Beta+ (`BP App. C`: user-declared platforms in MVP) |
| **MovieLens / Tag Genome (GroupLens)** | ratings, tags | research license: commercial or revenue-bearing use requires prior written permission from a GroupLens faculty member ([م17]) | offline baselines and methodology prototyping only until permission is documented; **blocked** for seeding the production shared latent space | research; Alpha seed only with permission |
| **User-uploaded lists (CSV)** | the user's own watch history and ratings | user's data, processed under the `import_processing` consent | watch events (`source=import`), `importedRating` as low-confidence auxiliary data (`BP §4.2`) | Alpha (`BP §14`) |
| **LLM outputs (our fingerprints and explanations)** | derived features | our derivative under the provider's terms; inputs must themselves be licensed for derivation | store, derive, train; provenance recorded per feature (`BP §13.3`) | Phase 0+ |
| **Posters / stills** | display assets | per-image rights; TMDB images need the TMDB agreement and attribution; Wikimedia Commons images carry their own licenses | display only with a registry row; otherwise show a text card | any |
| **Google Knowledge Graph / other "free to query" APIs** | facts | usage terms ≠ derivation license | verify terms; registry row per value; otherwise do not use | — |

## 3. Source notes

### 3.1 Wikidata (Phase 0 primary)

CC0: free for any purpose, no attribution obligation (we credit it anyway). Coverage and quality vary by film; Arabic labels are often present. Use the entity API/SPARQL with provenance (`sourceRecordId` per value). Do not rely on it alone for plot text quality — that is the LLM enrichment's job, and the enrichment input must itself be rights-clear.

### 3.2 IMDb

The free datasets are explicitly non-commercial; using them in a served commercial product is a violation, not a gray area. They may be used for offline baselines (`BP §16.3`) in research notebooks. Commercial data via AWS Data Exchange is a later economic decision.

### 3.3 TMDB

Free developer keys are for non-commercial use; a commercial recommendation product needs a written agreement that explicitly covers: commercial recommendations, storing data, generating fingerprints/embeddings, sending synopses to an LLM, Arabic localization, image display and attribution scope, retention, and term. Start the conversation early (weeks, not days). Until then TMDB data is not in the production catalog.

### 3.4 Availability

`BP App. C` leaves the MVP choice open: user-declared platforms vs a licensed partner. MVP uses user-declared platforms plus a "where to watch" link; a partner integration (with market coverage for Saudi Arabia confirmed in writing, SLA, freshness and attribution) is a Closed Beta item. Availability is always a filter and a Watchability value, never a ranking feature (`BP §6`, `§10.2`).

### 3.5 MovieLens / Tag Genome — blocked for production seeding without permission

The GroupLens dataset READMEs state that the data may not be used for commercial or revenue-bearing purposes without first obtaining permission from a GroupLens faculty member; some versions also restrict redistribution. Seeding a live component that shapes commercial recommendations is such a use even if it is silent to users (`BP §7.6` changes what is *said*, not what the license covers). Actions:

1. Request written permission from GroupLens covering: seeding a production factor model, training derived models, influence on live recommendations and triad selection, retention, attribution.
2. Until documented here, MovieLens/Tag Genome are research/offline only.
3. If not obtained before Alpha, the shared latent space starts from Alpha-cohort data (`BP §17.2` fallback; ADR-13).

Check the README of the exact dataset file downloaded; wording differs slightly between versions.

### 3.6 LLM-derived data (OpenAI)

Our fingerprints and explanations are our derivatives, but only if the inputs were licensed for derivation (Wikidata facts, our own synopses, licensed provider text). Never feed copied reviews or scraped text. Rules and pipeline: [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §5; privacy: [PRIVACY.md](PRIVACY.md) §6.

### 3.7 User imports

The user uploads a file they are entitled to (e.g. an export from a service that allows it). We process it under a specific consent, delete the raw file after parsing, and keep only matched watch events and, if present, `importedRating` with `ratingSource='import'`. OAuth integrations with providers are reviewed later (`BP §4.2`).

## 4. Phase 0 research catalog (`BP §17.1`, `§18` weeks 1–2)

1. Select 300–500 feature films balanced across Arabic and international cinema and popularity tiers; assign stable `internalId`s.
2. Fetch facts and multilingual titles from Wikidata with a registry row per value.
3. Add alternate/localized titles (`localized_titles`) for search.
4. Run enrichment on rights-clear inputs; publish V1 fingerprints with provenance and review sampling per language.
5. Posters only where a registry row allows display; otherwise text cards.
6. Record the catalog's coverage and quality by language, country and popularity (`BP §11.3`).

The 15 hand-entered titles in `apps/backend/src/scripts/seed.ts` are development fixtures with `licenseStatus: 'unknown'`; they must not appear in any external test.

## 5. Attribution

Credits page and API metadata list every source actually used with the attribution each requires (Wikidata credit; TMDB logo/link if and when licensed; provider attribution per contract). Attribution strings are stored with the registry row, not hard-coded in the UI.

## 6. Pre-launch legal checklist (`BP App. B`, Gate 4)

- [ ] Rights registry populated for every field, image and availability value in the catalog
- [ ] Wikidata provenance recorded per value
- [ ] IMDb free data confirmed absent from every served component
- [ ] TMDB: written commercial agreement covering the uses in §3.3, or TMDB absent from production
- [ ] Availability partner: agreement with Saudi coverage, SLA, attribution — or user-declared platforms only
- [ ] MovieLens/Tag Genome: written GroupLens permission documented, or not used in any served component
- [ ] LLM inputs verified rights-clear; outputs versioned with provenance
- [ ] Image display limited to rows with `licenseStatus = commercial_allowed`
- [ ] Attribution rendered for every used source
- [ ] Privacy notice discloses data sources and retention ([PRIVACY.md](PRIVACY.md))
- [ ] Local counsel review completed and filed

## 7. Red flags

| Do not | Because | Instead |
|---|---|---|
| Use IMDb free dumps in the product | non-commercial license | Wikidata + licensed provider |
| Assume a TMDB free key allows a commercial recommender or ML | requires written agreement | negotiate, or stay off TMDB |
| Scrape any provider | terms and law | licensed APIs and contracts |
| Show a poster without a registry row | rights | text card until licensed |
| Send user data to the LLM | privacy | film evidence only, `store=false` |
| Train on text you copied from reviews | copyright | licensed or own text; abstract features |
| Seed the production shared space from MovieLens/Tag Genome without permission | GroupLens license | permission first, or Alpha-cohort seeding |
| Let availability or commission move organic ranking | `BP §14.1`, `§20.3` | filter and disclosed referral only |

## 8. Sources

[م14] Wikidata WikiProject Movies · [م15] IMDb non-commercial datasets · [م16] TMDB developer documentation · [م26] TMDB API terms of use · [م17] GroupLens MovieLens README · [م23] OpenAI data controls — all as listed in `BP App. D`, reviewed 2026-09-02/03; re-check before any commercial use.

---

**Changelog**
- 2.0 (2026-09-03): rewritten. Replaced a verbatim TMDB quote of uncertain provenance with a paraphrase flagged for counsel; removed unverifiable catalog-size and cost figures and an ad-hoc week-based timeline that conflicted with `BP §18`; added user imports, LLM derivatives, images and the Phase 0 catalog steps; aligned the checklist with `BP App. B`.
