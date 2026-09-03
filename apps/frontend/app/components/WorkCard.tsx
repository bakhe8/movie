'use client';

import type { Recommendation } from '../lib/api';
import { formatConfidence, formatNumber, formatPersonalFit, formatReason, type PersonalFitLevel } from '../lib/format';
import styles from './WorkCard.module.css';

type Lang = 'ar' | 'en';

/**
 * The work card: one film with its four separate values -- Personal Fit,
 * Public Quality, Watchability, Confidence -- each in its own visual language,
 * never merged, never a percentage (blueprint §2.4 #7, §4.4, ADR-33;
 * docs/WORK_CARD_DESIGN_2026-09-03.md). Presentation only: every model value
 * reaches the screen through lib/format.ts.
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
  publicQuality?: { value: number | null; votes: number | null; sources: string[] } | null;
  watchability?: { available: boolean | null; providers: { name: string; market: string }[] } | null;
  title: { posterUrl?: string | null };
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
  },
};

const SEGMENTS: Record<PersonalFitLevel, number> = { high: 3, medium: 2, low: 1 };

export function WorkCard({
  lang,
  position,
  count,
  recommendation,
  listed,
  busy,
  onAddToList,
  onMarkWatched,
}: {
  lang: Lang;
  // 1-based position inside the item's own track, and the track's size.
  position: number;
  count: number;
  recommendation: Recommendation;
  listed: boolean;
  busy: boolean;
  onAddToList: () => void;
  onMarkWatched: () => void;
}) {
  const t = labels[lang];
  const rec = recommendation as Recommendation & Contract;
  const name = lang === 'ar' ? rec.title.titleAr : rec.title.titleEn;
  const alt = lang === 'ar' ? rec.title.titleEn : rec.title.titleAr;
  const showAlt = Boolean(alt && alt !== name);
  const poster = rec.title.posterUrl ?? null;

  // Relative forms only (ADR-33 §3): level + position, never the score.
  const fit = formatPersonalFit(position, count);
  const confidence = formatConfidence(rec.confidenceBand, lang);
  const weak = rec.confidenceBand === 'inconclusive' || rec.confidenceBand === 'initial';
  const reason = formatReason(rec.reason, lang);
  const filled = SEGMENTS[fit.level];

  // Public quality: contract object when present, else the transitional number.
  const quality = rec.publicQuality ?? (rec.publicQualityScore === null ? null : { value: rec.publicQualityScore, votes: null, sources: [] });
  // Availability: contract object when present, else the transitional number
  // (> 0 read as available; 0 as not; null as unknown).
  const watch =
    rec.watchability ??
    (rec.watchabilityScore === null ? null : { available: rec.watchabilityScore > 0, providers: [] });

  return (
    <article className={styles.card} aria-label={name}>
      <div className={poster ? `${styles.head} ${styles.withPoster}` : styles.head}>
        <span className={position === 1 ? `${styles.badge} ${styles.first}` : styles.badge} aria-label={t.position(position)}>
          {formatNumber(position, lang)}
        </span>
        {/* Plain <img>: poster hosts come from the licensing registry, not next.config. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {poster && <img className={styles.poster} src={poster} alt="" loading="lazy" />}
        <div className={styles.titles}>
          <h4 className={styles.title}>{name}</h4>
          {(showAlt || rec.title.releaseYear) && (
            <p className={styles.alt}>
              {showAlt && <bdi>{alt}</bdi>}
              {showAlt && rec.title.releaseYear ? ' · ' : ''}
              {rec.title.releaseYear ? String(rec.title.releaseYear) : ''}
            </p>
          )}
        </div>
      </div>

      {reason && (
        <p className={styles.reason}>
          {reason} {weak && t.reasonWeak}
          <span className={styles.reasonSource}>{t.reasonSource}</span>
        </p>
      )}

      {/* Four separate values in four labelled cells; no cell repeats another
          and nothing is merged (blueprint §4.4, ADR-20, ADR-33). Unknown is
          hollow, never 0. */}
      <dl className={styles.cells}>
        <div className={styles.cell}>
          <dt>{t.fit}</dt>
          <dd>
            {/* Unlabelled meter (ADR-33 §3); the band only limits the fill. */}
            <div className={`${styles.meter} ${styles[rec.confidenceBand]}`} aria-hidden="true">
              {[1, 2, 3].map((segment) => (
                <i key={segment} className={segment <= filled ? styles.on : undefined} />
              ))}
            </div>
            <span className={styles.word}>{t.fitLevel[fit.level]}</span>
            <span className={styles.pos}>{t.fitPosition(formatNumber(fit.position, lang), formatNumber(fit.count, lang))}</span>
          </dd>
        </div>

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

        <div className={styles.cell}>
          <dt>{t.confidence}</dt>
          <dd>
            <span className={styles.band}>{confidence.label}</span>
            <span className={styles.copy}>{confidence.copy}</span>
            {rec.fingerprintCoverage < 1 && <span className={styles.copy}>{t.partialFingerprint}</span>}
          </dd>
        </div>
      </dl>

      <div className={styles.actions}>
        <button type="button" className={styles.ghost} onClick={onAddToList} disabled={busy || listed}>
          {listed ? t.added : t.addToList}
        </button>
        <button type="button" className={styles.ghost} onClick={onMarkWatched} disabled={busy}>
          {t.markWatched}
        </button>
      </div>
    </article>
  );
}
