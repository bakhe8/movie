# Privacy & Data Compliance

## Overview

This document outlines privacy commitments and compliance measures for the Movie Recommendation System, with special attention to Saudi Arabia's Personal Data Protection Law (PDPL).

> See [movie_taste_platform_blueprint_ar.md](movie_taste_platform_blueprint_ar.md) §21 for the authoritative privacy principles this document must implement, including: account identity kept separate from a pseudonymous taste id; no selling of an individual's taste profile and no vague secondary use; and an explicit ban on inferring or surfacing sensitive traits (religion, politics, orientation, health) from watch/ranking behavior, not just a promise not to collect them directly.

## Legal Framework

### Saudi Arabia PDPL Requirements
- [Official PDPL Portal](https://dgp.sdaia.gov.sa/)
- Clear purpose statement for data processing
- Explicit consent for each processing activity
- Right to access, correction, deletion, and portability
- Impact assessments for automated decision-making
- Data Protection Officer contact information

### Global Privacy Standards
- GDPR principles (lawfulness, transparency, data minimization)
- Data retention limits
- Privacy by design

## Data Collection Principles

### What We Collect (MVP Phase 1)
1. **User Account Data**
   - Email, password (hashed with bcrypt/argon2)
   - First/last name (optional)
   - Language preference (ar/en)

2. **Taste Preference Data**
   - Triadic rankings (which film user ranked higher)
   - Watched/not-watched status
   - Watchlist items
   - Generated preference weights

3. **System Data**
   - API call logs (for 30 days per OpenAI default)
   - Session IDs (anonymized)
   - Timestamps

### What We DON'T Collect, and Never Infer (MVP Phase 1)
- Personal location data
- Device identifiers or tracking cookies
- IP addresses beyond request logging
- Religious, political, or sexual-orientation inference — this is a hard ban on *inferring or surfacing* these from watch history and rankings, not merely a promise not to ask for them directly (blueprint §21.1)
- Health data
- Biometric data

## User Consent Model

### Tiered Consent Flow

```
1. Account Creation
   ├── Core consent: "I agree to Terms & Privacy Policy"
   │   └── Covers: account management, authentication
   │
2. First Login
   ├── Purpose-specific consent (separate toggles, scoped to what MVP Phase 1
   │   │  actually implements — see "Exclusions from MVP" below)
   │   ├── [x] Use my rankings to improve recommendations — copy must disclose that
   │   │       this includes my pseudonymous ranking patterns contributing to a
   │   │       pooled model shared across profiles (blueprint §7.5), not only a
   │   │       model trained on my own rankings alone; opt out via `no_collaborative`
   │   │       (see "Right to Restrict Processing") without losing personalization
   │   │       from your own individual rankings
   │   └── [x] Store my watched list for personalization
   │
3. Feature Activation (Future — not built in Phase 1; toggle appears when shipped)
   ├── "Include my taste profile in aggregated, anonymized trend analysis" - cross-user use
   ├── "Send me recommendations via email"
   ├── "Share your profile" - collaborative filtering
   ├── "Export data" - download my preferences
   └── "AI explanations" - use my data for natural language explanations
```

**Implementation:**
```typescript
// Backend endpoint for consent management
POST /api/users/{id}/consents
{
  consentType: 'ranking_personalization' | 'watchlist' | 'collaborative' | 'ai_explanation',
  granted: boolean,
  timestamp: Date
}
```

## Data Minimization

### Profile Separation
- **No family accounts** - each person gets individual profile
- **Reason**: Prevents conflation of different taste preferences; clearer data attribution

### Ranking Events (Not Aggregated Profiles)
- Store **raw triadic comparison events**, not derived models
- Ability to **rebuild all weights from events** if needed
- **Delete all rankings** on request without losing historical proof of deletion

### Pseudonymization
```
Stored Event Structure:
{
  sessionId: "random-uuid-not-linked-to-email",
  profileId: "user-profile-uuid",
  triadsRanked: [3 films ranked],
  timestamp: Date,
  // Email/account is linked via foreign key, not embedded
}
```

The shared latent space's batch training (blueprint §7.5) reads triads keyed only by `profile_id`, the same pseudonymous id as everywhere else — it never joins back to `user_id`/email, so a model export or the pooled training job carries no more identifying data than any other model-training path already covered by this section.

## User Rights

### Right to Access
```bash
GET /api/profiles/{id}/data/export
→ Returns JSON dump of:
  - All rankings (triads)
  - All watched/not-watched state
  - Current preference weights
  - Recommendation history
  - Engagement with recommendations
  - Timestamp: all actions with dates
```

### Right to Correction
```bash
PATCH /api/profiles/{id}/watched-titles/{titleId}
{ state: 'watched' | 'not_watched' | 'not_remembered' | 'watchlist' }

# Triad events are append-only per the blueprint (§13.2): a correction never
# overwrites the original ranking in place. It creates a new triad event that
# references the one it corrects, so training/eval history stays reproducible.
POST /api/profiles/{id}/triads/{triadId}/corrections
{ ranking: [0, 1, 2], notes: "I changed my mind" }
```

### Right to Erasure

Per the blueprint (§14, `POST /v1/privacy/delete`), deletion goes through an
announced safety period before anything is irreversibly purged, not an
instant no-warning wipe — see "Data Deletion Flow" below for the sequence.

```bash
DELETE /api/profiles/{id}
→ After the safety-period window, deletes:
  - All triadic rankings
  - All watched/not-watched states
  - All preference weights
  - Recommendation history
  (Keeps anonymized global statistics only if user consented)

DELETE /api/users/{id}
→ Completely removes user account and ALL related data once the
   safety-period window has elapsed (then permanent, cannot be recovered)
```

### Right to Data Portability
```bash
GET /api/profiles/{id}/data/portable
→ Returns standardized CSV/JSON:
  - Personal information
  - Ranking history
  - Preference model coefficients
  - In a standard format
```

### Right to Restrict Processing
```bash
POST /api/profiles/{id}/restrictions
{
  restrictionType: 'no_ai_explanations' | 'no_collaborative' | 'pause_all'
}
```

`no_collaborative` now covers two things, not just a hypothetical future feature: (1) any user-facing collaborative/social recommendation surface (excluded from MVP anyway, see "Exclusions from MVP"), and (2) exclusion of this profile's triads from the shared latent space's pooled training data (blueprint §7.5) — the profile's own individually-fit model and recommendations continue to work, just without contributing to or benefiting from the cross-profile pooled space.

## Automated Decision-Making Disclosure

### Recommendation System Transparency
**User sees:**
- Model version used to generate this recommendation
- Top 3 factors influencing the recommendation
- Similar films that contributed to this suggestion
- Confidence as a verbal band (e.g. "initial/likely/strong"), never a raw score or percentage until calibrated against confirmed post-watch outcomes (blueprint §7.2/§9.3)
- Ability to feedback on recommendation

**Example** (illustrative copy only — per blueprint §7.2/§9.3, dimension "match %" figures and a bare confidence percentage are not shown until calibrated against confirmed post-watch outcomes; the shown confidence is a verbal band):
```
Why "Interstellar" is recommended:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Based on your taste model (trained on 22 rankings)

1. High psychological depth
2. Medium-slow pacing
3. Complex narrative

Similar films you enjoyed:
• Inception (2010) — ranked highly in a past triad
• The Prestige (2006) — ranked #1 vs others

Personal Fit: shown separately from Public Quality and Watchability (never merged)
Confidence: "This is a fairly stable pattern in your picks" (Strong band — not a %)
Not what you're looking for? [Feedback]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### No Fully Automated Decisions
- **Blocking decisions**: We never block access, content, or features based solely on automated logic
- **Recommendations are suggestions**, not obligations
- User always has **override and feedback** capability

## API Privacy Constraints

### OpenAI API Integration
```python
# ALWAYS USE store:false TO PREVENT TRAINING
response = openai_client.messages.create(
    model="gpt-4o",
    messages=[...],
    extra_headers={
        "openai-internal-store": "false"
    }
)
```

**Data sent to OpenAI:**
- Film title and plot summary (not user email/ID)
- For: Generating film fingerprints
- Retention: 30 days default (not used for training)

**Never send to OpenAI:**
- User email or personal information
- User rankings or preferences
- Payment information

### Database Encryption
```bash
# In production, use:
# 1. SSL/TLS for all database connections
# 2. Encryption at rest: AWS RDS encryption, or equivalent
# 3. Encrypted backups with separate key management
```

## Audit and Monitoring

### Audit Log
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY,
  event_type: 'login' | 'data_access' | 'profile_delete' | 'export_request',
  actor: user_id,
  resource: 'user' | 'profile' | 'triad' | 'recommendation',
  resource_id: UUID,
  status: 'success' | 'failure',
  timestamp: TIMESTAMP,
  ip_address: VARCHAR(45), -- IPv4 or IPv6, hashed in production
  reason: VARCHAR(500) -- For deletes: "User request" or "Policy violation"
);
```

### Retention
- **Login logs**: 90 days
- **Data access logs**: 1 year
- **Deletion requests**: Permanent record
- **API calls (OpenAI)**: 30 days (per OpenAI default)

## Data Retention Policy

### By Data Type
| Data | Retention | Condition | Deletion Method |
|------|-----------|-----------|-----------------|
| Triadic rankings | Indefinite | User consent | Soft delete + audit log |
| Preference weights | Indefinite | User consent | Regenerate from events |
| Recommendations shown | 2 years | Analytics | Hard delete after 2 years |
| API logs | 30 days | Compliance | Auto-purge after 30 days |
| Account data | Until delete | Active account | Hard delete on request |
| Audit logs | 7 years | Compliance | Archived logs |

### Data Deletion Flow
```
User requests deletion
    ↓
System marks triads as "deleted" (soft delete)
    ↓
Audit log records: "User deletion request, triads IDs: [list]"
    ↓
After compliance window (if needed), hard delete
    ↓
Backup and audit logs retained per legal hold
```

## International Data Transfers

### When Using US-Based Cloud Providers

The system **should initially store data within Saudi Arabia or MENA region** to avoid:
- PDPL Article 37 (data transfer restrictions)
- Additional compliance complexity
- Latency penalties

**If using AWS/GCP/Azure:**
```
1. Establish Data Processing Agreement (DPA)
2. Use only data centers within KSA or region-locked services
3. Apply additional controls:
   - Encryption in transit AND at rest
   - Regular audit reports
   - Right to audit inclusion
4. Notify users in Privacy Policy
```

## Privacy Impact Assessment (PIA)

### Before Launch Checklist
- [ ] Privacy impact assessment completed
- [ ] Legal review of terms & policy
- [ ] Data Protection Officer review (or external DPO consultant)
- [ ] User consent flow tested
- [ ] Data access endpoints functional
- [ ] Deletion endpoints functional
- [ ] Audit logging enabled
- [ ] Encryption enabled
- [ ] Breach response plan drafted

## Incident Response

### Data Breach Procedure
```
1. DETECT & ASSESS
   └─ Isolate affected systems within 1 hour

2. NOTIFY (within 72 hours per PDPL)
   ├─ Data Protection Authority (SDAIA)
   ├─ Affected users (email notification)
   └─ Internal escalation

3. REMEDIATE
   ├─ Patch vulnerability
   ├─ Reset affected passwords
   └─ Rotate API keys

4. DOCUMENT
   └─ Full incident report, root cause, prevention measures
```

## Exclusions from MVP

**Not implemented in Phase 1:**
- Social features (no sharing profiles)
- User-facing collaborative filtering (no "people who liked X also liked Y", no visible cross-user recommendations)
- Email recommendations
- Third-party integrations (JustWatch, etc.)
- Advertising targeting

**Correction — this is narrower than "no cross-user data" was previously stated to mean:** blueprint §7.5 introduces a shared latent space, batch-trained on pooled pseudonymous triads and fingerprints across profiles, used silently from the Alpha stage (blueprint §17.2) to improve candidate generation and triad selection. This *does* involve cross-user data processing starting in Phase 1/Alpha — it is never shown to a user as "based on other users" (that's gated behind the §7.6/§17.3 disclosure gate, itself post-MVP), but the pooling and computation happen earlier than the line above previously implied. See "Ranking Personalization Consent" below for the disclosure this requires, and `no_collaborative` under "Right to Restrict Processing" for how a user opts out of it specifically.

Each feature will require separate consent and privacy assessment before rollout.

## Resources

- [SDAIA Data Protection Portal](https://dgp.sdaia.gov.sa/)
- [PDPL Regulations (Arabic)](https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter)
- [PDPL Requirements (English Summary)](https://dgp.sdaia.gov.sa/wps/portal/pdp/knowledgecenter/details/overview/)
- [OpenAI Data Privacy](https://openai.com/enterprise-privacy/)
- [GDPR Compliance for Inspiration](https://gdpr-info.eu/)

## Contact

**Data Protection Officer (to be appointed):**
- Email: dpo@movierecommendation.example
- Response SLA: 7 business days

**Privacy Inquiries:**
- Email: privacy@movierecommendation.example

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-01 | Initial MVP Phase 1 Privacy Policy |
