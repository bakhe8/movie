'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Recommendation, type RecommendationTrack } from '../lib/api';
import { TRACK_COPY } from '../lib/copy';
import { formatConfidence, formatNumber, formatPersonalFit, formatReason, type PersonalFitLevel } from '../lib/format';
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

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'pending' } | { kind: 'failed' };

export function RecommendationsScreen({
  lang,
  profileId,
  onGoToRank,
}: {
  lang: Lang;
  profileId: string;
  onGoToRank?: () => void;
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
      setPhase(err instanceof ApiError && err.status === 409 ? { kind: 'pending' } : { kind: 'failed' });
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
      <p className="eyebrow">{t.eyebrow}</p>
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
          {onGoToRank && (
            <button type="button" className="cta" onClick={onGoToRank}>
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
        <button type="button" className="cta full" onClick={load}>
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
          <section key={track} className={styles.track} aria-label={tracks[track].name}>
            <div className={styles.trackHeader}>
              <h3>{tracks[track].name}</h3>
              <p>{tracks[track].purpose}</p>
            </div>
            {trackItems.length === 0 ? (
              <p className={styles.empty}>{t.emptyTrack}</p>
            ) : (
              <>
              <ol className={styles.list}>
                {shown.map((rec, index) => {
                  const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
                  const alt = lang === 'ar' ? rec.title.titleEn : rec.title.titleAr;
                  const meta = [rec.title.releaseYear, rec.title.genres?.join(' · ')].filter(Boolean).join(' · ');
                  // Relative forms only: position inside the track and a tertile
                  // level -- never the raw score (ADR-33).
                  const fit = formatPersonalFit(index + 1, trackItems.length);
                  const confidence = formatConfidence(rec.confidenceBand, lang);
                  // The reason names only the dimensions that lifted the score
                  // (§9.4); when confidence is weak it says so (§9.4 last rule).
                  const reason = formatReason(rec.reason, lang);
                  const weak = rec.confidenceBand === 'inconclusive' || rec.confidenceBand === 'initial';
                  const busy = busyTitleId === rec.title.id;
                  const onList = listed.has(rec.title.id);

                  return (
                    <li key={rec.title.id} className={styles.card}>
                      <div className={styles.top}>
                        <span className={styles.badge} aria-hidden="true">
                          {formatNumber(index + 1, lang)}
                        </span>
                        <div>
                          <h4 className={styles.title}>{name}</h4>
                          {alt && alt !== name && <p className={styles.alt}>{alt}</p>}
                          {meta && <p className={styles.meta}>{meta}</p>}
                          {rec.title.description && <p className={styles.desc}>{rec.title.description}</p>}
                          {reason && (
                            <p className={styles.reason}>
                              {reason} {weak && t.reasonWeak}
                              <span className={styles.reasonSource}>{t.reasonSource}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Four separate values in four labelled cells; no cell
                          repeats another and nothing is merged (blueprint §4.4,
                          ADR-20, ADR-33). Unknown stays unknown, never 0. */}
                      <dl className={styles.cells}>
                        <div className={styles.cell}>
                          <dt>{t.fit}</dt>
                          <dd>
                            <span className={`${styles.chip} ${styles[fit.level]}`}>{t.fitLevel[fit.level]}</span>
                            <span className={styles.sub}>
                              {t.fitPosition(formatNumber(fit.position, lang), formatNumber(fit.count, lang))}
                            </span>
                          </dd>
                        </div>
                        <div className={styles.cell}>
                          <dt>{t.quality}</dt>
                          <dd className={rec.publicQualityScore === null ? styles.unknown : undefined}>
                            {rec.publicQualityScore === null ? t.qualityUnknown : formatNumber(rec.publicQualityScore, lang)}
                          </dd>
                        </div>
                        <div className={styles.cell}>
                          <dt>{t.availability}</dt>
                          <dd className={rec.watchabilityScore === null ? styles.unknown : undefined}>
                            {rec.watchabilityScore === null ? t.availabilityUnknown : formatNumber(rec.watchabilityScore, lang)}
                          </dd>
                        </div>
                        <div className={styles.cell}>
                          <dt>{t.confidence}</dt>
                          <dd>
                            <span className={`${styles.chip} ${styles.band}`}>{confidence.label}</span>
                            <span className={styles.sub}>{confidence.copy}</span>
                            {rec.fingerprintCoverage < 1 && <span className={styles.sub}>{t.partialFingerprint}</span>}
                          </dd>
                        </div>
                      </dl>

                      <div className={styles.actions}>
                        <button type="button" className={styles.ghost} onClick={() => addToList(rec)} disabled={busy || onList}>
                          {onList ? t.added : t.addToList}
                        </button>
                        <button type="button" className={styles.ghost} onClick={() => markWatched(rec)} disabled={busy}>
                          {t.markWatched}
                        </button>
                      </div>
                    </li>
                  );
                })}
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
