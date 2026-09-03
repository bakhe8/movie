'use client';

import type { LibraryRankingItem, Recommendation } from '../lib/api';
import { TRACK_COPY } from '../lib/copy';
import { formatConfidence, formatNumber, formatPersonalFit, formatReason, type PersonalFitLevel } from '../lib/format';
import { PublicQualityCell } from '../public-quality/PublicQualityCell';
import type { PublicQuality } from '../public-quality/types';
import { Poster } from './Poster';
import styles from './WorkCard.module.css';

type Lang = 'ar' | 'en';

/**
 * The work card: one film with its separate values, each in its own visual
 * language, never merged, never a percentage (blueprint §2.4 #7, §4.4, ADR-33;
 * docs/WORK_CARD_DESIGN_2026-09-03.md). Presentation only: every model value
 * reaches the screen through lib/format.ts.
 *
 * Two kinds share the card:
 * - `recommendation` (home): Personal Fit, Public Quality, Watchability,
 *   Confidence, the reason, and the list/watched actions.
 * - `ranking` (library): the film's position among the watched set as the
 *   relative form, plus Confidence and the reason. No quality/availability
 *   cells -- the library is about what the user has already watched, and no
 *   actions (SPEC §5.4; ADR-33: positions only, never framed as a
 *   recommendation).
 *
 * Transitional data (paper §4, owner decision 2): the API still sends one
 * number for quality and one for availability. Until the frontend type
 * matches the API.md contract (value + votes + sources; providers + market),
 * quality shows the number with "source not stated" and availability shows
 * available / unknown without a provider. The optional `publicQuality` /
 * `watchability` objects below are the contract shape, rendered as soon as
 * they arrive.
 */
type Contract = {
  // The API's Public Quality object (board G4): rendered by PublicQualityCell,
  // with the source's attribution and the rights badge, as soon as it arrives.
  publicQuality?: PublicQuality | null;
  watchability?: { available: boolean | null; providers: { name: string; market: string }[] } | null;
};

const labels = {
  ar: {
    fit: 'الملاءمة الشخصية',
    fitLevel: { high: 'عالية', medium: 'متوسطة', low: 'أقل' } satisfies Record<PersonalFitLevel, string>,
    fitPosition: (position: string, count: string) => `${position} من ${count} في هذا المسار`,
    quality: 'الجودة العامة',
    qualityUnknown: 'لا مصدر مرخّص بعد',
    sourceUnknown: 'المصدر غير مذكور',
    votes: (n: string) => `${n} تصويت`,
    availability: 'التوفر',
    available: 'متاح',
    unavailable: 'غير متاح',
    availabilityUnknown: 'غير معروف بعد',
    confidence: 'الثقة',
    partialFingerprint: 'بعض سمات هذا الفيلم غير معروفة، فخُفّضت الثقة درجة.',
    reasonSource: 'من اختياراتك أنت',
    reasonWeak: 'والدليل ما زال قليلًا.',
    addToList: 'أضف إلى قائمتي',
    added: 'في قائمتك',
    markWatched: 'شاهدته',
    position: (n: number) => `الموضع ${n}`,
    // Library ranking (SPEC §5.4, ADR-33): a position among the watched set,
    // never framed as a recommendation and never a score.
    rankingCell: 'ترتيبك الشخصي',
    rankingPosition: (position: string, count: string) => `${position} من ${count} بين ما شاهدت`,
  },
  en: {
    fit: 'Personal fit',
    fitLevel: { high: 'High', medium: 'Medium', low: 'Lower' } satisfies Record<PersonalFitLevel, string>,
    fitPosition: (position: string, count: string) => `${position} of ${count} on this track`,
    quality: 'Public quality',
    qualityUnknown: 'No licensed source yet',
    sourceUnknown: 'Source not stated',
    votes: (n: string) => `${n} votes`,
    availability: 'Availability',
    available: 'Available',
    unavailable: 'Not available',
    availabilityUnknown: 'Unknown yet',
    confidence: 'Confidence',
    partialFingerprint: 'Some of this film’s traits are unknown, so confidence was lowered one band.',
    reasonSource: 'from your own choices',
    reasonWeak: 'The evidence is still thin.',
    addToList: 'Add to my list',
    added: 'On your list',
    markWatched: 'Watched it',
    position: (n: number) => `Position ${n}`,
    rankingCell: 'Your personal ranking',
    rankingPosition: (position: string, count: string) => `${position} of ${count} among what you watched`,
  },
};

const SEGMENTS: Record<PersonalFitLevel, number> = { high: 3, medium: 2, low: 1 };

type Shared = {
  lang: Lang;
  // 1-based position inside the item's own set (track or watched set), and that set's size.
  position: number;
  count: number;
  // Opens the work page for this title; the title becomes a button.
  onOpen?: () => void;
  // Inside the work page: the cells only (the page owns the head and the actions).
  headless?: boolean;
  // The host renders Public Quality itself (the work page, with the source's
  // attribution and date); skip the card's transitional quality cell.
  withoutQuality?: boolean;
};

type RecommendationProps = Shared & {
  kind?: 'recommendation';
  recommendation: Recommendation;
  listed: boolean;
  busy: boolean;
  onAddToList?: () => void;
  onMarkWatched?: () => void;
};

type RankingProps = Shared & {
  kind: 'ranking';
  item: LibraryRankingItem;
};

export function WorkCard(props: RecommendationProps | RankingProps) {
  const { lang, position, count } = props;
  const t = labels[lang];
  const isRanking = props.kind === 'ranking';

  const rec = isRanking ? null : (props.recommendation as Recommendation & Contract);
  const title = isRanking ? props.item.title : (rec as Recommendation).title;
  const confidenceBand = isRanking ? props.item.confidenceBand : (rec as Recommendation).confidenceBand;
  const fingerprintCoverage = isRanking ? props.item.fingerprintCoverage : (rec as Recommendation).fingerprintCoverage;
  const reasonSource = isRanking ? props.item.reason : (rec as Recommendation).reason;

  const name = lang === 'ar' ? title.titleAr : title.titleEn;
  const alt = lang === 'ar' ? title.titleEn : title.titleAr;
  const showAlt = Boolean(alt && alt !== name);

  // Relative forms only (ADR-33 §3): level + position, never the score.
  const fit = formatPersonalFit(position, count);
  const confidence = formatConfidence(confidenceBand, lang);
  const weak = confidenceBand === 'inconclusive' || confidenceBand === 'initial';
  const reason = formatReason(reasonSource, lang);
  const filled = SEGMENTS[fit.level];

  // Public quality: contract object when present, else the transitional number.
  const fullQuality = rec?.publicQuality ?? null;
  const quality = rec && !fullQuality && rec.publicQualityScore !== null ? { value: rec.publicQualityScore, votes: null, sources: [] as string[] } : null;
  // Availability: contract object when present, else the transitional number
  // (> 0 read as available; 0 as not; null as unknown).
  const watch = rec
    ? (rec.watchability ?? (rec.watchabilityScore === null ? null : { available: rec.watchabilityScore > 0, providers: [] }))
    : null;

  const meter = (
    <div className={`${styles.meter} ${styles[confidenceBand]}`} aria-hidden="true">
      {[1, 2, 3].map((segment) => (
        <i key={segment} className={segment <= filled ? styles.on : undefined} />
      ))}
    </div>
  );

  const { onOpen, headless, withoutQuality } = props;

  return (
    <article className={headless ? `${styles.card} ${styles.headless}` : styles.card} aria-label={name}>
      {!headless && (
        <div className={styles.head}>
          <span className={position === 1 ? `${styles.badge} ${styles.first}` : styles.badge} aria-label={t.position(position)}>
            {formatNumber(position, lang)}
          </span>
          {/* The poster slot is always present (owner decision 2026-09-04); hollow until licensed. */}
          <Poster title={title} size="sm" />
          <div className={styles.titles}>
            <h4 className={styles.title}>
              {onOpen ? (
                <button type="button" className={styles.titleButton} onClick={onOpen}>
                  {name}
                </button>
              ) : (
                name
              )}
            </h4>
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
          </div>
        </div>
      )}

      {/* On the work page no section names the track, so the card does
          (decision 27: the track's role hue). */}
      {headless && rec && (
        <span className={`${styles.trackChip} ${styles[`track_${rec.track}`]}`}>{TRACK_COPY[lang][rec.track].name}</span>
      )}

      {reason && (
        <p className={styles.reason}>
          {reason} {weak && t.reasonWeak}
          <span className={styles.reasonSource}>{t.reasonSource}</span>
        </p>
      )}

      {/* Separate values in labelled cells; no cell repeats another and nothing
          is merged (blueprint §4.4, ADR-20, ADR-33). Unknown is hollow, never 0. */}
      <dl className={isRanking ? `${styles.cells} ${styles.cellsTwo}` : styles.cells}>
        {isRanking ? (
          <div className={styles.cell}>
            <dt>{t.rankingCell}</dt>
            <dd>
              {/* The position is the value; the meter only restates its tertile. */}
              {meter}
              <span className={styles.word}>{t.fitLevel[fit.level]}</span>
              <span className={styles.pos}>{t.rankingPosition(formatNumber(position, lang), formatNumber(count, lang))}</span>
            </dd>
          </div>
        ) : (
          <div className={styles.cell}>
            <dt>{t.fit}</dt>
            <dd>
              {/* Unlabelled meter (ADR-33 §3); the band only limits the fill. */}
              {meter}
              <span className={styles.word}>{t.fitLevel[fit.level]}</span>
              <span className={styles.pos}>{t.fitPosition(formatNumber(fit.position, lang), formatNumber(fit.count, lang))}</span>
            </dd>
          </div>
        )}

        {!isRanking && !withoutQuality && fullQuality && <PublicQualityCell quality={fullQuality} lang={lang} />}

        {!isRanking && !withoutQuality && !fullQuality && (
          <div className={styles.cell}>
            <dt>{t.quality}</dt>
            <dd>
              {quality && quality.value !== null ? (
                <>
                  <span className={styles.num}>{formatNumber(quality.value, lang)}</span>
                  <span className={styles.numSub}>
                    {[quality.votes !== null ? t.votes(formatNumber(quality.votes, lang)) : null, ...quality.sources]
                      .filter(Boolean)
                      .join(' · ') || t.sourceUnknown}
                  </span>
                </>
              ) : (
                <span className={`${styles.chip} ${styles.hollow}`}>{t.qualityUnknown}</span>
              )}
            </dd>
          </div>
        )}

        {!isRanking && (
          <div className={styles.cell}>
            <dt>{t.availability}</dt>
            <dd>
              {watch && watch.providers.length > 0 ? (
                <div className={styles.chips}>
                  {watch.providers.map((provider) => (
                    <span key={`${provider.name}-${provider.market}`} className={styles.chip}>
                      {provider.name} · {provider.market}
                    </span>
                  ))}
                </div>
              ) : watch && watch.available === true ? (
                <span className={styles.chip}>{t.available}</span>
              ) : watch && watch.available === false ? (
                <span className={`${styles.chip} ${styles.hollow}`}>{t.unavailable}</span>
              ) : (
                <span className={`${styles.chip} ${styles.hollow}`}>{t.availabilityUnknown}</span>
              )}
            </dd>
          </div>
        )}

        <div className={styles.cell}>
          <dt>{t.confidence}</dt>
          <dd>
            <span className={styles.band}>{confidence.label}</span>
            <span className={styles.copy}>{confidence.copy}</span>
            {fingerprintCoverage < 1 && <span className={styles.copy}>{t.partialFingerprint}</span>}
          </dd>
        </div>
      </dl>

      {!isRanking && !headless && (
        <div className={styles.actions}>
          <button
            type="button"
            className={props.listed ? `${styles.ghost} ${styles.later}` : styles.ghost}
            onClick={props.onAddToList}
            disabled={props.busy || props.listed}
          >
            {props.listed ? t.added : t.addToList}
          </button>
          <button type="button" className={styles.ghost} onClick={props.onMarkWatched} disabled={props.busy}>
            {t.markWatched}
          </button>
        </div>
      )}
    </article>
  );
}
