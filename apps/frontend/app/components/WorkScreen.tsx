'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { api, type FingerprintDimension, type LibraryRankingItem, type Recommendation, type Title, type TitleState } from '../lib/api';
import { FEATURE_REASON_COPY } from '../lib/copy';
import { Poster } from './Poster';
import { WorkCard } from './WorkCard';
import styles from './WorkScreen.module.css';

type Lang = 'ar' | 'en';

/**
 * The work page (blueprint §5.3 "صفحة العمل"): one title with its content
 * fingerprint, the reason it fits, and public quality and availability kept
 * separate. Opened from a card on Home, the Library or Discover; the context
 * the card came with (a recommendation, or a library ranking row) is shown
 * as-is, through the same WorkCard cells, never recomputed.
 *
 * The API returns the public title only (no raw fingerprint, by design:
 * M2 / DATA_LICENSING). API.md targets a "fingerprint summary (reviewed
 * features only)"; until GET /titles/:id carries it, the section says so.
 * `fingerprintSummary` below is the shape proposed to the backend: reviewed
 * dimensions with a level, no numbers.
 */
type FingerprintLevel = 'low' | 'mid' | 'high';
type PublicTitle = Title & {
  fingerprintSummary?: { key: FingerprintDimension; level: FingerprintLevel }[] | null;
};

export type WorkContext =
  | { kind: 'recommendation'; recommendation: Recommendation; position: number; count: number }
  | { kind: 'ranking'; item: LibraryRankingItem; position: number; count: number }
  | { kind: 'none' };

const DIMENSIONS: FingerprintDimension[] = [
  'pacing',
  'rhythmVariance',
  'ambiguity',
  'psychologicalDepth',
  'warmth',
  'darkness',
  'linearity',
  'dialogueDensity',
  'actionIntensity',
  'plotComplexity',
  'visualComplexity',
  'soundscapeComplexity',
  'colorSaturation',
  // V2 families (ADR-69); `ending.*` is left out on purpose: spoilers.
  'narrative.revelation',
  'narrative.perspective',
  'narrative.unreliability',
  'tone.irony',
  'tone.unease',
  'tone.catharsis',
  'tone.compassion',
  'characters.agency',
  'characters.moralAmbiguity',
  'characters.transformation',
  'characters.relationshipCentrality',
];

// The dimension names (FINGERPRINT_SCHEMA.md §2), for the fingerprint section
// only; the reason line keeps using FEATURE_REASON_COPY phrases.
const DIMENSION_NAMES: Record<Lang, Record<FingerprintDimension, string>> = {
  ar: {
    pacing: 'الإيقاع',
    rhythmVariance: 'تقلّب الإيقاع',
    ambiguity: 'الغموض',
    psychologicalDepth: 'العمق النفسي',
    warmth: 'الدفء',
    darkness: 'القتامة',
    linearity: 'خطّية السرد',
    dialogueDensity: 'كثافة الحوار',
    actionIntensity: 'كثافة الحركة',
    plotComplexity: 'تعقيد الحبكة',
    visualComplexity: 'الغنى البصري',
    soundscapeComplexity: 'الغنى الصوتي',
    colorSaturation: 'تشبّع الألوان',
    'narrative.revelation': 'الكشف التدريجي',
    'narrative.perspective': 'تعدد وجهات النظر',
    'narrative.unreliability': 'موثوقية الراوي',
    'tone.irony': 'السخرية',
    'tone.unease': 'التوتر',
    'tone.catharsis': 'التفريغ العاطفي',
    'tone.compassion': 'التعاطف',
    'characters.agency': 'فاعلية الشخصيات',
    'characters.moralAmbiguity': 'الغموض الأخلاقي',
    'characters.transformation': 'تحوّل الشخصيات',
    'characters.relationshipCentrality': 'مركزية العلاقات',
    'ending.openness': '',
    'ending.twist': '',
    'ending.justice': '',
    'ending.optimism': '',
  },
  en: {
    pacing: 'Pacing',
    rhythmVariance: 'Rhythm variance',
    ambiguity: 'Ambiguity',
    psychologicalDepth: 'Psychological depth',
    warmth: 'Warmth',
    darkness: 'Darkness',
    linearity: 'Linearity',
    dialogueDensity: 'Dialogue density',
    actionIntensity: 'Action intensity',
    plotComplexity: 'Plot complexity',
    visualComplexity: 'Visual complexity',
    soundscapeComplexity: 'Soundscape complexity',
    colorSaturation: 'Colour saturation',
    'narrative.revelation': 'Revelation',
    'narrative.perspective': 'Perspectives',
    'narrative.unreliability': 'Narrator reliability',
    'tone.irony': 'Irony',
    'tone.unease': 'Unease',
    'tone.catharsis': 'Catharsis',
    'tone.compassion': 'Compassion',
    'characters.agency': 'Character agency',
    'characters.moralAmbiguity': 'Moral ambiguity',
    'characters.transformation': 'Transformation',
    'characters.relationshipCentrality': 'Relationships',
    'ending.openness': '',
    'ending.twist': '',
    'ending.justice': '',
    'ending.optimism': '',
  },
};

const labels = {
  ar: {
    back: 'رجوع',
    eyebrow: 'صفحة العمل',
    fingerprint: 'بصمة المحتوى',
    fingerprintNote: 'سمات مراجَعة تصف العمل نفسه، لا حكمًا عليه ولا توقعًا لذوقك.',
    fingerprintPending: 'لم تُنشر بصمة هذا العمل بعد.',
    fit: 'ملاءمته لك',
    fitNote: 'كما ظهرت في المكان الذي فتحت منه هذا العمل؛ أربع قيم منفصلة.',
    noContext: 'افتح هذا العمل من توصية أو من ترتيبك لترى ملاءمته لك هنا.',
    yourState: 'حالته عندك',
    watched: 'شاهدته',
    later: 'لاحقًا',
    onList: 'في قائمتك',
    isWatched: 'مُشاهَد',
    undo: 'تراجع',
    watchedNotice: 'سُجّل كمُشاهَد وسيدخل جولات الترتيب.',
    laterNotice: 'أُضيف إلى قائمتك.',
    undoNotice: 'أُلغي التسجيل. لا يُحتسب ضدّه.',
    actionFailed: 'تعذّر الحفظ. حاول مجددًا.',
    level: { low: 'منخفض', mid: 'متوسط', high: 'مرتفع' } satisfies Record<FingerprintLevel, string>,
  },
  en: {
    back: 'Back',
    eyebrow: 'Work page',
    fingerprint: 'Content fingerprint',
    fingerprintNote: 'Reviewed traits describing the work itself -- not a verdict, not a prediction of your taste.',
    fingerprintPending: 'This work’s fingerprint has not been published yet.',
    fit: 'How it fits you',
    fitNote: 'As shown where you opened this work from; four separate values.',
    noContext: 'Open this work from a recommendation or your ranking to see how it fits you here.',
    yourState: 'Your status',
    watched: 'Watched it',
    later: 'Later',
    onList: 'On your list',
    isWatched: 'Watched',
    undo: 'Undo',
    watchedNotice: 'Marked as watched; it will enter ranking rounds.',
    laterNotice: 'Added to your list.',
    undoNotice: 'No longer marked. It does not count against it.',
    actionFailed: 'Could not save. Please try again.',
    level: { low: 'Low', mid: 'Medium', high: 'High' } satisfies Record<FingerprintLevel, string>,
  },
};

const SEGMENTS: Record<FingerprintLevel, number> = { low: 1, mid: 2, high: 3 };

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function WorkScreen({
  lang,
  profileId,
  title,
  context,
  initialState,
  onBack,
}: {
  lang: Lang;
  profileId: string;
  title: Title;
  context: WorkContext;
  // The exposure/list state known where the card came from, if any.
  initialState?: TitleState | null;
  onBack: () => void;
}) {
  const t = labels[lang];
  const names = DIMENSION_NAMES[lang];
  const [state, setState] = useState<TitleState | null>(initialState ?? null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The originating screen only knows what happened on it this session; the
  // server's lists are the record (watched wins over the watchlist).
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getWatchedTitles(profileId), api.getWatchlist(profileId)])
      .then(([watched, watchlist]) => {
        if (cancelled) return;
        const isWatched = watched.some((entry) => entry.titleId === title.id && entry.state === 'watched');
        const isListed = watchlist.some((entry) => entry.titleId === title.id);
        setState(isWatched ? 'watched' : isListed ? 'watchlist' : null);
      })
      .catch(() => {
        // Keep what the originating screen knew.
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, title.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const name = lang === 'ar' ? title.titleAr : title.titleEn;
  const alt = lang === 'ar' ? title.titleEn : title.titleAr;
  const showAlt = Boolean(alt && alt !== name);
  const summary = (title as PublicTitle).fingerprintSummary ?? null;
  const known = new Map((summary ?? []).map((entry) => [entry.key, entry.level]));

  // Only exposure/list states are written here -- never a rating (ADR-4);
  // undo returns the title to "exposure unknown" (blueprint §2.4 #3).
  async function change(next: TitleState, message: string) {
    setBusy(true);
    try {
      await api.setTitleState(profileId, title.id, { state: next });
      setState(next);
      setNotice(message);
    } catch {
      setNotice(t.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ChevronIcon />
        {t.back}
      </button>

      {/* Q21: the backdrop is the poster itself, blurred, under a gradient to
          the ground; the frontend composes no image URL of its own. */}
      <div
        className={title.posterUrl ? `${styles.header} ${styles.withImage}` : styles.header}
        style={title.posterUrl ? ({ '--hero-image': `url("${title.posterUrl}")` } as CSSProperties) : undefined}
      >
        <Poster title={title} size="lg" className={styles.headerPoster} />
        <div className={styles.headerText}>
        <p className={styles.eyebrow}>{t.eyebrow}</p>
        <h2>{name}</h2>
        {(showAlt || title.releaseYear) && (
          <p className={styles.alt}>
            {showAlt && <bdi>{alt}</bdi>}
            {showAlt && title.releaseYear ? ' · ' : ''}
            {title.releaseYear ? String(title.releaseYear) : ''}
          </p>
        )}
        {title.genres && title.genres.length > 0 && (
          <ul className={styles.genres}>
            {title.genres.map((genre) => (
              <li key={genre}>{genre}</li>
            ))}
          </ul>
        )}
        </div>
        {/* Full width under the poster on the phone: a synopsis in the narrow
            column beside a 120px poster wrapped every few words. */}
        <div className={styles.headerBelow}>
          {/* Catalogue descriptions arrive in their own language: direction from the text. */}
          {title.description && (
            <p className={styles.desc} dir="auto">
              {title.description}
            </p>
          )}
          {title.posterSource?.attribution && (
            <p className={styles.credit} dir="auto">
              {title.posterSource.attribution}
            </p>
          )}
        </div>
      </div>

      {notice && (
        <p className={styles.status} role="status">
          {notice}
        </p>
      )}

      {/* The fit, exactly as the originating surface showed it (ADR-33: the
          same four cells, never merged, never recomputed here). */}
      <section className={styles.section} aria-label={t.fit}>
        <h3>{t.fit}</h3>
        {context.kind === 'recommendation' && (
          <>
            <p className={styles.sectionNote}>{t.fitNote}</p>
            <WorkCard
              lang={lang}
              position={context.position}
              count={context.count}
              recommendation={context.recommendation}
              listed={state === 'watchlist'}
              busy={busy}
              headless
            />
          </>
        )}
        {context.kind === 'ranking' && (
          <>
            <p className={styles.sectionNote}>{t.fitNote}</p>
            <WorkCard lang={lang} kind="ranking" item={context.item} position={context.position} count={context.count} headless />
          </>
        )}
        {context.kind === 'none' && <span className={styles.hollow}>{t.noContext}</span>}
      </section>

      {/* Content fingerprint: reviewed dimensions as levels, in the text colour
          (the accent is reserved for personal fit). */}
      <section className={styles.section} aria-label={t.fingerprint}>
        <h3>{t.fingerprint}</h3>
        <p className={styles.sectionNote}>{t.fingerprintNote}</p>
        {summary && summary.length > 0 ? (
          <ul className={styles.dims}>
            {DIMENSIONS.filter((key) => known.has(key)).map((key) => {
              const level = known.get(key) as FingerprintLevel;
              return (
                <li key={key} className={styles.dim}>
                  <span className={styles.dimName}>{names[key]}</span>
                  <div className={styles.meter} aria-hidden="true">
                    {[1, 2, 3].map((segment) => (
                      <i key={segment} className={segment <= SEGMENTS[level] ? styles.on : undefined} />
                    ))}
                  </div>
                  <span className={styles.dimWord}>
                    {level === 'high' ? FEATURE_REASON_COPY[lang][key].higher : level === 'low' ? FEATURE_REASON_COPY[lang][key].lower : t.level.mid}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className={styles.hollow}>{t.fingerprintPending}</span>
        )}
      </section>

      <section className={styles.section} aria-label={t.yourState}>
        <h3>{t.yourState}</h3>
        <div className={styles.actions}>
          {state === 'watched' ? (
            <>
              <span className={styles.hollow}>{t.isWatched}</span>
              <button type="button" className={styles.ghost} onClick={() => change('not_watched', t.undoNotice)} disabled={busy}>
                {t.undo}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.primary} onClick={() => change('watched', t.watchedNotice)} disabled={busy}>
                {t.watched}
              </button>
              <button
                type="button"
                className={state === 'watchlist' ? `${styles.ghost} ${styles.later}` : styles.ghost}
                onClick={() => change('watchlist', t.laterNotice)}
                disabled={busy || state === 'watchlist'}
              >
                {state === 'watchlist' ? t.onList : t.later}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
