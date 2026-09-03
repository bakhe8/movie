# Phase 1 Implementation Checklist

## Project Setup ✅ COMPLETED
- [x] Monorepo structure (Next.js, NestJS, Python workers, shared types)
- [x] Database schema defined (PostgreSQL with pgvector)
- [x] Docker Compose for PostgreSQL + Redis
- [x] Environment configuration template
- [x] Documentation (architecture, schema, privacy, quickstart)
- [x] Plackett-Luce ranker implementation (Python)
- [x] OpenAI fingerprinting worker implementation (Python)
- [x] Shared TypeScript types package
- [x] Makefile with common commands

---

## Authentication & Users

### Backend
- [ ] `AuthService` - Register, login, JWT token generation
- [ ] `AuthController` - POST /auth/register, POST /auth/login, POST /auth/refresh
- [ ] `JwtStrategy` - Validate tokens on protected endpoints
- [ ] Password hashing (bcrypt or argon2)
- [ ] Email validation
- [ ] Refresh token mechanism
- [ ] Tests: Unit tests for auth logic

### Frontend
- [ ] Login page with email/password form
- [ ] Register page with form validation
- [ ] JWT token storage (localStorage or httpOnly cookie)
- [ ] Auto-redirect to login if unauthenticated
- [ ] Logout functionality
- [ ] Password reset flow (optional for MVP)

---

## Profiles Management

### Backend
- [ ] `ProfilesService` - CRUD operations
- [ ] `ProfilesController` - REST endpoints
  - [ ] GET /profiles/{id} - Get profile details
  - [ ] POST /profiles - Create new profile
  - [ ] PATCH /profiles/{id} - Update profile
  - [ ] DELETE /profiles/{id} - Delete profile
- [ ] Profile validation (unique name per user)
- [ ] Authorization (users can only access their own profiles)
- [ ] Tests: Profile CRUD tests

### Frontend
- [ ] Profile page showing current profile
- [ ] Create new profile dialog
- [ ] Edit profile form
- [ ] Delete profile confirmation
- [ ] Switch between profiles (if user has multiple)

---

## Film Catalog Management

### Backend
- [ ] `TitlesService` - Search, CRUD
- [ ] `TitlesController` - REST endpoints
  - [ ] GET /titles - List films with pagination
  - [ ] GET /titles/{id} - Get film details
  - [ ] POST /titles - Add new film (admin only)
  - [ ] GET /titles/search?q={query} - Search by title
- [ ] Fingerprint field on Title entity
- [ ] Tests: Search functionality, pagination

### Frontend
- [ ] Film search page with autocomplete
- [ ] Film detail view (title, year, description, fingerprint)
- [ ] Display fingerprint radar chart (optional for MVP)
- [ ] No edit/delete for non-admins

### Data Seeding
- [ ] Select 300-500 films to seed
- [ ] Create migration/seed script
- [ ] Manually add films via admin API
- [ ] Generate fingerprints (batch job)

---

## Triadic Ranking (Core Feature)

### Backend
- [ ] `TriadsService` - Generate, store, score
- [ ] `TriadsController` - REST endpoints
  - [ ] GET /profiles/{id}/triads/current - Get next triad to rank
  - [ ] POST /triads/{id}/rank - Submit ranking
  - [ ] GET /triads/{id} - Get triad details
  - [ ] GET /profiles/{id}/triads - List user's completed triads
- [ ] Triad generation logic:
  - [ ] Select 3 random unranked films initially
  - [ ] Later: select films to distinguish between similar preferences
- [ ] Ranking validation (ensure valid ranking [0,1,2])
- [ ] "Haven't watched" / "Don't remember" replacement logic — two distinct neutral states, neither a preference signal (blueprint §2.4 principle #3, §4.3)
- [ ] Tests: Triad generation, ranking validation

### Frontend
- [ ] Triadic ranking interface (3 cards visible)
  - [ ] Film poster/title for each card, licensed poster only — no critic scores shown in the triad (blueprint §4.3)
  - [ ] Click to rank (1st → 2nd → 3rd), plus a keyboard-accessible alternative to drag/click for RTL clarity
  - [ ] Visual feedback for selected ranking
  - [ ] Submit button
  - [ ] "Haven't watched? Replace" and "Don't remember it well? Replace" as two separate buttons
- [ ] Film replacement dialog (show similar films to replace with)
- [ ] Progress indicator (X of N triads completed — N is not a fixed constant; first-value target is 3-5 triads and Alpha completion target is 20-30 triads per blueprint §17.2, exact count is an open question per blueprint Appendix C)
- [ ] Confirmation on submit
- [ ] Next triad automatically loads
- [ ] Tests: Ranking component behavior

### Placeholder for AI Integration
- [ ] Triad generation strategy (initially random)
- [ ] TODO: Connect to Python ranker (Phase 1b)
  - Compute information gain
  - Select most informative triads

---

## Preference Model Training

### Python Worker
- [ ] `PlackettLuceRanker.fit()` - Train from triads
  - [ ] Collect all completed triads for user
  - [ ] Extract fingerprints
  - [ ] Run MLE optimization
  - [ ] Store weights in database
- [ ] `PlackettLuceRanker.predict_score()` - Score films
- [ ] `compute_pairwise_accuracy()` - Validate model
- [ ] Tests: MLE convergence, accuracy measurement

### Backend Integration
- [ ] `RankerService` - Wrapper around Python worker
- [ ] Job queue integration:
  - [ ] Trigger retraining after each N triads (e.g., every 5)
  - [ ] Store trained weights in `user_model_snapshots`
  - [ ] Handle job failures gracefully
- [ ] Cache user weights in Redis
- [ ] Tests: Model storage and retrieval

---

## Recommendations Generation

### Backend
- [ ] `RecommendationsService` - Score and rank films
- [ ] `RecommendationsController`
  - [ ] GET /profiles/{id}/recommendations - Get top N recommendations
  - [ ] POST /recommendations/{id}/feedback - Log user feedback
- [ ] Scoring logic:
  - [ ] Load user's preference weights
  - [ ] Compute Personal Fit, Public Quality, and Watchability separately for all unwatched films (blueprint §4.4 — never merge into one score)
  - [ ] Sort candidates by Personal Fit within each of the three tracks (safe / discovery / outside-usual)
  - [ ] Filter (already watched, etc.)
  - [ ] Return top 10 with a confidence BAND (Initial/Likely/Strong/Inconclusive), not a raw percentage (blueprint §7.2, §9.3)
- [ ] Cache invalidation after triad ranking
- [ ] Tests: Recommendation scoring

### Frontend
- [ ] Recommendations page
  - [ ] Display top recommendations (10), grouped by safe / discovery / outside-usual
  - [ ] Show Personal Fit, Public Quality, and Watchability as three separate values, plus confidence band
  - [ ] Show top reasons (dimensions that drove recommendation), no-spoiler
  - [ ] Show similar films
  - [ ] "Add to watchlist" button
  - [ ] "Not relevant to me" dismiss action, logged as an outcome event only — no thumbs-up/down or star rating: the blueprint's only explicit preference question, permanently, is the triad ranking (blueprint §2.4 principle #2, §4.5)
- [ ] Clickable dimensions to learn more
- [ ] Tests: Recommendations rendering

### Explanation Module (Optional for MVP)
- [ ] `ExplanationService` - Call OpenAI for natural language explanation
- [ ] Template for explanation (no LLM needed initially)
- [ ] Example: "You enjoy psychological dramas with complex narratives. Interstellar matches your taste for narrative ambiguity and complexity." (no bare numeric feature score shown to the user — explanations describe the evidence qualitatively; a calibrated percentage is never shown pre-calibration, blueprint §7.2, §9.4)

---

## User State Management

### Backend
- [ ] `UserTitleStateService` - Manage watched/watchlist/interested
- [ ] Controller endpoints:
  - [ ] PATCH /profiles/{id}/titles/{titleId}/state - Update state
  - [ ] GET /profiles/{id}/watched-titles - List watched
  - [ ] GET /profiles/{id}/watchlist - List watchlist
- [ ] States: watched, not_watched, watchlist, interested
- [ ] Tests: State transitions

### Frontend
- [ ] Mark films as watched/not watched
- [ ] Add to watchlist
- [ ] View watch history
- [ ] Integrate with search results (show state)

---

## Admin Dashboard (Optional for MVP)

### Backend
- [ ] `AdminService` - Model inspection
- [ ] `AdminController`
  - [ ] GET /admin/models/{profileId} - Get model weights
  - [ ] GET /admin/triads/latest - View recent rankings
  - [ ] GET /admin/recommendations/test - Test recommendation engine
  - [ ] GET /admin/films/missing-fingerprints - Films without fingerprints
- [ ] Authorization: Admin role only

### Frontend
- [ ] Admin login with elevated privileges
- [ ] Model weights visualization (bar chart)
- [ ] Recent rankings feed
- [ ] Test recommendation scoring
- [ ] Film seeding UI (add/import films)

---

## Testing & Quality Assurance

### Unit Tests
- [ ] Auth logic (login, token validation)
- [ ] Ranker accuracy (Plackett-Luce on synthetic data)
- [ ] Recommendation scoring
- [ ] State transitions (watched/not-watched)

### API Tests (Backend)
- [ ] Auth endpoints (register, login)
- [ ] Profile CRUD
- [ ] Titles search and pagination
- [ ] Triads generation and ranking
- [ ] Recommendations generation

### E2E Tests (Frontend)
- [ ] Complete ranking flow (login → rank 5 triads → view recommendations)
- [ ] Film search and viewing
- [ ] State management (watch/unwatched)

### Manual Testing
- [ ] Triadic ranking interface feels responsive
- [ ] Recommendations update after ranking
- [ ] No N+1 queries in database
- [ ] Performance with 100+ films, 50+ rankings

---

## Database & Infrastructure

### PostgreSQL
- [ ] Create all tables from schema.md
- [ ] Add indexes for performance
- [ ] Test on 1000s of titles, 100s of triads
- [ ] Backup strategy

### Redis
- [ ] Cache user preference weights
- [ ] Session storage
- [ ] (Future: Job queue with BullMQ)

### Docker
- [ ] Verify PostgreSQL + pgvector builds
- [ ] Verify Redis builds
- [ ] docker-compose.yml tested locally
- [ ] Environment variable substitution works

---

## Film Fingerprinting (Phase 1b - After MVP Core Works)

### Backend
- [ ] Fingerprinting job processor
- [ ] Queue fingerprinting for new films
- [ ] Store fingerprint in title.fingerprint field
- [ ] Handle OpenAI errors gracefully

### Python Worker
- [ ] `FilmEnrichmentWorker.generate_fingerprint()`
- [ ] Call OpenAI Responses API with schema enforcement
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
- [x] npm dev working

### Staging (Pre-Launch)
- [ ] Deploy backend to staging environment
- [ ] Deploy frontend to staging
- [ ] Database migrations tested
- [ ] Environment variables configured
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] Logging configured

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
- [ ] Data deletion endpoint working
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
- [ ] No duplicate films in triads
- [ ] Replacement logic works correctly

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

- [ ] All Phase 1 core features working
- [ ] Database schema tested
- [ ] 300-500 films seeded with fingerprints
- [ ] Plackett-Luce ranker trained and validated
- [ ] 80-150 Alpha users onboarded (blueprint §17.2); accepters complete 20-30 triads
- [ ] No critical bugs in testing
- [ ] Documentation complete
- [ ] Privacy policy reviewed
- [ ] PDPL compliance verified
- [ ] OpenAI API integration tested
- [ ] Rate limiting and security measures in place

---

**Last Updated**: 2025-01-02  
**Status**: In Progress  
**Next Milestone**: Complete backend core endpoints (auth, profiles, triads)
