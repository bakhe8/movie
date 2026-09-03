'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Recommendation, type RecommendationTrack } from '../lib/api';
import { TRACK_COPY } from '../lib/copy';
import { formatNumber, type PersonalFitLevel } from '../lib/format';
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
// is possible: the triad needs three watched titles first (SPEC §5.1).
type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'pending'; watched: number | null } | { kind: 'failed' };

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
  const [listed, setListed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<RecommendationTrack>>(new Set());

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      // The home screen is "tonight's decision": a short list per track
      // (blueprint §5.3), so 15 covers 3–5 items on each of three tracks.
      const result = await api.getRecommendations(profileId, 15);
      setItems(result);
      setPhase({ kind: 'ready' });
    } catch (err) {
      // 409 is the backend's honest "no trained preference model yet"
      // (RecommendationsService); anything else is a real failure.
      if (err instanceof ApiError && err.status === 409) {
        let watched: number | null = null;
        try {
          watched = (await api.getWatchedTitles(profileId)).length;
        } catch {
          watched = null;
        }
        setPhase({ kind: 'pending', watched });
      } else {
        setPhase({ kind: 'failed' });
      }
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
      await api.setTitleState(profileId, rec.title.id, { state: 'watched' });
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

  if (phase.kind === 'failed') {
    return (
      <div className={styles.screen}>
        {header}
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {t.failed}
        </p>
        <button type="button" className={styles.retry} onClick={load}>
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
