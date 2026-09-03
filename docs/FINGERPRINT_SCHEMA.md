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

- Namespaced keys `family.feature` (e.g. `narrative.ambiguity`, `ending.openness`), stored one row per `(title, featureKey, extractorVersion)` in `content_features` with `value`, optional `distribution` for multi-valued/conditional features, `uncertainty`, `sourceIds`, `licenseStatus`, `reviewStatus`, `validFrom`.
- `titles.fingerprint` remains the published, immutable snapshot the model reads; publishing a new snapshot bumps `extractorVersion` and links the old rows via `supersededBy` (`BP §11.3`: no silent overwrite).
- People and cultural-context features are separate feature blocks with their own shrinkage in the model (`BP §7.1`, `§10.2`), never part of the dense content vector.
- The work is separated from editions and watch events (`BP §6.2`): dub/subtitle quality is a Watchability/edition signal, never a work feature.
- Coverage and quality are measured per original language, production country and popularity tier (`BP §11.3`, `§16.1`).

## 4. Unknown handling in the model (ADR-19)

- A feature with `value = NULL` or `confidence` below the publish threshold is **unknown**.
- Training: a triad whose three titles do not all have a complete V1 vector is excluded from the loss (never zero-filled).
- Scoring candidates: unknown features are imputed with the population feature mean, and the title's `confidenceBand` input carries a fingerprint-quality penalty (`BP §9.1` "fingerprint confidence", `§9.2` last criterion). The candidate can be recommended but its reason must not cite an unknown feature.
- Current code coerces missing values to 0 in both `training.py` and `RecommendationsService.personalFitScore`; this is a listed gap.

## 5. Extraction pipeline (`BP §11.2`, `§15.3`)

```
licensed evidence (plot/synopsis/descriptors we have rights to derive from) + fingerprintSchemaVersion + locale
   → OpenAI Responses API, Structured Outputs against the versioned JSON Schema, store=false, model id from config
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
- The model id is configuration (`OPENAI_FINGERPRINT_MODEL`), never hard-coded in code or docs; the worker's current `"gpt-4o"` default is a placeholder to be moved to configuration.

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
