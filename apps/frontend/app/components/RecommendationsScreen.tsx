'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError, type ProfileReadiness, type Recommendation, type RecommendationTrack, type TrainingSummary } from '../lib/api';
import { TRACK_COPY } from '../lib/copy';
import { formatConfidence, formatNumber, todayLocal, topTraits, type PersonalFitLevel } from '../lib/format';
import { WorkCard } from './WorkCard';
import { Poster } from './Poster';
import { genreLabel } from '../lib/genres';
import { Toast } from '../lib/toast';
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
    heroCaption: 'هذه الليلة، حكاية جديدة.',
    exploreFilm: 'اكتشف الفيلم',
    personalSelection: 'من اقتراحاتك',
    // The four values are shown, not described (ADR-111): the paragraph that
    // said so is gone, and this strip says what the model has learned so far
    // -- once, at the top, instead of a confidence sentence under every card.
    tasteTitle: 'ذوقك حتى الآن',
    rounds: 'جولات رتّبتها',
    watchedTitles: 'أفلام شاهدتها',
    traits: 'ما تعلّمناه',
    traitsPending: 'ما زلنا نجمع سماتك.',
    confidenceOnce: (band: string) => `الثقة: ${band}`,
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
      // Only the readiness contract can tell this apart from "no model"
      // (ADR-103): النموذج جاهز، والحوض فارغ.
      noCandidates: {
        title: 'نموذجك جاهز، ولا أفلام جديدة نقترحها',
        body: 'كل ما في الكتالوج اليوم إمّا شاهدته أو استبعدته. يتّسع الكتالوج باستمرار، وتظهر اقتراحات جديدة كلما أُضيفت أفلام.',
      },
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
    // A shelf of tiles has no action buttons, so every track needs a way in --
    // not only the ones with items left over (ADR-111).
    openTrack: 'افتح المسار',
    showLess: 'عرض أقل',
    addToList: 'أضف إلى قائمتي',
    added: 'في قائمتك',
    markWatched: 'شاهدته',
    watchedNotice: (title: string) => `سُجّل «${title}» كمُشاهَد وسيدخل جولات الترتيب.`,
    notRelevantNotice: (title: string) => `أُخفي «${title}». سجّلنا أن هذا الاقتراح لم يناسبك.`,
    listNotice: (title: string) => `أُضيف «${title}» إلى قائمتك.`,
    actionFailed: 'تعذّر الحفظ. حاول مجددًا.',
  },
  en: {
    eyebrow: "Tonight's pick",
    title: 'Recommended for you',
    heroCaption: 'A new story. Tonight.',
    exploreFilm: 'Explore the film',
    personalSelection: 'Picked for you',
    tasteTitle: 'Your taste so far',
    rounds: 'rounds ranked',
    watchedTitles: 'films watched',
    traits: 'what we learned',
    traitsPending: 'Still gathering your traits.',
    confidenceOnce: (band: string) => `Confidence: ${band}`,
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
      noCandidates: {
        title: 'Your model is ready; there is nothing new to suggest',
        body: 'Everything in the catalogue today is either watched or set aside. The catalogue keeps growing, and suggestions appear as films are added.',
      },
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
    openTrack: 'Open the track',
    showLess: 'Show less',
    addToList: 'Add to my list',
    added: 'On your list',
    markWatched: 'Watched it',
    watchedNotice: (title: string) => `“${title}” is marked watched and will enter ranking rounds.`,
    notRelevantNotice: (title: string) => `“${title}” is hidden. We recorded that this suggestion missed.`,
    listNotice: (title: string) => `“${title}” was added to your list.`,
    actionFailed: 'Could not save. Please try again.',
  },
};

// `pending` carries the watched count so its one action leads where progress
// is possible: the triad needs three watched titles first (SPEC §5.1). Once
// `needed` is 0 it carries the training state instead, and the screen says
// which of the situations below the user is actually in.
type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; readiness: ProfileReadiness | null }
  | { kind: 'pending'; watched: number | null; needed: number; training: TrainingSummary; readiness: ProfileReadiness | null }
  | { kind: 'paused' }
  | { kind: 'outdated' }
  | { kind: 'failed' };

type PendingSituation =
  | 'rounds'
  | 'building'
  | 'notStarted'
  | 'noFingerprints'
  | 'failed'
  | 'notPublished'
  | 'disabled'
  | 'unreachable'
  // A ready model with an empty candidate pool. Nothing in the training
  // state can express this -- it is the distinction ADR-103 exists for.
  | 'noCandidates';

// The readiness contract answers the capability question directly (ADR-103):
// it is the only source that can say "the model is ready, the pool is empty",
// and it names a disabled service and a coverage failure without inferring
// them from a job's state. What it cannot do is tell a job that succeeded
// without publishing from a service that could not be reached -- both arrive
// as `model_service_error` -- so the training state still refines those two.
// Readiness first, the local inference only for what it leaves open; if the
// readiness read itself failed, the screen falls back to what it always did
// rather than losing an explanation.
function situationFor(needed: number, training: TrainingSummary, readiness: ProfileReadiness | null): PendingSituation {
  const capability = readiness?.recommendation;
  if (capability) {
    if (capability.reason === 'insufficient_eligible_candidates') return 'noCandidates';
    if (capability.reason === 'model_service_disabled') return 'disabled';
    if (capability.status === 'queued' || capability.status === 'processing') return 'building';
    if (capability.reason === 'insufficient_fingerprint_coverage') return 'noFingerprints';
    if (capability.reason === 'insufficient_triads') return 'rounds';
  }
  return pendingSituation(needed, training);
}

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

// Readiness is an explanation, not a dependency: if it cannot be read the
// screen still renders from the recommendations response alone.
async function readinessOrNull(profileId: string): Promise<ProfileReadiness | null> {
  try {
    return await api.getReadiness(profileId);
  } catch {
    return null;
  }
}

type RecommendationsScreenProps = {
  lang: Lang;
  profileId: string;
  onGoToRank?: () => void;
  onGoToDiscover?: () => void;
  // Opens the work page with this recommendation as its context (blueprint §5.3).
  onOpenTitle?: (rec: Recommendation, position: number, count: number, listed: boolean) => void;
};

export function RecommendationsScreen(props: RecommendationsScreenProps) {
  return <ProfileRecommendations key={props.profileId} {...props} />;
}

function ProfileRecommendations({ lang, profileId, onGoToRank, onGoToDiscover, onOpenTitle }: RecommendationsScreenProps) {
  const t = labels[lang];
  const tracks = TRACK_COPY[lang];
  const [items, setItems] = useState<Recommendation[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
  const [pendingTitles, setPendingTitles] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const listOverridesRef = useRef(new Map<string, boolean>());
  const lifetimeRef = useRef(0);
  const [requesting, setRequesting] = useState(false);
  const [listed, setListed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<RecommendationTrack>>(new Set());
  // ADR-110: which recommendations this screen has already reported as seen.
  // A ref, not state: reporting an impression must never cause a render, and
  // the set is read and written inside the same effect that computes it.
  const reportedRef = useRef<Set<string>>(new Set());

  // The keyed profile boundary resets local state. The lifetime also guards
  // completions after navigation and Strict Mode's discarded effect pass.
  useEffect(() => {
    const lifetime = ++lifetimeRef.current;
    return () => { lifetimeRef.current = lifetime + 1; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.getWatchlist(profileId).then((watchlist) => {
      if (cancelled) return;
      const saved = new Set(watchlist.map((entry) => entry.titleId));
      for (const [titleId, listed] of listOverridesRef.current) {
        if (listed) saved.add(titleId);
        else saved.delete(titleId);
      }
      setListed(saved);
    }).catch(() => {
      // Local confirmed saves still work when the persisted list cannot load.
    });
    return () => { cancelled = true; };
  }, [profileId]);

  function beginTitleAction(titleId: string): number | null {
    if (pendingRef.current.has(titleId)) return null;
    pendingRef.current.add(titleId);
    setPendingTitles(new Set(pendingRef.current));
    return lifetimeRef.current;
  }

  function finishTitleAction(titleId: string, lifetime: number) {
    if (lifetime !== lifetimeRef.current) return;
    pendingRef.current.delete(titleId);
    setPendingTitles(new Set(pendingRef.current));
  }

  // Exactly the items on screen right now: the preview slice of each track,
  // plus everything in the tracks the reader expanded. An item further down
  // an unexpanded track was created but not shown, and saying otherwise is
  // what made "shown" meaningless before ADR-110.
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const track of TRACK_ORDER) {
      const trackItems = items.filter((item) => item.track === track);
      const shown = expanded.has(track) ? trackItems : trackItems.slice(0, TRACK_PREVIEW);
      for (const item of shown) {
        ids.push(item.recommendationId);
      }
    }
    return ids;
  }, [items, expanded]);

  useEffect(() => {
    const fresh = visibleIds.filter((id) => id && !reportedRef.current.has(id));
    if (fresh.length === 0) {
      return;
    }
    for (const id of fresh) {
      reportedRef.current.add(id);
    }
    // A lost impression is a lost measurement, never a lost feature: this
    // never blocks the render and never surfaces an error to the reader.
    void api.recordImpressions(profileId, fresh).catch(() => {});
  }, [visibleIds, profileId]);

  // `silent` refreshes in place (the poll while a model is being built) --
  // no skeleton flash every few seconds.
  const load = useCallback(async (silent = false) => {
    const lifetime = lifetimeRef.current;
    if (!silent) {
      setPhase({ kind: 'loading' });
    }
    try {
      // ADR-80: 200 with a discriminator instead of 409/400.
      // 15 items covers 3–5 per each of the three tracks (blueprint §5.3).
      const result = await api.getRecommendations(profileId, 15);
      if (lifetime !== lifetimeRef.current) return;
      if (result.state === 'ready' && result.items.length > 0) {
        setItems(result.items);
        // The cards paint first; the taste strip's counts follow. Readiness is
        // a second request (ADR-103) and the list must not wait on it -- if it
        // never answers, the strip shows the traits it can read from the items
        // themselves and nothing is claimed that was not measured.
        setPhase({ kind: 'ready', readiness: null });
        void readinessOrNull(profileId).then((readiness) => {
          if (!readiness || lifetime !== lifetimeRef.current) return;
          setPhase((current) => (current.kind === 'ready' ? { ...current, readiness } : current));
        });
      } else if (result.state === 'ready') {
        // A ready model that returned nothing: an empty list is not an
        // answer, so ask readiness why (ADR-103 -- almost always an empty
        // candidate pool) and say it.
        setItems([]);
        const readiness = await readinessOrNull(profileId);
        if (lifetime !== lifetimeRef.current) return;
        setPhase({
          kind: 'pending',
          watched: null,
          needed: 0,
          training: { state: 'succeeded', jobId: null, errorKind: null, completedTriads: 0, nextTrainingAt: null },
          readiness,
        });
      } else if (result.state === 'pending') {
        let watched: number | null = null;
        if (result.needed > 0) {
          try {
            watched = (await api.getWatchedTitles(profileId)).length;
          } catch {
            watched = null;
          }
        }
        const readiness = await readinessOrNull(profileId);
        if (lifetime !== lifetimeRef.current) return;
        setPhase({ kind: 'pending', watched, needed: result.needed, training: result.training, readiness });
      } else if (result.state === 'paused') {
        setPhase({ kind: 'paused' });
      } else {
        setPhase({ kind: 'outdated' });
      }
    } catch {
      if (lifetime !== lifetimeRef.current) return;
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
    const lifetime = lifetimeRef.current;
    setRequesting(true);
    try {
      await api.requestTraining(profileId);
      if (lifetime !== lifetimeRef.current) return;
      setNoticeTone('success');
      setNotice(t.trainRequested);
      await load(true);
    } catch (error) {
      if (lifetime !== lifetimeRef.current) return;
      setNoticeTone('error');
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
      if (lifetime === lifetimeRef.current) setRequesting(false);
    }
  }

  async function addToList(rec: Recommendation) {
    const lifetime = beginTitleAction(rec.title.id);
    if (lifetime === null) return;
    const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
    try {
      await api.setTitleState(profileId, rec.title.id, { state: 'watchlist' });
      // The outcome names the recommendation, not just the title (ADR-110).
      void api.recordOutcome(rec.recommendationId, 'saved').catch(() => {});
      if (lifetime !== lifetimeRef.current) return;
      listOverridesRef.current.set(rec.title.id, true);
      setListed((current) => new Set(current).add(rec.title.id));
      setNoticeTone('success');
      setNotice(t.listNotice(name));
    } catch {
      if (lifetime !== lifetimeRef.current) return;
      setNoticeTone('error');
      setNotice(t.actionFailed);
    } finally {
      finishTitleAction(rec.title.id, lifetime);
    }
  }

  async function markWatched(rec: Recommendation) {
    const lifetime = beginTitleAction(rec.title.id);
    if (lifetime === null) return;
    const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
    try {
      // A watched title leaves the candidate pool and becomes eligible for
      // later triads (blueprint §4.5) -- no rating is asked, ever (ADR-4).
      // ADR-104: the device's own local day, never the server's UTC clock.
      // The watch event, not the bare state PATCH (ADR-110): it marks the
      // title watched *and* writes the outcome row that closes §4.5's loop
      // back to the recommendation this watch actually followed.
      await api.recordWatchEvent(profileId, {
        titleId: rec.title.id,
        watchedOn: todayLocal(),
        recommendationId: rec.recommendationId,
      });
      if (lifetime !== lifetimeRef.current) return;
      listOverridesRef.current.set(rec.title.id, false);
      setListed((current) => { const next = new Set(current); next.delete(rec.title.id); return next; });
      setItems((current) => current.filter((item) => item.title.id !== rec.title.id));
      setNoticeTone('success');
      setNotice(t.watchedNotice(name));
    } catch {
      if (lifetime !== lifetimeRef.current) return;
      setNoticeTone('error');
      setNotice(t.actionFailed);
    } finally {
      finishTitleAction(rec.title.id, lifetime);
    }
  }

  // The only negative signal this product collects about a *suggestion* --
  // never about the film (BP §2.4 principle #2). It hides the card and
  // records the outcome; nothing about the title's own state changes.
  async function markNotRelevant(rec: Recommendation) {
    const lifetime = beginTitleAction(rec.title.id);
    if (lifetime === null) return;
    const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
    try {
      await api.recordOutcome(rec.recommendationId, 'dismissed_not_relevant');
      if (lifetime !== lifetimeRef.current) return;
      setItems((current) => current.filter((item) => item.title.id !== rec.title.id));
      setNoticeTone('success');
      setNotice(t.notRelevantNotice(name));
    } catch {
      if (lifetime !== lifetimeRef.current) return;
      setNoticeTone('error');
      setNotice(t.actionFailed);
    } finally {
      finishTitleAction(rec.title.id, lifetime);
    }
  }

  // What the model has learned, said once at the top (ADR-111, audit P0 #4
  // and #15): the counts come from the readiness contract, the traits from
  // the reasons of the very items below, and the confidence band is the
  // model's own -- so nothing here is a number this screen invented.
  const rounds = phase.kind === 'ready' ? (phase.readiness?.rounds ?? null) : null;
  const band = phase.kind === 'ready' ? (phase.readiness?.recommendation.confidenceBand ?? null) : null;
  const traits = phase.kind === 'ready' ? topTraits(items.map((item) => item.reason), lang) : [];
  // Choose artwork only from the recommendations already in the visible
  // shelves. An absent image is never replaced by an invented film still.
  const featured = items.find((item) => item.title.posterUrl && visibleIds.includes(item.recommendationId)) ?? items[0];
  const featuredTrack = featured ? items.filter((item) => item.track === featured.track) : [];

  function openFeatured() {
    if (!featured || !onOpenTitle) return;
    void api.recordOutcome(featured.recommendationId, 'clicked').catch(() => {});
    onOpenTitle(featured, featuredTrack.indexOf(featured) + 1, featuredTrack.length, listed.has(featured.title.id));
  }

  const tasteStrip = phase.kind === 'ready' && (rounds || traits.length > 0 || band) && (
    <section className={styles.taste} aria-label={t.tasteTitle}>
      {rounds && (
        <dl className={styles.counts}>
          <div>
            <dd>{formatNumber(rounds.learningRounds, lang)}</dd>
            <dt>{t.rounds}</dt>
          </div>
          <div>
            <dd>{formatNumber(rounds.watchedTitles, lang)}</dd>
            <dt>{t.watchedTitles}</dt>
          </div>
        </dl>
      )}
      <div className={styles.traitRow}>
        {traits.length > 0 ? (
          traits.map((trait) => (
            <span key={trait} className={styles.trait}>
              {trait}
            </span>
          ))
        ) : (
          <span className={styles.traitsPending}>{t.traitsPending}</span>
        )}
        {band && <span className={styles.confidenceOnce}>{t.confidenceOnce(formatConfidence(band, lang).label)}</span>}
      </div>
    </section>
  );

  const header = (
    <div className={styles.header}>
      <p className={styles.eyebrow}>{t.eyebrow}</p>
      <h2>{t.title}</h2>
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
    const situation = situationFor(phase.needed, phase.training, phase.readiness);
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
    const actionLabel =
      situation === 'notStarted'
        ? t.trainNow
        : situation === 'unreachable'
          ? t.trainRetry
          : situation === 'failed' || situation === 'noFingerprints' || situation === 'notPublished'
            ? t.trainRetry
            : null;
    const runAction = () => { if (situation === 'unreachable') void load(); else void trainNow(); };
    const showSupport = phase.training.jobId !== null && situation !== 'building' && situation !== 'notStarted' && situation !== 'noCandidates';
    return (
      <div className={styles.screen}>
        {header}
        {/* An empty catalogue pool is a calm state, not an alarm: 'status'
            like a build in progress, not 'alert' like a failure. */}
        <div className={styles.pending} role={situation === 'building' || situation === 'noCandidates' ? 'status' : 'alert'}>
          <h3>{copy.title}</h3>
          <p>{copy.body}</p>
          {showSupport && <p className={styles.support}>{t.support(phase.training.jobId as string)}</p>}
          {notice && (
            <Toast message={notice} onDismiss={() => setNotice(null)} tone={noticeTone} />
          )}
          {actionLabel && (
            <button type="button" className={styles.cta} onClick={runAction} disabled={requesting}>
              {requesting ? t.trainRequesting : actionLabel}
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

  return (
    <div className={`${styles.screen} ${styles.ready}`}>
      {header}
      {featured && (
        <section className={styles.hero} aria-label={t.eyebrow}
          style={featured.title.posterUrl ? ({ '--hero-image': `url("${featured.title.posterUrl}")` } as CSSProperties) : undefined}>
          <div className={styles.heroBackdrop} aria-hidden="true" />
          <div className={styles.heroContent}>
            <span className={styles.heroKicker}><i aria-hidden="true" />{t.personalSelection}</span>
            <p className={styles.heroCaption}>{t.heroCaption}</p>
            <h3 className={styles.heroTitle} dir="auto">{featured.title.titleEn || featured.title.titleAr}</h3>
            {lang === 'ar' && featured.title.titleAr !== featured.title.titleEn && <p className={styles.heroArabic}>{featured.title.titleAr}</p>}
            <div className={styles.heroMeta}>
              {featured.title.releaseYear && <span>{featured.title.releaseYear}</span>}
              {featured.title.genres?.slice(0, 2).map((genre) => <span key={genre}>{genreLabel(genre, lang)}</span>)}
              <span>{tracks[featured.track].name}</span>
            </div>
            <div className={styles.heroActions}>
              {onOpenTitle && <button type="button" className={styles.heroPrimary} onClick={openFeatured}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>{t.exploreFilm}
              </button>}
              <button type="button" className={styles.heroSave} onClick={() => addToList(featured)} disabled={pendingTitles.has(featured.title.id) || listed.has(featured.title.id)}>
                <svg viewBox="0 0 24 24" fill={listed.has(featured.title.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M7 4h10v16l-5-3.5L7 20z" /></svg>
                {listed.has(featured.title.id) ? t.added : t.addToList}
              </button>
            </div>
          </div>
          <div className={styles.heroPosterWrap} aria-hidden="true"><Poster title={featured.title} size="lg" className={styles.heroPoster} name={featured.title.titleEn} /></div>
          <span className={styles.heroEdition} aria-hidden="true">KOLME / TONIGHT</span>
        </section>
      )}
      {notice && (
        <Toast message={notice} onDismiss={() => setNotice(null)} tone={noticeTone} />
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
              <ol className={isExpanded ? styles.list : styles.rail}>
                {shown.map((rec, index) => (
                  <li key={rec.title.id} className={styles.item}>
                    {/* The work card owns the four values and the reason
                        (docs/WORK_CARD_DESIGN_2026-09-03.md); this screen keeps
                        the tracks, the list state and the actions' effects. */}
                    <WorkCard
                      lang={lang}
                      position={index + 1}
                      count={trackItems.length}
                      // A shelf shows tiles; opening the track gives the full
                      // cards back, with the reason and the three actions.
                      compact={!isExpanded}
                      recommendation={rec}
                      listed={listed.has(rec.title.id)}
                      busy={pendingTitles.has(rec.title.id)}
                      onAddToList={() => addToList(rec)}
                      onMarkWatched={() => markWatched(rec)}
                      onNotRelevant={() => markNotRelevant(rec)}
                      onOpen={
                        onOpenTitle
                          ? () => {
                              // The click is an outcome of this exact
                              // recommendation (ADR-110), reported beside
                              // the navigation, never in place of it.
                              void api.recordOutcome(rec.recommendationId, 'clicked').catch(() => {});
                              onOpenTitle(rec, index + 1, trackItems.length, listed.has(rec.title.id));
                            }
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ol>
              {(
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
                  {isExpanded ? t.showLess : hidden > 0 ? t.showMore(formatNumber(hidden, lang)) : t.openTrack}
                </button>
              )}
              </>
            )}
          </section>
        );
      })}

      {tasteStrip}

    </div>
  );
}
