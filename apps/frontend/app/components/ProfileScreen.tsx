'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type ConfidenceBand, type PreferredLanguage } from '../lib/api';
import { formatConfidence, formatNumber } from '../lib/format';
import { MARKETS, PLATFORMS } from '../lib/onboarding-options';
import { useSession } from '../lib/session';
import { ConsentsPanel } from './ConsentsPanel';
import { ReadinessPanel } from './ReadinessPanel';
import styles from './ProfileScreen.module.css';

type Lang = 'ar' | 'en';

const labels = {
  ar: {
    eyebrow: 'الملف الشخصي',
    title: 'حسابك وملف ذوقك',
    account: 'الحساب',
    logout: 'تسجيل الخروج',
    taste: 'ملف الذوق',
    tasteHint: 'ما تعلّمه نموذجك عنك، وما صار جاهزًا.',
    prefs: 'التفضيلات',
    prefsHint: 'اسم ملفك، ولغة الواجهة، وسوقك، ومنصاتك.',
    accountHint: 'بريدك وتسجيل الخروج.',
    privacyHint: 'الموافقات، والتصدير، والحذف، وإيقاف المعالجة.',
    backToProfile: 'إلى ملفي',
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
    modelBuilding: 'جارٍ بناء ملفك…',
    modelBuildingNote: 'يستغرق عادةً بضع دقائق. ستظهر المقترحات عند الانتهاء.',
    modelRetrain: 'حدّث نموذجي',
    modelRetraining: 'جارٍ الطلب…',
    modelVersion: 'إصدار النموذج',
    modelFailedInvalid: 'جولاتك محفوظة، لكن الأفلام التي رتّبتها لا تملك بعدُ تحليلًا منشورًا يكفي لبناء نموذج.',
    modelFailed: 'تعذّر بناء نموذجك في آخر محاولة. اختياراتك محفوظة.',
    modelNotPublished: 'اكتمل آخر تدريب ولم يُنشر نموذج. اختياراتك محفوظة.',
    modelDisabled: 'التدريب غير مفعَّل على هذا الخادم؛ إعداد تشغيلي يعالجه مشغّل الخدمة، لا أنت.',
    modelUnreachable: 'تعذّر الوصول إلى خدمة النموذج. حاول بعد قليل.',
    modelSupport: (id: string) => `رمز الدعم: ${id}`,
    trainFailed: 'تعذّر إرسال طلب التدريب.',
    trainNeedRounds: 'أكمل جولة ترتيب واحدة على الأقل قبل التدريب.',
    confidence: 'الثقة',
    // Blueprint §5.3 "ملف الذوق": core tendencies, conditional tendencies,
    // unknown areas, exceptions, drift -- none of it exists in the API yet.
    detailPending: 'الميول الثابتة والمناطق المجهولة والاستثناءات تظهر هنا عندما يُبنى ملف الذوق التفصيلي.',
    privacy: 'الخصوصية',
    privacyBody: 'ملفك خاص افتراضيًا: لا صفحة عامة، ولا مشاركة إلا بقرارك، ولا يُباع ملف ذوقك.',
    privacyLink: 'اقرأ إشعار الخصوصية',
    dataLink: 'المصادر والحقوق',
    resetTitle: 'مسح ملف الذوق والبدء من جديد',
    resetBody: 'يحذف كل جولات الترتيب والعلامات والنموذج لهذا الملف ويبدأ ملفًا فارغًا. حسابك يبقى. لا يمكن التراجع.',
    resetAction: 'مسح ملف الذوق',
    resetConfirm: 'نعم، امسح',
    resetting: 'جارٍ المسح…',
    resetDone: 'بدأ ملف ذوق جديد.',
    cancel: 'إلغاء',
    exportAction: 'تصدير بياناتك',
    exportBody: 'ملف JSON يحتوي على كل ما نعرفه عنك: حسابك، ترتيباتك، بصماتك المُحكَّمة، وسجل الطلبات.',
    exportPassword: 'كلمة المرور للتحقق',
    exportSubmit: 'تصدير',
    exporting: 'جارٍ التصدير…',
    exportDone: 'اكتمل التصدير.',
    exportFailed: 'تعذّر التصدير. تحقق من كلمة المرور.',
    deleteAction: 'حذف الحساب',
    deleteBody: 'يوقف الطلب معالجة ملفاتك ويحدد موعد الحذف بعد مهلة أمان. يمكنك إلغاء الطلب حتى ذلك الموعد؛ وبعد التنفيذ لا يمكن التراجع.',
    deletePassword: 'كلمة المرور للتحقق',
    deleteSubmit: 'طلب الحذف',
    deleting: 'جارٍ الطلب…',
    deletePending: (date: string) => `مجدوَل للحذف بتاريخ ${date}. يمكنك الإلغاء حتى ذلك الحين.`,
    deleteCancelAction: 'إلغاء طلب الحذف',
    cancelling: 'جارٍ الإلغاء…',
    deleteCancelled: 'أُلغي طلب الحذف.',
    deleteFailed: 'تعذّر الطلب. تحقق من كلمة المرور.',
    pauseTitle: 'إيقاف كل المعالجة مؤقتًا',
    pauseBody: 'يوقف التوصيات وجولات الترتيب على كل ملفاتك ريثما تُكمل طلب الخصوصية.',
    pauseAction: 'إيقاف المعالجة',
    pausing: 'جارٍ الإيقاف…',
    pauseDone: 'المعالجة موقوفة.',
    resumeAction: 'استئناف المعالجة',
    resuming: 'جارٍ الاستئناف…',
    resumeDone: 'المعالجة مستأنفة.',
    pauseFailed: 'تعذّرت العملية. حاول مجددًا.',
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
    tasteHint: 'What your model has learned, and what is ready.',
    prefs: 'Preferences',
    prefsHint: 'Your profile name, interface language, market and platforms.',
    accountHint: 'Your email and sign out.',
    privacyHint: 'Consents, export, deletion and pausing.',
    backToProfile: 'Back to profile',
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
    modelBuilding: 'Building your profile…',
    modelBuildingNote: 'Usually takes a few minutes. Recommendations will appear once it is done.',
    modelRetrain: 'Update my model',
    modelRetraining: 'Requesting…',
    modelVersion: 'Model version',
    modelFailedInvalid: 'Your rounds are saved, but the films you ranked do not yet have enough published analysis to build a model from.',
    modelFailed: 'Your model could not be built on the last attempt. Your choices are saved.',
    modelNotPublished: 'The last training run finished but no model was published. Your choices are saved.',
    modelDisabled: 'Training is not enabled on this server; an operational setting for the service operator, not for you.',
    modelUnreachable: 'The model service could not be reached. Try again in a moment.',
    modelSupport: (id: string) => `Support code: ${id}`,
    trainFailed: 'The training request could not be sent.',
    trainNeedRounds: 'Complete at least one ranking round before training.',
    confidence: 'Confidence',
    detailPending: 'Stable tendencies, unknown areas and exceptions will appear here once the detailed taste profile is built.',
    privacy: 'Privacy',
    privacyBody: 'Your profile is private by default: no public page, no sharing unless you choose it, and your taste profile is never sold.',
    privacyLink: 'Read the Privacy Notice',
    dataLink: 'Sources and rights',
    resetTitle: 'Wipe the taste profile and start over',
    resetBody: 'Deletes every ranking round, mark and model of this profile and starts an empty one. Your account stays. This cannot be undone.',
    resetAction: 'Wipe taste profile',
    resetConfirm: 'Yes, wipe it',
    resetting: 'Wiping…',
    resetDone: 'A new taste profile has started.',
    cancel: 'Cancel',
    exportAction: 'Export your data',
    exportBody: 'A JSON file with everything we hold about you: your account, rankings, reviewed fingerprints, and request log.',
    exportPassword: 'Password to verify',
    exportSubmit: 'Export',
    exporting: 'Exporting…',
    exportDone: 'Export complete.',
    exportFailed: 'Export failed. Check your password.',
    deleteAction: 'Delete account',
    deleteBody: 'The request pauses processing for your profiles and sets a deletion date after a safety period. You can cancel until that date; after deletion runs it cannot be undone.',
    deletePassword: 'Password to verify',
    deleteSubmit: 'Request deletion',
    deleting: 'Requesting…',
    deletePending: (date: string) => `Scheduled for deletion on ${date}. You can cancel until then.`,
    deleteCancelAction: 'Cancel deletion request',
    cancelling: 'Cancelling…',
    deleteCancelled: 'Deletion request cancelled.',
    deleteFailed: 'Request failed. Check your password.',
    pauseTitle: 'Pause all processing',
    pauseBody: 'Stops recommendations and ranking rounds on all your profiles while your privacy request is fulfilled.',
    pauseAction: 'Pause processing',
    pausing: 'Pausing…',
    pauseDone: 'Processing paused.',
    resumeAction: 'Resume processing',
    resuming: 'Resuming…',
    resumeDone: 'Processing resumed.',
    pauseFailed: 'Could not complete. Please try again.',
    notYet: 'not built yet',
    failed: 'Could not save. Please try again.',
    loading: 'Loading…',
  },
};

type ModelStatus =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'building' }
  | { kind: 'trained'; version: string; band: ConfidenceBand }
  // The last job failed: 'invalid' = the ranked titles lack published
  // fingerprints, 'error' = the service itself failed (brief P0-01). Before
  // this, every one of these read as "not trained yet", with no reason.
  | { kind: 'failed'; errorKind: 'invalid' | 'error' | null; jobId: string | null }
  | { kind: 'not_published'; jobId: string | null }
  | { kind: 'disabled' }
  | { kind: 'unknown' };

export function ProfileScreen({ lang, onLanguageChange }: { lang: Lang; onLanguageChange?: (lang: Lang) => void }) {
  const { user, profile, logout, refreshProfile } = useSession();
  const t = labels[lang];
  // Which of the four the reader is inside; null is the hub.
  const [open, setOpen] = useState<'taste' | 'prefs' | 'account' | 'privacy' | null>(null);
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
  const [retraining, setRetraining] = useState(false);
  // Bumped after a training request so the readiness panel re-reads.
  const [retrainKey, setRetrainKey] = useState(0);
  const [retrainError, setRetrainError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; executeAfter: string | null } | null | 'loading'>('loading');
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseNotice, setPauseNotice] = useState<string | null>(null);
  const [paused, setPaused] = useState<boolean>(profile?.pausedAt !== null && profile?.pausedAt !== undefined);

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
    // ADR-108/110: the rounds count and the model's confidence both come
    // from readiness. Counting completed triads here included the `verify`
    // repeats that count toward nothing, and the band used to be read off a
    // one-item recommendation request -- which wrote a recommendations row
    // and stamped it shown for a list nobody ever saw.
    const [readiness, watchedTitles] = await Promise.all([
      api.getReadiness(profileId).catch(() => null),
      api.getWatchedTitles(profileId).catch(() => null),
    ]);
    setRounds(readiness ? readiness.rounds.learningRounds : null);
    setWatched(watchedTitles ? watchedTitles.length : null);
    try {
      const status = await api.getTrainingStatus(profileId);
      if (status.state === 'queued' || status.state === 'running') {
        setModel({ kind: 'building' });
      } else if (status.latestSnapshot) {
        // The model's own band, not one title's: a recommendation's band is
        // demoted by that title's fingerprint coverage (ADR-19), which says
        // something about the title, not about the model this screen names.
        setModel({
          kind: 'trained',
          version: status.latestSnapshot.modelVersion,
          band: readiness?.ordinalModel.confidenceBand ?? 'initial',
        });
      } else if (status.state === 'failed') {
        setModel({ kind: 'failed', errorKind: status.job?.errorKind ?? null, jobId: status.job?.id ?? null });
      } else if (status.state === 'succeeded') {
        // Built, never published: a job that ended well with nothing to serve.
        setModel({ kind: 'not_published', jobId: status.job?.id ?? null });
      } else if (status.state === 'disabled') {
        setModel({ kind: 'disabled' });
      } else if (status.state === 'unknown') {
        setModel({ kind: 'unknown' });
      } else {
        setModel({ kind: 'none' });
      }
    } catch {
      setModel({ kind: 'unknown' });
    }
  }, [profileId]);

  useEffect(() => {
    // loadStats' own setState calls all happen after an `await`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStats();
  }, [loadStats]);

  // Poll training status while a job is in progress.
  useEffect(() => {
    if (model.kind !== 'building' || !profileId) return;
    const id = window.setInterval(() => {
      void api.getTrainingStatus(profileId).then((status) => {
        if (status.state !== 'queued' && status.state !== 'running') {
          // Job finished (or failed); reload everything.
          void loadStats();
        }
      }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [model.kind, profileId, loadStats]);

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

  useEffect(() => {
    api
      .listPrivacyRequests()
      .then((requests) => {
        const pending = requests.find((r) => r.type === 'delete' && r.status === 'scheduled');
        setPendingDelete(pending ? { id: pending.id, executeAfter: pending.executeAfter } : null);
      })
      .catch(() => setPendingDelete(null));
  }, []);

  async function exportData() {
    if (!exportPassword || exportBusy) return;
    setExportBusy(true);
    setExportNotice(null);
    try {
      const data = await api.exportData(exportPassword);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reel-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportPassword('');
      setExportNotice(t.exportDone);
    } catch {
      setExportNotice(t.exportFailed);
    } finally {
      setExportBusy(false);
    }
  }

  async function requestAccountDelete() {
    if (!deletePassword || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteNotice(null);
    try {
      const result = await api.requestDelete(deletePassword);
      setPendingDelete({ id: result.id, executeAfter: result.executeAfter });
      setDeletePassword('');
    } catch {
      setDeleteNotice(t.deleteFailed);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function cancelAccountDelete() {
    if (pendingDelete === 'loading' || !pendingDelete || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteNotice(null);
    try {
      await api.cancelDelete(pendingDelete.id);
      setPendingDelete(null);
      setDeleteNotice(t.deleteCancelled);
    } catch {
      setDeleteNotice(t.deleteFailed);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function togglePause() {
    if (pauseBusy) return;
    setPauseBusy(true);
    setPauseNotice(null);
    try {
      if (paused) {
        await api.resumeAll();
        setPaused(false);
        setPauseNotice(t.resumeDone);
      } else {
        await api.pauseAll();
        setPaused(true);
        setPauseNotice(t.pauseDone);
      }
    } catch {
      setPauseNotice(t.pauseFailed);
    } finally {
      setPauseBusy(false);
    }
  }

  async function retrain() {
    if (!profileId || retraining || model.kind === 'building') return;
    setRetraining(true);
    setRetrainError(null);
    try {
      await api.requestTraining(profileId);
      setModel({ kind: 'building' });
      setRetrainKey((key) => key + 1);
    } catch (error) {
      // Said, not swallowed: the live round of 2026-09-05 pressed this button
      // and saw nothing at all (brief P0-01). The state stays; the reason the
      // request was refused is shown under the button.
      const reason = error instanceof ApiError ? (error.details ?? {}).reason : undefined;
      setRetrainError(
        reason === 'model_service_disabled'
          ? t.modelDisabled
          : reason === 'model_service_unreachable'
            ? t.modelUnreachable
            : reason === 'need_more_triads'
              ? t.trainNeedRounds
              : t.trainFailed,
      );
    } finally {
      setRetraining(false);
    }
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

  // UX_AUDIT_MOBILE_2026-09-05 P1 #10: one 3714px page held the account, the
  // preferences, a 28-country list, the alias id, the model, the readiness
  // panel, every consent with its date, and four irreversible actions. It is
  // a hub of four now: the page opens on the four cards, and one of them at a
  // time takes the screen. No routing -- the shell owns the tabs, and this is
  // one tab's inside.
  // One conventional glyph per card (owner's addendum 3): a face for the
  // account, sliders for preferences, a shield for privacy, a chart for what
  // the model has learned. Each is `aria-hidden` -- the card's own name is
  // beside it, so nothing here depends on recognising a picture.
  const sections = [
    {
      id: 'taste' as const,
      name: t.taste,
      hint: t.tasteHint,
      icon: (
        <>
          <path d="M4 19V9M10 19V5M16 19v-7M20.5 19H3.5" />
        </>
      ),
    },
    {
      id: 'prefs' as const,
      name: t.prefs,
      hint: t.prefsHint,
      icon: (
        <>
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </>
      ),
    },
    {
      id: 'account' as const,
      name: t.account,
      hint: t.accountHint,
      icon: (
        <>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20a7 7 0 0114 0" />
        </>
      ),
    },
    {
      id: 'privacy' as const,
      name: t.privacy,
      hint: t.privacyHint,
      icon: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
    },
  ];
  const current = sections.find((section) => section.id === open) ?? null;

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h2>{current ? current.name : t.title}</h2>
        {current && (
          <button type="button" className={styles.back} onClick={() => setOpen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
            {t.backToProfile}
          </button>
        )}
      </div>

      {notice && (
        <p className={notice.error ? `${styles.status} ${styles.error}` : styles.status} role="status">
          {t[notice.key]}
        </p>
      )}

      {!current && (
        <>
          {user && (
            <div className={styles.who}>
              <span className={styles.strong}>{user.email}</span>
            </div>
          )}
          <ul className={styles.hub}>
            {sections.map((section) => (
              <li key={section.id}>
                <button type="button" className={styles.hubCard} onClick={() => setOpen(section.id)}>
                  <svg
                    className={styles.hubIcon}
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {section.icon}
                  </svg>
                  <span className={styles.hubName}>{section.name}</span>
                  <span className={styles.hubHint}>{section.hint}</span>
                  <svg className={styles.hubChevron} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open === 'taste' && (
        <section className={styles.section} aria-label={t.taste}>

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
        {model.kind === 'building' && (
          <p className={styles.buildingNote}>
            <span className={styles.spinner} aria-hidden="true" />
            {t.modelBuilding}
            <span className={styles.buildingHint}>{t.modelBuildingNote}</span>
          </p>
        )}
        {model.kind === 'failed' && (
          <p role="alert">
            {model.errorKind === 'invalid' ? t.modelFailedInvalid : t.modelFailed}
            {model.jobId && <> {t.modelSupport(model.jobId)}</>}
          </p>
        )}
        {model.kind === 'not_published' && (
          <p role="alert">
            {t.modelNotPublished}
            {model.jobId && <> {t.modelSupport(model.jobId)}</>}
          </p>
        )}
        {model.kind === 'disabled' && <p role="alert">{t.modelDisabled}</p>}
        {model.kind === 'unknown' && <p role="alert">{t.modelUnreachable}</p>}
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
        {/* Anything the user can retry or start: not while a build runs, and
            not on a server that has no model service to ask. */}
        {(model.kind === 'none' || model.kind === 'trained' || model.kind === 'failed' || model.kind === 'not_published' || model.kind === 'unknown') && (
          <button type="button" className={styles.secondary} onClick={retrain} disabled={retraining}>
            {retraining ? t.modelRetraining : t.modelRetrain}
          </button>
        )}
        {retrainError && (
          <p className={styles.error} role="alert">
            {retrainError}
          </p>
        )}
        {/* The four capabilities, straight from the readiness contract
            (ADR-103). It sits under the model block rather than replacing
            it: the block above is what this profile's model *is*, the panel
            is what the product can do for you right now and what it still
            needs -- the question the brief §5.1 said one "trained or not"
            flag could never answer. `retrainKey` re-reads it after a
            training request, so the panel and the button never disagree. */}
        <ReadinessPanel profileId={profileId ?? null} lang={lang} refreshKey={retrainKey} />
        <p>{t.detailPending}</p>
        </section>
      )}

      {open === 'prefs' && (
        <section className={styles.section} aria-label={t.prefs}>
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
        </section>
      )}

      {open === 'account' && (
        <section className={styles.section} aria-label={t.account}>
        <h3>{t.account}</h3>
        {user && (
          <p>
            {/* An account created since the door stopped asking has no name
                (2026-09-05); the address is what identifies it. */}
            {(user.firstName || user.lastName) && (
              <>
                <span className={styles.strong}>{[user.firstName, user.lastName].filter(Boolean).join(' ')}</span>
                <br />
              </>
            )}
            {user.email}
          </p>
        )}
        <div className={styles.row}>
          <button type="button" className={styles.ghost} onClick={logout}>
            {t.logout}
          </button>
        </div>
        </section>
      )}

      {open === 'privacy' && (
        <section className={styles.section} aria-label={t.privacy}>
        <h3>{t.privacy}</h3>
        <p>{t.privacyBody}</p>
        <p>
          <Link href={`/privacy?lang=${lang}`} className={styles.docLink}>
            {t.privacyLink}
          </Link>
          {' · '}
          <Link href={`/data-notice?lang=${lang}`} className={styles.docLink}>
            {t.dataLink}
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

        {/* Export (PRIVACY.md §5, ALPHA 2.4): synchronous JSON at Alpha scale;
            password re-verifies the account before handing the document. */}
        <p className={styles.strong}>{t.exportAction}</p>
        <p>{t.exportBody}</p>
        <div className={styles.passwordRow}>
          <input
            type="password"
            className={styles.passwordInput}
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            placeholder={t.exportPassword}
            autoComplete="current-password"
            aria-label={t.exportPassword}
            disabled={exportBusy}
          />
          <button type="button" className={styles.ghost} onClick={exportData} disabled={exportBusy || !exportPassword}>
            {exportBusy ? t.exporting : t.exportSubmit}
          </button>
        </div>
        {exportNotice && <p className={styles.notice} role="status">{exportNotice}</p>}

        {/* Delete account (PRIVACY.md §5 §10, ALPHA 2.4): 30-day scheduled,
            cancellable, password-verified. */}
        <p className={styles.strong}>{t.deleteAction}</p>
        {pendingDelete === 'loading' ? (
          <p>{t.loading}</p>
        ) : pendingDelete ? (
          <>
            <p>
              {t.deletePending(
                pendingDelete.executeAfter
                  ? new Date(pendingDelete.executeAfter).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '—',
              )}
            </p>
            <div className={styles.row}>
              <button type="button" className={`${styles.ghost} ${styles.danger}`} onClick={cancelAccountDelete} disabled={deleteBusy}>
                {deleteBusy ? t.cancelling : t.deleteCancelAction}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{t.deleteBody}</p>
            <div className={styles.passwordRow}>
              <input
                type="password"
                className={styles.passwordInput}
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder={t.deletePassword}
                autoComplete="current-password"
                aria-label={t.deletePassword}
                disabled={deleteBusy}
              />
              <button
                type="button"
                className={`${styles.ghost} ${styles.danger}`}
                onClick={requestAccountDelete}
                disabled={deleteBusy || !deletePassword}
              >
                {deleteBusy ? t.deleting : t.deleteSubmit}
              </button>
            </div>
          </>
        )}
        {deleteNotice && <p className={styles.notice} role="status">{deleteNotice}</p>}

        <h3>{t.pauseTitle}</h3>
        <p>{t.pauseBody}</p>
        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.ghost} ${paused ? styles.danger : ''}`}
            onClick={togglePause}
            disabled={pauseBusy}
          >
            {pauseBusy ? (paused ? t.resuming : t.pausing) : (paused ? t.resumeAction : t.pauseAction)}
          </button>
        </div>
        {pauseNotice && <p className={styles.notice} role="status">{pauseNotice}</p>}
        </section>
      )}
    </div>
  );
}
