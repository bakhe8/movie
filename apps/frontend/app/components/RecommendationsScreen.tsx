'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Recommendation, type RecommendationTrack, type TrainingSummary } from '../lib/api';
import { TRACK_COPY } from '../lib/copy';
import { formatNumber, todayLocal, type PersonalFitLevel } from '../lib/format';
import { WorkCard } from './WorkCard';
import styles from './RecommendationsScreen.module.css';

type Lang = 'ar' | 'en';

// Blueprint §4.4 order: the safe track first, then the two exploratory ones.
const TRACK_ORDER: RecommendationTrack[] = ['safe', 'discovery', 'outside_usual'];
// "Each track short: 3–5 items on the home screen" (blueprint §5.3).
const TRACK_PREVIEW = 5;

const labels = {
  ar: {
    eyebrow: 'قرار الليلة',
    title: 'المقترح لك',
    hint: 'لكل فيلم أربع قيم منفصلة: الملاءمة الشخصية، الجودة العامة، التوفر، والثقة. لا نجمعها في رقم واحد.',
    pendingTitle: 'ما زلنا نتعلم ذوقك',
    pendingBody: 'التوصيات تظهر بعد أن يُدرَّب نموذجك على جولات ترتيب كافية.',
    // Once the rounds are enough, the backend says what became of them; each
    // situation is named here, never "still learning" over a failure the
    // user cannot see (live round 2026-09-05, brief P0-01/P0-03).
    training: {
      building: { title: 'جارٍ بناء نموذجك', body: 'تُعالَج جولاتك الآن. يستغرق هذا عادةً بضع دقائق، وتتحدّث هذه الصفحة تلقائيًا.' },
      notStarted: { title: 'جولاتك تكفي للبدء', body: 'اكتملت جولات كافية ولم يبدأ التدريب بعد. اطلبه الآن.' },
      noFingerprints: {
        title: 'جولاتك محفوظة، والنموذج ينتظر تحليل الأفلام',
        body: 'الأفلام التي رتّبتها لا تملك بعدُ تحليلًا منشورًا يكفي لبناء نموذج. لم يضع شيء من اختياراتك؛ يُعاد التدريب عندما يُنشر التحليل أو عند طلبك.',
      },
      failed: { title: 'تعذّر بناء نموذجك', body: 'حدث خطأ أثناء التدريب. اختياراتك محفوظة.' },
      notPublished: { title: 'اكتمل التدريب ولم يُنشر النموذج', body: 'اختياراتك محفوظة. أعد المحاولة، وإن تكرّر أرفق رمز الدعم.' },
      disabled: { title: 'التدريب غير مفعَّل على هذا الخادم', body: 'جولاتك محفوظة. هذا إعداد تشغيلي يعالجه مشغّل الخدمة، لا أنت.' },
      unreachable: { title: 'تعذّر الوصول إلى خدمة النموذج', body: 'جولاتك محفوظة. حاول بعد قليل.' },
    },
    trainNow: 'درّب نموذجي الآن',
    trainRetry: 'أعد المحاولة',
    trainRequesting: 'جارٍ الطلب…',
    trainRequested: 'أُرسل طلب التدريب.',
    trainFailed: 'تعذّر إرسال طلب التدريب.',
    support: (id: string) => `رمز الدعم: ${id}`,
    pausedTitle: 'المعالجة موقوفة مؤقتًا',
    pausedBody: 'طلبك قيد التنفيذ. يمكنك استئناف المعالجة في إعدادات الخصوصية.',
    outdatedTitle: 'يحتاج نموذجك تحديثًا',
    outdatedBody: 'مُخطَّط التدريب تغيّر. رتّب بضعة أفلام إضافية لإعادة البناء.',
    goRank: 'إلى الترتيب',
    goDiscover: 'اختر أفلامًا شاهدتها',
    emptyTrack: 'لا اقتراحات في هذا المسار بعد.',
    emptyAll: 'لا توجد توصيات حاليًا. سجّل مزيدًا من الأفلام أو أكمل جولات ترتيب أكثر.',
    failed: 'تعذّر تحميل التوصيات.',
    retry: 'إعادة المحاولة',
    fit: 'الملاءمة الشخصية',
    fitLevel: { high: 'عالية', medium: 'متوسطة', low: 'أقل' } satisfies Record<PersonalFitLevel, string>,
    fitPosition: (position: string, count: string) => `${position} من ${count} في هذا المسار`,
    quality: 'الجودة العامة',
    qualityUnknown: 'لا مصدر مرخّص بعد',
    availability: 'التوفر',
    availabilityUnknown: 'غير معروف بعد',
    confidence: 'الثقة',
    partialFingerprint: 'بعض سمات هذا الفيلم غير معروفة، فخُفّضت الثقة درجة.',
    reasonSource: 'من اختياراتك أنت',
    reasonWeak: 'والدليل ما زال قليلًا.',
    showMore: (n: string) => `عرض ${n} أخرى`,
    showLess: 'عرض أقل',
    addToList: 'أضف إلى قائمتي',
    added: 'في قائمتك',
    markWatched: 'شاهدته',
    watchedNotice: (title: string) => `سُجّل «${title}» كمُشاهَد وسيدخل جولات الترتيب.`,
    listNotice: (title: string) => `أُضيف «${title}» إلى قائمتك.`,
    actionFailed: 'تعذّر الحفظ. حاول مجددًا.',
    model: (version: string) => `إصدار النموذج: ${version}`,
  },
  en: {
    eyebrow: "Tonight's pick",
    title: 'Recommended for you',
    hint: 'Each film shows four separate values: personal fit, public quality, availability and confidence. They are never merged into one number.',
    pendingTitle: 'Still learning your taste',
    pendingBody: 'Recommendations appear once your model has been trained on enough ranking rounds.',
    training: {
      building: { title: 'Building your model', body: 'Your rounds are being processed. This usually takes a few minutes; this page refreshes on its own.' },
      notStarted: { title: 'Your rounds are enough to start', body: 'Enough rounds are complete, but training has not started yet. Request it now.' },
      noFingerprints: {
        title: 'Your rounds are saved; the model is waiting for the films’ analysis',
        body: 'The films you ranked do not yet have enough published analysis to build a model from. Nothing you chose is lost; training runs again once the analysis is published, or when you ask.',
      },
      failed: { title: 'Your model could not be built', body: 'Training hit an error. Your choices are saved.' },
      notPublished: { title: 'Training finished but no model was published', body: 'Your choices are saved. Try again; if it repeats, quote the support code.' },
      disabled: { title: 'Training is not enabled on this server', body: 'Your rounds are saved. This is an operational setting for the service operator, not for you.' },
      unreachable: { title: 'The model service could not be reached', body: 'Your rounds are saved. Try again in a moment.' },
    },
    trainNow: 'Train my model now',
    trainRetry: 'Try again',
    trainRequesting: 'Requesting…',
    trainRequested: 'Training requested.',
    trainFailed: 'The training request could not be sent.',
    support: (id: string) => `Support code: ${id}`,
    pausedTitle: 'Processing paused',
    pausedBody: 'Your request is in progress. You can resume processing from privacy settings.',
    outdatedTitle: 'Model needs updating',
    outdatedBody: 'The training schema changed. Rank a few more films to rebuild.',
    goRank: 'Go to ranking',
    goDiscover: 'Pick films you have watched',
    emptyTrack: 'Nothing on this track yet.',
    emptyAll: 'No recommendations right now. Log more films or complete more ranking rounds.',
    failed: 'Recommendations could not be loaded.',
    retry: 'Try again',
    fit: 'Personal fit',
    fitLevel: { high: 'High', medium: 'Medium', low: 'Lower' } satisfies Record<PersonalFitLevel, string>,
    fitPosition: (position: string, count: string) => `${position} of ${count} on this track`,
    quality: 'Public quality',
    qualityUnknown: 'No licensed source yet',
    availability: 'Availability',
    availabilityUnknown: 'Unknown yet',
    confidence: 'Confidence',
    partialFingerprint: 'Some of this film’s traits are unknown, so confidence was lowered one band.',
    reasonSource: 'from your own choices',
    reasonWeak: 'The evidence is still thin.',
    showMore: (n: string) => `Show ${n} more`,
    showLess: 'Show less',
    addToList: 'Add to my list',
    added: 'On your list',
    markWatched: 'Watched it',
    watchedNotice: (title: string) => `“${title}” is marked watched and will enter ranking rounds.`,
    listNotice: (title: string) => `“${title}” was added to your list.`,
    actionFailed: 'Could not save. Please try again.',
    model: (version: string) => `Model version: ${version}`,
  },
};

// `pending` carries the watched count so its one action leads where progress
// is possible: the triad needs three watched titles first (SPEC §5.1). Once
// `needed` is 0 it carries the training state instead, and the screen says
// which of the situations below the user is actually in.
type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'pending'; watched: number | null; needed: number; training: TrainingSummary }
  | { kind: 'paused' }
  | { kind: 'outdated' }
  | { kind: 'failed' };

type PendingSituation = 'rounds' | 'building' | 'notStarted' | 'noFingerprints' | 'failed' | 'notPublished' | 'disabled' | 'unreachable';

function pendingSituation(needed: number, training: TrainingSummary): PendingSituation {
  if (needed > 0) {
    return 'rounds';
  }
  switch (training.state) {
    case 'queued':
    case 'running':
      return 'building';
    case 'failed':
      return training.errorKind === 'invalid' ? 'noFingerprints' : 'failed';
    // A job that succeeded with no snapshot to serve: built, never published.
    case 'succeeded':
      return 'notPublished';
    case 'disabled':
      return 'disabled';
    case 'unknown':
      return 'unreachable';
    // 'idle': enough rounds, nothing ever requested (the automatic trigger
    // missed, or the service was down at the time). 'paused' is answered at
    // the top level and never reaches here.
    default:
      return 'notStarted';
  }
}

export function RecommendationsScreen({
  lang,
  profileId,
  onGoToRank,
  onGoToDiscover,
  onOpenTitle,
}: {
  lang: Lang;
  profileId: string;
  onGoToRank?: () => void;
  onGoToDiscover?: () => void;
  // Opens the work page with this recommendation as its context (blueprint §5.3).
  onOpenTitle?: (rec: Recommendation, position: number, count: number, listed: boolean) => void;
}) {
  const t = labels[lang];
  const tracks = TRACK_COPY[lang];
  const [items, setItems] = useState<Recommendation[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [busyTitleId, setBusyTitleId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [listed, setListed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<RecommendationTrack>>(new Set());

  // `silent` refreshes in place (the poll while a model is being built) --
  // no skeleton flash every few seconds.
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setPhase({ kind: 'loading' });
    }
    try {
      // ADR-80: 200 with a discriminator instead of 409/400.
      // 15 items covers 3–5 per each of the three tracks (blueprint §5.3).
      const result = await api.getRecommendations(profileId, 15);
      if (result.state === 'ready') {
        setItems(result.items);
        setPhase({ kind: 'ready' });
      } else if (result.state === 'pending') {
        let watched: number | null = null;
        if (result.needed > 0) {
          try {
            watched = (await api.getWatchedTitles(profileId)).length;
          } catch {
            watched = null;
          }
        }
        setPhase({ kind: 'pending', watched, needed: result.needed, training: result.training });
      } else if (result.state === 'paused') {
        setPhase({ kind: 'paused' });
      } else {
        setPhase({ kind: 'outdated' });
      }
    } catch {
      setPhase({ kind: 'failed' });
    }
  }, [profileId]);

  useEffect(() => {
    // load's own setState calls all happen after an `await`, inside its
    // async body, not synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // While the model service works on the rounds, refresh quietly until it is
  // done -- the same 5-second poll the profile screen runs.
  useEffect(() => {
    if (phase.kind !== 'pending') return;
    const { state } = phase.training;
    if (state !== 'queued' && state !== 'running') return;
    const id = window.setInterval(() => {
      void load(true);
    }, 5000);
    return () => window.clearInterval(id);
  }, [phase, load]);

  // The request to train lives where the user waits for its result, not only
  // under the profile screen, and its refusal is said (brief P0-01: the live
  // round clicked "update my model" and saw nothing at all).
  async function trainNow() {
    setRequesting(true);
    try {
      await api.requestTraining(profileId);
      setNotice(t.trainRequested);
      await load(true);
    } catch (error) {
      const reason = error instanceof ApiError ? (error.details ?? {}).reason : undefined;
      setNotice(
        reason === 'model_service_disabled'
          ? t.training.disabled.title
          : reason === 'model_service_unreachable'
            ? t.training.unreachable.title
            : reason === 'paused'
              ? t.pausedTitle
              : t.trainFailed,
      );
    } finally {
      setRequesting(false);
    }
  }

  async function addToList(rec: Recommendation) {
    const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
    setBusyTitleId(rec.title.id);
    try {
      await api.setTitleState(profileId, rec.title.id, { state: 'watchlist' });
      setListed((current) => new Set(current).add(rec.title.id));
      setNotice(t.listNotice(name));
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusyTitleId(null);
    }
  }

  async function markWatched(rec: Recommendation) {
    const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
    setBusyTitleId(rec.title.id);
    try {
      // A watched title leaves the candidate pool and becomes eligible for
      // later triads (blueprint §4.5) -- no rating is asked, ever (ADR-4).
      // ADR-104: the device's own local day, never the server's UTC clock.
      await api.setTitleState(profileId, rec.title.id, { state: 'watched', watchedOn: todayLocal() });
      setItems((current) => current.filter((item) => item.title.id !== rec.title.id));
      setNotice(t.watchedNotice(name));
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusyTitleId(null);
    }
  }

  const header = (
    <div className={styles.header}>
      <p className={styles.eyebrow}>{t.eyebrow}</p>
      <h2>{t.title}</h2>
      {phase.kind === 'ready' && <p className={styles.hint}>{t.hint}</p>}
    </div>
  );

  if (phase.kind === 'loading') {
    return (
      <div className={styles.screen} aria-busy="true">
        {header}
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (phase.kind === 'pending') {
    const situation = pendingSituation(phase.needed, phase.training);
    if (situation === 'rounds') {
      return (
        <div className={styles.screen}>
          {header}
          <div className={styles.pending} role="status">
            <h3>{t.pendingTitle}</h3>
            <p>{t.pendingBody}</p>
            {/* One tap towards progress: Discover until three watched titles
                exist (the triad is blocked below that), then the triad. */}
            {phase.watched !== null && phase.watched < 3 && onGoToDiscover ? (
              <button type="button" className={styles.cta} onClick={onGoToDiscover}>
                {t.goDiscover}
              </button>
            ) : (
              onGoToRank && (
                <button type="button" className={styles.cta} onClick={onGoToRank}>
                  {t.goRank}
                </button>
              )
            )}
          </div>
        </div>
      );
    }
    const copy = t.training[situation];
    // 'building' and 'disabled' offer nothing to press: one is in progress,
    // the other is not the user's to fix. 'unreachable' re-reads the state;
    // every failure asks the model service again.
    const action =
      situation === 'notStarted'
        ? { label: t.trainNow, run: trainNow }
        : situation === 'unreachable'
          ? { label: t.trainRetry, run: () => void load() }
          : situation === 'failed' || situation === 'noFingerprints' || situation === 'notPublished'
            ? { label: t.trainRetry, run: trainNow }
            : null;
    const showSupport = phase.training.jobId !== null && situation !== 'building' && situation !== 'notStarted';
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.pending} role={situation === 'building' ? 'status' : 'alert'}>
          <h3>{copy.title}</h3>
          <p>{copy.body}</p>
          {showSupport && <p className={styles.support}>{t.support(phase.training.jobId as string)}</p>}
          {notice && (
            <p className={styles.status} role="status">
              {notice}
            </p>
          )}
          {action && (
            <button type="button" className={styles.cta} onClick={action.run} disabled={requesting}>
              {requesting ? t.trainRequesting : action.label}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === 'paused') {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.pending} role="status">
          <h3>{t.pausedTitle}</h3>
          <p>{t.pausedBody}</p>
        </div>
      </div>
    );
  }

  if (phase.kind === 'outdated') {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.pending} role="status">
          <h3>{t.outdatedTitle}</h3>
          <p>{t.outdatedBody}</p>
          {onGoToRank && (
            <button type="button" className={styles.cta} onClick={onGoToRank}>
              {t.goRank}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div className={styles.screen}>
        {header}
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {t.failed}
        </p>
        <button type="button" className={styles.retry} onClick={() => void load()}>
          {t.retry}
        </button>
      </div>
    );
  }

  const modelVersions = [...new Set(items.map((item) => item.modelVersion))];

  return (
    <div className={styles.screen}>
      {header}
      {notice && (
        <p className={styles.status} role="status">
          {notice}
        </p>
      )}
      {items.length === 0 && <p className={styles.status}>{t.emptyAll}</p>}

      {TRACK_ORDER.map((track) => {
        const trackItems = items.filter((item) => item.track === track);
        const isExpanded = expanded.has(track);
        const shown = isExpanded ? trackItems : trackItems.slice(0, TRACK_PREVIEW);
        const hidden = trackItems.length - shown.length;
        return (
          <section key={track} className={styles.track} data-track={track} aria-label={tracks[track].name}>
            <div className={styles.trackHeader}>
              <h3>{tracks[track].name}</h3>
              <p>{tracks[track].purpose}</p>
            </div>
            {trackItems.length === 0 ? (
              <p className={styles.empty}>{t.emptyTrack}</p>
            ) : (
              <>
              <ol className={styles.list}>
                {shown.map((rec, index) => (
                  <li key={rec.title.id} className={styles.item}>
                    {/* The work card owns the four values and the reason
                        (docs/WORK_CARD_DESIGN_2026-09-03.md); this screen keeps
                        the tracks, the list state and the actions' effects. */}
                    <WorkCard
                      lang={lang}
                      position={index + 1}
                      count={trackItems.length}
                      recommendation={rec}
                      listed={listed.has(rec.title.id)}
                      busy={busyTitleId === rec.title.id}
                      onAddToList={() => addToList(rec)}
                      onMarkWatched={() => markWatched(rec)}
                      onOpen={onOpenTitle ? () => onOpenTitle(rec, index + 1, trackItems.length, listed.has(rec.title.id)) : undefined}
                    />
                  </li>
                ))}
              </ol>
              {(hidden > 0 || isExpanded) && (
                <button
                  type="button"
                  className={styles.more}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(track)) next.delete(track);
                      else next.add(track);
                      return next;
                    })
                  }
                >
                  {isExpanded ? t.showLess : t.showMore(formatNumber(hidden, lang))}
                </button>
              )}
              </>
            )}
          </section>
        );
      })}

      {/* Which model produced this list (PRIVACY.md §12 transparency). */}
      {modelVersions.map((version) => (
        <p key={version} className={styles.model}>
          {t.model(version)}
        </p>
      ))}
    </div>
  );
}
