'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type ConfidenceBand, type PreferredLanguage } from '../lib/api';
import { formatConfidence, formatNumber } from '../lib/format';
import { MARKETS, PLATFORMS } from '../lib/onboarding-options';
import { useSession } from '../lib/session';
import { ConsentsPanel } from './ConsentsPanel';
import styles from './ProfileScreen.module.css';

type Lang = 'ar' | 'en';

const labels = {
  ar: {
    eyebrow: 'الملف الشخصي',
    title: 'حسابك وملف ذوقك',
    account: 'الحساب',
    logout: 'تسجيل الخروج',
    taste: 'ملف الذوق',
    nameLabel: 'اسم ملف الذوق',
    languageLabel: 'لغة الواجهة',
    arabic: 'العربية',
    english: 'English',
    // Blueprint §4.1: display and availability only, never a taste prior.
    marketLabel: 'السوق',
    marketPlaceholder: 'لم يُحدَّد بعد',
    platformsLabel: 'المنصات المتاحة لك',
    settingsNote: 'اللغة والسوق والمنصات تؤثر في العرض والتوفر فقط، لا في افتراض ذوقك.',
    tasteId: 'معرّف ملف الذوق المستعار',
    tasteIdNote: 'هذا المعرّف، لا حسابك، هو ما يشير إليه النموذج وكل سجلاتك.',
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ.',
    nameTaken: 'يوجد ملف بهذا الاسم.',
    rounds: 'جولات الترتيب المكتملة',
    watched: 'أفلام مسجّلة كمُشاهَدة',
    model: 'نموذجك',
    modelNone: 'لم يُدرَّب نموذجك بعد. يُبنى من جولات الترتيب، لا من أي تقييم.',
    modelVersion: 'إصدار النموذج',
    confidence: 'الثقة',
    // Blueprint §5.3 "ملف الذوق": core tendencies, conditional tendencies,
    // unknown areas, exceptions, drift -- none of it exists in the API yet.
    detailPending: 'الميول الثابتة والمناطق المجهولة والاستثناءات تظهر هنا عندما يُبنى ملف الذوق التفصيلي.',
    privacy: 'الخصوصية',
    privacyBody: 'ملفك خاص افتراضيًا: لا صفحة عامة، ولا مشاركة إلا بقرارك، ولا يُباع ملف ذوقك.',
    privacyLink: 'اقرأ إشعار الخصوصية',
    resetTitle: 'مسح ملف الذوق والبدء من جديد',
    resetBody: 'يحذف كل جولات الترتيب والعلامات والنموذج لهذا الملف ويبدأ ملفًا فارغًا. حسابك يبقى. لا يمكن التراجع.',
    resetAction: 'مسح ملف الذوق',
    resetConfirm: 'نعم، امسح',
    resetting: 'جارٍ المسح…',
    resetDone: 'بدأ ملف ذوق جديد.',
    cancel: 'إلغاء',
    exportAction: 'تصدير بياناتك',
    deleteAction: 'حذف الحساب',
    notYet: 'لم يُبنَ بعد',
    failed: 'تعذّر الحفظ. حاول مجددًا.',
    loading: 'جارٍ التحميل…',
  },
  en: {
    eyebrow: 'Profile',
    title: 'Your account and taste profile',
    account: 'Account',
    logout: 'Log out',
    taste: 'Taste profile',
    nameLabel: 'Taste profile name',
    languageLabel: 'Interface language',
    arabic: 'العربية',
    english: 'English',
    marketLabel: 'Market',
    marketPlaceholder: 'Not set yet',
    platformsLabel: 'Platforms you can watch on',
    settingsNote: 'Language, market and platforms affect display and availability only, never what we assume about your taste.',
    tasteId: 'Pseudonymous taste profile id',
    tasteIdNote: 'This id, not your account, is what the model and all your records point to.',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved.',
    nameTaken: 'A profile with this name already exists.',
    rounds: 'Completed ranking rounds',
    watched: 'Films marked watched',
    model: 'Your model',
    modelNone: 'Your model has not been trained yet. It is built from ranking rounds, never from a rating.',
    modelVersion: 'Model version',
    confidence: 'Confidence',
    detailPending: 'Stable tendencies, unknown areas and exceptions will appear here once the detailed taste profile is built.',
    privacy: 'Privacy',
    privacyBody: 'Your profile is private by default: no public page, no sharing unless you choose it, and your taste profile is never sold.',
    privacyLink: 'Read the Privacy Notice',
    resetTitle: 'Wipe the taste profile and start over',
    resetBody: 'Deletes every ranking round, mark and model of this profile and starts an empty one. Your account stays. This cannot be undone.',
    resetAction: 'Wipe taste profile',
    resetConfirm: 'Yes, wipe it',
    resetting: 'Wiping…',
    resetDone: 'A new taste profile has started.',
    cancel: 'Cancel',
    exportAction: 'Export your data',
    deleteAction: 'Delete account',
    notYet: 'not built yet',
    failed: 'Could not save. Please try again.',
    loading: 'Loading…',
  },
};

type ModelStatus = { kind: 'loading' } | { kind: 'none' } | { kind: 'trained'; version: string; band: ConfidenceBand } | { kind: 'unknown' };

export function ProfileScreen({ lang, onLanguageChange }: { lang: Lang; onLanguageChange?: (lang: Lang) => void }) {
  const { user, profile, logout, refreshProfile } = useSession();
  const t = labels[lang];
  const [name, setName] = useState(profile?.name ?? '');
  const [language, setLanguage] = useState<PreferredLanguage>(profile?.preferredLanguage ?? 'ar');
  const [market, setMarket] = useState(profile?.market ?? '');
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(profile?.platforms ?? []));
  const [saving, setSaving] = useState(false);
  // Stored as a label key, not text, so a notice set just before a language
  // switch renders in the language now on screen.
  const [notice, setNotice] = useState<{ key: 'saved' | 'nameTaken' | 'failed' | 'resetDone'; error?: boolean } | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [watched, setWatched] = useState<number | null>(null);
  const [model, setModel] = useState<ModelStatus>({ kind: 'loading' });
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const profileId = profile?.id;
  const profileName = profile?.name;
  const profileLanguage = profile?.preferredLanguage;
  const profileMarket = profile?.market;
  const profilePlatforms = profile?.platforms.join(',');

  // Keep the form in step with the profile it edits (after a save, a refresh,
  // or a reset that replaced the profile).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(profileName ?? '');
    setLanguage(profileLanguage ?? 'ar');
    setMarket(profileMarket ?? '');
    setPlatforms(new Set(profilePlatforms ? profilePlatforms.split(',') : []));
  }, [profileId, profileName, profileLanguage, profileMarket, profilePlatforms]);

  const loadStats = useCallback(async () => {
    if (!profileId) return;
    setModel({ kind: 'loading' });
    const [triads, watchedTitles] = await Promise.all([
      api.getCompletedTriads(profileId).catch(() => null),
      api.getWatchedTitles(profileId).catch(() => null),
    ]);
    setRounds(triads ? triads.length : null);
    setWatched(watchedTitles ? watchedTitles.length : null);
    try {
      // The recommendation call is the only surface that reports which model
      // snapshot serves this profile and its confidence band (PRIVACY §12).
      const [first] = await api.getRecommendations(profileId, 1);
      setModel(first ? { kind: 'trained', version: first.modelVersion, band: first.confidenceBand } : { kind: 'unknown' });
    } catch (err) {
      // 409 = no trained snapshot yet (RecommendationsService).
      setModel(err instanceof ApiError && err.status === 409 ? { kind: 'none' } : { kind: 'unknown' });
    }
  }, [profileId]);

  useEffect(() => {
    // loadStats' own setState calls all happen after an `await`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const samePlatforms =
    !!profile && platforms.size === profile.platforms.length && profile.platforms.every((id) => platforms.has(id));
  const dirty =
    !!profile &&
    (name.trim() !== profile.name ||
      language !== profile.preferredLanguage ||
      market !== (profile.market ?? '') ||
      !samePlatforms);

  function togglePlatform(id: string) {
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!profile || !dirty || name.trim().length === 0) return;
    setSaving(true);
    try {
      // `market` cannot be unset once chosen (the DTO takes a code or nothing);
      // an unset market stays unset until the user picks one.
      await api.updateProfile(profile.id, {
        name: name.trim(),
        preferredLanguage: language,
        ...(market ? { market } : {}),
        platforms: [...platforms],
      });
      await refreshProfile();
      onLanguageChange?.(language);
      setNotice({ key: 'saved' });
    } catch (err) {
      setNotice({ key: err instanceof ApiError && err.status === 409 ? 'nameTaken' : 'failed', error: true });
    } finally {
      setSaving(false);
    }
  }

  // "Reset taste" (blueprint §2.4 #9): delete this profile -- which cascades
  // its triads, replacements, marks and snapshots -- and let the session
  // auto-create a fresh one. The account stays. Stronger than the target
  // POST /privacy/reset (which keeps watch history); the copy says so.
  async function resetTaste() {
    if (!profile) return;
    setResetting(true);
    try {
      await api.deleteProfile(profile.id);
      await refreshProfile();
      setConfirmReset(false);
      setNotice({ key: 'resetDone' });
    } catch {
      setNotice({ key: 'failed', error: true });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h2>{t.title}</h2>
      </div>

      {notice && (
        <p className={notice.error ? `${styles.status} ${styles.error}` : styles.status} role="status">
          {t[notice.key]}
        </p>
      )}

      <section className={styles.section} aria-label={t.account}>
        <h3>{t.account}</h3>
        {user && (
          <p>
            <span className={styles.strong}>
              {user.firstName} {user.lastName}
            </span>
            <br />
            {user.email}
          </p>
        )}
        <div className={styles.row}>
          <button type="button" className={styles.ghost} onClick={logout}>
            {t.logout}
          </button>
        </div>
      </section>

      <section className={styles.section} aria-label={t.taste}>
        <h3>{t.taste}</h3>
        <div className={styles.field}>
          <label htmlFor="profile-name">{t.nameLabel}</label>
          <input id="profile-name" value={name} maxLength={255} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="profile-language">{t.languageLabel}</label>
          <select
            id="profile-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as PreferredLanguage)}
          >
            <option value="ar">{t.arabic}</option>
            <option value="en">{t.english}</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="profile-market">{t.marketLabel}</label>
          <select id="profile-market" value={market} onChange={(event) => setMarket(event.target.value)}>
            <option value="" disabled={market !== ''}>
              {t.marketPlaceholder}
            </option>
            {MARKETS.map((option) => (
              <option key={option.code} value={option.code}>
                {lang === 'ar' ? option.ar : option.en}
              </option>
            ))}
          </select>
        </div>
        <fieldset className={`${styles.field} ${styles.fieldset}`}>
          <legend>{t.platformsLabel}</legend>
          <div className={styles.chips}>
            {PLATFORMS.map((option) => {
              const on = platforms.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={on ? `${styles.chipToggle} ${styles.chipOn}` : styles.chipToggle}
                  aria-pressed={on}
                  onClick={() => togglePlatform(option.id)}
                >
                  {lang === 'ar' ? option.ar : option.en}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p>{t.settingsNote}</p>
        <div className={styles.row}>
          <button type="button" className={styles.primary} onClick={save} disabled={!dirty || saving || name.trim().length === 0}>
            {saving ? t.saving : t.save}
          </button>
        </div>
        {profile && (
          <p>
            <span className={styles.strong}>{t.tasteId}</span>
            <br />
            <code className={styles.code}>{profile.id}</code>
            <br />
            {t.tasteIdNote}
          </p>
        )}

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>{t.rounds}</dt>
            <dd>{rounds === null ? '—' : formatNumber(rounds, lang)}</dd>
          </div>
          <div className={styles.stat}>
            <dt>{t.watched}</dt>
            <dd>{watched === null ? '—' : formatNumber(watched, lang)}</dd>
          </div>
        </dl>

        <h3>{t.model}</h3>
        {model.kind === 'loading' && <p>{t.loading}</p>}
        {model.kind === 'none' && <p>{t.modelNone}</p>}
        {model.kind === 'unknown' && <p>{t.failed}</p>}
        {model.kind === 'trained' && (
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>{t.modelVersion}</dt>
              <dd>{model.version}</dd>
            </div>
            <div className={styles.stat}>
              <dt>{t.confidence}</dt>
              <dd>
                <span className={styles.chip}>{formatConfidence(model.band, lang).label}</span>
                <p>{formatConfidence(model.band, lang).copy}</p>
              </dd>
            </div>
          </dl>
        )}
        <p>{t.detailPending}</p>
      </section>

      <section className={styles.section} aria-label={t.privacy}>
        <h3>{t.privacy}</h3>
        <p>{t.privacyBody}</p>
        <p>
          <Link href={`/privacy?lang=${lang}`} className={styles.docLink}>
            {t.privacyLink}
          </Link>
        </p>

        {/* Consent changes the onboarding copy promises (PRIVACY.md §3). */}
        <ConsentsPanel lang={lang} />

        <p className={styles.strong}>{t.resetTitle}</p>
        <p>{t.resetBody}</p>
        {confirmReset ? (
          <div className={styles.confirm} role="group">
            <div className={styles.row}>
              <button type="button" className={`${styles.primary} ${styles.dangerFill}`} onClick={resetTaste} disabled={resetting}>
                {resetting ? t.resetting : t.resetConfirm}
              </button>
              <button type="button" className={styles.ghost} onClick={() => setConfirmReset(false)} disabled={resetting}>
                {t.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.row}>
            <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={() => setConfirmReset(true)}>
              {t.resetAction}
            </button>
          </div>
        )}

        {/* Promised by principle #9 and PRIVACY.md §5; the endpoints do not
            exist yet, and the screen says so instead of hiding the rights. */}
        <div className={styles.row}>
          <button type="button" className={styles.ghost} disabled>
            {t.exportAction}
          </button>
          <span className={styles.notYet}>{t.notYet}</span>
        </div>
        <div className={styles.row}>
          <button type="button" className={styles.ghost} disabled>
            {t.deleteAction}
          </button>
          <span className={styles.notYet}>{t.notYet}</span>
        </div>
      </section>
    </div>
  );
}
