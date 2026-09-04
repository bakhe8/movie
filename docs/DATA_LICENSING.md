# Data Sources, Rights and Licensing

**Status**: Derived from blueprint `§11` (rights registry per field, catalog pipeline, data-quality rules), `§4.2` (user imports), `§7.5` (external seed data), `§17.1` (research catalog), `App. B` (pre-launch checklist), `App. D` (sources). Decisions: ADR-13, ADR-19, ADR-23.
**Not legal advice.** Terms quoted or paraphrased here were read on the dates stated; they change. Gate 4 (`BP` executive summary) requires a documented rights registry and a legal review **before the first revenue** (a paid tier, ads or referral commission) — not before development, testing or the free launch. Owner decision 2026-09-04, §0 below.
**Version**: 2.2 — 2026-09-04.

---

## 0. Launch-stage policy (owner decision, 2026-09-04)

The product is built to production grade — notices, consents, exports, deletion, audit, internal reviews — and **launches free, with zero revenue of any kind**: no paid tier, no ads, no referral commission. Only after a period of real usage is the revenue model studied (which features go paid or stay free by observed attraction, pricing by LLM model strength, several providers). Every licensing question in this document is an **input to that cost / benefit / profit study**, not a prerequisite for building. Consequences:

- **No license request, API agreement, permission letter or external counsel engagement is a gate** for development, testing, alpha, beta or the free launch. Each source is used under the terms that apply to a free, non-revenue service: Wikidata (CC0), Wikipedia (CC BY-SA, attribution), TMDB's free key (non-commercial, attribution), IMDb's non-commercial datasets (attribution, no redistribution), GroupLens research terms, our own LLM derivatives.
- `licenseStatus: 'non_commercial_only'`, and `'unknown'` with a named source, are **displayable** while the service earns nothing. `commercial_allowed` becomes the display condition only when revenue starts.
- The rights registry (`source_records`) is still filled per value — it is cheap, and it is what turns the later switch into a data change instead of a rebuild. A missing row is hygiene debt, not a display block.
- The free period must be genuinely free: the "where to watch" link carries no commission until the revenue decision (`BP §14.1`'s "disclosed referral" waits for it).
- What stays prohibited in every stage, because it is a boundary and not paperwork: scraping any provider; bulk redistribution of any third-party dataset (values are shown per title with attribution, never re-exported); personal data sent to the LLM.
- Agreements open together at the revenue-model decision — TMDB commercial terms, availability partner, GroupLens permission (only if a seeded component is still served), external counsel — and their cost is a line in that study.

## 1. The rule: access is not a license (`BP §11.1`)

Every field, image, clip, score and availability record has a row in the rights registry (`source_records` in [SCHEMA.md](SCHEMA.md)) with: source, right type, attribution required, permission to store / derive / train, retention, and fallback plan. Nothing is displayed, derived from, or trained on **for revenue** without a registry row whose `licenseStatus` allows that use; while the service is free (§0) a row naming the source and its attribution is enough. Missing values are `NULL`, never `0`/`false` (`BP §11.3`). Scraping IMDb, TMDB or any provider is prohibited in every phase, licensed or not.

## 2. Summary matrix

| Source | What it gives | Terms (as understood; verify) | Allowed use for us | Phase |
|---|---|---|---|---|
| **Wikidata** | ids, titles in many languages incl. Arabic, year, credits, countries, links to other ids | CC0 | display, store, derive, train | Phase 0 seed ([م14]) |
| **IMDb non-commercial datasets** | titles, ratings, votes, credits (official daily TSV dumps) | personal/non-commercial only; attribution line required; no redistribution ([م15]) | **required by the owner (2026-09-04)**: ratings and votes as the Public Quality source, plus titles/credits for matching, in served components through the free launch (§0), keyed by `tconst`, each value with a registry row and IMDb's attribution line; local copies refreshed from the official dumps only; never re-exported in bulk; the commercial license (AWS Data Exchange) is an input to the revenue study | Phase 0+ (Public Quality) |
| **IMDb commercial (AWS Data Exchange)** | licensed metadata/ratings | paid agreement | anything the contract allows | at the revenue-model study, if the economics justify |
| **TMDB API** | metadata, alternate titles, languages, images | free key for non-commercial use; commercial use requires an agreement; attribution required; the terms restrict use of TMDB content for AI/ML purposes ([م16], [م26]) | images and metadata under the free key, with attribution, through the free launch (§0); fingerprints are derived from Wikipedia/Wikidata text, not TMDB, so the AI/ML clause is not exercised; commercial terms are an input to the revenue study | Phase 0+ (free key) |
| **Availability provider (e.g. JustWatch partner program)** | where to watch per market, audio/subtitles | partner agreement; no public free API; no scraping | user-declared platforms plus a plain, commission-free link until the revenue decision; dated partner snapshots for Watchability after it — filter/context only, never a taste feature | partner: after the revenue decision (`BP App. C`: user-declared platforms until then) |
| **MovieLens / Tag Genome (GroupLens)** | ratings, tags | research license: commercial or revenue-bearing use requires prior written permission from a GroupLens faculty member ([م17]) | offline baselines and methodology prototyping; seeding a served component is permitted under the research terms while the service earns nothing (§0), though ADR-13 starts the shared space from Alpha-cohort data anyway; permission is requested at the revenue decision only if a seeded component is still served | research; seeding optional |
| **User-uploaded lists (CSV)** | the user's own watch history and ratings | user's data, processed under the `import_processing` consent | watch events (`source=import`), `importedRating` as low-confidence auxiliary data (`BP §4.2`) | Alpha (`BP §14`) |
| **LLM outputs (our fingerprints and explanations)** | derived features | our derivative under the provider's terms; inputs must themselves be licensed for derivation | store, derive, train; provenance recorded per feature (`BP §13.3`) | Phase 0+ |
| **Posters / stills** | display assets | per-image rights; TMDB images need the TMDB agreement and attribution; Wikimedia Commons images carry their own licenses | display only with a registry row; otherwise show a text card | any |
| **Google Knowledge Graph / other "free to query" APIs** | facts | usage terms ≠ derivation license | verify terms; registry row per value; otherwise do not use | — |

## 3. Source notes

### 3.1 Wikidata (Phase 0 primary)

CC0: free for any purpose, no attribution obligation (we credit it anyway). Coverage and quality vary by film; Arabic labels are often present. Use the entity API/SPARQL with provenance (`sourceRecordId` per value). Do not rely on it alone for plot text quality — that is the LLM enrichment's job, and the enrichment input must itself be rights-clear.

### 3.2 IMDb

The owner has ruled the free datasets **essential** (2026-09-04): they are the Public Quality source (`public_quality_sources`, `BP §10.3`: per-source, dated, never averaged) and a matching aid for titles and credits. They are used under their published terms during the free period (§0): official dumps only (`title.ratings`, `title.basics`, `title.crew`, `name.basics` as needed), stored locally and refreshed from the dumps, every served value with a `source_records` row (`non_commercial_only`) and IMDb's attribution line rendered wherever a value appears, no bulk redistribution — the user data export contains the user's own data, not IMDb columns. Two honest notes: IMDb's wording is "personal and non-commercial", narrower than TMDB's free tier, so this is the source most exposed if revenue ever starts before its commercial license is in place; and the datasets are not an API — no scraping of imdb.com pages in any stage. The commercial license (AWS Data Exchange) is a line in the revenue-model study, with "drop the IMDb values" as the priced alternative.

### 3.3 TMDB

Free developer keys are for non-commercial use, which is the whole free period (§0): posters and metadata are fetched with the free key, credited as TMDB requires, and stored in `source_records` as `non_commercial_only`. No agreement is requested now. When the revenue model is studied, a written agreement would need to cover: commercial recommendations, storing data, image display and attribution scope, Arabic localization, retention, and term — and, only if fingerprint inputs ever move from Wikipedia to TMDB text, derivation and LLM use. If the terms do not pay off in that study, the fallback is already built: text cards.

### 3.4 Availability

`BP App. C` leaves the MVP choice open: user-declared platforms vs a licensed partner. MVP uses user-declared platforms plus a "where to watch" link; a partner integration (with market coverage for Saudi Arabia confirmed in writing, SLA, freshness and attribution) is a Closed Beta item. Availability is always a filter and a Watchability value, never a ranking feature (`BP §6`, `§10.2`).

### 3.5 MovieLens / Tag Genome — research terms apply while the service earns nothing

The GroupLens dataset READMEs state that the data may not be used for commercial or revenue-bearing purposes without first obtaining permission from a GroupLens faculty member; some versions also restrict redistribution. A free service with no revenue is not such a use, so no permission is requested now (§0). Rules:

1. Offline baselines and methodology work: allowed, as before.
2. Seeding a served component: allowed under the research terms during the free period, but ADR-13's default stands — the shared latent space starts from Alpha-cohort data, and external seeding is an option, not a requirement.
3. At the revenue-model decision, if a MovieLens-seeded component is still served, request written permission covering: seeding a production factor model, training derived models, influence on live recommendations and triad selection, retention, attribution — or re-seed from internal data. Cost and delay of that request are lines in the revenue study.

Check the README of the exact dataset file downloaded; wording differs slightly between versions.

### 3.6 LLM-derived data (any LLM provider; Anthropic since 2026-09-03)

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

The 15 hand-entered titles in `apps/backend/src/scripts/seed.ts` are development fixtures with `licenseStatus: 'unknown'`; retired from `movie-postgres` (board C-15, 2026-09-04 — the owner's catalog floor is 200+ titles, never these 15), kept only as a fixture for `postgres-test`'s own e2e specs, and must not appear in any external test.

## 5. Attribution

Credits page and API metadata list every source actually used with the attribution each requires (Wikidata credit; TMDB logo/link if and when licensed; provider attribution per contract). Attribution strings are stored with the registry row, not hard-coded in the UI.

## 6. Checklists (`BP App. B`, Gate 4)

### 6.1 Before the free launch — team-internal, no third party involved

- [ ] Rights registry populated for every field, image and availability value in the catalog (source and attribution; status may be `non_commercial_only`)
- [ ] Wikidata provenance recorded per value
- [ ] IMDb: values come from the official dumps only, each with a registry row, the attribution line rendered, no bulk re-export
- [ ] LLM inputs verified rights-clear (Wikipedia/Wikidata text, own synopses); outputs versioned with provenance
- [ ] Image display limited to rows with a known status (`commercial_allowed` or `non_commercial_only`) and the attribution each requires
- [ ] Attribution rendered for every used source (Wikidata, Wikipedia CC BY-SA, TMDB)
- [ ] "Where to watch" links carry no commission; no ads; no paid tier
- [ ] Privacy notice discloses data sources and retention ([PRIVACY.md](PRIVACY.md)), reviewed by the team

### 6.2 At the revenue-model study — inputs to cost / benefit / profit, decided together

- [ ] IMDb: commercial license (AWS Data Exchange) priced — or the IMDb values dropped
- [ ] TMDB: written commercial agreement covering the uses in §3.3, or TMDB dropped for text cards
- [ ] Availability partner: agreement with Saudi coverage, SLA, attribution — or user-declared platforms stay
- [ ] MovieLens/Tag Genome: written GroupLens permission if a seeded component is still served — or re-seed from internal data
- [ ] Referral commission on "where to watch": disclosed and priced, or left off
- [ ] Per-feature usage and per-model LLM cost from the free period on the table (the data this study runs on)
- [ ] External counsel review of the registry, notices and agreements, completed and filed before the first revenue

## 7. Red flags

| Do not | Because | Instead |
|---|---|---|
| Re-export or redistribute IMDb, TMDB or MovieLens values in bulk (dumps, API listings, data files) | dataset terms | show per title with attribution; exports carry the user's own data only |
| Take revenue (paid tier, ads, commission) while still on the TMDB free key, IMDb's non-commercial datasets or MovieLens research terms | those terms are non-commercial | decide the agreements in the revenue study first; text cards and internal seeding are the built fallbacks |
| Scrape any provider | terms and law | licensed APIs and contracts |
| Show a poster without a registry row | rights | text card until licensed |
| Send user data to the LLM | privacy | film evidence only, `store=false` |
| Train on text you copied from reviews | copyright | licensed or own text; abstract features |
| Keep a MovieLens/Tag Genome-seeded component served after revenue starts, without permission | GroupLens license | permission at the revenue decision, or re-seed from internal data (ADR-13 default) |
| Let availability or commission move organic ranking | `BP §14.1`, `§20.3` | filter and disclosed referral only |

## 8. Sources

[م14] Wikidata WikiProject Movies · [م15] IMDb non-commercial datasets · [م16] TMDB developer documentation · [م26] TMDB API terms of use · [م17] GroupLens MovieLens README · [م23] OpenAI data controls — all as listed in `BP App. D`, reviewed 2026-09-02/03; re-check before any commercial use.

---

**Changelog**
- 2.2 (2026-09-04): owner ruling — IMDb non-commercial datasets are essential: Public Quality source and matching aid in served components through the free launch, under their terms (official dumps, attribution, no redistribution); commercial license deferred to the revenue study like every other agreement. §0, matrix, §3.2, §6, §7.
- 2.1 (2026-09-04): owner decision — the launch is free with zero revenue; no license request, API agreement, permission or counsel engagement gates development, testing or the free launch; all of them move to the revenue-model study as cost/benefit inputs. New §0; §1 display rule tied to revenue; TMDB, availability and MovieLens rows and notes rewritten; §6 split into a team-internal pre-launch list and a revenue-study list; red flags updated.
- 2.0 (2026-09-03): rewritten. Replaced a verbatim TMDB quote of uncertain provenance with a paraphrase flagged for counsel; removed unverifiable catalog-size and cost figures and an ad-hoc week-based timeline that conflicted with `BP §18`; added user imports, LLM derivatives, images and the Phase 0 catalog steps; aligned the checklist with `BP App. B`.
