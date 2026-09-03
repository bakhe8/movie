# Phase 1 Implementation Checklist

> **Status snapshot (2026-09-03)** — verified against the code at commit `fc72d85`, not against
> intentions. `[x]` means it exists in the repo and was exercised (unit test, e2e test, or the
> manual browser pass below). Anything partial stays `[ ]` with a note saying exactly what exists.
>
> Verified on 2026-09-03: backend vitest suite (38 tests, 5 files) passes; Python worker pytest
> suite (21 tests) passes; `tsc --noEmit` clean on both apps; all three migrations applied to the
> local Postgres; full manual browser pass — register → Discover (mark 6 titles watched) → Rank
> (load triad, reorder, save, next triad auto-loads) → My list (watched list + "model not trained
> yet" message) → Profile → language toggle → logout.

## Project Setup ✅ COMPLETED
- [x] Monorepo structure (Next.js, NestJS, Python workers, shared types)
- [x] Database schema defined (PostgreSQL with pgvector) — 3 TypeORM migrations in `apps/backend/src/migrations`
- [x] Docker Compose for PostgreSQL + Redis (+ a disposable `postgres-test` service for e2e)
- [x] Environment configuration template
- [x] Documentation (architecture, schema, privacy, quickstart)
- [x] Plackett-Luce ranker implementation (Python)
- [x] OpenAI fingerprinting worker implementation (Python)
- [x] Shared TypeScript types package
- [x] Makefile with common commands

---

## Authentication & Users

### Backend
- [x] `AuthService` - Register, login, JWT token generation
- [x] `AuthController` - POST /auth/register, POST /auth/login, GET /auth/profile (no /auth/refresh yet — see below)
- [x] `JwtStrategy` - Validate tokens on protected endpoints
- [x] Password hashing (bcrypt, cost 10)
- [x] Email validation (`@IsEmail` in RegisterDto; password 8–64 chars)
- [ ] Refresh token mechanism (single access token only)
- [x] Tests: Unit tests for auth logic (`auth.service.spec.ts`, 7 tests)

### Frontend
- [x] Login page with email/password form (`AuthScreen`)
- [x] Register page with form validation (required fields, email type, 8-char minimum password)
- [x] JWT token storage — `localStorage` via `lib/session.tsx`
- [x] Auto-redirect to login if unauthenticated (`page.tsx` renders `AuthScreen` when there is no session)
- [x] Logout functionality (`ProfileScreen`)
- [ ] Password reset flow (optional for MVP)

---

## Profiles Management

### Backend
- [x] `ProfilesService` - CRUD operations
- [x] `ProfilesController` - REST endpoints
  - [x] GET /profiles - List the caller's profiles
  - [x] GET /profiles/{id} - Get profile details
  - [x] POST /profiles - Create new profile
  - [x] PATCH /profiles/{id} - Update profile
  - [x] DELETE /profiles/{id} - Delete profile
- [x] Profile validation (unique name per user — DB unique constraint on `(userId, name)`)
- [x] Authorization (users can only access their own profiles — ownership check on every profile-scoped route, covered by `test/idor.e2e-spec.ts`)
- [x] Tests: Profile CRUD tests (`profiles.service.spec.ts`, 7 tests)

### Frontend
- [x] Profile page showing current profile (name, user email; `ProfileScreen`)
- [ ] Create new profile dialog (the session provider auto-creates one default profile on first login)
- [ ] Edit profile form
- [ ] Delete profile confirmation
- [ ] Switch between profiles (if user has multiple)

---

## Film Catalog Management

### Backend
- [x] `TitlesService` - Search (ILIKE on `titleEn`/`titleAr`), list with pagination, get by id
- [x] `TitlesController` - REST endpoints
  - [x] GET /titles - List films with pagination
  - [x] GET /titles/{id} - Get film details
  - [ ] POST /titles - Add new film (admin only) — not implemented, no admin role exists
  - [x] GET /titles/search?q={query} - Search by title
- [x] Fingerprint field on Title entity (`FilmFingerprintV1`, 13 numeric dimensions + `themes`)
- [ ] Tests: Search functionality, pagination (no `titles.service.spec.ts` yet)

### Frontend
- [x] Film search page with live (debounced) search (`DiscoverScreen`)
- [ ] Film detail view (title, year, description, fingerprint)
- [ ] Display fingerprint radar chart (optional for MVP)
- [x] No edit/delete for non-admins (there is no write UI for titles at all)

### Data Seeding
- [ ] Select 300-500 films to seed — **15 films** seeded so far (`scripts/seed.ts`)
- [x] Create migration/seed script (`npm run db:seed`)
- [ ] Manually add films via admin API (no admin API)
- [ ] Generate fingerprints (batch job) — the 15 seeded fingerprints are hand-entered placeholders, not worker output

---

## Triadic Ranking (Core Feature)

### Backend
- [x] `TriadsService` - Generate, store (scoring lives in the Python ranker, not here)
- [x] `TriadsController` - REST endpoints
  - [x] GET /profiles/{id}/triads/current - Get next triad to rank (creates one if none is active)
  - [x] POST /triads/{id}/rank - Submit ranking
  - [ ] GET /triads/{id} - Get triad details — not implemented
  - [x] GET /profiles/{id}/triads - List user's completed triads
- [x] Triad generation logic:
  - [x] Select 3 random watched, not-yet-ranked films (policy `random-v1`; each triad records `policyVersion`, `displayOrder` shuffled independently of `titleIds`, and `selectionPropensity` = 1/C(pool,3) for later off-policy evaluation)
  - [ ] Later: select films to distinguish between similar preferences (adaptive policy)
- [x] Ranking validation (ensure valid ranking [0,1,2]; rejects re-submission of a completed triad)
- [ ] "Haven't watched" / "Don't remember" replacement logic — two distinct neutral states, neither a preference signal (blueprint §2.4 principle #3, §4.3). `metadata.replacements` is reserved on the entity but nothing writes it.
- [x] Tests: Triad generation, ranking validation (`triads.service.spec.ts`, 10 tests)

### Frontend
- [x] Triadic ranking interface (3 cards visible) (`RankScreen`)
  - [ ] Film poster/title for each card, licensed poster only — no critic scores shown in the triad (blueprint §4.3). **Today: title, year, genres, description only; no poster field exists on Title yet.** No critic scores are shown, as required.
  - [x] Click to rank plus a keyboard-accessible alternative — drag-and-drop **and** ↑/↓ buttons on every card
  - [x] Visual feedback for selected ranking (position number per card)
  - [x] Submit button
  - [ ] "Haven't watched? Replace" and "Don't remember it well? Replace" as two separate buttons
- [ ] Film replacement dialog (show similar films to replace with)
- [ ] Progress indicator (X of N triads completed — N is not a fixed constant; first-value target is 3-5 triads and Alpha completion target is 20-30 triads per blueprint §17.2, exact count is an open question per blueprint Appendix C)
- [ ] Confirmation on submit (currently saves and immediately loads the next round)
- [x] Next triad automatically loads
- [ ] Tests: Ranking component behavior (no frontend test setup yet)

### Placeholder for AI Integration
- [x] Triad generation strategy (initially random)
- [ ] TODO: Connect to Python ranker (Phase 1b)
  - Compute information gain
  - Select most informative triads

---

## Preference Model Training

### Python Worker
- [x] `PlackettLuceRanker.fit()` - Train from triads (`src/training.py`, CLI `train-profile <profile-uuid>`)
  - [x] Collect all completed triads for profile (direct Postgres read via `DATABASE_URL`)
  - [x] Extract fingerprints (13 dimensions, same order as the backend)
  - [x] Run MLE optimization (BFGS, L2 regularisation; population prior term `b_i` threaded through, currently all-zero)
  - [x] Store weights in database (`user_model_snapshots`, with `pairwiseAccuracy` and `trainingTriadCount`)
- [x] `PlackettLuceRanker.predict_score()` - Score films
- [x] `compute_pairwise_accuracy()` - Validate model
- [x] Tests: MLE convergence, accuracy measurement, population-prior effect (`tests/test_ranker.py`, `tests/test_training.py`)

### Backend Integration
- [ ] `RankerService` - Wrapper around Python worker — **none; training is a manual CLI run, the backend never invokes Python**
- [ ] Job queue integration:
  - [ ] Trigger retraining after each N triads (e.g., every 5)
  - [x] Store trained weights in `user_model_snapshots` (written by the Python CLI directly)
  - [ ] Handle job failures gracefully
- [ ] Cache user weights in Redis (Redis container runs; nothing in the backend uses it)
- [ ] Tests: Model storage and retrieval (only the read side is covered, in `recommendations.service.spec.ts`)

---

## Recommendations Generation

### Backend
- [x] `RecommendationsService` - Score and rank films
- [x] `RecommendationsController`
  - [x] GET /profiles/{id}/recommendations - Get top N recommendations (`?limit=`); returns 409 until a model snapshot exists
  - [ ] POST /recommendations/{id}/feedback - Log user feedback
- [x] Scoring logic:
  - [x] Load user's preference weights (latest `user_model_snapshots` row; rejects dimension mismatch)
  - [x] Compute Personal Fit, Public Quality, and Watchability separately (blueprint §4.4 — never merge into one score). **Personal Fit is computed; Public Quality and Watchability are returned as explicit `null` because no data source for either exists yet.**
  - [ ] Sort candidates by Personal Fit within each of the three tracks (safe / discovery / outside-usual) — every result is `track: 'safe'` today; no discovery/outside-usual policy exists
  - [x] Filter (already watched / not_watched, titles without a fingerprint)
  - [x] Return top N with a confidence BAND (Initial/Likely/Strong/Inconclusive), not a raw percentage (blueprint §7.2, §9.3). **The band is a provisional heuristic on `trainingTriadCount`, not the calibrated system blueprint §16.2 requires.**
- [ ] Cache invalidation after triad ranking (no cache yet)
- [x] Tests: Recommendation scoring (`recommendations.service.spec.ts`, 9 tests)

### Frontend
- [ ] Recommendations page — `ListScreen` renders a flat title+description list when recommendations exist, and a translated "not trained yet / empty / error" message otherwise. Not yet:
  - [ ] Grouped by safe / discovery / outside-usual
  - [ ] Show Personal Fit, Public Quality, and Watchability as three separate values, plus confidence band
  - [ ] Show top reasons (dimensions that drove recommendation), no-spoiler
  - [ ] Show similar films
  - [ ] "Add to watchlist" button
  - [ ] "Not relevant to me" dismiss action, logged as an outcome event only — no thumbs-up/down or star rating: the blueprint's only explicit preference question, permanently, is the triad ranking (blueprint §2.4 principle #2, §4.5)
- [ ] Clickable dimensions to learn more
- [ ] Tests: Recommendations rendering

### Explanation Module (Optional for MVP)
- [ ] `ExplanationService` - Call OpenAI for natural language explanation (`enrichment.py` has an unused `generate_recommendation_explanation`; nothing calls it)
- [ ] Template for explanation (no LLM needed initially)
- [ ] Example: "You enjoy psychological dramas with complex narratives. Interstellar matches your taste for narrative ambiguity and complexity." (no bare numeric feature score shown to the user — explanations describe the evidence qualitatively; a calibrated percentage is never shown pre-calibration, blueprint §7.2, §9.4)

---

## User State Management

### Backend
- [x] `UserTitleStateService` - Manage watched/watchlist/interested
- [x] Controller endpoints:
  - [x] PATCH /profiles/{id}/titles/{titleId}/state - Update state
  - [x] GET /profiles/{id}/watched-titles - List watched
  - [x] GET /profiles/{id}/watchlist - List watchlist
- [x] States: watched, not_watched, watchlist, interested
- [x] No in-app rating: the PATCH endpoint cannot write a rating. `importedRating` + `ratingSource: 'import'` exist for a future list-import path only (blueprint §2.4 principle #2, §4.5; migration `SplitImportedRatingFromInAppState`)
- [x] Tests: State transitions (`user-title-state.service.spec.ts`, 5 tests)

### Frontend
- [x] Mark films as watched (`DiscoverScreen`)
- [ ] Mark films as not watched
- [ ] Add to watchlist
- [x] View watch history (`ListScreen`, "Watched films")
- [ ] Integrate with search results (show state) — Discover only remembers clicks made in the current session; it does not load existing states on mount

---

## Admin Dashboard (Optional for MVP)

### Backend
- [ ] `AdminService` - Model inspection
- [ ] `AdminController`
  - [ ] GET /admin/models/{profileId} - Get model weights
  - [ ] GET /admin/triads/latest - View recent rankings
  - [ ] GET /admin/recommendations/test - Test recommendation engine
  - [ ] GET /admin/films/missing-fingerprints - Films without fingerprints
- [ ] Authorization: Admin role only (no roles exist)

### Frontend
- [ ] Admin login with elevated privileges
- [ ] Model weights visualization (bar chart)
- [ ] Recent rankings feed
- [ ] Test recommendation scoring
- [ ] Film seeding UI (add/import films)

---

## Testing & Quality Assurance

### Unit Tests
- [x] Auth logic (login, token validation)
- [x] Ranker accuracy (Plackett-Luce on synthetic data)
- [x] Recommendation scoring
- [x] State transitions (watched/not-watched)

### API Tests (Backend)
`test/idor.e2e-spec.ts` runs over real HTTP against the disposable `postgres-test` container
(`npm run test:e2e`). It proves the auth guard (401 without a token) and that every
profile-scoped route rejects another user's profile — profiles CRUD, triads, recommendations,
title state, watchlist. It is **not** functional coverage of the endpoints themselves:
- [ ] Auth endpoints (register, login) — register is exercised as setup; login is unit-tested only
- [ ] Profile CRUD — ownership/404 paths only
- [ ] Titles search and pagination
- [ ] Triads generation and ranking — ownership only
- [ ] Recommendations generation — ownership only

### E2E Tests (Frontend)
- [ ] Complete ranking flow (login → rank 5 triads → view recommendations) — done **manually** on 2026-09-03, not automated
- [ ] Film search and viewing
- [ ] State management (watch/unwatched)

### Manual Testing
- [x] Triadic ranking interface feels responsive (browser pass 2026-09-03: load, reorder, save, next round)
- [ ] Recommendations update after ranking — not verified; no training run has been done against a real profile yet
- [ ] No N+1 queries in database (`RankScreen` fetches each of the 3 titles with a separate GET /titles/{id})
- [ ] Performance with 100+ films, 50+ rankings

---

## Database & Infrastructure

### PostgreSQL
- [x] Create all tables from schema.md (3 migrations: InitialSchema, AddTriadEventFields, SplitImportedRatingFromInAppState)
- [ ] Add indexes for performance — only primary keys and unique constraints exist, no explicit indexes
- [ ] Test on 1000s of titles, 100s of triads
- [ ] Backup strategy

### Redis
- [ ] Cache user preference weights
- [ ] Session storage
- [ ] (Future: Job queue with BullMQ)

### Docker
- [x] Verify PostgreSQL + pgvector builds (`ankane/pgvector`, healthy)
- [x] Verify Redis builds (healthy; unused by the app so far)
- [x] docker-compose.yml tested locally (dev `postgres` on host port 5433, `postgres-test` on 5544)
- [x] Environment variable substitution works (compose defaults + `.env`)

---

## Film Fingerprinting (Phase 1b - After MVP Core Works)

### Backend
- [ ] Fingerprinting job processor
- [ ] Queue fingerprinting for new films
- [ ] Store fingerprint in title.fingerprint field (column exists; nothing writes worker output into it yet)
- [ ] Handle OpenAI errors gracefully

### Python Worker
- [x] `FilmEnrichmentWorker.generate_fingerprint()` (`src/enrichment.py`)
- [x] Call OpenAI with schema enforcement (structured output, `response_format=FilmFingerprintV1`)
- [ ] Batch processing capability
- [ ] Retry logic for failed API calls

### Seeding
- [ ] Fingerprint 300-500 films (can be manual initially)
- [ ] Verify fingerprint schema correctness
- [ ] Store model version used

---

## Deployment Preparation

### Local Development ✅
- [x] Docker Compose setup
- [x] npm dev working (`npm run dev` starts both apps; backend on :3101 under `/api`, frontend on :3000)

### Staging (Pre-Launch)
- [ ] Deploy backend to staging environment
- [ ] Deploy frontend to staging
- [ ] Database migrations tested (applied locally only)
- [ ] Environment variables configured
- [x] CORS properly configured (origin from `FRONTEND_URL`, default `http://localhost:3000`, credentials on)
- [x] Rate limiting enabled (global `ThrottlerGuard`, 60 requests / 60 s)
- [ ] Logging configured (Nest default logger only)

### Production (Post-MVP Validation)
- [ ] Choose hosting platform (Vercel, Lambda, etc.)
- [ ] Database backup strategy
- [ ] Monitoring and alerting
- [ ] API rate limiting and DDoS protection
- [ ] SSL/TLS certificates
- [ ] Error tracking (Sentry, etc.)

---

## Privacy & Compliance

### Data Privacy
- [x] Privacy policy drafted (docs/privacy.md)
- [ ] Terms of Service drafted
- [ ] Consent flow implemented
- [ ] Data export endpoint working
- [ ] Data deletion endpoint working (DELETE /profiles/{id} cascades a profile's data; no account-level deletion)
- [ ] Audit logging enabled

### Saudi Arabia PDPL
- [ ] Privacy impact assessment completed
- [ ] Data Protection Officer identified
- [ ] Breach response plan drafted
- [ ] Regulatory review before launch

---

## Metrics & Success Criteria

### Alpha Success Metrics (80-150 users, blueprint §17.2 — 15-20 is the earlier Phase 0 UX-prototype cohort, not this gate)
- [ ] Majority of accepters complete 20-30 triads across short sessions
- [ ] "Haven't watched" + "not remembered" replacement rate stays low enough not to degrade triad reliability (exact threshold set experimentally, not fixed here)
- [ ] Model beats the best simpler baseline (popularity ranking, genre similarity, etc.) by a statistically significant margin — treat "60-65% pairwise accuracy" as an illustrative starting point only, per blueprint §16.5
- [ ] Average session duration and dropout no worse than a non-adaptive baseline triad policy

### Data Quality
- [ ] No corrupted triads in database
- [ ] Preference weights converge (loss decreases)
- [ ] No duplicate films in triads (guaranteed by construction in `random-v1`, not yet checked on real data)
- [ ] Replacement logic works correctly (not built)

---

## Nice-to-Haves (Post-MVP)

- [ ] Recommendation explanations (OpenAI)
- [ ] Radar chart visualization of fingerprints
- [ ] Film recommendations by genre
- [ ] Collaborative filtering hints
- [ ] Email notifications
- [ ] Social sharing (future)
- [ ] Mobile app (Expo)

---

## Launch Readiness Checklist

- [ ] All Phase 1 core features working (core loop works locally; replacement buttons, training trigger, and recommendation UI are missing)
- [ ] Database schema tested
- [ ] 300-500 films seeded with fingerprints (15 hand-entered)
- [ ] Plackett-Luce ranker trained and validated (unit-tested on synthetic data only)
- [ ] 80-150 Alpha users onboarded (blueprint §17.2); accepters complete 20-30 triads
- [ ] No critical bugs in testing
- [ ] Documentation complete
- [ ] Privacy policy reviewed
- [ ] PDPL compliance verified
- [ ] OpenAI API integration tested
- [ ] Rate limiting and security measures in place

---

**Last Updated**: 2026-09-03  
**Status**: In Progress — the core loop (auth → mark watched → rank triads → train → recommend) exists end-to-end and runs locally; training is still a manual CLI step  
**Next Milestone**: "Haven't watched" / "Don't remember" replacement (API + two UI buttons), automatic retraining trigger from the backend, and growing the catalog toward 300-500 titles with worker-generated fingerprints
