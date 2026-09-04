# Catalog expansion candidates — published selection criteria (board C-16)

Companion to `catalog.expansion.candidates.tsv` in this directory. This is a **candidate pool for the owner to review, not a finished curated list** — nothing here has been enriched (no model calls made to produce it) or loaded into any database. It follows the same sourcing method as the original 300-title catalog (WS1, `docs/DEMO_DATA_PLAN_2026-09-03.md` §"WS1 — Catalog fixture"): real Wikidata items only, an IMDb ID (P345) required as the practical "this is resolvable/enrichable" gate, nothing invented.

## Why these slices

The current 300-title catalog (measured 2026-09-04) is US/English-heavy (122 English-language, 105 Arabic, only 75 spread across every other language) and has real geographic and genre gaps once the count goes past a token "one per continent" gesture:

| Gap found | Evidence |
|---|---|
| Sub-Saharan Africa | 0 titles (North Africa only: Egypt, Tunisia, Morocco, Algeria, Sudan) |
| Latin America | 5 titles total (Mexico 2, Argentina 2, Brazil 1) |
| Southeast Asia beyond one Indonesian title | Philippines, Thailand, Vietnam, Malaysia: 0 |
| South Asia beyond India | Pakistan, Bangladesh: 0 |
| Eastern Europe / Central Asia | Russia 2, Poland 1, Hungary 1; Czech Republic, Romania, Georgia, Kazakhstan: 0 |
| Arabian Gulf depth | Saudi Arabia/UAE/Kuwait/Bahrain 18 combined, Oman/Qatar: 0 |
| Genre | Documentary 3, War 10, Political 2, Sport 2, Road Movie 2, Disaster 1 (out of 300) |
| Era | Pre-1980: 54/300 (18%) |

## Method

1. **Sourcing.** Two passes. Wikidata's own query service (`query.wikidata.org`) was mid-outage for the first pass (HTTP 429/502/504 on every SPARQL query attempted), so that pass listed real, notable films by title from a country/slice gap (not invented) and resolved each to its Wikidata QID via the lighter, unaffected `wbsearchentities`/`wbgetentities` REST API instead of one bulk SPARQL sweep — the same manual-curation spirit WS1 used. The service recovered partway through this pass; the remaining slices used direct SPARQL queries (`?film wdt:P495 wd:<country>`, ordered by `wikibase:sitelinks`), which is faster but pulls in noise (see next point).
2. **Real-cinema filter.** SPARQL's `country of origin` (P495) claim frequently reflects a co-production or filming-location credit, not a genuine work of that national cinema — the raw Eastern-Europe/East-Asia batches were majority Hollywood studio films (Pixar/Disney titles, *Venom*, *Dunkirk*, *Snowpiercer*, *Mission: Impossible*) credited to a country only for tax-financing reasons. Every SPARQL-sourced row was hand-checked against this before inclusion; the title-search pass (point 1) mostly avoided the problem by construction.
3. **IMDb gate.** Every row was verified to carry a P345 IMDb ID; anything that didn't resolve to a real film entity with one was dropped, not guessed.
4. **Deduplication against the existing 300.** Checked programmatically by real Wikidata QID (not by title string, which would miss a retitled release) — 11 initial picks turned out to already be in the catalog (e.g. *City of God*, *Roma*, *The Battle of Algiers*) and were removed.
5. Sitelink count (`wikibase:sitelinks`) is carried as a rough notability signal, since Wikidata does not store IMDb vote counts — an actual vote-count filter is a TMDB lookup, deferred to the enrichment pass this list is explicitly gating (`fetch-catalog.ts` / `load-catalog-rights` already do this for the existing 300).

## Result: 125, not 200

The board's target was +200; this pass delivers **125** real, verified, non-duplicate candidates. The shortfall is the direct cost of points 2 and 4 above — roughly 35 SPARQL hits were dropped as spurious co-production credits and 18 as duplicates or within-batch repeats. Padding back to 200 would mean lowering the real-cinema bar or accepting near-duplicates, which seemed like the wrong trade given this list exists specifically so the owner can trust it without re-verifying each row. A second pass (more slices, or a deliberately loosened bar the owner signs off on first) can close the gap if 125 isn't enough to work from.

## What this list is not

- Not final curation. The owner's review pass is where a title gets accepted, swapped, or dropped for reasons beyond "is this real and non-duplicate" — same as WS1's "no Arabic title anywhere" change was.
- Not enriched. No fingerprint, no plot evidence, no rights-registry row. That is the next step (`fetch-catalog.ts`), and only after this list is approved.
- Not exhaustive per slice — sized to what a careful pass produced, not a claim that these are the only or the best possible picks per country.

## Columns (`catalog.expansion.candidates.tsv`)

`qid` (Wikidata, e.g. `Q220741`) · `slice` (working bucket name from the gap table above) · `region_hint` (ISO 3166-1 alpha-2 — a first guess from Wikidata's country-of-origin claim, worth a second look per point 2 above) · `title_en` · `year` · `imdb` (tt-id) · `sitelinks` (breadth proxy) · `reason` (why this slice, one line, shared across a slice's rows)
