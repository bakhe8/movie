'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError, CONSENT_VERSION, type PreferredLanguage } from '../lib/api';
import { MARKETS, PLATFORMS } from '../lib/onboarding-options';
import { formatNumber } from '../lib/format';
import { useSession } from '../lib/session';
import { PlatformMark } from './PlatformMark';
import styles from './OnboardingScreen.module.css';

type Lang = 'ar' | 'en';
type Step = 1 | 2;
// Two steps (UX_AUDIT_MOBILE_2026-09-05 P0 #8, owner's interaction addendum):
// the third only described the loop the next screen makes the reader do, and
// it stood between them and the first poster. About 250 words used to come
// before a single film was visible.
const STEP_COUNT = 2;

const labels = {
  ar: {
    stepOf: (n: string, total: string) => `الخطوة ${n} من ${total}`,
    skip: 'لاحقًا',
    // Step 1 (blueprint §4.1: account + interface language + market + platforms)
    step1Title: 'جهّز مكانك في الصف الأول',
    step1Lead: 'تؤثر هذه الاختيارات في العرض والتوفر فقط.',
    // Verbatim from blueprint §4.1 -- the promise that makes this step safe to ask.
    step1Note: 'لغة الواجهة والمنطقة تؤثران في العرض والتوفر، لا في افتراض الذوق. اختيار العربية لا يعني تفضيل الأفلام العربية، والإقامة في السعودية لا تعني خفض ترتيب الأعمال الأجنبية.',
    language: 'لغة الواجهة',
    arabic: 'العربية',
    english: 'English',
    market: 'السوق',
    marketPlaceholder: 'اختر دولة',
    marketRequired: 'اختر السوق لنعرف أين تُتاح الأفلام.',
    platforms: 'المنصات المتاحة لك',
    platformsHint: 'اختر ما تشترك فيه أو تصل إليه. يمكنك تركها فارغة.',
    next: 'متابعة',
    saving: 'جارٍ الحفظ…',
    saveFailed: 'تعذّر الحفظ. حاول مجددًا.',
    // Step 2: what we collect and why (PRIVACY.md §1, §3)
    step2Title: 'ما نجمعه ولماذا',
    step2Lead: 'قبل أن تبدأ، هذا ما يحدث ببياناتك.',
    // One clause each (owner's instruction, 2026-09-05). Every fact that was
    // here is still here; what left is the second sentence explaining it, and
    // the privacy notice under the list carries the full text.
    collect: [
      { head: 'حسابك منفصل عن ذوقك', body: 'ملف ذوقك يحمل معرّفًا مستعارًا.' },
      { head: 'ما تسجّله كمُشاهَد', body: 'يُخزَّن لبناء الثلاثيات والتوصيات، وما لم تشاهده لا يُحتسب ضدّه.' },
      { head: 'ترتيباتك تدرّب نموذجك', body: 'لا نجوم ولا إعجاب، والنموذج لملفك وحده.' },
      { head: 'خاص افتراضيًا', body: 'لا صفحة عامة، ولا بيع، ولا استنتاج سمات حساسة.' },
      { head: 'حقوقك', body: 'مسح الملف متاح الآن؛ التصدير والحذف قيد البناء.' },
    ],
    // Declinable purposes (PRIVACY.md §3; docs/CONSENT_COPY_2026-09-04.md):
    // shown as items with a switch, recorded with the mandatory two.
    optional: [
      {
        purpose: 'personalization_pooled' as const,
        head: 'المساهمة في النموذج الجماعي (اختياري)',
        body: 'ترتيباتك المستعارة تُحسّن الاقتراحات للجميع، ولا تُنسب إليك. إيقافها لا يمسّ نموذجك.',
        toggle: 'المساهمة في النموذج الجماعي',
      },
      {
        purpose: 'analytics_first_party' as const,
        head: 'تحليلات المنتج (اختياري)',
        body: 'أحداث تشغيلية على أنظمتنا فقط: لا طرف ثالث ولا إعلانات.',
        toggle: 'تحليلات المنتج',
      },
    ],
    // Revocability belongs beside the switches, once, not in each body.
    optionalNote: 'يمكنك تغيير الاختيارين لاحقًا من الملف الشخصي.',
    fullText: 'النص الكامل في إشعار الخصوصية',
    // Step 3: the loop ahead
    start: 'ابدأ بتسجيل ما شاهدت',
    // With three watched titles already logged, the loop's first step is done.
    startRanking: 'ابدأ الترتيب',
    back: 'رجوع',
  },
  en: {
    stepOf: (n: string, total: string) => `Step ${n} of ${total}`,
    skip: 'Later',
    step1Title: 'Make yourself a front-row seat',
    step1Lead: 'These choices affect display and availability only.',
    step1Note: 'Interface language and region affect display and availability, not what we assume about your taste. Choosing Arabic does not mean preferring Arabic films, and living in Saudi Arabia does not down-rank foreign ones.',
    language: 'Interface language',
    arabic: 'العربية',
    english: 'English',
    market: 'Market',
    marketPlaceholder: 'Choose a country',
    marketRequired: 'Choose your market so we know where films are available.',
    platforms: 'Platforms you can watch on',
    platformsHint: 'Pick what you subscribe to or can access. You can leave this empty.',
    next: 'Continue',
    saving: 'Saving…',
    saveFailed: 'Could not save. Please try again.',
    step2Title: 'What we collect and why',
    step2Lead: 'Before you start, this is what happens with your data.',
    collect: [
      { head: 'Your account is separate from your taste', body: 'Your taste profile carries a pseudonymous id.' },
      { head: 'What you mark as watched', body: 'Stored to build triads and recommendations; what you have not watched never counts against it.' },
      { head: 'Your rankings train your model', body: 'No stars, no likes, and the model is used for your profile alone.' },
      { head: 'Private by default', body: 'No public page, nothing sold, no sensitive traits inferred.' },
      { head: 'Your rights', body: 'Clearing the profile works today; export and deletion are being built.' },
    ],
    optional: [
      {
        purpose: 'personalization_pooled' as const,
        head: 'Contribute to the shared model (optional)',
        body: 'Your rankings, pseudonymous and never attributed to you, improve suggestions for everyone. Turning this off leaves your own model untouched.',
        toggle: 'Contribute to the shared model',
      },
      {
        purpose: 'analytics_first_party' as const,
        head: 'Product analytics (optional)',
        body: 'Operational events on our own systems only: no third party, no advertising.',
        toggle: 'Product analytics',
      },
    ],
    optionalNote: 'You can change both later from your profile.',
    fullText: 'The full text is in the privacy notice',
    start: 'Start marking what you watched',
    startRanking: 'Start ranking',
    back: 'Back',
  },
};

export function OnboardingScreen({
  lang,
  onLanguageChange,
  onDone,
  onSkip,
}: {
  lang: Lang;
  onLanguageChange?: (lang: Lang) => void;
  // Where the last step's button lands: the triad when three watched titles
  // are already logged, otherwise Discover -- one tap, not a blocked triad
  // and then a second tap (owner decision 2026-09-03).
  onDone: (destination: 'rank' | 'discover') => void;
  // "Later" leaves onboarding by the same rule: it never lands on a blocked triad.
  onSkip: (destination: 'rank' | 'discover') => void;
}) {
  const t = labels[lang];
  const { profile, refreshProfile } = useSession();
  const [step, setStep] = useState<Step>(1);
  // null until the count arrives (or if it fails): treated as "not enough".
  // Counted once on arrival, since "later" can leave from step 1.
  const [watchedCount, setWatchedCount] = useState<number | null>(null);
  const profileId = profile?.id;
  const destination: 'rank' | 'discover' = watchedCount !== null && watchedCount >= 3 ? 'rank' : 'discover';

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    api
      .getWatchedTitles(profileId)
      .then((watched) => {
        if (!cancelled) setWatchedCount(watched.length);
      })
      .catch(() => {
        if (!cancelled) setWatchedCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);
  const [language, setLanguage] = useState<PreferredLanguage>(profile?.preferredLanguage ?? lang);
  const [market, setMarket] = useState(profile?.market ?? '');
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(profile?.platforms ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Declinable purposes, recorded with the mandatory two on "understood".
  // personalization_pooled defaults on (PRIVACY.md §3 says so explicitly);
  // analytics_first_party defaults off -- PRIVACY.md names no default for it,
  // and opt-in is the safer reading until the owner decides otherwise
  // (docs/CONSENT_COPY_2026-09-04.md §2).
  const [optional, setOptional] = useState<Record<'personalization_pooled' | 'analytics_first_party', boolean>>({
    personalization_pooled: true,
    analytics_first_party: false,
  });

  function togglePlatform(id: string) {
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveStepOne() {
    if (!profile) return;
    if (!market) {
      setError(t.marketRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateProfile(profile.id, { preferredLanguage: language, market, platforms: [...platforms] });
      await refreshProfile();
      onLanguageChange?.(language);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? t.saveFailed : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  // Records the two purposes step 2's copy discloses and that are mandatory
  // for the core loop (PRIVACY.md §3: proceeding past this screen is the
  // consent), plus the two declinable ones exactly as their switches stand
  // (blueprint gap 7, closed on the write side; ADR-60).
  async function acknowledgeAndContinue() {
    setConsentSaving(true);
    setConsentError(null);
    try {
      await api.updateConsents([
        { purpose: 'watch_history', version: CONSENT_VERSION, granted: true },
        { purpose: 'personalization_individual', version: CONSENT_VERSION, granted: true },
        { purpose: 'personalization_pooled', version: CONSENT_VERSION, granted: optional.personalization_pooled },
        { purpose: 'analytics_first_party', version: CONSENT_VERSION, granted: optional.analytics_first_party },
      ]);
      onDone(destination);
    } catch (err) {
      setConsentError(err instanceof ApiError ? t.saveFailed : t.saveFailed);
    } finally {
      setConsentSaving(false);
    }
  }

  const progress = (
    <div className={styles.progress} aria-label={t.stepOf(formatNumber(step, lang), formatNumber(STEP_COUNT, lang))}>
      <span>{t.stepOf(formatNumber(step, lang), formatNumber(STEP_COUNT, lang))}</span>
      <div className={styles.dots} aria-hidden="true">
        {Array.from({ length: STEP_COUNT }, (_, index) => (
          <span key={index} className={index < step ? `${styles.dot} ${styles.dotOn}` : styles.dot}>{index < step - 1 ? '✓' : formatNumber(index + 1, lang)}</span>
        ))}
      </div>
    </div>
  );

  if (step === 1) {
    return (
      <div className={styles.screen}>
        {progress}
        <div className={styles.header}>
          <svg className={styles.introIcon} width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="12" rx="3" /><path d="M8 20h8M12 16v4M10 8l5 2.5-5 2.5z" /></svg>
          <h2>{t.step1Title}</h2>
          <p className={styles.lead}>{t.step1Lead}</p>
        </div>
        <div className={styles.card}>
          <fieldset className={`${styles.field} ${styles.fieldset}`} disabled={saving}>
            <legend>{t.language}</legend>
            <div className={styles.languageChoices}>
              {(['ar', 'en'] as const).map((choice) => (
                <button key={choice} type="button" aria-pressed={language === choice} onClick={() => setLanguage(choice)}>
                  <span aria-hidden="true">{choice === 'ar' ? 'ع' : 'A'}</span>
                  {choice === 'ar' ? t.arabic : t.english}
                </button>
              ))}
            </div>
          </fieldset>
          <div className={styles.field}>
            <label htmlFor="onboarding-market">{t.market}</label>
            <select id="onboarding-market" value={market} onChange={(event) => setMarket(event.target.value)} disabled={saving}>
              <option value="">{t.marketPlaceholder}</option>
              {MARKETS.map((option) => (
                <option key={option.code} value={option.code}>
                  {lang === 'ar' ? option.ar : option.en}
                </option>
              ))}
            </select>
          </div>
          <fieldset className={`${styles.field} ${styles.fieldset}`} disabled={saving}>
            <legend>{t.platforms}</legend>
            <p className={styles.lead}>{t.platformsHint}</p>
            <div className={styles.chips}>
              {PLATFORMS.map((option) => {
                const on = platforms.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={on}
                    onClick={() => togglePlatform(option.id)}
                  >
                    <PlatformMark id={option.id} name={option.en} />
                    {lang === 'ar' ? option.ar : option.en}
                    <span className={styles.platformCheck} aria-hidden="true">{on ? '✓' : '+'}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className={styles.note}>{t.step1Note}</p>
          {error && (
            <p className={styles.status} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={saveStepOne} disabled={saving}>
              {saving ? t.saving : t.next}
            </button>
            <button type="button" className={styles.link} onClick={() => onSkip(destination)} disabled={saving}>
              {t.skip}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className={styles.screen}>
        {progress}
        <div className={styles.header}>
          <svg className={styles.introIcon} width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3" /></svg>
          <h2>{t.step2Title}</h2>
          <p className={styles.lead}>{t.step2Lead}</p>
        </div>
        <ul className={styles.list}>
          {t.collect.map((item) => (
            <li key={item.head}>
              <strong>{item.head}</strong>
              <span>{item.body}</span>
            </li>
          ))}
          {/* Declinable purposes: the same list, each with its own switch. */}
          {t.optional.map((item) => (
            <li key={item.purpose}>
              <strong>{item.head}</strong>
              <span>{item.body}</span>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  role="switch"
                  disabled={consentSaving}
                  checked={optional[item.purpose]}
                  onChange={(event) => setOptional((current) => ({ ...current, [item.purpose]: event.target.checked }))}
                />
                <span>{item.toggle}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className={styles.note}>{t.optionalNote}</p>
        <p className={styles.lead}>
          <Link href={`/privacy?lang=${lang}`} target="_blank" rel="noopener" className={styles.docLink}>
            {t.fullText}
          </Link>
        </p>
        {consentError && (
          <p className={styles.status} role="alert">
            {consentError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={acknowledgeAndContinue} disabled={consentSaving}>
            {consentSaving ? t.saving : destination === 'rank' ? t.startRanking : t.start}
          </button>
          <button type="button" className={styles.ghost} onClick={() => setStep(1)} disabled={consentSaving}>
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  // Steps 1 and 2 are the whole of it; anything after this would be a
  // description of the next screen rather than the screen.
  return null;
}
