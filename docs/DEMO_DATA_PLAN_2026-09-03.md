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

### WS3 — Personas and activity (`db:seed:demo`, 4–6 h incl. tests)

**Deliverable**: `apps/backend/src/scripts/seed-demo.ts`, `npm run db:seed:demo` at the root (and `make demo`), unit-tested pure generators.

Four personas with a hidden taste vector θ over the 13 dimensions in `FINGERPRINT_DIMENSIONS` order (pacing, rhythmVariance, ambiguity, psychologicalDepth, warmth, darkness, linearity, dialogueDensity, actionIntensity, plotComplexity, visualComplexity, soundscapeComplexity, colorSaturation):

| Slug | Taste | θ | Watched | Triads | Expected band |
|---|---|---|---|---|---|
| `slow-burn` | slow, ambiguous, dark, dialogue-led, contemplative | `[-1.0, 0.2, 1.0, 1.0, -0.3, 0.8, 0.5, 0.3, -1.0, 0.6, 0.4, 0.2, -0.6]` | 60 | 25 | strong |
| `spectacle` | fast, clear, action-heavy, elaborate visuals and sound | `[1.0, 0.5, -0.8, -0.4, 0.3, -0.2, -0.6, -0.5, 1.0, 0.0, 0.8, 0.9, 0.7]` | 40 | 12 | likely |
| `warm-talky` | warm, light, linear, dense dialogue, saturated | `[-0.3, -0.2, -0.4, 0.5, 1.0, -1.0, -0.7, 1.0, -0.8, -0.5, -0.2, -0.3, 0.5]` | 30 | 6 | initial |
| `newcomer` | undefined (θ = 0) | zeros | 12 | 2 | inconclusive |

Per persona the script writes:

- `users` + one `profiles` row (`preferredLanguage: 'ar'`; `market: 'SA'` and 2–3 `platforms` **if** the onboarding columns exist in the entity at run time — coordinate with the concurrent onboarding work; the seed must compile either way).
- `user_title_state`: the watched set sampled to favour, not exclusively contain, films the persona would like (mix ratio 70/30 so the ranking has something to order); `watchedAt` spread over the previous 18 months; `watchlist` 8/6/5/3 items; `not_watched` 10/5/5/2 marks (stay recommendation candidates, `§2.4 #3`); `notes` on ~5 titles; `importedRating` + `ratingSource: 'import'` on 3 titles of `slow-burn` only; `triadEligible: false` on 2 titles of `slow-burn` (paired with `not_remembered` replacement rows below).
- `triads`: for each triad draw 3 titles from the eligible watched set, never repeating the immediately previous triad's titles (ADR-34); utility `u = θ·x / τ + Gumbel` with τ = 0.5 (exact Plackett–Luce sampling, so the model's assumption holds and accuracy lands around 0.8–0.9, not 1.0); `ranking` = the three **title ids** best-first (ADR-15); `displayOrder` an independent shuffle; `shownAt`/`answeredAt` 40–90 s apart, grouped in sessions of 5 on different days; `status: 'completed'`; `policyVersion: 'demo-synthetic-v1'`; `selectionPropensity = 1 / C(pool, 3)`; `modelVersion: null`; `idempotencyKey: null`; `sessionId: 'demo-s<n>'`. One extra **active** triad for `spectacle` so the Rank screen opens mid-round.
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

### WS4 — Training runner (1 h)

**Deliverable**: `services/workers/src/train_demo.py` (`python -m src.train_demo`): lists profiles whose user email ends in `@demo.local`, runs the existing `train_profile()` for each, prints one row per persona with `trainingTriadCount`, the band it will produce, `heldOutPairwiseAccuracy`, and the **recovery score** = cosine similarity between the learned `weights` and the persona's hidden θ (θ is read from the persona table, exported by WS3 to `apps/backend/src/scripts/fixtures/personas.demo.json`).

Acceptance: 4 snapshots; `slow-burn` recovery ≥ 0.8 and held-out pairwise accuracy ≥ 0.75; `newcomer` recovery is *not* asserted (θ = 0 is unrecoverable by design). If `slow-burn` fails the bar, the pipeline — not the persona — is wrong; the triads were sampled from the model's own likelihood. Triads containing the 5 partial titles are dropped by the trainer, so counts in the snapshot may be slightly below the seed's; the runner prints both.

`make demo` = `npm run db:seed:demo && cd services/workers && poetry run python -m src.train_demo`.

### WS5 — Browser judgment pass (1–2 h, mobile 375×812 with touch, Arabic then English)

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
| WS3 | 4–6 h | WS1/WS2 | `postgres-test` for the double-run check |
| WS4 | 1 h | — | WS3 output |
| WS5 | 1–2 h | — | a fresh backend build on a side port (do not restart a concurrent session's server) |
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
