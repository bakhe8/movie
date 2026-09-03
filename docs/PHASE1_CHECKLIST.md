# Phase 1 Implementation Checklist

> **Two bars, stated separately (snapshot 2026-09-03, code at `33940df`).**
> Every row carries two verdicts, because "the code exists and runs" and "it does what the
> blueprint requires" are different claims and conflating them is how a checklist lies.
>
> | Column | ✅ | 🟡 | ❌ | — |
> |---|---|---|---|---|
> | **Built** | exists in the repo and was exercised (unit/e2e test or the manual browser pass) | partly built | not built | |
> | **Blueprint** | verified against the cited section of [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) | meets part of the cited section | fails the cited section | the blueprint says nothing specific, so "Built ✅" is the whole bar |
>
> A row is only *done* when both columns are ✅ (or Built ✅ with Blueprint —). Section numbers
> (§) refer to the blueprint.
>
> **Verified on 2026-09-03:** backend vitest suite (38 tests, 5 files) passes; Python worker
> pytest suite (21 tests) passes; `tsc --noEmit` clean on both apps; all three migrations applied
> locally; manual browser pass — register → Discover (mark 6 titles watched) → Rank (load
> triad, reorder, save, next triad auto-loads) → My list (watched list + "model not trained yet"
> message) → Profile → language toggle → logout.

## Blueprint gaps hiding behind working code (fix these before adding features)

These are things that *run* today but contradict or fall short of the blueprint. They are
listed here because a green test suite makes them invisible.

1. **Schema is incomplete** — only 7 of the 10 tables in [schema.md](schema.md) exist
   (`recommendations`, `global_model_versions`, `source_records` are missing). §13.1 needs the
   recommendations log and model versions; §11.1 needs the per-field rights registry.
2. **"Not watched" is treated as an exclusion signal** — `RecommendationsService` removes
   titles whose state is `not_watched` from the candidate pool. §2.4 principle #3: unwatched is
   unknown exposure, never a negative signal; such titles are exactly the recommendation
   candidates.
3. **Missing fingerprint dimension becomes 0** — `training.py` (`fingerprint.get(dim, 0) or 0`)
   and `RecommendationsService.personalFitScore` (`Number(x) || 0`). §6 / §11.3: absence means
   unknown, never zero.
4. **Model "validation" is in-sample** — `training.py` fits on all completed triads and then
   computes `pairwiseAccuracy` on the same triads. §8.3, §16.1, §17.2 require a temporally
   held-out slice, triad kept whole, that never enters training.
5. **Triad instruction copy does not fix the meaning of the answer** — §4.3 requires
   «رتّب هذه الأفلام حسب إعجابك الشخصي، من الأكثر إلى الأقل» so the ranking is not read as
   artistic quality or tonight's mood (§2.4 #4). `RankScreen` says «رتّب الأفلام بحسب تفضيلك».
6. **Triad event is missing `answered_at` and `model_version`** (§13.2); `POST …/rank` has no
   idempotency key (§14), only a status guard.
7. **Recommendations are never persisted** — no reason, no display propensity, no
   `experiment_id`/`request_id` (§13.1 `recommendations`, §14, §14.1). Without the log the
   post-watch loop (§4.5) cannot close and §16 evaluation has nothing to read.
8. **Confidence band is a triad-count heuristic** — §9.2/§9.3 require evidence diversity,
   successful prediction of held-out comparisons, and fingerprint quality before showing a band.
9. **Fingerprints carry no provenance** — the type has `confidence`/`sourceIds`/`reviewStatus`
   but every seeded row leaves them empty (§6, §13.3), and the 13 dimensions cover only part of
   the §6.1 families.
10. **Onboarding collects no market, platforms, or consent** (§4.1, §13.1 `consents`, §2.4 #9).

---

## Project Setup

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Monorepo structure (Next.js, NestJS, Python workers, shared types) | ✅ | — | |
| Database schema (PostgreSQL + pgvector) | 🟡 | ❌ | 7 of 10 tables from schema.md migrated; `recommendations`, `global_model_versions`, `source_records` missing (§13.1, §11.1). pgvector image runs but no `vector` column exists — `embeddings.vector` is `real[]` (§12.1) |
| Docker Compose for PostgreSQL + Redis (+ disposable `postgres-test`) | ✅ | — | |
| Environment configuration template | ✅ | — | |
| Documentation (architecture, schema, privacy, quickstart) | ✅ | — | Blueprint is the sole source of truth; the rest is this repo's elaboration (see docs/README.md) |
| Plackett-Luce ranker implementation (Python) | ✅ | ✅ | §7.2: full ranking kept as one listwise event, not three pairwise comparisons |
| OpenAI fingerprinting worker implementation (Python) | ✅ | 🟡 | §15.3 structured output ✅; §15.4 acceptance tests ❌; schema covers only part of §6.1; never run against the catalog |
| Shared TypeScript types package | ✅ | — | |
| Makefile with common commands | ✅ | — | |

---

## Authentication & Users

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `AuthService` — register, login, JWT | ✅ | 🟡 | §13.1: account identity vs. pseudonymous taste id — only the profile id separates them; no region/market on the account; no `consents` record at registration (§2.4 #9) |
| `AuthController` — POST /auth/register, POST /auth/login, GET /auth/profile | ✅ | — | No /auth/refresh |
| `JwtStrategy` — validate tokens on protected endpoints | ✅ | — | |
| Password hashing | ✅ | — | bcrypt, cost 10 |
| Email validation | ✅ | — | `@IsEmail`; password 8–64 chars |
| Refresh token mechanism | ❌ | — | |
| Tests: unit tests for auth logic | ✅ | — | `auth.service.spec.ts`, 7 tests |

### Frontend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Login page with email/password form | ✅ | — | `AuthScreen` |
| Register page with form validation | ✅ | ❌ | §4.1 onboarding = account + UI language + market + platforms, then import/select watched titles. The form collects name/email/password only; no consent step (§13.1) |
| JWT token storage | ✅ | — | `localStorage` via `lib/session.tsx` |
| Auto-redirect to login if unauthenticated | ✅ | — | `page.tsx` renders `AuthScreen` without a session |
| Logout functionality | ✅ | — | `ProfileScreen` |
| Password reset flow (optional for MVP) | ❌ | — | |

---

## Profiles Management

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `ProfilesService` — CRUD | ✅ | 🟡 | §13.1 `taste_profiles` = weights version, posterior, time layers, exceptions. `Profile` holds name + language only; the model lives in `user_model_snapshots` with weights and bias terms, no posterior, no time layers, no exceptions |
| GET /profiles, GET /profiles/{id}, POST, PATCH, DELETE | ✅ | — | |
| Profile validation (unique name per user) | ✅ | — | DB unique constraint on `(userId, name)` |
| Authorization (own profiles only) | ✅ | ✅ | Ownership check on every profile-scoped route; proven by `test/idor.e2e-spec.ts` (§2.4 #9 private by default) |
| Tests: profile CRUD | ✅ | — | `profiles.service.spec.ts`, 7 tests |

### Frontend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Profile page showing current profile | ✅ | — | Name + user email (`ProfileScreen`) |
| Create new profile dialog | ❌ | — | One default profile is auto-created on first login |
| Edit profile form | ❌ | — | |
| Delete profile confirmation | ❌ | — | |
| Switch between profiles | ❌ | — | §2.4 #10 (independent profiles) is satisfied by the data model, not yet by the UI |

---

## Film Catalog Management

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `TitlesService` — search, list, get | ✅ | ❌ | §5.1 "search by alternate titles" / §13.1 `localized_titles` / §12.1 Postgres FTS — today: ILIKE on `titleEn` and `titleAr` only |
| GET /titles (paginated), GET /titles/{id}, GET /titles/search?q= | ✅ | — | |
| POST /titles (admin only) | ❌ | — | No admin role exists |
| Fingerprint field on Title entity | ✅ | ❌ | `FilmFingerprintV1`: 13 numeric dims + `themes`, with optional `confidence`/`sourceIds`/`extractorVersion`/`reviewStatus`. §6.1/§13.3: per-feature uncertainty, sources, version, review — every seeded row leaves these empty; families for characters, ending, people, cultural context are absent |
| Tests: search, pagination | ❌ | — | No `titles.service.spec.ts` |

### Frontend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Film search page | ✅ | 🟡 | Live debounced search (`DiscoverScreen`); inherits the alternate-title gap above |
| Film detail view | ❌ | — | §5.3 work page: fingerprint, fit reason, public quality and availability shown separately |
| Fingerprint radar chart (optional) | ❌ | — | |
| No edit/delete for non-admins | ✅ | — | No write UI for titles at all |

### Data Seeding

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Select 300–500 films to seed | ❌ | ❌ | 15 films. §17.1: balanced research catalog of 300–500 incl. Arabic + international + varied popularity |
| Seed script | ✅ | ❌ | `npm run db:seed` works. §11.1: rights registry per field — seeded rows carry no source/license (`source_records` table does not exist) |
| Manually add films via admin API | ❌ | — | |
| Generate fingerprints (batch job) | ❌ | — | The 15 seeded fingerprints are hand-entered placeholders, not worker output |

---

## Triadic Ranking (Core Feature)

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `TriadsService` — generate, store | ✅ | 🟡 | Event-model gaps listed per row below; scoring lives in the Python ranker |
| GET /profiles/{id}/triads/current | ✅ | 🟡 | §14 `/triads/next`: only watched titles ✅, returns propensity + policy ✅; no `model_version`/`experiment_id`/`request_id` on the response |
| POST /triads/{id}/rank | ✅ | ❌ | §14: idempotency key, membership and time checks — only a "already completed" status guard. §13.2: `answered_at` and `model_version` not recorded (`createdAt` doubles as `shown_at`) |
| GET /triads/{id} | ❌ | — | |
| GET /profiles/{id}/triads (completed) | ✅ | — | |
| Random selection of 3 watched, unranked titles (`random-v1`) | ✅ | 🟡 | §8.2 propensity `ρ` logged (uniform 1/C(pool,3)) ✅, `policyVersion` ✅, `displayOrder` shuffled independently ✅ (§4.3, §8.3). §8.3 not met: no session limit/fatigue cost, no validation hold-out, no same-director/language guard |
| Adaptive selection (distinguish similar preferences) | ❌ | ❌ | §8.1 six triad functions, §8.2 selection score, §7.5 Fisher-information targeting — none |
| Ranking validation (permutation of [0,1,2]) | ✅ | — | |
| "Haven't watched" / "Don't remember" replacement — two neutral states, no preference signal | ❌ | ❌ | §4.3, §13.1 `triad_replacements`, §14 `/triads/{id}/replace`. `metadata.replacements` is reserved on the entity, nothing writes it |
| Tests: generation, ranking validation | ✅ | — | `triads.service.spec.ts`, 10 tests |

### Frontend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Triadic ranking interface (3 cards) | ✅ | ❌ | §4.3 instruction must fix the meaning («حسب إعجابك الشخصي، من الأكثر إلى الأقل») to exclude artistic quality and tonight's mood (§2.4 #4); `RankScreen` says «رتّب الأفلام بحسب تفضيلك / البطاقة الأولى هي المفضلة» |
| Licensed poster + title + year per card, no critic scores | ❌ | ❌ | §4.3. Today: title, year, genres, description; no poster field on Title. No critic scores shown ✅ |
| Click/drag to rank plus a keyboard-accessible alternative | ✅ | ✅ | Drag-and-drop **and** ↑/↓ buttons on every card (§4.3 RTL clarity) |
| Visual feedback for selected ranking | ✅ | — | Position number per card |
| Submit button | ✅ | — | |
| "Haven't watched? Replace" and "Don't remember? Replace" as two separate buttons | ❌ | ❌ | §4.3 |
| Film replacement dialog | ❌ | — | |
| Progress indicator (X of N; N is not fixed — 3–5 for first value, 20–30 Alpha target per §17.2; open question per Appendix C) | ❌ | — | |
| Confirmation on submit | ❌ | — | Saves and immediately loads the next round |
| Next triad automatically loads | ✅ | — | §4.3 "result: periodic update, not necessarily after every triad" — nothing is shown yet, which is allowed |
| Tests: ranking component behavior | ❌ | — | No frontend test setup |

### Placeholder for AI Integration

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Triad generation strategy (initially random) | ✅ | — | |
| Connect to Python ranker for triad selection (information gain) | ❌ | — | §8.2, §7.5 |

---

## Preference Model Training

### Python Worker

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `PlackettLuceRanker.fit()` — train from triads (`train-profile <profile-uuid>`) | ✅ | 🟡 | §7.1: `b(m)` present as an explicit zero placeholder ✅, `θᵀφ` ✅, `δ` as per-item bias ✅, `pᵀq` deferred (allowed). §7.5: per-user model from scratch — the blueprint says not to; the shared latent space / calibration does not exist |
| — Collect completed triads for the profile | ✅ | ❌ | §8.3, §16.1, §17.2: no temporally held-out slice; every completed triad trains |
| — Extract fingerprints | ✅ | ❌ | §6 / §11.3: missing dimension is coerced to 0 (`fingerprint.get(dim, 0) or 0`) instead of unknown |
| — Run MLE optimization | ✅ | ✅ | BFGS with L2, listwise likelihood (§7.2) |
| — Store weights in database | ✅ | 🟡 | `user_model_snapshots` (weights, biasTerms, trainingTriadCount, pairwiseAccuracy). §13.1 `taste_profiles`: no posterior, no time layers, no exceptions |
| `PlackettLuceRanker.predict_score()` | ✅ | — | |
| `compute_pairwise_accuracy()` — validate model | ✅ | ❌ | Computed on the training triads themselves; §16.1 requires within-user temporal split with the whole triad on one side |
| Tests: MLE convergence, accuracy, population-prior effect | ✅ | — | `tests/test_ranker.py`, `tests/test_training.py` |

### Backend Integration

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `RankerService` — wrapper around the Python worker | ❌ | — | Training is a manual CLI run; the backend never invokes Python (§12.2 model service in the request flow) |
| Trigger retraining after every N triads | ❌ | — | |
| Store trained weights in `user_model_snapshots` | ✅ | 🟡 | Written by the Python CLI directly; see taste_profiles gap above |
| Handle job failures gracefully | ❌ | — | |
| Cache user weights in Redis | ❌ | — | Redis container runs; nothing uses it |
| Tests: model storage and retrieval | 🟡 | — | Read side only (`recommendations.service.spec.ts`) |

---

## Recommendations Generation

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `RecommendationsService` | ✅ | ❌ | §13.1 `recommendations` + §14/§14.1: results are computed on the fly and never persisted — no reason, no display propensity, no `experiment_id`/`request_id`. Without the log the §4.5 post-watch loop cannot close |
| GET /profiles/{id}/recommendations (`?limit=`; 409 until a snapshot exists) | ✅ | ❌ | Same contract gaps as above; only `modelVersion` is returned |
| POST /recommendations/{id}/feedback | ❌ | — | §13.1 `outcomes` |
| Load user's preference weights | ✅ | — | Latest snapshot; rejects dimension mismatch |
| Personal Fit, Public Quality, Watchability computed separately, never merged | ✅ | ✅ | §4.4, §2.4 #7. Personal Fit computed; the other two are explicit `null` (no data source), not fabricated |
| Sort within the three tracks (safe / discovery / outside-usual) | ❌ | ❌ | §4.4: every result is `track: 'safe'`; no discovery or outside-usual policy |
| Filter candidates | ✅ | ❌ | Excludes `watched` ✅ and titles without a fingerprint ✅, **but also excludes `not_watched`** — §2.4 #3 says unwatched is unknown exposure, not an exclusion. Missing dimension → 0 (`Number(x) \|\| 0`), §6 / §11.3 |
| Confidence BAND (initial/likely/strong/inconclusive), never a raw percentage | ✅ | ❌ | Band is derived from `trainingTriadCount` alone; §9.2/§9.3 require evidence diversity, held-out prediction success, and fingerprint quality. No raw percentage is exposed ✅ (§7.2) |
| Cache invalidation after triad ranking | ❌ | — | No cache |
| Tests: recommendation scoring | ✅ | — | `recommendations.service.spec.ts`, 9 tests |

### Frontend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Recommendations page | 🟡 | ❌ | `ListScreen` shows a flat title + description list when available, and a translated "not trained yet / empty / error" message otherwise. §4.4 requires three separate values, a verbal confidence, a reason, and availability |
| Grouped by safe / discovery / outside-usual | ❌ | ❌ | §4.4 |
| Show Personal Fit, Public Quality, Watchability + confidence band | ❌ | ❌ | §4.4 |
| Top reasons (dimensions that drove it), no spoilers, with `evidence_source` | ❌ | ❌ | §9.4, §12.2 attribution gate, §14 |
| Similar films | ❌ | — | |
| "Add to watchlist" | ❌ | — | §5.1 |
| "Not relevant to me" dismiss, logged as an outcome only — no thumbs or stars (§2.4 #2, §4.5) | ❌ | — | |
| Clickable dimensions to learn more | ❌ | — | |
| Tests: recommendations rendering | ❌ | — | |

### Explanation Module (Optional for MVP)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `ExplanationService` (OpenAI natural-language explanation) | ❌ | — | `enrichment.py` has an unused `generate_recommendation_explanation`; §9.4 rules and §12.2 attribution gate not implemented |
| Template explanation (no LLM) | ❌ | — | |
| No bare numeric feature score shown to the user; qualitative evidence only; no uncalibrated percentage (§7.2, §9.4) | ❌ | — | Nothing is shown yet |

---

## User State Management

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `UserTitleStateService` — watched / not_watched / watchlist / interested | ✅ | 🟡 | §13.1 `watch_events` + §6.2: time, source, edition, audio, subtitles, provider. Today: one state row with `watchedAt` and `notes`; whether "watched" came from the app or an import is not recorded |
| PATCH /profiles/{id}/titles/{titleId}/state | ✅ | — | |
| GET /profiles/{id}/watched-titles | ✅ | — | |
| GET /profiles/{id}/watchlist | ✅ | — | |
| POST /v1/watch-events with import source | ❌ | ❌ | §14, §4.2: no import path (`POST /v1/library/imports`) |
| No in-app rating: PATCH cannot write a rating; `importedRating` + `ratingSource: 'import'` reserved for a future import path | ✅ | ✅ | §2.4 #2, §4.2, §4.5; migration `SplitImportedRatingFromInAppState` |
| Tests: state transitions | ✅ | — | `user-title-state.service.spec.ts`, 5 tests |

### Frontend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Mark films as watched | ✅ | 🟡 | §4.2 "quick pick from known, diverse titles with search + watched" — search + watched ✅; no curated diverse starter set; no CSV import |
| Mark films as not watched | ❌ | — | |
| Add to watchlist | ❌ | — | §5.1 |
| View watch history | ✅ | — | `ListScreen` |
| Show state in search results | ❌ | — | Discover only remembers clicks made in the current session; existing states are not loaded |

---

## Admin Dashboard (Optional in this checklist, **required by the blueprint**)

§5.1 puts an internal board for content review, fingerprint sources and model versions inside the
MVP, and §17.2 requires it for Alpha.

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `AdminService` — model inspection | ❌ | ❌ | §5.1, §17.2 |
| GET /admin/models/{profileId} | ❌ | ❌ | |
| GET /admin/triads/latest | ❌ | ❌ | |
| GET /admin/recommendations/test | ❌ | ❌ | |
| GET /admin/films/missing-fingerprints | ❌ | ❌ | |
| Authorization: admin role only | ❌ | — | No roles exist |
| Admin frontend (login, weights chart, rankings feed, test scoring, film seeding UI) | ❌ | ❌ | |

---

## Testing & Quality Assurance

### Unit Tests

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Auth logic | ✅ | — | |
| Ranker accuracy on synthetic data | ✅ | — | |
| Recommendation scoring | ✅ | — | |
| State transitions | ✅ | — | |

### API Tests (Backend)

`test/idor.e2e-spec.ts` runs over real HTTP against the disposable `postgres-test` container
(`npm run test:e2e`). It proves the auth guard (401 without a token) and that every
profile-scoped route rejects another user's profile. It is **not** functional coverage.

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Auth endpoints (register, login) | 🟡 | — | Register used as setup; login unit-tested only |
| Profile CRUD | 🟡 | — | Ownership / 404 paths only |
| Titles search and pagination | ❌ | — | |
| Triads generation and ranking | 🟡 | — | Ownership only |
| Recommendations generation | 🟡 | — | Ownership only |

### E2E Tests (Frontend)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Complete ranking flow (login → rank → recommendations) | ❌ | — | Done manually on 2026-09-03, not automated |
| Film search and viewing | ❌ | — | |
| State management | ❌ | — | |

### Manual Testing

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Triadic ranking interface feels responsive | ✅ | — | Browser pass 2026-09-03 |
| Recommendations update after ranking | ❌ | — | No training run against a real profile yet |
| No N+1 queries | ❌ | — | `RankScreen` fetches each of the 3 titles with a separate GET /titles/{id} |
| Performance with 100+ films, 50+ rankings | ❌ | — | |

### Offline evaluation protocol (§16)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Within-user temporal split, triad as one unit (§16.1) | ❌ | ❌ | |
| Metrics beyond pairwise accuracy: NLL, top-1, Kendall τ, NDCG, Brier/ECE (§16.2) | ❌ | ❌ | Only in-sample pairwise accuracy |
| Baselines: popularity, genre similarity, Bradley–Terry, random triads (§16.3) | ❌ | ❌ | |
| Model acceptance gate (§16.5) | ❌ | ❌ | |

---

## Database & Infrastructure

### PostgreSQL

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Create all tables from schema.md | 🟡 | ❌ | 7 of 10: `recommendations`, `global_model_versions`, `source_records` missing (§13.1, §11.1) |
| Indexes for performance | ❌ | — | Only PKs and unique constraints |
| Test on 1000s of titles, 100s of triads | ❌ | — | |
| Backup strategy | ❌ | — | |

### Redis

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Cache user preference weights | ❌ | — | |
| Session storage | ❌ | — | |
| Job queue (BullMQ) | ❌ | — | §12.1 "queue later, when needed" |

### Docker

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| PostgreSQL + pgvector container | ✅ | — | `ankane/pgvector`, healthy; the extension is not used by any column |
| Redis container | ✅ | — | Healthy; unused |
| docker-compose.yml tested locally | ✅ | — | Dev `postgres` on host 5433, `postgres-test` on 5544 |
| Environment variable substitution | ✅ | — | Compose defaults + `.env` |

---

## Film Fingerprinting (Phase 1b)

### Backend

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Fingerprinting job processor | ❌ | — | |
| Queue fingerprinting for new films | ❌ | — | |
| Store worker output in `title.fingerprint` | ❌ | — | Column exists; nothing writes worker output |
| Handle OpenAI errors gracefully | ❌ | — | |

### Python Worker

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| `FilmEnrichmentWorker.generate_fingerprint()` | ✅ | 🟡 | §15.3 structured output (`response_format=FilmFingerprintV1`) ✅; §15.4 acceptance tests ❌; provenance fields not populated (§13.3); §6.1 family coverage partial |
| Batch processing | ❌ | — | |
| Retry logic | ❌ | — | |

### Seeding

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Fingerprint 300–500 films | ❌ | ❌ | §17.1 |
| Verify fingerprint schema correctness | ❌ | — | |
| Store model version used | ❌ | — | |

---

## Deployment Preparation

### Local Development

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Docker Compose setup | ✅ | — | |
| `npm run dev` | ✅ | — | Backend on :3101 under `/api`, frontend on :3000 |

### Staging (Pre-Launch)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Deploy backend / frontend to staging | ❌ | — | §12.1 dev/staging/prod + feature flags |
| Database migrations tested | 🟡 | — | Applied locally only |
| Environment variables configured | ❌ | — | |
| CORS configured | ✅ | — | Origin from `FRONTEND_URL`, default `http://localhost:3000`, credentials on |
| Rate limiting enabled | ✅ | — | Global `ThrottlerGuard`, 60 req / 60 s |
| Logging / observability | ❌ | ❌ | Nest default logger only; §12.1 OpenTelemetry + Sentry + first-party analytics |
| CI/CD | ❌ | ❌ | §12.1 |

### Production (Post-MVP Validation)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Hosting platform, backups, monitoring, DDoS protection, TLS, error tracking | ❌ | — | |

---

## Privacy & Compliance

### Data Privacy

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Privacy policy drafted | ✅ | 🟡 | docs/privacy.md exists; not reviewed |
| Terms of Service drafted | ❌ | — | |
| Consent flow | ❌ | ❌ | §13.1 `consents` (purpose, version, time); nothing is captured at registration |
| Data export endpoint | ❌ | ❌ | §2.4 #9, §14 `POST /v1/privacy/export` |
| Data deletion endpoint | ❌ | ❌ | §2.4 #9, §14 `POST /v1/privacy/delete`. DELETE /profiles/{id} cascades a profile only; no account-level deletion |
| Audit logging | ❌ | — | |

### Saudi Arabia PDPL

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Privacy impact assessment | ❌ | — | |
| Data Protection Officer identified | ❌ | — | |
| Breach response plan | ❌ | — | |
| Regulatory review before launch | ❌ | — | |

---

## Metrics & Success Criteria

### Alpha Success Metrics (80–150 users, §17.2; 15–20 is the Phase 0 UX cohort, §17.1)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Majority of accepters complete 20–30 triads across short sessions | ❌ | — | No Alpha yet |
| Replacement rate low enough not to degrade triad reliability (threshold set experimentally) | ❌ | — | Replacement not built |
| Model beats the best simpler baseline by a statistically significant margin ("60–65% pairwise" is illustrative only, §16.5) | ❌ | — | No baselines, no holdout |
| Session duration and dropout no worse than a non-adaptive baseline policy | ❌ | — | |

### Data Quality

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| No corrupted triads | ❌ | — | Not checked on real data |
| Preference weights converge | ❌ | — | |
| No duplicate films in triads | 🟡 | — | Guaranteed by construction in `random-v1`; not checked on real data |
| Replacement logic works | ❌ | — | Not built |

---

## Nice-to-Haves (Post-MVP)

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| Recommendation explanations (OpenAI), radar chart, genre lists, collaborative hints, email, sharing, mobile app | ❌ | — | §5.2 lists what is deliberately deferred |

---

## Launch Readiness Checklist

| Item | Built | Blueprint | Evidence / gap |
|---|---|---|---|
| All Phase 1 core features working | ❌ | ❌ | Core loop runs locally; see the gap list at the top |
| Database schema tested | ❌ | ❌ | Incomplete (7/10 tables) |
| 300–500 films seeded with fingerprints | ❌ | ❌ | 15 hand-entered |
| Plackett-Luce ranker trained and validated | ❌ | ❌ | Unit-tested on synthetic data; no held-out validation |
| 80–150 Alpha users onboarded; accepters complete 20–30 triads | ❌ | — | |
| No critical bugs in testing | ❌ | — | |
| Documentation complete | ❌ | — | |
| Privacy policy reviewed | ❌ | — | |
| PDPL compliance verified | ❌ | — | |
| OpenAI API integration tested | ❌ | — | |
| Rate limiting and security measures in place | 🟡 | — | Rate limiting ✅; no audit log, no consent, no export/delete |

---

**Last Updated**: 2026-09-03  
**Status**: In Progress — the core loop (auth → mark watched → rank triads → train → recommend) is built and runs locally, but ten of its pieces fall short of the blueprint (list at the top). Training is still a manual CLI step.  
**Next Milestone**: close the cheap blueprint gaps first (triad instruction copy, `answered_at` + `model_version`, stop excluding `not_watched`, treat missing dimensions as unknown, temporal hold-out in training, the three missing tables), then "Haven't watched" / "Don't remember" replacement (API + two UI buttons), an automatic retraining trigger, and a persisted recommendations log so the post-watch loop can close.
