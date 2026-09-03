# Privacy, Data Protection and Security Controls

**Status**: Derived from blueprint `§21.1` (privacy principles), `§21.3` (threat model), `§13.1` (`consents`, `privacy_requests`), `§14` (privacy endpoints), `§7.5` (pooled training as a distinct purpose), `§15.2`–`§15.3` (LLM data rules). Decisions: ADR-7, ADR-9, ADR-23, ADR-24, ADR-26.
**Not legal advice.** The controlling law is the Saudi Personal Data Protection Law (PDPL) and its Implementing Regulations (`BP App. D` [م20], [م21]). Every "verify with counsel" note below is a real pre-launch task (`BP` Gate 4, `App. B`).
**Version**: 2.0 — 2026-09-03.

---

## 1. Principles we implement (`BP §21.1`)

1. Account identity is separated from the pseudonymous taste id (`profiles.id`); model and event tables never reference `users` directly (ADR-7).
2. Processing purposes are explicit; data is minimized; retention is limited (§9).
3. Encryption in transit and at rest; fine-grained permissions; access and audit logs (§7).
4. Export, delete, reset taste, and correction of source data are product features (§5).
5. Profiles are private by default; sharing is explicit and selective (nothing public in MVP).
6. **Hard ban** on inferring or displaying sensitive traits — religion, politics, sexual orientation, health — from watch history or rankings. This is enforced in explanation rules (`BP §9.4`), in the theme vocabulary (`BP §6.1` "Theme" row), and in review.
7. No sale of an individual taste profile; no vague secondary use.
8. Adults only in MVP; children's accounts need a separate consent and protection design.

## 2. Data inventory

| Data | Purpose | Basis (consent purpose id, §3) | Retention (§9) | Where |
|---|---|---|---|---|
| Email, password hash, name | account, login, security | `terms_privacy` | until account deletion | `users` |
| UI language, market, platforms | display and availability only — never taste | `terms_privacy` | until deletion | `profiles` |
| Watched / not-watched / watchlist state, watch events (time, edition, audio, subtitles, provider) | personalization; Watchability | `watch_history` | until deletion/reset | `user_title_states`, `watch_events` |
| Imported lists (raw file, parsed rows, imported ratings) | populate watch history | `import_processing` | raw file deleted after parsing; rows until deletion/reset | object storage (temporary), `library_imports`, `watch_events` |
| Triad events, replacements | individual taste model | `personalization_individual` | until deletion/reset | `triads`, `triad_replacements` |
| Triad events pooled across profiles | shared latent space (`BP §7.5`) | `personalization_pooled` (separate, opt-out) | until deletion/reset; excluded from the next retrain on opt-out | read from `triads` by the batch job; no copy |
| Model snapshots, taste profile | serving recommendations, explanations | `personalization_individual` | regenerated; old snapshots pruned per §9 | `user_model_snapshots` |
| Recommendations shown, outcomes | closing the loop, evaluation | `personalization_individual` | 24 months then aggregated | `recommendations`, `outcomes` |
| Consents, privacy requests | compliance record | legal obligation | permanent (tombstone after deletion) | `consents`, `privacy_requests` |
| Audit log (actor, action, resource, hashed IP) | security, compliance | legitimate interest / legal obligation | per §9 | `audit_log` |
| Server/request logs | operations, abuse prevention | legitimate interest | 30 days | logging platform |
| First-party product analytics (event trail, `requestId`) | evaluation (`BP §16`) | `analytics_first_party` | 24 months | analytics store |

Not collected: precise location, device fingerprints or tracking cookies, third-party advertising identifiers, biometrics, health data, IP beyond request logs. Not inferred: anything in principle 6.

## 3. Consent model (`BP §13.1`)

Purposes are a closed list; each has a version (the text the user saw). A `consents` row is written per (user, purpose, version) with `granted`/`revokedAt`.

| Purpose id | When asked | Copy must disclose | Can be declined? |
|---|---|---|---|
| `terms_privacy` | registration | terms, privacy notice, account processing | no (required to use the service) |
| `watch_history` | onboarding | storing watched/not-watched/watchlist and watch details | no for the core loop (the product cannot work without it); declining = do not proceed |
| `personalization_individual` | onboarding | rankings train a model **about you** used only for your profile | no for the core loop |
| `personalization_pooled` | onboarding, default on with clear copy | your pseudonymous rankings also help train a **shared population model** that improves candidate and triad selection for everyone; never shown to others; opt-out keeps your individual personalization | **yes** — sets restriction `no_pooled` |
| `import_processing` | at import time | file type/size checks, parsing, deletion of the raw file, imported ratings kept as low-confidence auxiliary data | yes (skip import) |
| `analytics_first_party` | onboarding | product analytics on our own systems only | yes |
| later: `email_recommendations`, `taste_card_sharing` | feature activation | separate assessment before rollout | yes |

Rule: no purpose is bundled into another; changing a purpose's text bumps its version and re-asks.

## 4. Restrictions

`PUT /api/v1/consents` (see [API.md](API.md)) supports:

- `no_pooled` — revokes `personalization_pooled`; the profile's triads are excluded from the next shared-space retrain; the individual model is unchanged.
- `pause_all` — sets `profiles.pausedAt`; training and recommendations stop; data is retained until the user deletes, resets or resumes.

## 5. User rights (`BP §14`, `§21.1`)

| Right | Endpoint | Behaviour |
|---|---|---|
| Access / portability | `POST /api/v1/privacy/export` → status → artifact | JSON (and CSV for lists): account, profiles, consents, watch history, triads and replacements, model snapshots (weights per feature key), recommendations shown and outcomes, timestamps; identity re-verification before delivery |
| Correction | source-data correction via support/admin; taste corrections via a new linked triad event (`BP §13.2`); watch state via `POST /watch-events` | originals are never edited in place |
| Erasure | `POST /api/v1/privacy/delete` | announced safety period (configurable, disclosed in the notice), then purge of account, profiles (cascade: events, snapshots, recommendations, outcomes), derived data, and export artifacts; backups expire on their schedule (§10); tombstone in `audit_log`/`privacy_requests` |
| Reset taste | `POST /api/v1/privacy/reset` | deletes triads, replacements, snapshots, recommendations, outcomes for the profile; keeps account, consents, watch history unless also requested |
| Restrict | `no_pooled`, `pause_all` | §4 |
| Object to automated decisions | — | recommendations are suggestions; no access, content or feature is blocked by an automated decision; the user always has override and dismissal |

None of these endpoints exist yet — see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## 6. Third-party processors

### 6.1 Anthropic (enrichment and explanation rephrasing) — ADR-23 rules, provider chosen 2026-09-03

The LLM provider is Anthropic's Messages API (owner's decision, recorded in [DEMO_DATA_PLAN_2026-09-03.md](DEMO_DATA_PLAN_2026-09-03.md) §8 pending its ADR number); the rules below are ADR-23's, unchanged, applied to it.

- Only film evidence we have rights to derive from and the schema are sent. **Never** sent: user ids, emails, rankings, preferences, watch history, profile text. Explanations are rephrased from an evidence payload of film features, not from user data.
- The Messages API has no per-request "do not store" flag: retention is governed by the organization's data-retention configuration with the provider. Request zero-data-retention for the organization where eligible — note that some model tiers require a retention period and are unavailable under ZDR — and document the configured retention in the notice. Verify current terms before launch (`BP App. D` [م23] is the OpenAI-era reference; add the provider's data-controls page to App. D).
- A data processing agreement with the provider is in the pre-launch checklist even though no personal data is intended to flow, as a control against accidental leakage.
- Model ids are configuration (`ANTHROPIC_FINGERPRINT_MODEL`, `ANTHROPIC_EXPLANATION_MODEL`); every published fingerprint records the model id the API actually served in `modelVersion` and the pipeline version in `extractorVersion`. A refusal by the model is a human-review item, never silently re-routed to another model.

### 6.2 Catalog and availability providers

Provider data is content data, not personal data. Contracts are tracked in [DATA_LICENSING.md](DATA_LICENSING.md). No user data is sent to providers.

### 6.3 Infrastructure

Hosting is undecided (ADR-24). Requirements: DPA with the provider; encryption at rest; regional data residency (§8); access logging.

## 7. Security controls (`BP §21.3`)

| Surface | Control |
|---|---|
| Account | bcrypt passwords; auth throttling (5/min); JWT with refresh before Alpha; optional MFA later; session alerts |
| API | object-level authorization on every profile route (e2e IDOR suite runs on every change); global rate limit; strict DTO whitelisting; `Idempotency-Key`; `requestId` on every request; audit log |
| Import | type/size validation, sandboxed parsing, raw file deletion, least-privilege storage |
| Staff | RBAC (`users.role`), separation of duties, just-in-time access, audit trail for every admin action |
| Models | data minimization, membership-inference evaluation, no identity in prompts, isolation of the model service |
| Deletion | traceable workflow, tombstones, declared backup policy |
| Transport/storage | TLS everywhere; encryption at rest; secrets in a manager, never in the repo (`.env` is git-ignored) |

## 8. Data residency and transfers

Preferred: store and process personal data in Saudi Arabia or the region. Any transfer outside the Kingdom (e.g. a cloud region abroad, or the LLM provider — which should receive no personal data) must satisfy the PDPL's cross-border transfer provisions and SDAIA's transfer regulations, with a DPA, encryption, audit rights, and disclosure in the privacy notice. **Verify with counsel** before choosing a region.

## 9. Retention schedule

| Data | Retention | Then |
|---|---|---|
| Account and profiles | life of the account | purge on deletion after the safety period |
| Triads, replacements, watch events | life of the profile | purge on deletion/reset |
| Model snapshots | latest N per profile (N set by the model service; older pruned) | purge on deletion/reset |
| Recommendations, outcomes | 24 months | aggregate, then purge |
| Raw import files | until parsed (hours) | deleted |
| Export artifacts | 7 days after delivery | deleted |
| Request/server logs | 30 days | purged |
| Audit log | 12 months online, then archived per legal advice | — |
| Consents, privacy requests | permanent record without personal data after deletion | — |
| Backups | provider schedule, documented in the notice | expire; restore drill documented (`BP §18.1`) |

## 10. Deletion flow

```
request → identity re-verification → privacy_requests(scheduled, executeAfter = now + safety period)
 → user notified, can cancel until executeAfter
 → job: purge users → profiles cascade → derived data → export artifacts
 → tombstone (no personal data) in audit_log + privacy_requests(done)
 → backups expire per §9; a restored backup replays pending deletions before serving
```

## 11. Breach response

1. Detect and contain; preserve evidence.
2. Notify SDAIA within the period required by the Implementing Regulations (currently 72 hours from awareness — verify current text) and affected users without undue delay when there is a risk of harm.
3. Remediate: patch, rotate secrets/API keys, force password resets where relevant.
4. Document root cause and prevention; run the incident review in the quarterly privacy/risk meeting (`BP §19.3`).

## 12. Automated decision-making transparency

Users see: which model version produced a recommendation, the top features that drove it (with `evidenceSource`), a verbal confidence band (never an uncalibrated percentage), and a "not relevant" control. No decision affecting access or eligibility is automated.

## 13. Pre-launch privacy checklist (`BP App. B`, Gate 4)

- [ ] Privacy notice, purposes, retention and consents reviewed by local counsel
- [ ] Privacy impact assessment for the recommendation system and pooled training
- [ ] Data Protection Officer or external consultant designated (`BP §19.1` legal/privacy role)
- [ ] Consent flow implemented and tested (all purposes in §3)
- [ ] Export, delete, reset tested end-to-end (`BP §18.1`)
- [ ] Audit logging enabled; admin access least-privilege
- [ ] Encryption in transit and at rest verified; secrets manager in place
- [ ] DPAs with hosting and LLM providers; region decided (§8)
- [ ] Backup restore drill and incident response exercise documented
- [ ] Sensitive-trait ban verified in explanation templates and theme vocabulary

## 14. Contacts

Placeholders until appointed: privacy inquiries `privacy@<domain>`; DPO `dpo@<domain>`; response target 7 business days.

---

**Changelog**
- 2.0 (2026-09-03): rewritten. Removed a fabricated OpenAI header (`openai-internal-store`) and a hard-coded model name, the "30-day breach notification" contradiction, non-`/v1` endpoint paths, and the `not_remembered` title state; added the closed consent-purpose list with pooled training as its own purpose, restriction semantics, retention schedule and deletion flow aligned with [SCHEMA.md](SCHEMA.md) and [API.md](API.md).
