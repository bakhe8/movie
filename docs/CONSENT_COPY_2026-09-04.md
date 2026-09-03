# Consent copy — gap 7's three remaining purposes (2026-09-04)

**For**: session B, to implement in `OnboardingScreen.tsx` / `AuthScreen.tsx`. Ready-to-paste Arabic/English strings plus the data-flow spec. Not touched by session A — this file only.

**Backend status**: nothing to build. `PUT /api/consents` already accepts all three purposes below (`LIVE_CONSENT_PURPOSES`, ADR-60) — this closes the write side of gap 7 in full once wired into the two screens. `CONSENT_VERSION = 'privacy-2.0'` (`apps/frontend/app/lib/api.ts`) is the version string to send for all three, same as the two purposes already recorded on step 2.

Copy style matches `OnboardingScreen.tsx`'s existing `collect` list: short head + one-sentence body, no marketing language, states the mechanism plainly (`PRIVACY.md` §1, §3).

---

## 1. `personalization_pooled` — OnboardingScreen step 2

`PRIVACY.md` §3: asked at onboarding, **default on**, declinable, sets restriction `no_pooled` on decline (`PRIVACY.md` §4 — that restriction's own enforcement, i.e. actually excluding a profile's triads from a shared-space retrain, is separate backend work, not yet built, and doesn't block recording this consent correctly today; the shared-space retrain job itself doesn't exist yet either, ADR-13).

Unlike the five existing `collect` items (plain text), this one needs an interactive toggle — recommend a 6th list item with a toggle control, not a separate card, to keep step 2 a single scroll.

| | Arabic | English |
|---|---|---|
| head | ترتيباتك تُسهم أيضاً في نموذج جماعي (اختياري) | Your rankings also help a shared model (optional) |
| body | إلى جانب نموذج ذوقك الخاص، تساعد ترتيباتك المستعارة — دون أن تُنسب إليك — في تدريب نموذج جماعي يُحسّن اختيار الثلاثيات والترشيحات للجميع. لا تُعرض لأحد أبداً. يمكنك إيقاف هذا في أي وقت دون أن يتأثر نموذجك الشخصي. | Beyond your own taste model, your pseudonymous rankings — never attributed to you — help train a shared model that improves triad and recommendation selection for everyone. Never shown to anyone. Turn this off any time without affecting your personal model. |
| toggle label | المساهمة في النموذج الجماعي | Contribute to the shared model |
| default | on | on |

Data flow: add to the same `updateConsents` call `acknowledgeAndContinue()` already makes —

```ts
await api.updateConsents([
  { purpose: 'watch_history', version: CONSENT_VERSION, granted: true },
  { purpose: 'personalization_individual', version: CONSENT_VERSION, granted: true },
  { purpose: 'personalization_pooled', version: CONSENT_VERSION, granted: pooledOn }, // new toggle state, default true
]);
```

## 2. `analytics_first_party` — OnboardingScreen step 2

`PRIVACY.md` §3: asked at onboarding, declinable — **no default stated**, unlike `personalization_pooled`'s explicit "default on".

**Flagging rather than inventing**: I recommend defaulting this **off** (opt-in), because (a) `PRIVACY.md` names a default only for `personalization_pooled`, and silence on this one purpose isn't the same as "also on" — that would be assuming a privacy-posture decision the doc doesn't make; (b) this purpose serves product evaluation, not the user's own recommendations directly, a weaker case for a silent default-on than pooled personalization has. This is a recommendation, not a decision on my part — if the owner prefers default-on, flip the default below, the copy doesn't need to change.

| | Arabic | English |
|---|---|---|
| head | تحليلات المنتج الأولى (اختياري) | First-party product analytics (optional) |
| body | نستخدم أحداثاً تشغيلية على أنظمتنا فقط — لا طرف ثالث، لا إعلانات — لقياس أداء التوصيات وتحسينها. يمكنك المشاركة أو الاعتذار الآن، وتغيير قرارك لاحقاً من الملف الشخصي. | We use operational events on our own systems only — no third party, no advertising — to measure and improve recommendation quality. Opt in or skip now, and change your choice later from your profile. |
| toggle label | تحليلات المنتج | Product analytics |
| default (A's recommendation) | off | off |

Data flow: same call as above, add `{ purpose: 'analytics_first_party', version: CONSENT_VERSION, granted: analyticsOn }`.

## 3. `terms_privacy` — AuthScreen, registration

`PRIVACY.md` §3: asked at registration, **not declinable** — required to use the service at all.

UI: a checkbox on the register form, visible only when `mode === 'register'` (same conditional as the first/last name fields), unchecked by default. The submit button should stay disabled (or the form should reject submission) until it's checked — matching "required to use the service," the same way `market` is required before step 1 can proceed in onboarding.

| | Arabic | English |
|---|---|---|
| label | أوافق على الشروط وإشعار الخصوصية. | I agree to the Terms and Privacy Notice. |

No `/terms` or `/privacy` page exists in the frontend yet to link from this checkbox — a separate, further gap this copy doesn't solve. Until those exist, render the label as plain text (no live links) rather than a broken or placeholder link.

Data flow: after `register()` resolves (the session token is set) and before entering onboarding —

```ts
await api.updateConsents([{ purpose: 'terms_privacy', version: CONSENT_VERSION, granted: true }]);
```

Same non-blocking error handling `acknowledgeAndContinue()` already uses is a reasonable default (surface the error, don't trap the user on the auth screen for a consent-write failure after their account already exists) — B's call given the established UX pattern here.

---

Once wired, `docs/IMPLEMENTATION_STATUS.md`'s gap 7 "still open" note needs updating to close — B or A, whoever lands the change, per the file's existing ownership note (B sends the text, A edits, or A does it directly on request).
