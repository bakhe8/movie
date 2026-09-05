'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { api, type FingerprintDimension, type LibraryRankingItem, type Recommendation, type Title, type TitleState } from '../lib/api';
import { FEATURE_REASON_COPY } from '../lib/copy';
import { genreLabel } from '../lib/genres';
import { todayLocal } from '../lib/format';
import { PublicQualityCell } from '../public-quality/PublicQualityCell';
import { collectSources, SourcesFooter } from '../public-quality/SourcesFooter';
import { Poster } from './Poster';
import { WorkCard } from './WorkCard';
import { Toast } from '../lib/toast';
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
    fingerprint: 'سمات العمل',
    fingerprintNote: 'سمات مراجَعة تصف العمل نفسه، لا حكمًا عليه ولا توقعًا لذوقك.',
    fingerprintPending: 'لم تُنشر سمات هذا العمل بعد.',
    fit: 'ملاءمته لك',
    quality: 'الجودة العامة',
    qualityNote: 'درجة خارجية بمصدرها وتاريخها؛ لا تُدمج مع ملاءمتك ولا تُرتَّب بها.',
    fitNote: 'كما ظهرت في المكان الذي فتحت منه هذا العمل؛ أربع قيم منفصلة.',
    noContext: 'افتح هذا العمل من توصية أو من ترتيبك لترى ملاءمته لك هنا.',
    yourState: 'حالته عندك',
    summaryForeign: 'الملخص (بالإنجليزية)',
    summary: 'عن الفيلم',
    film: 'داخل الحكاية',
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
    fingerprint: 'What the film is like',
    fingerprintNote: 'Reviewed traits describing the work itself -- not a verdict, not a prediction of your taste.',
    fingerprintPending: 'These traits have not been published for this film yet.',
    fit: 'How it fits you',
    quality: 'Public quality',
    qualityNote: 'An external score with its source and date; never merged with your fit, never used to rank you.',
    fitNote: 'As shown where you opened this work from; four separate values.',
    noContext: 'Open this work from a recommendation or your ranking to see how it fits you here.',
    yourState: 'Your status',
    summaryForeign: 'Summary (in Arabic)',
    summary: 'About the film',
    film: 'Inside the story',
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
  // The card's copy of the title is what it was when listed; the page reads
  // the title itself for what only GET /titles/:id carries (Public Quality
  // today; the poster and the fingerprint summary as they land). Until it
  // arrives, the card's copy renders.
  const [fresh, setFresh] = useState<Title | null>(null);
  const detail: Title = fresh ? { ...title, ...fresh } : title;

  useEffect(() => {
    let cancelled = false;
    api
      .getTitle(title.id)
      .then((loaded) => {
        if (!cancelled) setFresh(loaded);
      })
      .catch(() => {
        // The card's copy stays.
      });
    return () => {
      cancelled = true;
    };
  }, [title.id]);

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

  const name = lang === 'ar' ? detail.titleAr : detail.titleEn;
  const alt = lang === 'ar' ? detail.titleEn : detail.titleAr;
  const showAlt = Boolean(alt && alt !== name);
  // Catalogue text comes in the source's own language (Wikipedia today), so
  // "is this the reader's language?" is answered by the script it is written
  // in, not by a field the API does not send.
  const foreignSynopsis = Boolean(detail.description) && /[؀-ۿ]/.test(detail.description ?? '') !== (lang === 'ar');
  const summary = (detail as PublicTitle).fingerprintSummary ?? null;
  const known = new Map((summary ?? []).map((entry) => [entry.key, entry.level]));

  // Only exposure/list states are written here -- never a rating (ADR-4);
  // undo returns the title to "exposure unknown" (blueprint §2.4 #3).
  async function change(next: TitleState, message: string) {
    setBusy(true);
    try {
      // ADR-104: the device's own local day, never the server's UTC clock,
      // and only when actually marking watched right now.
      await api.setTitleState(profileId, title.id, next === 'watched' ? { state: next, watchedOn: todayLocal() } : { state: next });
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

      {/* The current contract carries a poster, not a separate backdrop.
          Its artwork becomes the cover without composing another image URL. */}
      <div
        className={styles.header}
        style={detail.posterUrl ? ({ '--hero-image': `url("${detail.posterUrl}")` } as CSSProperties) : undefined}
      >
        <Poster title={detail} size="lg" className={styles.headerPoster} name={name} />
        <div className={styles.headerText}>
        <p className={styles.eyebrow}>{t.film}</p>
        <h2>{name}</h2>
        {(showAlt || title.releaseYear) && (
          <p className={styles.alt}>
            {showAlt && <bdi>{alt}</bdi>}
            {title.releaseYear && (
              <span className={styles.yearTail}>
                {showAlt ? ' · ' : ''}
                {String(title.releaseYear)}
              </span>
            )}
          </p>
        )}
        {title.genres && title.genres.length > 0 && (
          <ul className={styles.genres}>
            {title.genres.map((genre) => (
              <li key={genre}>{genreLabel(genre, lang)}</li>
            ))}
          </ul>
        )}
        </div>
      <section className={styles.stateSection} aria-label={t.yourState}>
        <h3 className={styles.srOnly}>{t.yourState}</h3>
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
                {/* The tick and the bookmark are what these two actions look
                    like everywhere (owner's addendum 3); the words stay,
                    because a primary action names itself. */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12l5 5 9-10" />
                </svg>
                {t.watched}
              </button>
              <button
                type="button"
                className={state === 'watchlist' ? `${styles.ghost} ${styles.later}` : styles.ghost}
                onClick={() => change('watchlist', t.laterNotice)}
                disabled={busy || state === 'watchlist'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill={state === 'watchlist' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 4h10v16l-5-3.5L7 20z" />
                </svg>
                {state === 'watchlist' ? t.onList : t.later}
              </button>
            </>
          )}
        </div>
      </section>

        {/* Full width under the poster on the phone: a synopsis in the narrow
            column beside a 120px poster wrapped every few words. */}
        <div className={styles.headerBelow}>
          {/* Catalogue descriptions arrive in their own language: direction from the text. */}
          {detail.description && (
              /* An Arabic screen led with an English Wikipedia paragraph, left
                 aligned inside a right-aligned card, before anything about the
                 reader (UX_AUDIT_MOBILE_2026-09-05 P0 #6). Catalogue text
                 arrives in whatever language the source wrote it, so when it
                 is not the reader's it folds away under a named summary. */
              <details className={styles.synopsis}>
                <summary>{foreignSynopsis ? t.summaryForeign : t.summary}</summary>
                <p className={styles.desc} dir="auto">
                  {detail.description}
                </p>
              </details>
          )}
          {/* No attribution sentence here: every third-party credit on the page
              lives in the SourcesFooter at the end (owner, 2026-09-04). */}
        </div>
      </div>

      {notice && (
        <Toast message={notice} onDismiss={() => setNotice(null)} tone={notice === t.actionFailed ? 'error' : 'success'} />
      )}

      {/* The fit, exactly as the originating surface showed it (ADR-33: the
          same four cells, never merged, never recomputed here). */}
      <section className={styles.section} aria-label={t.fit}>
        <h3>{t.fit}</h3>
        {context.kind === 'recommendation' && (
          <>
            <WorkCard
              lang={lang}
              position={context.position}
              count={context.count}
              recommendation={context.recommendation}
              listed={state === 'watchlist'}
              busy={busy}
              headless
              withoutQuality
            />
          </>
        )}
        {context.kind === 'ranking' && (
          <>
            <WorkCard lang={lang} kind="ranking" item={context.item} position={context.position} count={context.count} headless />
          </>
        )}
        {context.kind === 'none' && <span className={styles.hollow}>{t.noContext}</span>}
      </section>

      {/* Public Quality: a fact about the title, separate from the fit
          (blueprint §5.3, §10.3; ALPHA_PLAN 5.3): one row per source with its
          attribution verbatim and the rights badge; null stays hollow. */}
      <section className={styles.section} aria-label={t.quality}>
        <h3>{t.quality}</h3>
        <p className={styles.srOnly}>{t.qualityNote}</p>
        <dl className={styles.qualityList}>
          <PublicQualityCell quality={detail.publicQuality} lang={lang} headless />
        </dl>
      </section>

      {/* Content fingerprint: reviewed dimensions as levels, in the text colour
          (the accent is reserved for personal fit). */}
      <section className={styles.section} aria-label={t.fingerprint}>
        <h3>{t.fingerprint}</h3>
        <p className={styles.srOnly}>{t.fingerprintNote}</p>
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

      {/* One place for every third-party credit on this page: the sources
          line, the badge, the verbatim lines folded (DATA_NOTICE_COPY §2).
          Unmounting this one line is the whole removal once the agreements land. */}
      <SourcesFooter lang={lang} sources={collectSources(detail)} />

    </div>
  );
}
