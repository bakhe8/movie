# Demo Data Plan — filling the database so the product can be judged

**Date**: 2026-09-03 · **Baseline**: commit `af1d4ce` on `main` plus the uncommitted onboarding work in the working tree (profile `market`/`platforms`, `OnboardingScreen`) · **Type**: execution map · **Status**: proposed, nothing implemented yet.

**What it settles**: exactly which rows must exist in the dev database, in which order they are produced, by which script, and what each screen must show afterwards — so that the owner can open the app and judge it against the blueprint with complete data instead of 15 placeholder films and an empty account. It also states what *no* data can fix today, so those cells are not judged as broken.

Blueprint anchors: `§4.1`–`§4.5` (journey), `§5.3` (product picture), `§6`/`§11.3` (fingerprints, unknown ≠ zero), `§9.3` (confidence bands), `§13.1`–`§13.2` (entities, triad events), `§17.1`–`§17.2` (Phase 0 catalog of 300–500 films, 20–30 triads per Alpha user). Contracts: [SCHEMA.md](SCHEMA.md) §1, [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §2, [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §6, [DATA_LICENSING.md](DATA_LICENSING.md) §4. Decisions used: ADR-6/23 (LLM use), ADR-15 (title-id rankings), ADR-17 (replacements), ADR-19 (unknown ≠ zero), ADR-22 (deterministic init), ADR-31/32 (held-out, event completeness), ADR-33 (display formats), ADR-34 (one-triad lookback).

---

## 1. Starting point (measured on the live dev database, 2026-09-03)

| Table | Rows | What it means for judging |
|---|---|---|
| `titles` | 15, all fingerprinted | hand-entered placeholder vectors, `confidence: {}`, `licenseStatus: 'unknown'`, no `externalIds`; Discover shows the whole catalog on one page (page size 20), search is meaningless, recommendations are "whatever is left of 15" |
| `users` / `profiles` | 4 / 4 | three are automated-test accounts |
| owner account (`bakheet@gmail.com`) | 0 watched, 0 triads, 0 snapshot | Home and Library answer 409 → "model not ready"; Profile shows no model |
| `triads` completed | 5 | spread over two test accounts |
| `user_model_snapshots` | 1 | one test account, 3 triads → band `initial` |
| `embeddings`, `triad_replacements` | 0 / 0 | |

What the screens actually read today (so this is the only data that can change what is seen): `titleAr`/`titleEn`, `releaseYear`, `genres`, `description`, `confidenceBand`, library `position`, `track`, `watchedAt`, `notes`, `importedRating`, model `modelVersion`. `publicQualityScore` and `watchabilityScore` are hard-coded `null` in `RecommendationsService` — no row anywhere can make them non-null.

Confidence bands are a triad-count heuristic (`RecommendationsService.confidenceBand()`), which fixes how many completed triads each demo persona needs:

| Completed triads | Band | Held-out metrics |
|---|---|---|
| 0–2 | inconclusive | none |
| 3–9 | initial | from 5 triads (1 held out) |
| 10–19 | likely | yes |
| ≥ 20 | strong | yes (4+ held out) |

---

## 2. Target state — "the product can be judged" means

| Screen | Must be visible after this plan |
|---|---|
| اكتشف / Discover | a starter list of many pages; Arabic and English search returning real hits; existing marks loading; progress toward the first triad |
| رتّب / Rank | an unbounded supply of triads from a large watched set; both replacement controls producing rows; the "mark one more film" path only when genuinely exhausted |
| الرئيسية / Home | recommendations for personas in **all four** confidence bands; the one-band demotion visible on at least one partially-described title; Public Quality and Watchability shown as "unknown" **by design** (§6 below) |
| قائمتي / Library | watchlist with items; a model-ordered personal ranking of 30–60 watched titles; a dated timeline over months; notes and an imported rating |
| الملف / Profile | model status with version and band for a trained profile; wipe-and-restart on a demo profile without touching others |
| Trainer | held-out NLL and pairwise accuracy on the 25-triad persona; the learned weights recover that persona's hidden taste vector (pipeline sanity, not product quality — §7) |

---

## 3. Decisions to take before starting

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Fingerprint source for the demo catalog | (a) the enrichment worker over an LLM API, results committed to the fixture; (b) deterministic placeholders from genres | **(a) — decided 2026-09-03: the Anthropic Messages API** (§8), with (b) as the fallback generator inside the same script so the seed never blocks on a key. Only (a) makes the taste judgment meaningful; (b) only proves the UI fills |
| D2 | Catalog size | 200 / 300–500 | **200 is the floor, not the target.** It is the smallest catalog that gives paging, search, balance and 60 watched per persona. The fetch and enrichment scripts take a QID list of any length, so growing to the blueprint's 300–500 (`§17.1`) is only more curation and more enrichment calls, no code. Licensing status is the same either way (development fixture, D4) |
| D3 | Seed activity onto the owner's real account | yes / no | **No.** Demo personas get their own `@demo.local` accounts; the owner's account is the *real* judgment path (§7) and must stay hand-made |
| D4 | LLM evidence for enrichment | Wikidata one-line descriptions only / plus Wikipedia plot synopses (CC BY-SA) | **Plus synopses**, stored in the fixture only (never in `titles`), `sourceIds` naming the page, `licenseStatus: 'unknown'`, `reviewStatus: 'unreviewed'`. Development fixture per [DATA_LICENSING.md](DATA_LICENSING.md) §4 — never in an external test or production |

---

## 4. Workstreams, in execution order

Dependencies: WS0 → WS1 → WS2 → WS3 → WS4 → WS5. **The catalog comes first and nothing is demonstrated, developed or judged against the 15 `FILM` fixtures** (owner's decision, 2026-09-03: fifteen titles are never enough for any purpose — they cannot fill a page, cannot be searched, and cap every persona at a handful of distinct triads). WS3's generators are unit-tested on synthetic in-memory titles, and its first real run is on the full WS1 catalog.

### WS0 — Guardrails (½ h)

The dev database is shared by several concurrent sessions ([IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), ADR-38/43 notes). Every demo row must be identifiable and removable without touching anything else.

- Demo users: email `persona-<slug>@demo.local`; password `demo-password-1` (dev only; documented, never reused).
- Demo titles: `internalId` prefix `DEMO` (`DEMO0001`…), so the 15 `FILM` fixtures and any future licensed catalog stay apart.
- Demo triads: `policyVersion = 'demo-synthetic-v1'`, `metadata.reasonForSelection = 'demo-persona'` — analytics and the trainer can separate synthetic events from real `random-v1` ones.
- Idempotency: the seed deletes users `LIKE '%@demo.local'` (cascades to profiles, states, triads, replacements, snapshots) and upserts titles by `internalId`, then rebuilds — a re-run yields the identical state (fixed RNG seed `20260903`).
- Never: touch non-demo users, drop tables, run `synchronize`, or write `importedRating` through the API (only the seed's direct insert may set it, with `ratingSource: 'import'`).
- A `db:seed:demo:clean` script removes only the demo users (titles stay; they are harmless and useful).

### WS1 — Catalog fixture — **done 2026-09-03 (300 titles, owner's decision D2)**

**Delivered** (all under `apps/backend/src/scripts/`):

| File | Role |
|---|---|
| `fixtures/catalog.demo.list.tsv` | the hand-curated list — one row per film: `slice`, `region`, `tier`, `year`, `titleEn`, `wiki` (`lang:Wikipedia_page_title`, the resolution key), optional `titleAr` and `genres` overrides. Row order fixes `internalId` (`DEMO0001`…); append, never reorder |
| `fetch-catalog.ts` | resolver/builder: Wikipedia page → Wikidata item → facts, labels, ids, sitelinks; Wikipedia leads (en + ar) and the plot section as enrichment evidence. Every remote answer is cached on disk (`CATALOG_CACHE_DIR`, default under the OS temp dir), so re-runs are offline; Wikimedia `429`s are honoured with `Retry-After`/long backoff |
| `fixtures/catalog.demo.json` | the fixture `db:seed:demo` will read — 300 entries, 1.1 MB, committed |
| `fixtures/catalog.demo.report.md` | balance, coverage, genre vocabulary and every warning of the last build — committed, regenerated on each run |

Commands: `npm run catalog:fetch` (root or `apps/backend`), `make catalog-fetch`; flags `--limit N` / `--only DEMOnnnn` (probe without rewriting the fixture) and `--no-plot`. Exit code 1 whenever a blocking warning remains (unresolved page, no Arabic title, duplicate item).

Entry shape — fields beyond the `titles` entity are fixture-only and are **not** persisted:

```json
{
  "internalId": "DEMO0002", "titleEn": "The Night of Counting the Years", "titleAr": "المومياء",
  "description": "…English Wikipedia lead, first two sentences…", "descriptionSource": "wikipedia:en",
  "descriptionAr": "…Arabic Wikipedia lead, first two sentences…",
  "releaseYear": 1969, "genres": ["Drama", "History"],
  "externalIds": { "wikidata": "Q2527271", "imdb": "tt0064652", "tmdb": "…" },
  "originalLanguage": "ar", "languages": ["ar"], "country": "EG", "countries": ["EG"],
  "slice": "ar", "region": "EG", "tier": "mid",
  "evidence": { "plotSummary": "…≤ 3000 chars…", "plotSource": "wikipedia:en:The Night of Counting the Years",
                "sourceIds": ["wikidata:Q2527271", "wikipedia:en:…"], "wikipedia": { "en": "…", "ar": "…" } },
  "fingerprint": null
}
```

Rules applied: `titleEn` is the curated title (Wikidata's English label for Arabic films is often a bare transliteration; it is kept as `evidence.wikidataLabelEn` when different); `titleAr` comes only from a Wikidata label or the Arabic Wikipedia page title — no transliteration was invented, and the `titleAr` override column ended up unused; Arabic varieties on Wikidata ("Egyptian Arabic", "Classical Arabic") map to `ar`; genres map Wikidata P136 labels onto a 27-term vocabulary (explicit map, then keyword folding, production tags dropped), capped at four, with Animation read from the item's class; a manual `genres` override applies only where Wikidata has none (9 rows).

Result of the final build (see the report for the full tables):

| Measure | Value |
|---|---|
| Entries | 300 / 300 rows |
| Slices | Arabic 105 · English 120 · other languages 75 |
| Tiers | popular 106 · mid 122 · niche 72 |
| Arabic slice | 35 titles before 2000; 18 from the Gulf (SA 11, AE 4, KW 2, BH 1); Egypt 42, Levant 24, Maghreb 17, Sudan/Yemen/Iraq 4 |
| Arabic title | 300 (Wikidata label or arwiki title) |
| Description | 293 from the English Wikipedia lead; 7 Arabic films have only Wikidata's stub in English and a real `descriptionAr` — the seed should prefer `descriptionAr` for those |
| Plot evidence | 295 from a Plot section; 5 from the article lead only |
| IMDb / TMDB ids | 298 / 298 |
| Warnings left | none blocking; 4 Saudi titles lack P364/P345 on Wikidata (language/ids `null`, never guessed) |

Curation changes forced by the "no Arabic title anywhere" rule, for the owner's review: Withnail and I → This Is England; Kes → Fish Tank; Upstream Color → Coherence; Old Joy → Leave No Trace; Farewell My Concubine → To Live; Come and See → Andrei Rublev; Uncle Boonmee → The Raid; Gangs of Wasseypur → Masaan; Stars in Broad Daylight (no page in any language) → The Extras (Al-Kompars, 1993). The 15 `FILM` fixtures are deliberately absent from the list so nothing appears twice.

Licensing (D4, [DATA_LICENSING.md](DATA_LICENSING.md) §4): facts and labels are Wikidata (CC0); the leads and plot text are Wikipedia (CC BY-SA 4.0) and live in the fixture's `evidence`/`description*` fields only, as LLM input and development display text; nothing carries a rights-registry row, so the whole fixture stays `licenseStatus: 'unknown'` and out of any external test or production database.

Growing the catalog to the blueprint's 300–500 is now curation only: append rows to the list and re-run.

### WS2 — Fingerprints — **done 2026-09-03: 300/300 extracted, 0 failures**

**The run** (2026-09-03, ~18:02–18:09 local): 300 titles in 439 s at 4-way concurrency, 0 failures, 0 refusals; 295 complete fingerprints and the 5 deliberately partial ones; every fingerprint carries `modelVersion: claude-sonnet-5`, `extractorVersion: enrichment-worker-v2`, `generatedBy: anthropic`, all 13 `confidence` values (mean 0.61, range 0.15–0.98), `sourceIds` from the fixture, `licenseStatus: unknown`, `reviewStatus: unreviewed`. Per-dimension spread over the catalog (sd 0.14–0.22 on every axis; psychologicalDepth highest mean 0.76, actionIntensity lowest 0.35) shows the extractor is not collapsing to the midpoint. Report: `catalog.demo.enrichment-report.md`.

**Model actually used**: Sonnet 5, not the Opus 5 configured in `.env.example`. At run time Opus 5's structured-output path answered `529 Overloaded` on every attempt over about two minutes (four spaced attempts plus the SDK's own six retries) while plain Opus 5 calls and Sonnet 5 structured calls succeeded. The session switched the local `.env` model to Sonnet 5 so that the whole run carries one `modelVersion` (the single Opus 5 extraction done earlier for `DEMO0001` was re-extracted with `--force`). Moving the catalog to Opus 5 later is `--force` with the model variable changed back, about ten minutes.

**Setup lessons recorded for the next machine**: a *Personal* (identity-linked) Console key needs `ANTHROPIC_WORKSPACE_ID` (the API answers 400 without it; commit `b4bf55f`); a Workspace-type key does not. The Console's evaluation plan has no credits until billing is set up (the API answers 400 "credit balance is too low"). A free-form `confidence` map in the output schema came back empty on the first real call; the schema now names all thirteen confidence fields (commit `7f01281`).

**Delivered**:

| File | Role |
|---|---|
| `services/workers/src/enrichment.py` | the worker, ported from the OpenAI Responses API to the Anthropic Messages API (§8): same Pydantic schema, structured outputs via `messages.parse`, model ids from `ANTHROPIC_FINGERPRINT_MODEL` / `ANTHROPIC_EXPLANATION_MODEL`, `extractorVersion` bumped to `enrichment-worker-v2`, `modelVersion` = the model id the API actually served, refusal / token-ceiling / API failure each a distinct `ValueError` |
| `services/workers/src/enrich_catalog.py` | the batch runner: `python -m src.enrich_catalog` (`make catalog-enrich`). Reads the fixture, extracts every entry whose fingerprint is missing or from an older extractor version, writes back atomically every 10 completions and at the end, 4 requests in flight by default, resumable — a failed or refused title stays `null` and is listed in `catalog.demo.enrichment-report.md` as a human-review item (`§15.4`), never fabricated. Flags: `--only`, `--limit`, `--force`, `--concurrency`, `--dry-run`, `--write-db` (UPDATE `titles.fingerprint` for seeded rows), `--placeholder` (`make catalog-enrich-placeholder`), `--partial-ids` |
| `services/workers/tests/test_enrichment.py`, `tests/test_enrich_catalog.py` | 13 + 18 tests: structured-output call shape, provenance stamping, refusal and ceiling errors, evidence selection (Arabic lead when the English one is a Wikidata stub), one-extraction-per-version, placeholder determinism and labelling, partial masking, a placeholder run against a temp fixture, a failing extraction reported not fabricated |

Evidence sent per title: `titleEn`, the description (`descriptionAr` for the 7 Wikidata stubs), `evidence.plotSummary`, and a context line with year, genres, country, original language and the Arabic title; `evidence.sourceIds` is stamped through. Nothing else — no user data exists in the fixture to leak.

Deliberately partial titles (two dimensions removed after extraction, `extractorVersion` suffixed `+partial`, so the ADR-19 one-band demotion is visible on Home): `DEMO0007`, `DEMO0063`, `DEMO0150`, `DEMO0222`, `DEMO0290`. The trainer drops triads containing them, which is the intended behaviour to observe.

Placeholders (`--placeholder`): deterministic genre-centroid vectors with seeded jitter, `extractorVersion: 'demo-placeholder-v1'`, `generatedBy: 'placeholder'`, `confidence` 0.3 on every dimension — never mistaken for an extraction, and re-extracted by the next real run because their version is not current.

**To re-run** (owner): `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (identity-linked keys only) and the two model variables in `.env`, then `make catalog-enrich`. A re-run is a no-op until the extractor or model version changes; `--force` re-extracts everything.

Acceptance — **met**: 295 complete fingerprints, 5 partial; every complete one has 13 finite numbers in [0, 1], a `confidence` entry per dimension, `sourceIds`, `extractorVersion: 'enrichment-worker-v2'`, `modelVersion` set, `licenseStatus: 'unknown'`, `reviewStatus: 'unreviewed'` (checked by script over the committed fixture). This was the first time the enrichment worker ran against a real catalog: zero failures and zero refusals is the `§15.4` acceptance-test input for this run; human review sampling (§7 below, the owner's 30 films) is still open.

### WS3 — Personas and activity — **code done 2026-09-03, verified on `postgres-test`; the dev-database load is announced on the board before it runs**

**Delivered**: `apps/backend/src/scripts/seed-demo.ts` (writer + CLI: `--clean`, `--dry-run`, `--seed`), `seed-demo.lib.ts` (pure, seeded generators), `fixtures/personas.demo.json` (the persona table below as data, read by the seed and by the trainer runner), `seed-demo.lib.spec.ts` (17 unit tests), `test/seed-demo.e2e-spec.ts` (a full double run against `postgres-test`: 4 accounts, 8 consents, 45 completed + 1 active triads, 3 replacements, every triad's titles watched, replaced titles never in a triad, rankings identical across the two runs), `npm run db:seed:demo` / `db:seed:demo:clean` at the root, `make demo` / `make demo-clean`. The seed writes `titles.originalLanguage` from the fixture only when the database has that column (migration `AddTrainingLanguageDiversity`), so it runs on either schema.

The original specification follows; the numbers it gives are what the e2e test asserts.

**Deliverable**: `apps/backend/src/scripts/seed-demo.ts`, `npm run db:seed:demo` at the root (and `make demo`), unit-tested pure generators.

Four personas with a hidden taste vector θ over the model's 28 dimensions in `FINGERPRINT_DIMENSIONS` order — the 13 V1 keys (pacing, rhythmVariance, ambiguity, psychologicalDepth, warmth, darkness, linearity, dialogueDensity, actionIntensity, plotComplexity, visualComplexity, soundscapeComplexity, colorSaturation) followed by the 15 V2 family keys (narrative.revelation, narrative.perspective, narrative.unreliability, tone.irony, tone.unease, tone.catharsis, tone.compassion, characters.agency, characters.moralAmbiguity, characters.transformation, characters.relationshipCentrality, ending.openness, ending.twist, ending.justice, ending.optimism). **Regenerated on 28 keys 2026-09-04** (owner's order after ADR-69 wired the families; the first fixture was 13 keys, τ = 0.2): the V2 half of each θ is written below as its own vector.

| Slug | Taste | θ | Watched | Triads | Expected band |
|---|---|---|---|---|---|
| `slow-burn` | slow, ambiguous, dark, dialogue-led, contemplative; open unresolved endings, unreliable narration, morally ambiguous people, no catharsis | V1 `[-1.0, 0.2, 1.0, 1.0, -0.3, 0.8, 0.5, 0.3, -1.0, 0.6, 0.4, 0.2, -0.6]` · V2 `[0.3, 0.4, 0.7, 0.2, 0.6, -0.5, 0.3, -0.3, 0.8, 0.4, 0.2, 1.0, -0.4, -0.6, -0.8]` | 60 | 25 | strong |
| `spectacle` | fast, clear, action-heavy, elaborate visuals and sound; cathartic, decisive endings with a twist, agents who act, justice served | V1 `[1.0, 0.5, -0.8, -0.4, 0.3, -0.2, -0.6, -0.5, 1.0, 0.0, 0.8, 0.9, 0.7]` · V2 `[0.5, -0.3, -0.6, 0.1, 0.2, 1.0, -0.1, 0.9, -0.7, 0.3, -0.4, -1.0, 0.6, 0.7, 0.6]` | 40 | 12 | likely |
| `warm-talky` | warm, light, linear, dense dialogue, saturated; compassion, relationships at the centre, transformation, hopeful just endings, no unease | V1 `[-0.3, -0.2, -0.4, 0.5, 1.0, -1.0, -0.7, 1.0, -0.8, -0.5, -0.2, -0.3, 0.5]` · V2 `[-0.2, 0.2, -0.5, 0.3, -0.8, 0.4, 1.0, 0.4, -0.4, 0.6, 1.0, -0.3, -0.3, 0.5, 0.9]` | 30 | 6 | initial |
| `newcomer` | undefined (θ = 0) | zeros | 12 | 2 | inconclusive |

Per persona the script writes:

- `users` + one `profiles` row (`preferredLanguage: 'ar'`; `market: 'SA'` and 2–3 `platforms` **if** the onboarding columns exist in the entity at run time — coordinate with the concurrent onboarding work; the seed must compile either way).
- `user_title_state`: the watched set sampled to favour, not exclusively contain, films the persona would like (mix ratio 70/30 so the ranking has something to order); `watchedAt` spread over the previous 18 months; `watchlist` 8/6/5/3 items; `not_watched` 10/5/5/2 marks (stay recommendation candidates, `§2.4 #3`); `notes` on ~5 titles; `importedRating` + `ratingSource: 'import'` on 3 titles of `slow-burn` only; `triadEligible: false` on 2 titles of `slow-burn` (paired with `not_remembered` replacement rows below).
- `triads`: for each triad draw 3 titles from the eligible watched set, never repeating the immediately previous triad's titles (ADR-34); utility `u = θ·x / τ + Gumbel` with τ = 0.4 on the 28 keys (0.2 on the first 13-key fixture, 0.5 in this plan's first draft — see WS4's calibration; exact Plackett–Luce sampling, so the model's assumption holds and held-out accuracy lands below 1.0); `ranking` = the three **title ids** best-first (ADR-15); `displayOrder` an independent shuffle; `shownAt`/`answeredAt` 40–90 s apart, grouped in sessions of 5 on different days; `status: 'completed'`; `policyVersion: 'demo-synthetic-v1'`; `selectionPropensity = 1 / C(pool, 3)`; `modelVersion: null`; `idempotencyKey: null`; `sessionId: 'demo-s<n>'`. One extra **active** triad for `spectacle` so the Rank screen opens mid-round.
- `triad_replacements`: 2 rows `not_remembered` (on `slow-burn`) and 1 row `not_watched` (on `spectacle`, whose state flips to `not_watched`), each attached to a completed triad whose `titleIds` reflect the swap — exactly what `TriadsService.replace()` would have produced.
- Titles: upsert the fixture's 300 entries (entity fields only: `internalId`, `titleEn`, `titleAr`, `description`, `releaseYear`, `genres`, `externalIds`, `fingerprint`) before anything else. For the 7 entries whose `descriptionSource` is `'wikidata'`, write `descriptionAr` into `description` — the stub "1955 film" is not a description.

Pure, unit-tested pieces (`seed-demo.spec.ts`): `sampleTriad()` (no repeat of previous, all watched, all eligible), `rankByUtility()` (permutation of input, seeded determinism), `spreadDates()` (monotone within a session), fixture validation (shape, 13 dims, `DEMO` prefix). The DB writer is verified by running it twice against `postgres-test` and asserting identical counts and identical `ranking` arrays.

Acceptance (printed by the script and checked by hand once):

| Check | Expected |
|---|---|
| demo users / profiles | 4 / 4 |
| `DEMO` titles | 200 (195 complete fingerprints) |
| watched per persona | 60 / 40 / 30 / 12 |
| completed triads per persona | 25 / 12 / 6 / 2 |
| active triads | 1 (`spectacle`) |
| replacements | 3 |
| a second run | same numbers, same rankings, no duplicates |

### WS4 — Training runner — **done 2026-09-03: loaded into the dev database and trained; acceptance met**

**The load** (~15:50Z): 300 `DEMO` titles upserted (the 15 `FILM` seeds untouched), four `@demo.local` accounts with their activity (45 completed + 1 active triads, 3 replacements, 8 consents), then one snapshot per persona from the unchanged trainer. Run from an isolated export of the committed `HEAD` (backend and worker package) because another session's uncommitted `titles.originalLanguage` entity change makes any insert into `titles` from the shared working tree fail against the dev database until its migration is applied; a re-run from the tree after that migration is idempotent and will also fill `originalLanguage`.

**Temperature calibration.** The plan's τ = 0.5 gave a persona that agreed with its own taste on only 78 % of pairs in expectation (simulated against the real fingerprints) and, after learning, a held-out accuracy of 0.67 and a recovery of 0.66 for `slow-burn` — too little signal, not a pipeline fault. Simulated pairwise agreement with the true utility order: τ 0.5 → 0.78, 0.3 → 0.85, 0.2 → 0.90, 0.15 → 0.92. τ = 0.2 (a consistent but not robotic ranker) is now the fixture value. **Re-calibrated for the 28-key θ (2026-09-04)**: the V2 half roughly doubles the utility spread over the catalog (standard deviation 0.76 → 1.51 for `slow-burn`), so at τ = 0.2 the same personas would agree with their own order on 0.95 of pairs — near-robotic; τ = 0.4 gives 0.90 for all three (`slow-burn` 0.899, `spectacle` 0.897, `warm-talky` 0.899, simulated against the real 28-key fingerprints), the same consistency the 13-key fixture had, and is now the fixture value.

| Persona | Triads trained | Held out | Held-out pairwise accuracy | Held-out NLL | Genre diversity | Recovery (cosine to θ) |
|---|---|---|---|---|---|---|
| `slow-burn` | 23 (25 seeded; the 2 containing the partial title were dropped by the trainer, as designed) | 4 | 0.75 | 1.35 | 20 | **0.83** |
| `spectacle` | 12 | 2 | 1.00 | 0.41 | 19 | 0.78 |
| `warm-talky` | 6 | 1 | 1.00 | 0.94 | 14 | 0.52 |
| `newcomer` | 2 | 0 | — | — | — | — (θ = 0, not asserted) |

Acceptance (the plan's bar: `slow-burn` recovery ≥ 0.8 and held-out accuracy ≥ 0.75) is met. The confidence band each persona lands in is observed on the screens in WS5, since the band rule lives in the backend (ADR-59/62) and is not reproduced by the runner.

**Deliverable**: `services/workers/src/train_demo.py` (`python -m src.train_demo`): lists profiles whose user email ends in `@demo.local`, runs the existing `train_profile()` for each, prints one row per persona with `trainingTriadCount`, the band it will produce, `heldOutPairwiseAccuracy`, and the **recovery score** = cosine similarity between the learned `weights` and the persona's hidden θ (θ is read from the persona table, exported by WS3 to `apps/backend/src/scripts/fixtures/personas.demo.json`).

Acceptance: 4 snapshots; `slow-burn` recovery ≥ 0.8 and held-out pairwise accuracy ≥ 0.75; `newcomer` recovery is *not* asserted (θ = 0 is unrecoverable by design). If `slow-burn` fails the bar, the pipeline — not the persona — is wrong; the triads were sampled from the model's own likelihood. Triads containing the 5 partial titles are dropped by the trainer, so counts in the snapshot may be slightly below the seed's; the runner prints both.

`make demo` = `npm run db:seed:demo && cd services/workers && poetry run python -m src.train_demo`.

### WS5 — Browser judgment pass — **done 2026-09-03 (text-verified on an isolated HEAD stack, ports 3110/3111)**

**How it ran.** A fresh export of the committed `HEAD` (frontend, backend, workers) served from a scratch directory on ports 3110/3111 against the dev database, so nothing of the other sessions' running servers or uncommitted tree was touched. The Browser pane was hidden for most of the pass, which blocks pointer actions and distorts screenshots, so the checks were made through the rendered page text (DOM) and the API as each persona; the one clean screenshot is the signed-in Home of `slow-burn`. A pointer-driven pass (drag reorder, the replacement confirmations) is still worth doing by hand.

| Screen | `slow-burn` (strong) | `spectacle` (likely) | `warm-talky` (initial) | `newcomer` (inconclusive) |
|---|---|---|---|---|
| Home | band **قوي**; top: Persona, The Lighthouse, First Reformed, Mulholland Drive, The Seventh Seal, Andrei Rublev — slow, ambiguous, dark, as designed; one reason line per card («غموض مقصود، ألوان باهتة… من اختياراتك أنت»); Public Quality «لا مصدر مرخّص بعد», availability «غير معروف بعد» | band **محتمل**; Mad Max: Fury Road, RRR, Run Lola Run, Everything Everywhere All at Once | band **أولي**; Ismail Yassine in the Army, My Wife the Director General, Children of Heaven, My Neighbor Totoro | band **غير محسوم**; Spirited Away, Coco, Amélie, RRR — noise, as designed |
| Library | «ترتيبك الشخصي»: 60 positions, no numbers; #1 Eraserhead, Rashomon, Memento, Stalker, Primer, Safe, Under the Skin … #58 Avatar, Star Wars, Guardians of the Galaxy; the partial title (The Choice) sits at #13 with coverage 0.85 and band **likely** — the ADR-19 demotion; watchlist 8; timeline 2025-03 → 2026-08; 5 notes («أعدت مشاهدته بعد سنوات.»); 3 imported ratings | ranking of 39: Avatar, City of God, The Raid on top; Hedi, Anatomy of a Fall at the bottom | ranking of 30: Tokyo Story, Wendy and Lucy, Halfaouine on top; Run Lola Run, The Blue Elephant at the bottom | ranking of 12 |
| Discover | «سجّلت 60 أفلام كمُشاهَدة … الترتيب متاح»; starter list; search «المومياء» → 1 result, marked «شاهدته / في قائمتك» | — | — | — |
| Rank | a fresh `random-v1` triad (Let the Right One In, The Fellowship of the Ring, Cinema Paradiso) with ↑/↓ and both controls «لم أشاهده» / «لا أتذكره»; «جولاتك المكتملة: 25» | opens on the seeded **active** triad (`demo-spectacle-open`) | fresh triad | fresh triad |
| Profile | account, market and platforms editable, pseudonymous profile id, 25 rounds, 60 watched, model `plackett-luce-v1`, band **قوي**, wipe control | — | — | — |

Findings for other scopes (recorded, not fixed here): the Discover progress copy says «60 أفلام» where Arabic wants «60 فيلمًا» (frontend copy); the Profile screen's market select reads «لم يُحدَّد بعد» in the DOM text although the profile has `market: SA` and onboarding was correctly skipped — worth a look at the select's initial value (frontend).

The original checklist follows.

Log in as each persona and check, in this order; every row is a screenshot in the final report:

| Screen | `slow-burn` | `spectacle` | `warm-talky` | `newcomer` |
|---|---|---|---|---|
| Discover | 10 pages; search «المومياء» and "Mummy" hit; existing marks shown | same | same | progress copy says how many more to reach the first triad |
| Rank | new triad loads; «لم أشاهده» and «لا أتذكره» each write a row; save → next | opens on the pre-seeded active triad | | after 2 more rounds the band on Home moves to `initial` |
| Home | band **strong**; top items slow/ambiguous/dark; a partial title shows the demotion note; Public Quality/Watchability "unknown" | band **likely**; top items fast/action | band **initial**; warm/talky on top | band **inconclusive** copy («لا توجد إشارة كافية بعد») |
| Library | ranking of 60 with positions only (no numbers); timeline over 18 months; notes; imported rating visible | ranking of 40 | ranking of 30 | ranking of 12 |
| Profile | model version + band; wipe → new empty profile, other personas untouched | | | |

The pass is judged against ADR-33 (no percentage, no merged score) and `§4.4` (three separate values + confidence).

### WS6 — Documentation and status (1 h, after WS5)

- [QUICKSTART.md](QUICKSTART.md) §4: add `npm run db:seed:demo` and `make demo`; §6: the four persona logins.
- [README.md](README.md) map: a row for this file; changelog entry. (`docs/README.md` is being edited by a concurrent session — add the row after that lands.)
- [DATA_LICENSING.md](DATA_LICENSING.md) §4: the `DEMO` catalog joins the 15 `FILM` rows as development fixtures, never in an external test.
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): a *Demo data* row under tooling with the WS5 evidence; the enrichment row loses "never run against the actual catalog".
- A new ADR (next free number — 44 at the time of writing; check before assigning): *Demo data policy* — synthetic personas separated by `policyVersion` and email domain, committed fingerprints, deterministic seed, never in production.

---

## 5. Timeline and ownership

| Step | Effort | Can run in parallel with | Needs |
|---|---|---|---|
| WS0 | ½ h | — | — |
| WS1 curation + fetch script | **done** | — | the owner's review of the Arabic slice and the nine forced swaps |
| WS2 | **done** (300/300 in 439 s) | — | — |
| WS3 | **done** — loaded into the dev database | — | — |
| WS4 | **done** — trained, acceptance met on V1; met again on the 28-key fixture after ADR-69 (§7.2, regeneration) | — | — |
| WS5 | **done** (text-verified; a pointer pass by hand remains) | — | — |
| WS6 | 1 h | — | WS5 screenshots |

About a day and a half remains. First visible result (Discover with 300 titles, placeholder fingerprints) after WS3 with `--placeholder`, roughly half a day.

---

## 6. What this plan deliberately does not fix (judge these as "not built", not "broken")

| Cell / feature | Why no data helps | Where it is planned |
|---|---|---|
| Public Quality | `null` in code; no `public_quality_sources` table | [SCHEMA.md](SCHEMA.md) §2.2, gap 1 |
| Watchability | `null` in code; no `availability_snapshots`; profile `platforms` only just being added | gap 1, gap 7 |
| Reason text per recommendation (`§9.4`) | not generated; `evidenceSource` absent | [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md) §8 |
| Discovery / outside-usual tracks | every result is `safe` | `§8`, adaptive policy |
| V2 fingerprint families in the model | extracted and published in `fingerprint.v2` for the demo catalog (§7.2); the trainer and scorer still read the 13 V1 keys | board request C9; [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §3.1 |
| Posters, runtime, credits | no columns; posters need a rights row first | `localized_titles`, `credits`, `source_records` |
| Recommendations log, outcomes, post-watch loop | tables missing | gap 4 |
| Calibrated confidence | band is a count heuristic | gap 5, ADR-21 |
| Population priors / shared latent space | `population_priors=None` in the trainer | `§7.5`, ADR-13 |

---

## 7. The honesty limit and the real judgment path

Synthetic personas are sampled from the model's own likelihood over the catalog's fingerprints. Recovering θ therefore proves that seed → train → rank is wired correctly; it says nothing about whether the fingerprints describe films the way people experience them, or whether the triad question yields a taste worth the name. That is the product question, and only the owner's real account can answer it:

1. After WS2, on `bakheet@gmail.com`: mark 30+ films *actually watched* from the `DEMO` catalog (add missing favourites to the QID list first — the catalog should contain films the owner knows well).
2. Rank 20+ triads by hand across two or three sittings; use the replacement controls whenever honest.
3. Train the profile (`python -m src.training <profile-uuid>`), then read Home and the Library ranking and answer, in writing: does the top of the library ranking match what you would have put there? Does the Home list feel like you, or like your genres? Where does it fail, and is the failure explainable by a missing fingerprint family ([FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §2.1)?
4. Those answers, not the persona recovery score, are the Phase 0 gate input (`§17.1`: "value appears after 3–5 triads").

### 7.1 The first non-synthetic ranker: Claude, 2026-09-03

At the owner's request the session ran §7's protocol itself, as a ranker from *outside* the generative model: an account `claude@judge.local` (kept out of the `@demo.local` domain so `make demo` never removes it; credentials on the session board), an onboarded profile, 61 catalog films the session can judge marked as watched with three notes and six watchlist entries, and **25 rounds answered by a preference order written by judgment** (`fixtures/judge-claude.ranking.json`; the rounds are in `judge-claude.rounds.json`). The app chose every triad (`random-v1`); nothing in the order was derived from a fingerprint. It is still not a human judgment — the owner's pass remains the gate input — but it is the first ranking the learner has seen that was not sampled from its own likelihood.

| Measure | Value |
|---|---|
| Rounds | 25 completed, 5 held out |
| Held-out pairwise accuracy / NLL | **0.67** / 1.99 (the synthetic personas: 0.75–1.00) |
| Genre diversity of the evidence | 17 |
| Spearman between Claude's own order and the model's library ranking (61 films) | **0.72** |
| Model's top 10 | Persona, Taste of Cherry, The Seventh Seal, Stalker, 2001, Rashomon, Lost in Translation, Portrait of a Lady on Fire, Blade Runner, In the Mood for Love — eight of them in Claude's top 23; Claude's #1 sits at #10 |
| Model's bottom 5 | The Truman Show, Toy Story, City of God, Terrorism and Kebab, Amélie — Claude's #43, #40, #51, #61, #50 |
| Largest disagreements | Fight Club (Claude #59, model #24) · Paradise Now (#48 → #20) · Where Is the Friend's House? (#11 → #40) · Eternal Sunshine (#20 → #47) · Cairo Station (#14 → #36) · Fargo (#29 → #51) |
| Home (all `strong`) | Andrei Rublev, Ida, A Ghost Story, Eraserhead, Aftersun, Roma, Burning, The Lighthouse, Wendy and Lucy, The Green Knight; every reason line reads "pacing lower, ambiguity higher" |

The four answers, written by the ranker:

1. **Does the top of the library ranking match what I would have put there?** Mostly. The model's top ten is drawn from my top quarter, and the bottom five are films I ranked low. A 0.72 rank correlation from 25 triads is real learning, not noise.
2. **Does the Home list feel like me, or like my genres?** Like one slice of me. It found the axis I ranked most consistently — slow, ambiguous, dark — and recommends along it. It has not found that I also rank warm, plain, humanist films high (Where Is the Friend's House? #11, Children of Heaven #33, Totoro #39); those sit low in its ranking. A single linear taste vector cannot hold "loves slow ambiguity" and "loves warm simplicity" at once, so it keeps the stronger one.
3. **Where does it fail, and is the failure a missing fingerprint family?** Yes, in every large disagreement. Fight Club and Paradise Now are pushed up because they score as ambiguous and dark — the dimensions that make me rank a film low there (self-satisfied cynicism, in the one; a thriller structure, in the other) are the `§6.1` families V1 lacks: tone beyond warmth/darkness (irony, unease, catharsis), characters (moral ambiguity, transformation) and ending. Where Is the Friend's House? and Eternal Sunshine are pushed down for the mirror reason: their warmth and emotional arc carry them, and V1 has only `warmth`.
4. **Confidence.** The screens say **قوي / strong** for this profile although it predicts my held-out rounds at two-thirds. `§9.2`'s "predicted held-out comparisons" criterion is not binding enough in the current band rule (ADR-59/62/64 add posterior stability, genre and language diversity); a ranker with 0.67 held-out accuracy should not read as "a fairly stable pattern in your choices". Recorded for session A (board request C8).

What this changes in the plan: nothing in WS1–WS5; it sharpens §6's "not built" list — the V2 fingerprint families are now the first thing a real ranker misses, and the confidence band needs a held-out floor. The owner's own pass (§7) stays the Phase 0 gate input.

### 7.2 The V2 families, first pass — extracted and evaluated 2026-09-04

Owner's directive after §7.1: start the second fingerprint families. Delivered (commits `46eab2e`, `538c4af`): the specification of fifteen namespaced features plus a controlled theme vocabulary ([FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §3.1), `generate_fingerprint_v2()` in the worker, `enrich_catalog --v2`, the V2 block extracted for all 300 titles (0 failures, mean confidence 0.58, per-feature sd 0.16–0.24) and published inside `titles.fingerprint.v2` on the dev database (V1 keys untouched, every V1 reader unaffected), and a read-only offline evaluation (`fingerprint_v2_eval.py`) that fits the trainer's own Plackett–Luce ranker with the trainer's temporal hold-out on three feature sets.

Spot values on the titles §7.1 mis-ranked, exactly the distinctions V1 could not make: Fight Club irony 0.85 / compassion 0.40; Where Is the Friend's House? compassion 0.85 / moral ambiguity 0.15; In the Mood for Love compassion 0.90 / catharsis 0.30; Paradise Now unease 0.90 / optimism 0.05.

**Evaluation on Claude's account**, first at the 25 rounds of §7.1, then after 25 more rounds answered from the same written order (50 in all; 47 usable, three dropped because they contain a deliberately partial title):

| Rounds | Regularization | Feature set | Held-out accuracy | Held-out NLL | Spearman with Claude's order |
|---|---|---|---|---|---|
| 25 | 0.01 (trainer default) | V1 | 0.67 | 1.99 | 0.73 |
| 25 | 0.01 | V1+V2 | 0.67 | 2.55 | 0.79 |
| 25 | 0.1 | V1 | 0.73 | 1.62 | 0.75 |
| 25 | 0.1 | V1+V2 | 0.67 | 1.54 | 0.76 |
| **50** | **0.01** | V1 | 0.85 | 0.91 | 0.79 |
| **50** | **0.01** | **V1+V2** | **0.85** | **0.82** | **0.83** |
| 50 | 0.1 | V1 | 0.81 | 1.10 | 0.77 |
| 50 | 0.1 | V1+V2 | 0.85 | 1.12 | 0.82 |
| 50 | any | V2 alone | 0.53–0.57 | 1.9–2.1 | 0.59–0.62 |

Where the six misses land under V1 versus V1+V2 at 50 rounds (regularization 0.1): Fight Club (Claude #59) #33 → **#48**; Eternal Sunshine (#20) #32 → **#21**; Cairo Station (#14) #35 → **#26**; In the Mood for Love (#1) #8 → **#3**; My Neighbor Totoro (#39) #53 → **#36**; Children of Heaven (#33) #45 → **#38**; Paradise Now (#48) #26 → #27; Fargo (#29) #51 → #47.

On the four synthetic personas (generated from V1 alone, so a control): V1+V2 improves `spectacle`'s held-out NLL (0.41 → 0.20) and overfits `slow-burn` and `warm-talky` at 0.01 with 6–19 training triads; V2 alone reconstructs `slow-burn` (held-out accuracy 0.93) because the new features correlate with the V1 axes it was built from.

**Reading.** The families carry the signal §7.1 said was missing: the cynical and the compassionate separate, and the films V1 put in the wrong half move to the right one. They complement V1 rather than replace it (V2 alone is weak). At 25 rounds a 28-dimensional vector overfits under the trainer's regularization; at 50 rounds V1+V2 is best on every measure. So the wiring must come with shrinkage: either a stronger L2 (0.1 held its own at 25 and 50) or, better, the blueprint's own answer — a hierarchical prior with the V2 block shrunk separately (`BP §7.1`), and the regularization chosen by held-out NLL rather than fixed.

**Proposed next steps** (model-service owner, board request C9): read the 28 keys in `training.py` and `RecommendationsService` (V2 from `fingerprint.v2.features`, unknown → dropped/imputed exactly as V1), record `fingerprintSchemaVersion` on the snapshot so old weights are never applied to a new vector, and choose the regularization by held-out NLL. Catalog side (this scope): Style/People/Cultural blocks when their evidence exists.

**Provenance rows — done 2026-09-04 (commit `d3e46c5`).** `content_features` now backs every published number of the demo catalog: 8,390 rows for the 300 `DEMO` titles and 28 feature keys (3,835 V1 rows, 55 more from the five deliberately partial titles' remaining dimensions, 4,500 V2 rows), each with `uncertainty = 1 − confidence`, the block's `sourceIds`, `licenseStatus: unknown`, `reviewStatus: unreviewed` and `validFrom` = the extraction time. Written by the seed (`seedContentFeatures()`, [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §3.1): upsert on `(titleId, featureKey, extractorVersion)`, older versions of a feature marked `supersededBy` the current row rather than deleted — verified by the `postgres-test` e2e with a planted older-version row across two runs. Nothing reads the table yet; the admin board (`§5.5`) and the review queue are its consumers.

**Re-measurement after the wiring — 2026-09-04 (ADR-69, commit `1a62cb3` by the model-service owner; this scope's follow-up in the commit after it).** The trainer now serves the 28 keys, `MODEL_VERSION` is `plackett-luce-v2`, and the L2 penalty is chosen per run by held-out NLL over (0.01, 0.03, 0.1, 0.3). Measured on the served path, not the offline script:

| What | Before (V1, 13 keys) | After (V1+V2, 28 keys) |
|---|---|---|
| Offline evaluation (`fingerprint_v2_eval`, regression check after the rename) | NLL 0.912 · acc 0.85 · Spearman 0.79 | NLL 0.824 · acc 0.85 · Spearman 0.83 — identical to the first pass |
| `train_profile` on `claude@judge.local` (47 usable triads, 9 held out) | — (old 13-key snapshot, refused with 409 by the dimension guard until retrained) | NLL 0.8241 · acc 85.19 % · chosen penalty 0.01 · 20 genres / 11 languages |
| `GET …/library/ranking` through the API, Spearman with Claude's written order over all 61 films | 0.72 at 25 rounds (§7.1) | **0.825** at 50 rounds, `modelVersion: plackett-luce-v2`, bands `likely`/`strong` |
| Where the misses land (API position / Claude's rank) | Fight Club #33/#59 · In the Mood for Love #8/#1 · Totoro #53/#39 | Fight Club **#57**/#59 · In the Mood for Love **#2**/#1 · Totoro **#41**/#39 · Amélie #58/#50 · The Dark Knight #54/#53 |
| Largest remaining disagreements (≥ 20 places) | — | Memento #22/#47 · Paradise Now #26/#48 · Capernaum #15/#36 · 12 Angry Men #23/#44 · Where Is the Friend's House? #31/#11 · Toy Story #60/#40 · Caramel #37/#57 · The Yacoubian Building #40/#60 |
| `GET …/recommendations?limit=15` | — | 15 results, all `strong`/`safe`, coverage 1.00; 2 of 15 reasons cite a V2 family (`tone.unease ↑` for The Lighthouse, `ending.justice ↑` for Atlantics), the rest V1 (`psychologicalDepth ↑`, `dialogueDensity ↓`, `actionIntensity ↓`) |

The served model reproduces the offline forecast to the third decimal, so the wiring is faithful. The top of the ranking is now Claude's top (Persona, In the Mood for Love, Stalker, Yi Yi, Close-Up, Mulholland Drive, Tokyo Story — Claude's #3, #1, #6, #5, #7, #10, #2). The remaining disagreements are of two kinds the fingerprint still cannot see: films Claude ranks by their moral or political weight rather than their texture (12 Angry Men, Paradise Now, The Yacoubian Building) and animation (Toy Story #60 for a #40) — the Style/People/Cultural blocks of §3.1, not more of V1/V2.

**Synthetic personas under the 28-key model** (`python -m src.train_demo`, run after re-seeding; the personas were generated from V1 alone, so their true V2 weight is exactly zero):

| persona | triads | held-out | acc | NLL | recovery (28) | recovery (V1 only) | V2 weight share | chosen penalty | before (V1, WS4) |
|---|---|---|---|---|---|---|---|---|---|
| `slow-burn` | 23 | 4 | **0.67** | 1.14 | 0.60 | 0.85 | 0.71 | 0.30 | acc 0.75 · NLL 1.35 · recovery 0.83 |
| `spectacle` | 12 | 2 | 1.00 | 0.20 | 0.75 | 0.86 | 0.50 | 0.01 | acc 1.00 · NLL 0.41 |
| `warm-talky` | 6 | 1 | 0.67 | 1.26 | 0.20 | 0.27 | 0.67 | 0.01 | initial band, as designed |
| `newcomer` | 2 | 0 | — | — | — | — | 0.67 | 0.01 | inconclusive, as designed |

Reading: `slow-burn` still recovers its own V1 direction (0.85 ≥ the 0.8 bar) and its held-out NLL improves (1.35 → 1.14), but it loses one held-out pair (8/12 instead of 9/12, i.e. 0.67 against the 0.75 bar) and the model puts 71 % of its weight norm on V2 families the persona never had — the correlated-feature cost of a 28-key vector on 23 rounds, which the grid answers with the strongest penalty (0.30). This is not a pipeline fault, it is the fixture being narrower than the served model: the personas are defined on 13 axes while the product now learns 28. `train_demo` therefore applies the recovery bar to the V1 sub-vector (where the generator defined the persona) and prints the full-vector recovery, the V2 share and the chosen penalty as diagnostics; the held-out bar is left as it was and is reported as **not met** for `slow-burn` until the fixture is regenerated. Proposed next step for this scope: regenerate the personas on all 28 keys (θ with deliberate V2 preferences — `slow-burn` on openness and unreliability, `spectacle` on catharsis and low ambiguity of ending, `warm-talky` on compassion and relationship centrality) so the synthetic control and the served model describe the same space, then re-run WS4's bar.

**Personas regenerated on 28 keys — 2026-09-04 (owner's order).** The fixture now defines each persona on the full model space: the 13 V1 weights unchanged, plus a V2 half written from the persona's description (`slow-burn` wants open endings 1.0, unreliable narration 0.7, moral ambiguity 0.8, no catharsis −0.5, no optimism −0.8; `spectacle` catharsis 1.0, agency 0.9, closed endings −1.0, twist 0.6, justice 0.7; `warm-talky` compassion 1.0, relationship centrality 1.0, optimism 0.9, no unease −0.8). The seed's generator (`seed-demo.lib.ts`) reads the 28 keys in the trainer's order (`MODEL_DIMENSIONS` = the 13 V1 keys + `FINGERPRINT_V2_DIMENSIONS` from the entity type, so the two lists cannot drift), imputes an unknown V2 key at 0.5 exactly as a V1 one, and treats a title without a `v2` block as incomplete, as the trainer does; τ moved from 0.2 to 0.4 to keep the personas' expected agreement with their own order at 0.90 (calibration above, WS4). The seed's activity therefore changed for every `@demo.local` account (different watched sets, triads and lists); the catalog, the provenance rows and `claude@judge.local` did not.

Trained from the tree on the served 28-key model (`python -m src.train_demo`, run after `npm run db:seed:demo`):

| persona | triads | held-out | acc | NLL | recovery (28) | recovery (V1 part) | V2 weight share (true share of θ) | chosen penalty | band |
|---|---|---|---|---|---|---|---|---|---|
| `slow-burn` | 23 | 4 | **0.83** | 1.09 | **0.87** | 0.90 | 0.75 (0.66) | 0.30 | strong |
| `spectacle` | 12 | 2 | 1.00 | 0.06 | 0.60 | 0.63 | 0.73 (0.70) | 0.01 | likely |
| `warm-talky` | 6 | 1 | 1.00 | 0.35 | 0.32 | 0.40 | 0.86 (0.70) | 0.01 | initial |
| `newcomer` | 2 | 0 | — | — | — | — | — | 0.01 | inconclusive |

The WS4 bar is met again on the served model: `slow-burn` recovers its 28-key θ at 0.87 (≥ 0.8) and predicts 10 of 12 held-out pairs (0.83 ≥ 0.75), against 0.67 and a 0.60 full-vector recovery when the same model was fed the 13-key personas (re-measurement above). The V2 weight the model learns now matches weight the persona actually has (share 0.75 learned against 0.66 true) instead of being spurious. `spectacle` and `warm-talky` behave as designed for their band: high held-out accuracy from few rounds but a direction the model has not pinned down yet (recovery 0.60 and 0.32 at 12 and 6 rounds) — exactly the "likely" and "initial" stories the screens tell. `train_demo` judges a 28-key persona on the full-vector recovery and a legacy 13-key one on its V1 part, and says which in its message.

### 7.3 The third block — form families, specified and extracted 2026-09-04

Owner's directive after the regeneration: specify the third block and extract it. Specified in [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §3.3 from two sources of evidence — the `BP §6.1` families the dense vector still did not cover (rhythm detail, dialogue & information, style) and the two places §7.2's re-measurement showed the served 28-key model still disagrees with Claude's order (formal distinction and lightness-with-depth ranked too low; openly sentimental social dramas too high). Twelve namespaced features: `rhythm.setupLength`, `rhythm.turningPointDensity`, `rhythm.deliberateness`, `information.expositionDirectness`, `information.subtext`, `information.knowledgeComplexity`, `style.stylization`, `style.experimentation`, `style.scale`, `tone.playfulness`, `tone.sentimentality`, `narrative.scope`. Left out on purpose: camera movement and editing (no descriptive visual evidence in the fixture), People and Cultural context (factual blocks, §3.2). No key encodes a political or other sensitive stance; `narrative.scope` is the size of the canvas and the prompt says so.

**Extraction** (`python -m src.enrich_catalog --v3`, concurrency 4): 300 of 300 titles, 0 failures, 0 refusals, 340 s, every block served by the same model id; stored as `fingerprint.v3` in the fixture and, through the seed, in `titles.fingerprint` and as 3,600 `content_features` rows (`enrichment-worker-v3-form-v1`). Mean confidence per feature, as the extractor reported it — lowest exactly where the evidence is thinnest, the two style features scored from plot text (0.42–0.43), highest on the canvas and the turning points (0.61–0.63):

| Feature | Mean | Spread (σ) | Confidence |
|---|---|---|---|
| `rhythm.setupLength` | 0.45 | 0.16 | 0.56 |
| `rhythm.turningPointDensity` | 0.52 | 0.19 | 0.61 |
| `rhythm.deliberateness` | 0.73 | 0.14 | 0.58 |
| `information.expositionDirectness` | 0.43 | 0.19 | 0.55 |
| `information.subtext` | 0.59 | 0.21 | 0.57 |
| `information.knowledgeComplexity` | 0.35 | 0.16 | 0.51 |
| `style.stylization` | 0.44 | 0.23 | 0.43 |
| `style.experimentation` | 0.40 | 0.22 | 0.42 |
| `style.scale` | 0.39 | 0.23 | 0.55 |
| `tone.playfulness` | 0.34 | 0.26 | 0.58 |
| `tone.sentimentality` | 0.40 | 0.20 | 0.53 |
| `narrative.scope` | 0.54 | 0.21 | 0.63 |

`rhythm.deliberateness` sits high for almost every title (mean 0.73, the narrowest spread): a canon-heavy catalog rarely contains padding, so the feature will separate little until the catalog holds ordinary films — a catalog property, not an extraction fault. Spot values on the films §7.2 named, exactly the distinctions the 28 keys could not make:

| Title | playfulness | sentimentality | stylization | experimentation | scale | scope | subtext |
|---|---|---|---|---|---|---|---|
| Toy Story (Claude #40, model #60) | 0.85 | 0.55 | 0.55 | 0.35 | 0.45 | 0.25 | 0.30 |
| Where Is the Friend's House? (#11, model #31) | 0.30 | 0.15 | 0.10 | 0.30 | 0.10 | 0.35 | 0.55 |
| Amélie (#50, model #58) | 0.90 | 0.75 | 0.85 | 0.60 | 0.30 | 0.30 | 0.40 |
| Capernaum (#36, model #15) | 0.15 | 0.60 | 0.25 | 0.40 | 0.35 | 0.75 | 0.40 |
| The Yacoubian Building (#60, model #40) | 0.15 | 0.55 | 0.30 | 0.20 | 0.65 | 0.85 | 0.40 |
| 12 Angry Men (#44, model #23) | 0.10 | 0.25 | 0.15 | 0.30 | 0.05 | 0.75 | 0.60 |
| Paradise Now (#48, model #26) | 0.05 | 0.25 | 0.15 | 0.30 | 0.30 | 0.75 | 0.75 |
| Persona (#3, model #1) | 0.05 | 0.05 | 0.85 | 0.95 | 0.05 | 0.25 | 0.95 |
| Stalker (#6, model #3) | 0.05 | 0.15 | 0.75 | 0.85 | 0.25 | 0.70 | 0.90 |
| In the Mood for Love (#1, model #2) | 0.10 | 0.35 | 0.65 | 0.60 | 0.15 | 0.20 | 0.95 |

The social dramas Claude ranks low share `narrative.scope` 0.75–0.85 with `tone.playfulness` ≤ 0.15; the restrained film about a child (Where Is the Friend's House?) reads sentimentality 0.15 against Capernaum's 0.60; Persona and Stalker are the catalog's experimentation ceiling.

**Offline evaluation** (`fingerprint_v2_eval`, Claude's 50 rounds — 47 usable — same temporal hold-out as the trainer; V1+V2 is the served model):

At the 50 rounds of §7.2 (47 usable, 9 held out), every L2 penalty of the trainer's grid:

| Penalty | Set | Held-out accuracy | Held-out NLL | Spearman with Claude's order |
|---|---|---|---|---|
| 0.01 | V1 | 0.85 | 0.91 | 0.79 |
| 0.01 | **V1+V2 (served)** | 0.85 | **0.82** | 0.83 |
| 0.01 | V1+V2+V3 | 0.81 | 1.91 | 0.85 |
| 0.01 | V3 alone | 0.77 | 1.32 | 0.79 |
| 0.03 | V1+V2 | 0.85 | 0.97 | 0.83 |
| 0.03 | V1+V2+V3 | 0.81 | 1.30 | **0.86** |
| 0.1 | V1+V2 | 0.85 | 1.12 | 0.82 |
| 0.1 | V1+V2+V3 | 0.81 | 1.06 | 0.85 |
| 0.3 | V1+V2 | 0.81 | 1.24 | 0.79 |
| 0.3 | V1+V2+V3 | 0.74 | 1.09 | 0.84 |
| any | V2 alone | 0.53–0.57 | 1.9–2.1 | 0.59–0.62 |

At 50 rounds the block already raises agreement with the written order to the best value of any set (0.86) and V3 alone is the strongest single block after V1 (0.79–0.80 against V2's 0.62), but 40 keys on 38 training rounds cost held-out likelihood at every penalty — the same overfit V2 showed at 25 rounds before the wiring. So the judge answered 25 more rounds through the API from the same written order (75 in all; 71 usable, 14 held out), and the picture inverted:

| Penalty | Set | Held-out accuracy | Held-out NLL | Spearman with Claude's order |
|---|---|---|---|---|
| 0.01 | V1 | 0.76 | 1.51 | 0.80 |
| 0.01 | V1+V2 (served) | 0.81 | 1.12 | 0.84 |
| 0.01 | V1+V2+V3 | 0.88 | 0.83 | 0.89 |
| 0.01 | V3 alone | 0.84 | 0.92 | 0.82 |
| **0.03** | V1 | 0.79 | 1.42 | 0.80 |
| 0.03 | **V1+V2 (served; the trainer's chosen penalty at 75 rounds)** | 0.81 | 1.08 | 0.84 |
| 0.03 | **V1+V2+V3** | **0.86** | **0.82** | **0.89** |
| 0.03 | V3 alone | 0.82 | 0.92 | 0.81 |
| 0.1 | V1+V2 | 0.76 | 1.09 | 0.83 |
| 0.1 | V1+V2+V3 | 0.81 | 0.88 | 0.88 |
| 0.3 | V1+V2 | 0.76 | 1.12 | 0.81 |
| 0.3 | V1+V2+V3 | 0.79 | 0.93 | 0.87 |
| any | V2 alone | 0.73–0.78 | 1.37–1.38 | 0.62–0.64 |

The served path confirms the baseline: `train_profile` on the 75 rounds chose 0.03 and reports held-out NLL 1.076 and accuracy 80.95 % — the V1+V2 row above to the third decimal — and the API ranking of the 61 films agrees with Claude's order at Spearman 0.846 (0.825 at 50 rounds). Against that served model, V1+V2+V3 at the same penalty predicts the 14 held-out rounds better (NLL 0.82 vs 1.08, accuracy 0.86 vs 0.81) and agrees with the full written order better (0.89 vs 0.84), at every penalty in the grid. V3 alone (NLL 0.92, accuracy 0.82–0.84, Spearman 0.81–0.82) now beats V1 alone on every measure: the form families carry more of this ranker's taste than the thirteen original dimensions do. The overfit at 50 rounds was a data-size effect, not a property of the block.

**Reading.** The third block is the strongest addition so far, and it needs about 75 rounds before it pays — below that a 40-key vector overfits under a single scalar penalty, exactly the case `BP §7.1`'s hierarchical (block-wise) shrinkage is meant for. Two wiring designs are therefore possible: read the 40 keys with the existing grid (pays from ~75 rounds, costs a little below that), or read them with a per-block penalty so the V3 weights stay near zero until the evidence supports them (pays earlier, one more hyper-parameter). Which one is the model-service owner's call; the evidence for both is above.

Wiring is a model-service change (the served vector would grow from 28 to 40 keys); requested from its owner as C10 with this evidence and the same rules as ADR-69 (V3 read from `fingerprint.v3.features`, a title without the block excluded from training, penalty chosen by held-out NLL).

**Wired and re-measured — 2026-09-04 (C10, commit `6abf34d` by the model-service owner; the owner chose the shared penalty grid over a per-block one).** The trainer serves 40 keys as `plackett-luce-v3`. On the served path, same 75 rounds:

| What | 28 keys (served before) | 40 keys (served now) |
|---|---|---|
| `train_profile` on `claude@judge.local` (71 usable, 14 held out) | NLL 1.076 · acc 80.95 % · penalty 0.03 | **NLL 0.823 · acc 85.71 % · penalty 0.03** — the offline V1+V2+V3 row to the third decimal |
| `GET …/library/ranking`, Spearman with Claude's order over all 61 films | 0.846 | **0.896**, `modelVersion: plackett-luce-v3` |
| Top of the ranking (Claude's rank) | Persona #3, In the Mood for Love #1, Stalker #6… | In the Mood for Love **#1**, Persona #3, Mulholland Drive #10, Tokyo Story #2, Yi Yi #5, Stalker #6 |
| Tracked films (model / Claude) | Totoro #41/#39 · Amélie #58/#50 · Fight Club #57/#59 | Totoro #38/#39 · Amélie #57/#50 · Fight Club #55/#59 |
| Largest remaining disagreements | Capernaum #12/#36 · Battle of Algiers #52/#30 · Memento #25/#47 · Toy Story #60/#40 | Memento #23/#47 · Toy Story #60/#40 · Seven Samurai #35/#19 · Lost in Translation #7/#23 · Capernaum #20/#36 · The Seventh Seal #21/#9 |

Two observations for the model-service owner rather than for the catalog: Toy Story stays at #60 for a #40 — the block gave the model the word (playfulness 0.85) but the served weights still rank it by everything else, so animation/family register may need its own family or the People/Cultural side blocks; and every one of the fifteen recommendations now cites `information.expositionDirectness ↓` as its first reason (the second varies: soundscape, psychological depth, deliberateness) — correct as a score explanation, poor as a display: the reason picker should prefer diversity across a page of results (`BP §9.4`).


### 7.4 The cultural-context block — Wikidata facts and coverage, 2026-09-04

Owner's directive after §7.3: start the cultural block from Wikidata. Specified in [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §3.4 as what `BP §6.1` says it is — a separate factual block, never a taste dimension and never about the viewer: original languages (P364), production countries (P495), setting places with their countries (P840 → P17), setting eras with dates (P2408 → P580/P582/P585 or a decade/century/year label), dialects explicitly unknown. Read by a new fetcher (`npm run catalog:cultural`) through the catalog's Wikidata cache, CC0, stored on the fixture entry and as categorical `content_features` rows (NULL value, codes as shares) by the seed. Nothing in the fingerprint, the trainer or the API reads it.

**Result on the demo catalog (2026-09-04, `catalog-cultural-v1`, 532 referenced Wikidata entities resolved through the catalog cache):** all 300 titles carry the block; 225 have at least one setting place (P840) and 100 a setting era (P2408); 23 stories are set outside their production country (Casablanca, Timbuktu, Gladiator, Apocalypse Now, The Third Man, Omar, Wajib, Salt of This Sea…). Every original language resolved to a code except four titles whose Wikidata language item has no ISO code at all (Songhay, Mixtec, Taiwanese Hokkien, Standard Taiwanese Mandarin — kept as labels, listed as `unknown` in the language table); one production "country" is a label rather than a code (`Occupied Palestinian territory`, the item has no P297). A place carries every country whose P17 statement holds now — ended and deprecated statements are skipped, and a contested region lists each claimant rather than having one picked — so Nablus reads `PS` (the 1948–1967 state Wikidata also records is ended) and the region item "Palestine" reads both `PS` and `IL`. 25 titles have a place with no country at all: fictional places (Tatooine, Middle-earth, DuLoc), oceans and ships (North Atlantic Ocean, RMS Carpathia), continents (Africa) and historical entities (Allied-occupied Austria).

Coverage per original language, the first measurement of `BP §11.3`'s gate on this catalog (setting place / era / V1 complete / mean V1 confidence):

| Language | Titles | Setting place | Setting era | V1 complete | Mean V1 confidence |
|---|---|---|---|---|---|
| en | 122 | 93 % | 48 % | 98 % | 0.66 |
| ar | 91 | **42 %** | **8 %** | 98 % | **0.51** |
| fr | 13 | 69 % | 31 % | 100 % | 0.60 |
| ja | 11 | 91 % | 64 % | 100 % | 0.68 |
| de / es / ko / tr / fa / hi | 5–6 each | 83–100 % | 0–100 % | 80–100 % | 0.61–0.67 |

And per production country: US 101 titles with a setting place for 93 %, **EG 41 with 17 %** and an era for 2 %, **SA 9 with 11 %**, FR 19 with 68 %, GB 15 with 93 %, JP 11 with 91 %, LB 7 with 71 %. By tier: popular 80 %, mid 75 %, niche 68 % have a place; niche titles are also the only tier with an incomplete V1 (94 %).

The gap the gate is there to catch is real and it is upstream, not in the pipeline: Wikidata describes where and when an American or Japanese story is set nine times out of ten, an Egyptian one one time in six, a Saudi one one in nine; and the V1 extractor's own confidence on Arabic-language titles (0.51) runs a full step below English (0.66), because the Arabic titles' plot text on Wikipedia is shorter. The review lists name the 75 titles without a place and the 200 without an era; for the Arabic half the fix belongs on Wikidata itself. `dialects` is unknown for every title — Wikidata does not carry it — and stays so rather than being guessed from the country.

Every block is written into the dev database as categorical `content_features` rows (NULL value, codes as shares) beside the fingerprint rows; the model, the trainer and the API read none of it yet.

What the block is for next: (1) the coverage tables are the first measurement of `BP §11.3`'s "per language / country / tier" quality gate on this catalog — the numbers above are the baseline any later catalog must not fall below; (2) the model-side use is the hierarchical side block of `BP §7.1`/`§10.2` (a heavily shrunk per-country/per-era effect that can never dominate the content vector), which is a model-service design, not a catalog one; (3) the review lists name exactly which titles need a human to add a place or era on Wikidata itself — the fix belongs upstream, in the open source of truth, not in a local override.

### 7.5 Arabic plot as second evidence — 2026-09-04

Cause (measured before touching anything): V1 confidence follows plot length — 0.45 under 400 characters, 0.55 at 400–2,000, 0.64 above 2,000; the Arabic slice's English plots have a median of 778 characters, the English slice's 2,936. Fix: `npm run catalog:evidence-ar` stores each title's Arabic Wikipedia plot section; `enrich_catalog --ar-evidence` re-extracts V1 for titles with an English plot under 2,000 characters, the Arabic section appended, version `enrichment-worker-v2+ar-evidence`, nested V2/V3 blocks kept, earlier provenance rows superseded by the seed.

**Result — a null effect, and a stability finding.** 215 of 300 Arabic articles have a plot section; 52 titles qualified (46 Arabic-slice; the other short-plot Arabic titles already used the Arabic section as their only plot). Re-extracted with the Arabic section appended, and, as a control, 20 of them re-extracted a second time under identical evidence on a scratch copy:

| | Titles | Mean V1 confidence before → after | Rose / fell | Mean value move | `linearity` move (flips ≥ 0.4) |
|---|---|---|---|---|---|
| Arabic evidence appended | 52 | 0.529 → 0.515 | 18 / 33 | 0.03 | 0.127 (8 of 52) |
| Control: same evidence, second run | 20 | 0.500 → 0.487 | — | 0.025 | 0.103 (2 of 20) |
| Arabic slice, all 105 | | 0.511 → 0.506 | | | |

The appended Arabic sections are short themselves (median 533 characters against the English 714), and the change they produce is inside the extractor's own run-to-run noise: confidence moves 0.02 per title and values 0.025 whether the evidence changed or not. So the Arabic slice's confidence gap is not closed by a second short plot; it needs longer evidence (the Arabic articles themselves are thin for these films — an upstream fact, like the missing settings in §7.4). The re-extraction stays published as the current version (equal evidence or better, same model, provenance intact, 674 earlier rows superseded rather than overwritten — the first real supersession in `content_features`), and the runner keeps the rule for any title whose Arabic article grows.

The finding that matters is `linearity`: it moves 0.10 per re-run under identical evidence and flips outright for a tenth of the titles (0.85 → 0.15 for The Blue Caftan, My Wife the Director General, The Perfect Candidate, The Nightingale's Prayer), while every other dimension moves 0.01–0.035. The scale's wording is ambiguous to the model — "linear" reads as chronological order to one run and as single-thread simplicity to another — which is exactly what §6's stability gate exists to catch. Until the scale is rewritten and re-extracted, `linearity` should not be cited as a displayed reason; this is the first data point for C-4 (drift between extractor runs). Call accounting for the run: 52 calls, 172,793 input and 19,556 output tokens, 3,323 / 376 per title, 4.7 s mean latency (report table, G7).

### 7.6 `linearity` drift diagnosed and fixed — the stability gate now passes (board C-10)

Cause: `linearity`'s prompt description read "0-1 (linear to fragmented)" — 0 = linear, 1 = fragmented, the documented convention (§3, §6.1) — but the field is *named* `linearity`, whose plain reading implies the opposite (a high score = very linear). Every other directional field's name matches its own high end (`darkness` high = dark, `warmth` high = warm, `ambiguity` high = ambiguous); `linearity` was the one exception, and a model reading it fast enough sometimes followed the name instead of the parenthetical — producing the outright flips §7.5's control caught (0.85 → 0.15, 0.80 → 0.20 on several titles).

Fix: the field name and its convention are unchanged (0 = linear, 1 = fragmented; no re-labelling, no value convention flip, so every already-extracted title stays comparable) — only the description text in `enrichment.py` (both schema classes) is rewritten to state both ends explicitly and warn against the name's own trap: *"0 = told in strict chronological order, 1 = fragmented / non-chronological… a HIGH score means LESS linear and MORE fragmented — never read a high score as 'very linear'."* `EXTRACTOR_VERSION` bumped to `enrichment-worker-v2-linearity-fix` (a prompt-wording change is a version change, FINGERPRINT_SCHEMA.md §5).

Re-verified the same way §7.5 found the problem: the 52-title batch extracted twice under the fixed prompt.

| | mean \|Δ\| | max \|Δ\| | flips (\|Δ\|≥0.4) |
|---|---|---|---|
| `linearity`, before the fix (§7.5) | 0.109 | 0.700 | 5 |
| `linearity`, after the fix | **0.015** | 0.100 | **0** |

`linearity` now sits at the stable end of the 13 dimensions (0.012–0.030 range), and the **stability gate passes outright** (`enrichment_acceptance.py drift`, no dimension over the 0.08 bound). Spot check: Cairo Station (a straightforward chronological drama) scores 0.15 in both runs — the convention itself is unchanged, only its reliability.

Not done here, and flagged rather than assumed: the catalog's 300 titles still carry V1 fingerprints extracted under the old (ambiguous) wording — `needs_extraction()` now correctly marks all of them as due for re-extraction under the new `EXTRACTOR_VERSION`, but re-running the full catalog is a real API cost (≈300 calls) and a separate decision from fixing the prompt itself.

### 7.7 Full catalog re-extraction under the corrected prompt (board C-14, owner approval O-6)

§7.6 fixed the `linearity` wording; this closes the loop the owner asked for — re-extract all 300 titles' V1 fingerprint under the corrected prompt, publish, retrain, re-evaluate, and record the real cost.

**Cost** (G7 call accounting, run `enrich-anthropic-20260904T013835Z`): 300 calls, `claude-sonnet-5`, 0 failures, **1,022,988 input + 113,903 output tokens** (3,410 / 380 per title), mean latency 4.7 s. No dollar figure is computed: `LLM_PRICES_JSON` is deliberately unset (pricing is a profitability-study input the owner has not decided, DATA_LICENSING §0) — these token counts are the actual cost data, ready for that study to price whenever it runs.

**Effect**, measured against the pre-run snapshot: `linearity` moved by mean |Δ| 0.37 (median 0.40, max 0.85) across all 300 titles, 149 of them by ≥0.4 — a systematic correction, not noise. Every other of the 13 V1 dimensions moved only 0.015–0.033 on the same evidence and model, confirming the fix touched only what it targeted. The largest moves are exactly the films the old wording read backwards — textbook linear narratives the ambiguous prompt scored as "very fragmented": *12 Angry Men* and *Boyhood* 0.90 → 0.05, *Tokyo Story* / *E.T.* / *Call Me by Your Name* 0.90 → 0.10. The model's own reported confidence in `linearity` barely moved (0.702 → 0.705): it was never unsure, only consistently backwards.

**Published** to `movie-postgres` (announced before/after; only `titles.fingerprint` and `content_features` touched, no account or other table): 3,890 older V1 rows superseded, never deleted; `content_features` 13,796 → 17,686 total (13,122 current); `source_records` (3,304), `public_quality_sources` (298) and `users` (16) unchanged.

**Retrained and re-measured**: the four demo personas still meet the WS4 bar (`slow-burn` recovery 0.83, held-out accuracy 0.92). `claude@judge.local` from the tree, before → after this fix:

| | NLL | accuracy | Spearman (API ranking vs Claude's order) | penalty chosen |
|---|---|---|---|---|
| Before (§7.3, C10 re-measurement) | 0.823 | 85.7 % | 0.896 | 0.03 |
| After (this run) | 0.981 | 83 % | 0.893 (API) / 0.90 (offline) | 0.1 |

A small, expected fluctuation from a real data correction — NLL and accuracy move within the noise a 14-round held-out set carries, Spearman is unchanged in practice. The judge's own ranking was never confused by `linearity`; only the catalog's feature values were, so no material change here was expected and none appeared.

### 7.8 Retiring the 15 `FILM*` placeholders from `movie-postgres` (board C-15)

The owner's standing rule (2026-09-03): never plan around the 15 hand-entered `FILM*` titles in `apps/backend/src/scripts/seed.ts` — 200 is the floor, 300–500 the target. They had stayed in `movie-postgres` since before the 300-title catalog existed. Investigated before touching anything: 64 accounts' triads (395) or watch-states (107) referenced them — `triads.titleIds` is a plain array with no FK, so the titles couldn't simply be deleted without leaving dangling references. Every one of the 64 was a disposable QA/load-test account (`load-*@example.com`, `rank-ui-*`, `verify-20260903`, `triad-test-*`, `browser.test.20260902`) — none `@demo.local`, none `claude@judge.local`. Deleted (cascade: profiles, triads, watch-states, replacements, refresh tokens; `consents.userId` set NULL by design) then the 15 titles. Verified after: 0 `FILM*` titles, 0 dangling triad references, all 5 real accounts intact, 300 catalog titles untouched.

`seed.ts` itself is unchanged and still runs against `postgres-test` for its own isolated fixture use; only the default setup flow (README.md, QUICKSTART.md §4) no longer points a fresh clone at it — `npm run db:seed:demo` (the 300-title catalog) is the documented step now.

---

## 8. Provider decision — LLM enrichment through the Anthropic Messages API

Owner's decision, 2026-09-03, in answer to "what is the alternative to an OpenAI key". Written here in ADR form because [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) was being edited by a concurrent session at the time; **it must be appended there under the next free number**, with a row in the summary table and a "superseded in part by" line under ADR-6, ADR-23 and ADR-36. Until then this section is the record.

**Context.** `BP §15.3` is conditional ("عند اختيار OpenAI") and its controls — background-only use, structured outputs against a versioned schema, model id from configuration, source ids, retry and review policy, a data-controls and retention review — bind any provider. ADR-6 had already made the model id configuration and named vendor risk as its revisit trigger. The worker had never run against a real catalog; the demo catalog (WS1, 300 titles) needed fingerprints, and the owner chose the provider.

**Decision.** `services/workers/src/enrichment.py` runs on the official `anthropic` SDK: `messages.parse` with the unchanged `FilmFingerprintV1` Pydantic schema for fingerprints, `messages.create` for the evidence-only explanation text; model ids from `ANTHROPIC_FINGERPRINT_MODEL` / `ANTHROPIC_EXPLANATION_MODEL`, never hard-coded; the client is built lazily (ADR-36 preserved) and resolves its credential itself (`ANTHROPIC_API_KEY`, or an `ant auth login` profile); `EXTRACTOR_VERSION` is `enrichment-worker-v2`; every fingerprint records the model id the API actually served as `modelVersion`. A refusal, a token-ceiling stop and an API failure are three distinct errors; the batch runner records each as a human-review item and leaves the title without a fingerprint. No server-side refusal fallback to another model is configured: one catalog run must carry one `modelVersion`, and a refused film is a review item (`§15.4`), not something to rescue silently. Thinking and effort stay at the model's defaults; output ceilings are 8192 / 2048 tokens because reasoning tokens count toward them. The `openai` dependency is removed from `pyproject.toml`.

**Rationale.** Same controls, same schema, one provider adapter; refusal handling that keeps provenance uniform; retention is an organization-level setting on this provider (there is no per-request store flag), which [PRIVACY.md](PRIVACY.md) §6.1 now states instead of the old `store=false` line.

**Consequences.** `.env.example`, [QUICKSTART.md](QUICKSTART.md) §2, [PRIVACY.md](PRIVACY.md) §6.1, [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md) §5, [SPECIFICATION.md](SPECIFICATION.md) §8, [DATA_LICENSING.md](DATA_LICENSING.md) §3.6, [ARCHITECTURE.md](ARCHITECTURE.md) §2 diagram and the root README updated in the same change. Still pending in files locked by a concurrent session: the ADR itself and its table row, the "superseded in part" notes under ADR-6/23/36, the enrichment row in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) (it still says "never run against the actual catalog"), and the `OPENAI_FINGERPRINT_MODEL` housekeeping line in [README.md](README.md). The blueprint's `§15.3` needs no change to stay true; its App. D could gain the provider's data-controls page next to [م23]. Every existing `enrichment-worker-v1` fingerprint (the 15 `FILM` seeds) is by definition stale and re-extractable, though those seeds are hand-entered and were never extracted at all.

**Revisit when.** ADR-6's trigger (cost or vendor risk justifies a distilled local extractor), or when the required retention posture cannot be met on the chosen model tier.

## Changelog

| Date | Change |
|---|---|
| 2026-09-03 | first version, from the measured state of the dev database and a read of the screens, services, trainer and enrichment worker |
| 2026-09-03 | owner's correction: nothing is built or judged against the 15-title fixture; the catalog (WS1) is the first step, and 200 titles is the floor with the scripts sized for the 300–500 Phase 0 target |
| 2026-09-03 | WS1 delivered at 300 titles: curated list, `fetch-catalog.ts`, `catalog.demo.json`, build report, `catalog:fetch` scripts; WS2/WS3 inputs updated to the fixture's real fields (`descriptionSource`, `descriptionAr`, `evidence`) |
| 2026-09-03 | D1 decided (Anthropic) and recorded as §8 in ADR form; WS2 code delivered: worker ported, batch runner `enrich_catalog.py`, 31 tests, `make catalog-enrich`; the extraction run itself waits for the owner's key |
| 2026-09-03 | WS2 run completed: 300/300 fingerprints on Sonnet 5 (Opus 5 structured outputs were returning 529 at the time), 0 failures; fixture and enrichment report committed; §8's ADR text was verified and written by session A as ADR-63 |
| 2026-09-03 | WS3 and WS4 code delivered: `seed-demo.ts` + pure library + `personas.demo.json`, 17 unit tests and a double-run e2e on `postgres-test`; `train_demo.py` + 4 tests; `db:seed:demo` scripts and `make demo`. The load into the dev database is announced on the session board before it runs |
| 2026-09-03 | Dev database loaded and the four personas trained; noise temperature calibrated 0.5 → 0.2 against the real fingerprints; WS4 acceptance met (`slow-burn` recovery 0.83, held-out accuracy 0.75). WS5 (browser judgment pass) is next |
| 2026-09-03 | WS5 done on an isolated HEAD stack (3110/3111): every persona in its expected band, rankings and recommendations match the designed tastes, the partial-title demotion is visible; two frontend copy/select findings recorded for session B. QUICKSTART §6.1 documents `make demo` and the persona logins. Remaining: WS6's status row (session A's file) and the owner's real-account judgment (§7) |
| 2026-09-03 | §7.1 added: the first non-synthetic ranker (Claude, 61 watched, 25 rounds by its own order): Spearman 0.72 with the model's ranking, held-out accuracy 0.67 yet band `strong`; the misses map onto the missing V2 fingerprint families; band calibration flagged to session A (C8) |
| 2026-09-04 | §7.2 added: V2 families specified, extracted for all 300 titles and published inside `fingerprint.v2`; offline evaluation at 25 and 50 rounds — V1+V2 best on every measure at 50 (held-out NLL 0.82 vs 0.91, Spearman 0.83 vs 0.79), the six misses move to the right half; wiring with shrinkage proposed to the model-service owner (C9) |
| 2026-09-04 | `content_features` provenance rows written by the seed for every V1 and V2 feature of the demo catalog (8,390 rows, supersession verified); C9 requested from session A directly |
| 2026-09-04 | Re-measurement after ADR-69 wired the 28 keys: served judge model NLL 0.824 / acc 85 % / API Spearman 0.825 (from 0.72); personas re-run under 28 keys, `slow-burn` held-out bar not met (0.67) with V1 recovery intact (0.85) — fixture narrower than the model, regeneration on 28 keys proposed; `train_demo` reports V1 recovery, V2 share and chosen penalty; `fingerprint_v2_eval` on the renamed constants |
| 2026-09-04 | Personas regenerated on 28 keys (V2 half of θ per persona, τ 0.2 → 0.4 by re-calibration, generator reads `MODEL_DIMENSIONS`); WS4 bar met on the served model: `slow-burn` recovery 0.87, held-out accuracy 0.83 |
| 2026-09-04 | §7.3: third block (form families, 12 keys) specified in FINGERPRINT_SCHEMA §3.3, extracted for all 300 titles (0 failures), published to the dev database with provenance rows, evaluated offline against Claude's order; wiring requested as C10 |
| 2026-09-04 | §7.4: cultural-context block from Wikidata (languages, countries, setting places and eras, CC0) on all 300 titles, stored as categorical provenance rows; coverage report per language / country / slice / tier is the first `BP §11.3` measurement |
| 2026-09-04 | §7.3 re-measured after C10 (`6abf34d`, 40 keys served): judge NLL 0.823 / acc 85.7 %, API Spearman 0.896 (from 0.846); two observations passed to the model-service owner |
| 2026-09-04 | Board C-8: personas regenerated on the full 40-key model (V3 half of θ added, τ 0.5); WS4 bar met on the served trainer: slow-burn recovery 0.83, held-out accuracy 0.92 |
| 2026-09-04 | Board C-4 (ALPHA_PLAN 5.5, BP §15.4): enrichment acceptance tests. Stability gate (`services/workers/src/enrichment_acceptance.py`) run on the real Arabic-evidence batch (52 titles) correctly failed on `linearity` (mean |Δ| 0.109, bound 0.08) and passed every other V1 dimension (0.02-0.04); human-review agreement gate (`apps/backend/src/scripts/measure-review-agreement.ts`) run against movie-postgres: 0 reviewed rows yet, reported honestly rather than a fabricated rate |
| 2026-09-04 | §7.5: Arabic Wikipedia plot as second evidence for short English plots; V1 re-extracted under `+ar-evidence`, confidence measured before/after per slice, rows superseded |
| 2026-09-04 | §7.6 (C-10): `linearity`'s name-vs-description ambiguity diagnosed and fixed (wording only, same 0/1 convention); stability gate now passes, drift 0.109→0.015 on a real re-verification |
| 2026-09-04 | §7.7 (C-14, owner approval O-6): full 300-title V1 re-extraction under the fixed prompt published to movie-postgres (3,890 rows superseded); cost 1.02M in / 114K out tokens, no dollar figure by design; personas and judge model retrained, WS4 bar still met |
| 2026-09-04 | §7.8 (C-15): the 15 `FILM*` placeholders and the 64 test/load-test accounts referencing them retired from `movie-postgres`; README/QUICKSTART point at `db:seed:demo`, not `db:seed`, by default |
