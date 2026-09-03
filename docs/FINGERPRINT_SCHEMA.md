# Film Fingerprint Schema and Enrichment Pipeline

**Status**: Derived from blueprint `§6` (four data layers), `§6.1` (feature families), `§6.2` (work vs edition vs watch), `§11.3` (data-quality rules), `§13.3` (feature record shape), `§15` (background LLM use, controlled extraction, acceptance tests). Decisions: ADR-19, ADR-23.

The fingerprint is the content description the taste model reads. It is **not** a rating, **not** popularity, and **not** a user attribute. Public reception and availability live in separate layers ([SCHEMA.md](SCHEMA.md): `public_quality_sources`, `availability_snapshots`).

---

## 1. Data layers (`BP §6`)

| Layer | Examples | Handling | Where it lives |
|---|---|---|---|
| Documented facts | ids, year, runtime, credits, original language, production countries | licensed/official sources, declared conflicts, auditable updates | `titles`, `credits`, `localized_titles`, `source_records` |
| Extracted features | pacing, tone, ambiguity, structure, dialogue density, ending | fixed schema, allowed evidence only, confidence, extractor version, human review sampling | `titles.fingerprint` (published snapshot) + `content_features` (provenance rows) |
| Collective opinion | critics, audience, vote counts, polarization, drift over time | each source stored separately and normalized internally; no synthetic "global score" | `public_quality_sources` |
| Access and availability | platform, market, audio, dub, subtitles, licensing window | dated snapshots from a licensed partner; separate from fit | `availability_snapshots` |

Rule: **absence means unknown, never zero** (`BP §6`, `§11.3`).

## 2. Version 1 — as implemented (frozen)

`schemaVersion = "film-fingerprint-v1"`. Thirteen numeric features on a 0–1 scale, a free-text theme list, per-feature confidence, and provenance. This is exactly what the seed data, the backend type, the shared type and the Python worker use today. It is frozen: no field is added to V1; new families arrive in V2 (§3).

| Key | 0 → 1 meaning | `BP §6.1` family |
|---|---|---|
| `pacing` | slow → fast | Rhythm |
| `rhythmVariance` | consistent → varied | Rhythm |
| `ambiguity` | clear → ambiguous | Narrative |
| `psychologicalDepth` | shallow → deep | Characters (partial) |
| `warmth` | cold → warm | Tone & emotion |
| `darkness` | light → dark | Tone & emotion |
| `linearity` | linear → fragmented | Narrative |
| `dialogueDensity` | sparse → dense | Dialogue & information |
| `actionIntensity` | contemplative → action-heavy | Rhythm / Style |
| `plotComplexity` | simple → complex | Narrative |
| `visualComplexity` | minimal → elaborate | Style |
| `soundscapeComplexity` | minimal → elaborate | Style |
| `colorSaturation` | desaturated → vivid | Style |

Plus:

```ts
themes: string[]                          // free text, not part of the model vector
confidence: { [key]: number }             // 0–1 per feature; empty object = unknown for every feature
generatedBy?: string; generatedAt?: Date; modelVersion?: string
sourceIds?: string[]; extractorVersion?: string
licenseStatus?: 'commercial_allowed' | 'non_commercial_only' | 'unknown'
reviewStatus?: 'unreviewed' | 'sampled' | 'human_reviewed'
```

**Three copies must stay identical** until a shared build exists (see ADR-1 consequences):

- `packages/shared/src/types.ts` — `FilmFingerprintV1`
- `apps/backend/src/entities/title-fingerprint.type.ts` — `FilmFingerprintV1`
- `services/workers/src/enrichment.py` — Pydantic `FilmFingerprintV1`; `services/workers/src/training.py` — `FINGERPRINT_DIMENSIONS` (order defines the weight vector index)

Known drift to fix (tracked in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)): the Pydantic model names the version field `schema_version` while both TypeScript copies use `schemaVersion`; the Pydantic model has no provenance fields, so worker output cannot be published without the backend adding them.

The model reads the 13 numeric keys in the `FINGERPRINT_DIMENSIONS` order; a stored weight vector is valid only for the `fingerprintSchemaVersion` it was trained against (`model_versions.fingerprintSchemaVersion`).

### 2.1 Coverage gap against `BP §6.1`

| Family | V1 coverage | V2 must add |
|---|---|---|
| Narrative | ambiguity, linearity, plotComplexity | mystery/gradual revelation, perspective, narrator reliability (multi-valued) |
| Rhythm | pacing, rhythmVariance, actionIntensity | time-to-first-event, turning-point density; "deliberate slowness" vs "emptiness" |
| Tone & emotion | warmth, darkness | irony, unease, emotional arc, catharsis amount; tones may coexist over time |
| Characters | psychologicalDepth | agency, competence, moral ambiguity, transformation, relationship centrality |
| Dialogue & information | dialogueDensity | exposition directness, subtext, knowledge complexity |
| Style | visual/soundscape complexity, colorSaturation | camera movement, editing, realism vs stylization, experimentation (needs licensed visual/descriptive evidence) |
| Theme | `themes[]` (free text) | controlled vocabulary; never used to infer user traits |
| Ending | — | closed/open, twist, dramatic justice, bitterness/optimism (internal use + spoiler-free explanations only) |
| People | — | director, writer, cast, cinematographer, composer as separate hierarchical, heavily shrunk effects — **not** in the dense vector |
| Cultural context | — | original language, dialects, production country, story setting, era — separate block; UI language and nationality never enter taste |

## 3. Version 2 — target shape (`BP §6.1`, `§13.3`)

### 3.1 First V2 family pass — specified and extracted 2026-09-04

Why now: the first non-synthetic ranker ([DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md) §7.1) disagreed with the V1 model exactly where V1 has no words — a cynical film scored like a contemplative one because both are "ambiguous and dark", and a warm humanist film sank because V1 knows only `warmth`. The families below are the ones a plot synopsis can support; Style (camera, editing) needs visual or descriptive evidence we do not have, People is a separate block fed by credits (ADR-65), and Cultural context is already structured (`originalLanguage`, country).

Fifteen features, all 0–1, namespaced `family.feature`, extracted by `FilmEnrichmentWorker.generate_fingerprint_v2()` from the same evidence as V1 (lead + plot section), confidence per feature required by the output schema:

| Key | 0 → 1 | `BP §6.1` family | What it is meant to separate |
|---|---|---|---|
| `narrative.revelation` | everything known early → built on withheld information revealed gradually | Narrative | mystery structure from mere ambiguity |
| `narrative.perspective` | one viewpoint → many viewpoints | Narrative | Rashomon-style multiplicity |
| `narrative.unreliability` | reliable narration → contradictory or unreliable | Narrative | the narrator as a device |
| `tone.irony` | earnest → ironic or satirical | Tone & emotion | the cynical from the contemplative |
| `tone.unease` | comfort → sustained dread | Tone & emotion | dread from mere darkness |
| `tone.catharsis` | emotion withheld → full release | Tone & emotion | the emotional arc's amount of release |
| `tone.compassion` | cold or detached gaze on the characters → compassionate gaze | Tone & emotion | humanism from misanthropy at equal darkness |
| `characters.agency` | buffeted by events → driving events | Characters | |
| `characters.moralAmbiguity` | clear-cut → ambiguous | Characters | |
| `characters.transformation` | static → transformed | Characters | |
| `characters.relationshipCentrality` | an individual's story → relationships at the centre | Characters | |
| `ending.openness` | closed → open | Ending | internal use and spoiler-free explanations only |
| `ending.twist` | none → major reversal | Ending | idem |
| `ending.justice` | dramatic justice absent → served | Ending | idem |
| `ending.optimism` | bitter → hopeful | Ending | idem |

Plus `theme.tags`: up to three tags from a controlled vocabulary (`identity, family, memory, power, justice, survival, love, grief, faith, class, war, coming-of-age, technology, isolation, freedom, art, crime, migration, friendship, madness, nature, duty, revenge, community`) — categorical, never in the dense vector, never used to infer anything about a user (`BP §6.1` Theme note).

Storage in this pass: the V2 block is published **inside** `titles.fingerprint` as a nested snapshot, so V1 stays frozen and every V1 reader is untouched:

```ts
fingerprint.v2 = {
  schemaVersion: 'film-fingerprint-v2', features: { 'tone.irony': 0.8, … 15 keys }, themes: ['identity', 'memory'],
  confidence: { 'tone.irony': 0.7, … }, generatedBy, generatedAt, modelVersion, extractorVersion: 'enrichment-worker-v2-families-v1',
  sourceIds, licenseStatus: 'unknown', reviewStatus: 'unreviewed'
}
```

The per-feature `content_features` rows are written by the demo seed (`seed-demo.ts`, `seedContentFeatures()`): one row per known V1 key (unnamespaced, as the snapshot spells it) and per V2 key, `value` from the snapshot, `uncertainty` = 1 − the extractor's confidence (NULL when none was reported), `sourceIds`/`licenseStatus`/`reviewStatus`/`validFrom` copied from the block that produced the value, upserted on `(titleId, featureKey, extractorVersion)` so a re-run is a no-op; when a newer extractor version of the same feature lands, every older open row of that pair gets `supersededBy` pointing at the current one — never deleted, never overwritten (`BP §11.3`). A missing dimension gets no row: unknown is not a value. The snapshot is still what the model reads, exactly as §3.2's rule says. Wiring — `FINGERPRINT_DIMENSIONS` in the trainer and `RecommendationsService` growing from 13 to 28 keys, snapshots carrying `fingerprintSchemaVersion` — is a model-service change and is proposed to its owner with the evidence from the offline evaluation (`services/workers/src/fingerprint_v2_eval.py`: the same Plackett–Luce fit on V1 vs V1+V2 vs V2-only features, same temporal hold-out as the trainer). The demo catalog is enriched with the block by `python -m src.enrich_catalog --v2`. First result (2026-09-04, [DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md) §7.2): on a real ranker with 50 rounds, V1+V2 beats V1 on held-out NLL (0.82 vs 0.91) and on agreement with the ranker's own order (Spearman 0.83 vs 0.79), and moves the films V1 mis-ranked to the right half; at 25 rounds the 28-dimensional vector overfits under the trainer's default regularization, so the wiring needs the blueprint's hierarchical shrinkage (`BP §7.1`) or a held-out-chosen penalty. V2 alone is weak (0.53–0.57): it complements V1, it does not replace it.

### 3.2 Target shape

- Namespaced keys `family.feature` (e.g. `narrative.ambiguity`, `ending.openness`), stored one row per `(title, featureKey, extractorVersion)` in `content_features` with `value`, optional `distribution` for multi-valued/conditional features, `uncertainty`, `sourceIds`, `licenseStatus`, `reviewStatus`, `validFrom`.
- `titles.fingerprint` remains the published, immutable snapshot the model reads; publishing a new snapshot bumps `extractorVersion` and links the old rows via `supersededBy` (`BP §11.3`: no silent overwrite).
- People and cultural-context features are separate feature blocks with their own shrinkage in the model (`BP §7.1`, `§10.2`), never part of the dense content vector.
- The work is separated from editions and watch events (`BP §6.2`): dub/subtitle quality is a Watchability/edition signal, never a work feature.
- Coverage and quality are measured per original language, production country and popularity tier (`BP §11.3`, `§16.1`).

## 4. Unknown handling in the model (ADR-19)

- A feature with `value = NULL` or `confidence` below the publish threshold is **unknown**.
- Training: a triad whose three titles do not all have a complete V1 vector is excluded from the loss (never zero-filled).
- Scoring candidates: unknown features are imputed with the population feature mean, and the title's `confidenceBand` input carries a fingerprint-quality penalty (`BP §9.1` "fingerprint confidence", `§9.2` last criterion). The candidate can be recommended but its reason must not cite an unknown feature.
- Implemented 2026-09-03: `training.py` returns no vector for an incomplete fingerprint and the trainer drops the whole triad; `PlackettLuceRanker` raises on an undescribed title instead of scoring it as zero; `RecommendationsService` imputes unknown dimensions with the candidate-pool mean, reports `fingerprintCoverage` per item, and demotes the confidence band one step when any dimension is unknown. A dimension unknown for every candidate contributes nothing to any candidate (neutral for ordering).

## 5. Extraction pipeline (`BP §11.2`, `§15.3`)

```
licensed evidence (plot/synopsis/descriptors we have rights to derive from) + fingerprintSchemaVersion + locale
   → Anthropic Messages API, structured outputs (JSON Schema, Pydantic-enforced) against the versioned schema, model id from config,
     retention governed at the organization level (no per-request flag; PRIVACY.md §6.1)
   → validation: schema → range checks (0–1) → source coverage → contradiction rules (e.g. linearity vs plotComplexity extremes)
   → escalation: low confidence / conflicts / under-represented language → human review queue
   → publish: immutable feature version + provenance + model/eval version; previous version superseded, never overwritten
```

Rules:

- Never send user data, account ids, rankings or preferences to the LLM (`BP §15.2`, `§21.3`).
- Never send text we do not have the right to derive from (no copied reviews, no scraped IMDb/TMDB text) ([DATA_LICENSING.md](DATA_LICENSING.md)).
- Extract once per `(title, extractorVersion)`; re-extract only on schema/model version change or a review finding — versioned, not ad hoc.
- Multiple independent extractions (different prompts/evidence) may be merged with a weak-supervision reliability model; low-confidence features can be used silently for candidate generation but not as displayed reasons until they pass the confidence threshold (`BP §7.6` logic applied to features).
- Triad data feeds back: a repeated contradiction between a feature and many users' behaviour lowers that feature's confidence and queues it for review.
- The model id is configuration (`ANTHROPIC_FINGERPRINT_MODEL`), never hard-coded in code or docs. Every published fingerprint records the model id the API actually served (`modelVersion`) and the pipeline version (`extractorVersion`, `enrichment-worker-v2` since the provider switch of 2026-09-03 — a different model family behind the same prompt is a version change).
- A refusal or an API failure leaves the title without a fingerprint and puts it on the report as a human-review item; nothing is fabricated and nothing is silently re-routed to another model, so one catalog run carries one `modelVersion`.
- Batch runner for the demo catalog: `services/workers/src/enrich_catalog.py` ([DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md) WS2) — evidence is the fixture's own Wikipedia lead and plot text plus the film's facts; resumable; placeholders are labelled `demo-placeholder-v1` and are never mistaken for extractions.

## 6. Acceptance tests before any batch is published (`BP §15.4`)

| Axis | Test | Gate |
|---|---|---|
| Schema validity | share of outputs that pass JSON Schema + range checks | nothing failing validation is published |
| Human accuracy | double-reviewed sample per language/country | agreed threshold; no large gap between languages |
| Stability | re-extract same input with same version | drift within bound, otherwise freeze and investigate |
| Spoilers | explanations tested against a banned events/endings list | zero high-severity spoilers in the launch sample |
| Usefulness | A/B recommendation with vs without explanation | higher understanding/trust without harmful priming |
| Cost | cost per new film and per 1,000 explanations | within the phase budget; auditable cache |

## 7. Explanations from features (`BP §9.4`)

Reasons are generated only from features that actually moved the score, with their sources and confidence; abstract, spoiler-free wording; no identity/psychological/sensitive attribution; no "because you like Korean films" from one film; weak confidence is stated, not papered over. Template explanations are the default; an LLM may rephrase a template from the evidence payload only, never invent evidence (`BP §15.1`, `§15.2`).

## 8. Current state (2026-09-03)

- 15 seeded titles carry hand-entered V1 vectors with `confidence: {}`, `sourceIds: ['manual-seed']`, `licenseStatus: 'unknown'`, `reviewStatus: 'unreviewed'` — honest placeholders for local development, not extractor output.
- `FilmEnrichmentWorker.generate_fingerprint()` exists (Chat Completions structured parse, not the Responses API; no `store=false`; provenance fields absent) and has never run against the catalog.
- No `content_features`, `source_records`, validation stages, review queue, or acceptance tests exist yet.

Full row-by-row status: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

---

**Changelog**
- 1.0 (2026-09-03): first dedicated fingerprint document; replaces the "~30–50 dimensions" wording scattered across older docs with the real V1 (13) and the `BP §6.1` V2 plan.
