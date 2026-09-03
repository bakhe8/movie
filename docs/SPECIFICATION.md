# Engineering Specification

**Status**: Derived document — every requirement here traces to a numbered section of the normative product blueprint, [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) (cited as `BP §x.y`). Where this document and the blueprint disagree, the blueprint wins and this document has a bug.
**Audience**: engineers building the Phase 0 → Alpha scope in English.
**Version**: 2.0 — 2026-09-03 (full rewrite; supersedes the 2025-dated "Full Specification").

This document says *what* must be built and the contracts between parts. *Why* is in [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md); *what exists today* is in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); the exact HTTP and SQL contracts are in [API.md](API.md) and [SCHEMA.md](SCHEMA.md).

---

## 1. Product in one paragraph

A personal film-taste assistant. The only explicit preference question it ever asks is "rank these three films you have watched, by your personal liking, most to least" (`BP §2.4 #2`, `§4.3`). From those listwise rankings it learns an interpretable taste model per profile, keeps Personal Fit, Public Quality, Watchability and Confidence as four separate values (`BP §2.4 #7`, `§4.4`), returns a short, explained watch decision in three tracks (safe / discovery / outside-usual), and closes the loop by feeding watched recommendations back into later triads (`BP §4.5`). Arabic-first RTL PWA for feature films, Saudi/Gulf launch market, English supported from the infrastructure up (`BP §2`, `§3`, `§5.1`).

**Working names.** UI brand: **Reel**. Repository/package name: `movie`. Formal Arabic title: منصة بصمة الذوق السينمائي. See ADR-14.

## 2. Non-negotiable principles (engineering reading)

These are `BP §2.4` restated as testable engineering constraints. Each one has at least one automated or review check named in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

| # | Principle (`BP §2.4`) | Engineering constraint |
|---|---|---|
| 1 | User choices are the truth about taste; public data is a prior. | Public ratings never enter the fingerprint vector; they live in a separate `public_quality` layer with their own uncertainty (`BP §6`, `§10.3`). |
| 2 | The only explicit preference question is the triad ranking. | No endpoint, DTO, or UI accepts a star/1–10 rating, thumbs, or like/dislike. Imported ratings are stored as `importedRating` + `ratingSource='import'` only, never solicited (`BP §4.2`, `§4.5`). |
| 3 | Unwatched = unknown exposure, never a negative signal. | `not_watched` and `not_remembered` never enter the training loss; `not_watched` titles remain recommendation candidates (`BP §4.3`, `§18.1`). |
| 4 | Ranking means stable personal liking, not artistic quality or tonight's mood. | Triad instruction copy is fixed: «رتّب هذه الأفلام حسب إعجابك الشخصي، من الأكثر إلى الأقل» / "Rank these films by how much you personally liked them, most to least." No "right now" framing (`BP §4.3`, `§7.3`). |
| 5 | Genre, language, country, public rating are coordinates, not conclusions. | UI language and region are never features of the taste model; original language and production country start at zero weight with shrinkage (`BP §4.1`, `§6.2`, `§10.2`). |
| 6 | Every inference needs repetition, diversity, and a confidence level. | A displayed "you tend to…" claim requires the `BP §9.2` criteria; confidence is shown as a verbal band, never an uncalibrated percentage (`BP §7.2`, `§9.3`). |
| 7 | Public quality, personal fit, watchability, confidence stay separate. | The API returns four separate fields; no client merges them into one displayed number (`BP §4.4`). Internal candidate ranking may blend them (`BP §10.3`), the display may not. |
| 8 | An exceptional film keeps its place but does not reshape the profile. | Per-(profile, film) residual δ is heavily shrunk; optional "special personal favorite" tag (`BP §7.4`). |
| 9 | Private by default; export, delete, reset. | Consent records, export and delete endpoints, no public profile in MVP (`BP §13.1`, `§14`, `§21.1`). |
| 10 | One person = one independent profile. | Model/event tables key on `profileId` (pseudonymous taste id), never on account identity (`BP §13.1`, `§21.1`). |
| 11 | The LLM enriches and explains; the measurable statistical model ranks. | No LLM call on the recommendation or triad-selection path; fingerprints and explanations are precomputed and versioned (`BP §12.2`, `§15.2`). |
| 12 | Every phase transition is a result gate, not a date. | Gates in §9 below; a model ships only if it passes `BP §16.5`. |

## 3. Scope

### 3.1 In scope for Phase 0 + Alpha (`BP §5.1`, `§17.1`–`§17.2`)

- Feature films only; adult accounts only; Arabic RTL UI with English as a first-class second locale.
- Onboarding: account → UI language → market (country) → platforms the user has → import or pick watched titles → 3–5 easy triads → first profile, library ranking and recommendations (`BP §4.1`).
- Watched-history entry: search (including alternate/localized titles) + "watched" marking; CSV import of a user-owned list (`BP §4.2`, `§5.1`, `§14 POST /library/imports`).
- One triad screen with neutral replacement for "haven't watched" and "don't remember" (`BP §4.3`).
- Personal library ranking; initial fingerprint-with-confidence taste profile (`BP §5.1`).
- Recommendations in three tracks, each item with Personal Fit, Public Quality, Watchability and a confidence band, a no-spoiler reason with `evidenceSource` (`BP §4.4`, `§9.4`, `§14`).
- Watchlist, timeline (watch history), post-watch loop (watched recommendation returns to later triads; no rating prompt) (`BP §4.5`, `§5.1`).
- Internal admin board: content review, fingerprint provenance, model versions (`BP §5.1`, `§17.2`).
- Export, delete, reset; sharing off by default (`BP §5.1`, `§14`).
- Research catalog of 300–500 films, balanced across Arabic/international and popularity tiers, with a per-field rights registry (`BP §11.1`, `§17.1`).
- Offline evaluation protocol and baselines (`BP §16`).

### 3.2 Deliberately deferred (`BP §5.2`, `§17.6`)

TV series; short video; native iOS/Android apps (only if the PWA proves a performance or push need); social feed and public comments; a persistent mood layer (later as a separate Session Fit); comprehensive availability integration without a licensed provider contract; subscriptions/B2B before retention and payment are proven; the disclosed "balance/enrichment" explanation phases of `BP §7.6` (silent computation is allowed from day one; disclosure is post-MVP and gated by `BP §17.3`).

## 4. Glossary (canonical terms)

Use these exact identifiers in code, API, schema and UI copy keys. Arabic UI copy for each is in the blueprint section cited.

| Term | Identifier | Definition | Source |
|---|---|---|---|
| Profile / taste id | `profileId` | Pseudonymous id of one person's taste; all events and models key on it. | `BP §13.1`, `§21.1` |
| Account | `userId` | Login identity; never joined into model training or exports of taste data. | `BP §13.1` |
| Triad | `triad` | One shown set of three watched titles + one listwise ranking event. | `BP §4.3`, `§13.2` |
| Replacement | `triadReplacement` | Swap of one triad item with reason `not_watched` or `not_remembered`; never a preference signal. | `BP §4.3`, `§13.1` |
| Exposure | `exposure` | Whether the user has seen a title: `watched`, `not_watched` (unknown), `not_remembered` (seen, cannot compare). | `BP App. A` |
| Personal Fit | `personalFit` | Ordinal estimate that this profile would rank the title high if watched. Never equals quality. | `BP App. A` |
| Public Quality | `publicQuality` | Reception from separate licensed sources, with vote count and uncertainty; never merged into Personal Fit. | `BP §10.3`, `App. A` |
| Watchability | `watchability` | Can it be watched now: market, platform, runtime, audio, subtitles. A filter/ranking context, never a taste feature. | `BP §6.2`, `App. A` |
| Confidence band | `confidenceBand` | `initial` / `likely` / `strong` / `inconclusive` — verbal, never a raw %. | `BP §9.3` |
| Track | `track` | `safe` / `discovery` / `outside_usual`. | `BP §4.4` |
| Evidence source | `evidenceSource` | `individual` or `population_enriched` on every displayed reason. | `BP §7.6`, `§12.2`, `§14` |
| Fingerprint | `fingerprint` | Versioned vector of extracted content features with provenance and confidence per feature. | `BP §6`, `§13.3` |
| Population prior | `b(m)` | Weak, heavily shrunk general-acceptance prior per title. | `BP §7.1` |
| Shared latent space | `sharedLatentSpace` | Population-level factor model (~15–30 factors) users are calibrated onto. | `BP §7.5` |
| Attribution gate | `attributionGate` | Component that decides `evidenceSource` for each displayed reason. | `BP §7.6`, `§12.2` |
| Selection propensity | `selectionPropensity` | P(policy chose this triad/candidate); logged for off-policy evaluation. | `BP §8.2`, `§14.1` |
| Confirmed recommendation | — | Recommended → watched → ranked high in a later triad. The north-star unit. | `BP §3.3`, `App. A` |

Naming rule: TypeScript/JSON use `camelCase`; SQL tables are `snake_case`, SQL columns are the TypeORM default (`camelCase`, quoted) — see ADR-16 and [SCHEMA.md](SCHEMA.md).

## 5. User experience contract

### 5.1 Onboarding (`BP §4.1`)

1. Register (email + password) and accept Terms/Privacy; record a `consents` row per purpose (`BP §13.1`; consent purposes in [PRIVACY.md](PRIVACY.md)).
2. Choose UI language (`ar`/`en`), market (ISO country), and platforms available (multi-select). These affect display and Watchability only.
3. Build the watched set: search with alternate titles, mark watched; or upload a CSV. Target ≥ 3 watched titles to unlock triads; suggest a diverse starter list to speed this up (`BP §4.2`).
4. 3–5 seed triads (exact count is an open experiment, `BP App. C`).
5. First result: an "initial" band profile, personal library ranking, first recommendations, with explicit "still learning" copy (`BP §9.3`).

### 5.2 Triad screen (`BP §4.3`)

- Instruction copy fixed (principle 4). Cards show licensed poster, title, year — no public scores.
- Interaction: vertical drag or sequential tap, plus a keyboard alternative (↑/↓ buttons); RTL-safe.
- Display order is randomized and logged separately from item order.
- Two separate neutral controls per card: "Haven't watched — replace" and "Don't remember — replace". Each calls the replace endpoint, logs the reason, and swaps only that item.
- After submit: next triad loads. A visible "your model updated" result is periodic, not necessarily per triad (open experiment, `BP App. C`).
- Ties / partial ranking: not offered until the `BP App. C` experiment decides between partial order and neutral replacement.

### 5.3 Recommendations (`BP §4.4`, `§9.4`)

- Three tracks, each short (3–5 items on the home screen, `BP §5.3`).
- Each item: title, Personal Fit, Public Quality, Watchability (with market/platform), confidence band, one no-spoiler reason with `evidenceSource`, and actions: add to watchlist, "not relevant" (logged as an outcome only), where to watch.
- Reason text must be generated only from features that actually drove the score, must not spoil, must not attribute sensitive traits, and must describe the limit of confidence when confidence is weak (`BP §9.4`).
- In MVP every displayed reason is `evidenceSource: individual` (phase 1 of `BP §7.6`); `population_enriched` reasons are disabled behind the `BP §17.3` cohort gate.

### 5.4 Library and post-watch loop (`BP §4.5`, `§5.1`)

- Watched list, personal ranking of the library, watchlist, timeline.
- Marking a recommended title as watched records a `watch_events` row (source, edition/audio/subtitles/provider when known) and an `outcomes` row against the recommendation; the title becomes eligible for later triads. No rating prompt.

### 5.5 Admin board (`BP §5.1`, `§17.2`)

Internal, role-gated: titles missing fingerprints or rights status, fingerprint provenance and review sampling, model versions and per-cohort metrics, latest triads, test scoring for a profile.

### 5.6 Privacy surfaces (`BP §14`, `§21.1`)

Export (async, with status), delete (announced safety period, then purge including derivatives and a backup policy), reset taste (delete events and models, keep account), consent management.

## 6. Data model contract

Authoritative table list and DDL: [SCHEMA.md](SCHEMA.md). Requirements the schema must satisfy:

- Events are append-only; a correction creates a new event linked to the old one (`BP §13.2`).
- A triad is stored and split as one unit: `titleIds[3]`, `displayOrder[3]`, `ranking[3]`, `shownAt`, `answeredAt`, `policyVersion`, `modelVersion`, `selectionPropensity`, `experimentId`, replacements (`BP §13.2`).
- Every extracted feature carries `sourceIds`, `confidence`/`uncertainty`, `extractorVersion`, `licenseStatus`, `reviewStatus`, `validFrom`; missing = `NULL`, never `0`/`false` (`BP §11.3`, `§13.3`).
- Every field, image and availability record has a rights registry entry (`BP §11.1`).
- Recommendations are persisted with separate scores, reason, policy, experiment, propensity and `requestId`; outcomes are logged per event type (`BP §13.1`, `§14.1`).
- Model versions and experiments are first-class rows so any result can be reproduced from the event log (`BP §13.1`, `§18.1`).
- Consents and privacy requests are rows with purpose, version and timestamps (`BP §13.1`).

## 7. Model contract

Authoritative detail: [RANKING_ALGORITHM.md](RANKING_ALGORITHM.md). Summary of what the model service must provide:

- Utility `s(u,m) = b(m) + θᵤᵀφₘ + pᵤᵀqₘ + δᵤₘ` (`BP §7.1`). Phase 0/Alpha implements `b`, `θᵀφ`, `δ`; internal collaborative `pᵀq` enters only with enough internal data (`BP §7.1`); the externally-seeded shared latent space (`BP §7.5`) is used silently from Alpha if and only if its data source is licensed ([DATA_LICENSING.md](DATA_LICENSING.md)), otherwise seeded from Alpha-cohort data.
- Listwise Plackett–Luce likelihood per triad; never three independent pairwise rows (`BP §7.2`).
- Per-profile fit is a calibration onto the shared space once it exists; before that, regularized per-profile MLE with the population prior (`BP §7.5`).
- Training data excludes a temporally held-out slice per profile; the whole triad stays on one side (`BP §16.1`).
- Triad selection policy per `BP §8`: six triad functions, the `Score(T)` objective with fatigue and reliability terms, probabilistic choice from top candidates, logged `selectionPropensity`, safety constraints of `BP §8.3` (no director/language loops, declared exploration share, position randomization, hold-out reservation, session limits).
- Confidence band computed from the `BP §9.2` criteria (posterior stability, effective evidence count, diversity, held-out prediction success, fingerprint quality). Until calibrated, the band is the only confidence shown.
- Attribution gate returns `(reasonText, evidenceSource)`; phase gates per `BP §7.6`.
- Acceptance gate for any model version: `BP §16.5` — better NLL, learning per minute, calibration and post-watch outcomes than the best simpler baseline, no fatigue increase, no language/country coverage regression.

## 8. Integration contracts

- **Frontend ↔ backend**: REST/JSON under `/api/v1` (`BP §12.1`, ADR-15); every response carries `modelVersion`, `experimentId`, `requestId` where applicable (`BP §14`). Full contract: [API.md](API.md).
- **Backend ↔ model service**: HTTP (FastAPI) for `train`, `select-triad`, `score`, `taste-profile`; training runs asynchronously and writes a `model_snapshot`; a queue (Redis/BullMQ) is introduced only when `BP §12.3` triggers fire. ADR-25.
- **Enrichment**: OpenAI Responses API with Structured Outputs against the versioned fingerprint JSON schema, `store=false`, model id from configuration only, retry + validation + human-review escalation, immutable versioned publish (`BP §15.3`). Contract: [FINGERPRINT_SCHEMA.md](FINGERPRINT_SCHEMA.md).
- **Catalog sources**: adapter per provider; every value lands in the rights registry with source/license/confidence/version (`BP §11.2`, `§11.3`). Rules: [DATA_LICENSING.md](DATA_LICENSING.md).

## 9. Phases and gates (`BP §17`, `§18`)

Phase names below are the blueprint's. Do not use "Phase 1/2/3" anywhere (ADR-18).

| Phase | Window (planning only) | Must exist | Gate (result, not date) |
|---|---|---|---|
| Phase 0 — hypothesis check | weeks 1–4 | product contract; 300–500-film research catalog with rights registry; clickable triad prototype; triad-vs-pair-vs-single timed experiment; simple baselines; data schema | Most of 15–20 testers understand the task and replacement; value after 3–5 triads; data can be collected legally and technically (`BP §17.1`) |
| Alpha (engine) | months 2–3 | account, watched history, triads, replacement, personal ranking, initial fingerprint and recommendations, full event trail, first PL model, content review board, temporal hold-out, first adaptive experiment; shared-space seeding only with license | Reliable win over the best baseline; value users can see; acceptable onboarding completion; triad time without fatigue; thresholds fixed before the test with confidence intervals (`BP §17.2`) |
| Closed Beta | months 4–6 | adaptive selection, deeper fingerprints, watchlist + diary, explanations with confidence, post-watch loop, permitted imports, catalog in the thousands, calibration/coverage dashboards | Interpretable early retention; recommendations converting to watches and later positive rankings; no large unexplained Arabic/non-English gap; cohort-level disclosure gate for `BP §7.6` phases 2–3 (`BP §17.3`) |
| Public Arabic Beta | months 7–9 | stable signup, optional taste card, referrals, complete export/delete/reset, display-rights agreements, load/restore/security tests, cost monitoring | organic growth before paid spend (`BP §17.4`) |
| Economics test | months 10–12 | small Pro offers, real payment, disclosed licensed referral commission with no effect on organic ranking | real payment and unit economics (`BP §17.5`) |

Alpha Definition of Done (`BP §18.1`): a new user reaches a first result unaided; "haven't watched" never enters the taste loss; every result reproducible from event log + model version; automated tests for triad, replacement, delete and export; documented backup restore drill; no content or image shown without a known license status; metrics board separates click, watch and later ranking; model rollback and feature flags exist.

## 10. Non-functional requirements

| Area | Requirement | Source |
|---|---|---|
| Latency | Recommendation and triad endpoints serve from precomputed model state; no LLM on the hot path. | `BP §12.2`, `§15.2` |
| Reproducibility | Any recommendation or triad can be regenerated from event log + `modelVersion` + `policyVersion`. | `BP §13.1`, `§18.1` |
| Security | Object-level authorization on every profile-scoped route (proven by the IDOR e2e suite); rate limits; least privilege; audit logs for staff access. | `BP §21.3` |
| Privacy | PDPL-aligned; pseudonymous taste id; encryption in transit and at rest; export/delete/reset; no sensitive-trait inference. | `BP §21.1`, [PRIVACY.md](PRIVACY.md) |
| Observability | Errors, latency, cost and the event trail; per-language/country slices for model metrics. | `BP §12.1`, `§16.2` |
| Accessibility | Keyboard path for ranking, screen-reader labels, RTL/LTR tested. | `BP App. B` |
| Data quality | Coverage and quality measured separately by original language, production country and popularity. | `BP §11.3` |
| Cost | Enrichment cost per new film and per 1,000 explanations tracked against a phase budget. | `BP §15.4`, `§20.4` |

## 11. Open questions that must be settled by experiment (`BP App. C`)

Do not "decide" these in code; instrument and test them.

| Question | Alternatives | How it is settled |
|---|---|---|
| Ties / weak memory | partial order, neutral replacement, or forbid | answer noise vs time/dropout in a UX test |
| Seed triad count | 3, 5, or adaptive | profile quality, activation, D7, profile satisfaction |
| Visible model update | after each triad vs batched | reward vs priming effect |
| Confidence display | verbal only vs calibrated % later | understanding, calibration, better decisions |
| First catalog provider | one licensed source vs merged sources | rights, Arabic completeness, cost, fallback flexibility |
| Availability in MVP | user-declared platforms vs licensed partner | usefulness, accuracy, cost, terms |
| Backend shape | full Next.js vs modular NestJS | team size, API contracts, testing, deploy complexity (currently NestJS; revisit only with evidence) |
| Pricing | free + Pro bundles | real payment test after retention |

---

**Changelog**
- 2.0 (2026-09-03): rewritten as a derived engineering spec; removed duplicated product narrative, stale "Phase 1/2/3" roadmap, invented thresholds, hard-coded model names, a fabricated OpenAI header, and the merged-score/rating-prompt remnants of the pre-blueprint draft.
