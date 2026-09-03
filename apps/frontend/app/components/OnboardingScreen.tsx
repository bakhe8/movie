'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, CONSENT_VERSION, type PreferredLanguage } from '../lib/api';
import { MARKETS, PLATFORMS } from '../lib/onboarding-options';
import { formatNumber } from '../lib/format';
import { useSession } from '../lib/session';
import styles from './OnboardingScreen.module.css';

type Lang = 'ar' | 'en';
type Step = 1 | 2 | 3;
const STEP_COUNT = 3;

const labels = {
  ar: {
    stepOf: (n: string, total: string) => `الخطوة ${n} من ${total}`,
    skip: 'لاحقًا',
    // Step 1 (blueprint §4.1: account + interface language + market + platforms)
    step1Title: 'لغتك وسوقك ومنصاتك',
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
    collect: [
      { head: 'حسابك منفصل عن ذوقك', body: 'ملف ذوقك يحمل معرّفًا مستعارًا، ولا يربطه النموذج بهويتك.' },
      { head: 'ما تسجّله كمُشاهَد', body: 'علامات المشاهدة وقائمتك تُخزَّن لبناء الثلاثيات والتوصيات، ولا يُحتسب ما لم تشاهده ضدّه.' },
      { head: 'ترتيباتك تدرّب نموذجًا عنك أنت', body: 'السؤال الوحيد هو ترتيب ثلاثة أفلام شاهدتها. لا نجوم ولا إعجاب، ولا يُستخدم النموذج إلا لملفك.' },
      { head: 'خاص افتراضيًا', body: 'لا صفحة عامة، ولا مشاركة إلا بقرارك، ولا يُباع ملف ذوقك، ولا نستنتج سمات حساسة من مشاهداتك.' },
      { head: 'حقوقك', body: 'مسح ملف الذوق متاح الآن من الملف الشخصي. التصدير وحذف الحساب قيد البناء.' },
    ],
    understood: 'فهمت، متابعة',
    // Step 3: the loop ahead
    step3Title: 'ثلاث خطوات لأول نتيجة',
    step3Lead: 'الانضمام قصير عمدًا. سجّلك يتوسع لاحقًا أثناء الاستخدام.',
    loop: [
      'سجّل ثلاثة أفلام شاهدتها على الأقل، بالبحث أو من قائمة البداية.',
      'رتّب ثلاث إلى خمس ثلاثيات قصيرة حسب إعجابك الشخصي.',
      'تظهر توصياتك الأولى وترتيب مكتبتك بثقة «أولية» تتحسن مع كل جولة.',
    ],
    start: 'ابدأ بتسجيل ما شاهدت',
    // With three watched titles already logged, the loop's first step is done.
    startRanking: 'ابدأ الترتيب',
    back: 'رجوع',
  },
  en: {
    stepOf: (n: string, total: string) => `Step ${n} of ${total}`,
    skip: 'Later',
    step1Title: 'Your language, market and platforms',
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
      { head: 'Your account is separate from your taste', body: 'Your taste profile carries a pseudonymous id; the model never ties it to your identity.' },
      { head: 'What you mark as watched', body: 'Watch marks and your list are stored to build ranking rounds and recommendations; what you have not watched never counts against it.' },
      { head: 'Your rankings train a model about you', body: 'The only question is ranking three films you have watched. No stars, no likes, and the model serves your profile only.' },
      { head: 'Private by default', body: 'No public page, no sharing unless you choose it, your taste profile is never sold, and no sensitive traits are inferred from what you watch.' },
      { head: 'Your rights', body: 'Wiping the taste profile is available now from the profile screen. Export and account deletion are being built.' },
    ],
    understood: 'Understood, continue',
    step3Title: 'Three steps to a first result',
    step3Lead: 'Onboarding is short on purpose. Your log grows later as you go.',
    loop: [
      'Mark at least three films you have watched, by search or from the starter list.',
      'Rank three to five short rounds by how much you personally liked each film.',
      'Your first recommendations and library ranking appear with “initial” confidence that improves every round.',
    ],
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

  // Records the two purposes step 2's copy already discloses and that are
  // mandatory for the core loop (PRIVACY.md §3: watch_history,
  // personalization_individual are both "no for the core loop" -- proceeding
  // past this screen is the consent). personalization_pooled and
  // analytics_first_party are declinable and need their own disclosure copy
  // and an opt-out control neither of which exists on this screen yet
  // (blueprint gap 7, still open) -- deliberately not granted here rather
  // than silently opted in without asking.
  async function acknowledgeAndContinue() {
    setConsentSaving(true);
    setConsentError(null);
    try {
      await api.updateConsents([
        { purpose: 'watch_history', version: CONSENT_VERSION, granted: true },
        { purpose: 'personalization_individual', version: CONSENT_VERSION, granted: true },
      ]);
      setStep(3);
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
          <span key={index} className={index < step ? `${styles.dot} ${styles.dotOn}` : styles.dot} />
        ))}
      </div>
    </div>
  );

  if (step === 1) {
    return (
      <div className={styles.screen}>
        {progress}
        <div className={styles.header}>
          <h2>{t.step1Title}</h2>
          <p className={styles.lead}>{t.step1Lead}</p>
        </div>
        <div className={styles.card}>
          <div className={styles.field}>
            <label htmlFor="onboarding-language">{t.language}</label>
            <select
              id="onboarding-language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as PreferredLanguage)}
            >
              <option value="ar">{t.arabic}</option>
              <option value="en">{t.english}</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="onboarding-market">{t.market}</label>
            <select id="onboarding-market" value={market} onChange={(event) => setMarket(event.target.value)}>
              <option value="">{t.marketPlaceholder}</option>
              {MARKETS.map((option) => (
                <option key={option.code} value={option.code}>
                  {lang === 'ar' ? option.ar : option.en}
                </option>
              ))}
            </select>
          </div>
          <fieldset className={`${styles.field} ${styles.fieldset}`}>
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
                    {lang === 'ar' ? option.ar : option.en}
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
            <button type="button" className={styles.link} onClick={() => onSkip(destination)}>
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
        </ul>
        {consentError && (
          <p className={styles.status} role="alert">
            {consentError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={acknowledgeAndContinue} disabled={consentSaving}>
            {consentSaving ? t.saving : t.understood}
          </button>
          <button type="button" className={styles.ghost} onClick={() => setStep(1)}>
            {t.back}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      {progress}
      <div className={styles.header}>
        <h2>{t.step3Title}</h2>
        <p className={styles.lead}>{t.step3Lead}</p>
      </div>
      <ol className={styles.steps}>
        {t.loop.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => onDone(destination)}>
          {destination === 'rank' ? t.startRanking : t.start}
        </button>
        <button type="button" className={styles.ghost} onClick={() => setStep(2)}>
          {t.back}
        </button>
      </div>
    </div>
  );
}
