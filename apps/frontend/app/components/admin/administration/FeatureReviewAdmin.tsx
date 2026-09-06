'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { FEATURE_REASON_COPY } from '../../../lib/copy';
import { ADMIN_SECTION_COPY, CONFIRM_ANALYSIS_LABEL, REVIEW_STATUS_COPY, featureKeyLabel, featureValuePhrase } from '../admin-copy';
import s from './FeatureReviewAdmin.module.css';

type Status = 'idle' | 'pending' | 'success' | 'error';

// ADMIN-W2 (ADR-117 "Decision — separation", W0 case F4): the only
// mutation-capable screen this package ships. Relocates the existing
// «عينة» write here from the old FeaturesTab -- same request, same
// disabled-while-pending guard, same real-status readback -- reached by a
// deep link that carries the row's own fields (no GET-by-id route exists,
// and W2 adds no new backend calls). Never fires the request on load.
export function FeatureReviewAdmin() {
  const params = useSearchParams();
  const featureId = params.get('featureId');
  const titleLabel = params.get('titleLabel') ?? '';
  const featureKey = params.get('featureKey') ?? '';
  // Absent and empty are both "unknown" (BP §11.3: NULL is never coerced to
  // 0) -- Number('') is 0, not NaN, so the raw param must be checked before
  // conversion or an unknown value would silently read as a real zero.
  const rawValue = params.get('value');
  const extractorVersion = params.get('extractorVersion') ?? '';
  const returnReviewStatus = params.get('returnReviewStatus') ?? 'unreviewed';
  const returnPage = params.get('returnPage') ?? '1';

  const [status, setStatus] = useState<Status>('idle');
  const [resultStatus, setResultStatus] = useState<string | null>(null);
  const [republishCount, setRepublishCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [correctedValue, setCorrectedValue] = useState('');
  const [note, setNote] = useState('');

  const backHref = `/admin/monitoring/reviews?${new URLSearchParams({ reviewStatus: returnReviewStatus, page: returnPage }).toString()}`;
  const numericValue = rawValue ? Number(rawValue) : null;
  const valuePhrase = numericValue !== null && Number.isFinite(numericValue) ? featureValuePhrase(featureKey, numericValue, FEATURE_REASON_COPY.ar) : null;
  const correctedNumber = correctedValue ? Number(correctedValue) : null;
  const canSubmitCorrection = correctedNumber !== null && Number.isFinite(correctedNumber) && correctedNumber >= 0 && correctedNumber <= 1;

  if (!featureId) {
    return (
      <div>
        <div className={s.pageHeader}>
          <h2 className={s.pageTitle}>{ADMIN_SECTION_COPY.review.title}</h2>
          <p className={s.pageBlurb}>{ADMIN_SECTION_COPY.review.blurb}</p>
        </div>
        <div className={s.card}>
          <p className={s.status}>لا يوجد سطر محدد للمراجعة. عُد إلى قائمة المراجعة واختر سطراً.</p>
          <Link className={s.backLink} href="/admin/monitoring/reviews">رجوع إلى المراقبة</Link>
        </div>
      </div>
    );
  }

  const confirmSample = async () => {
    setStatus('pending');
    setError(null);
    try {
      const { feature, correction } = await api.adminReviewFeature(featureId, { reviewStatus: 'sampled' });
      setResultStatus(correction ? correction.reviewStatus : feature.reviewStatus);
      setStatus('success');
    } catch {
      setError('تعذّر حفظ المراجعة. حاول مرة أخرى.');
      setStatus('error');
    }
  };

  // ADMIN-W4 (W0 case F4 extension, ADM-P0-02): when the analysis is wrong,
  // not just unverified -- the corrected value supersedes the extracted row
  // (never edits it in place) and the server folds it into the published
  // fingerprint in the same request, reported back here as `republish`.
  const saveCorrection = async () => {
    if (correctedNumber === null) return;
    setStatus('pending');
    setError(null);
    try {
      const { feature, correction, republish } = await api.adminReviewFeature(featureId, {
        reviewStatus: 'human_verified',
        correctedValue: correctedNumber,
        note: note.trim() || undefined,
      });
      setResultStatus(correction ? correction.reviewStatus : feature.reviewStatus);
      setRepublishCount(republish ? republish.changes.length : null);
      setStatus('success');
    } catch {
      setError('تعذّر حفظ التصحيح. حاول مرة أخرى.');
      setStatus('error');
    }
  };

  return (
    <div>
      <div className={s.pageHeader}>
        <h2 className={s.pageTitle}>{ADMIN_SECTION_COPY.review.title}</h2>
        <p className={s.pageBlurb}>{ADMIN_SECTION_COPY.review.blurb}</p>
      </div>
      <div className={s.card}>
        <div className={s.row}><span className={s.label}>الفيلم</span><span>{titleLabel || '—'}</span></div>
        <div className={s.row}><span className={s.label}>الخاصية</span><span>{featureKey ? featureKeyLabel(featureKey) : '—'}</span></div>
        <div className={s.row}><span className={s.label}>ما يقوله التحليل</span><span>{valuePhrase && numericValue !== null ? `${valuePhrase} (${numericValue.toFixed(2)})` : numericValue !== null ? numericValue.toFixed(3) : 'غير معروف'}</span></div>
        <div className={s.row}><span className={s.label}>مصدر التحليل</span><span className={s.value}>{extractorVersion || '—'}</span></div>

        <div className={s.actions}>
          <button type="button" className={s.confirmBtn} disabled={status === 'pending' || status === 'success' || correcting} onClick={confirmSample}>
            {status === 'pending' && !correcting ? '…' : CONFIRM_ANALYSIS_LABEL}
          </button>
          <button
            type="button"
            className={s.backLink}
            onClick={() => setCorrecting((c) => !c)}
            disabled={status === 'pending' || status === 'success'}
          >
            {correcting ? 'إلغاء التصحيح' : 'التحليل غير صحيح — إدخال قيمة صحيحة'}
          </button>
          <Link className={s.backLink} href={backHref}>رجوع إلى المراقبة</Link>
        </div>

        {correcting && status !== 'success' && (
          <div className={s.correctionForm}>
            <label htmlFor="corrected-value" className={s.label}>القيمة الصحيحة (بين 0 و1)</label>
            <input
              id="corrected-value"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={correctedValue}
              onChange={(e) => setCorrectedValue(e.target.value)}
              disabled={status === 'pending'}
            />
            <label htmlFor="correction-note" className={s.label}>ملاحظة (اختياري)</label>
            <textarea id="correction-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={status === 'pending'} />
            <button type="button" className={s.confirmBtn} disabled={!canSubmitCorrection || status === 'pending'} onClick={saveCorrection}>
              {status === 'pending' ? '…' : 'حفظ التصحيح'}
            </button>
          </div>
        )}

        {status === 'success' && (
          <p className={`${s.status} ${s.statusSuccess}`} role="status" aria-live="polite">
            تم الحفظ. الحالة الآن: {resultStatus ? (REVIEW_STATUS_COPY[resultStatus] ?? resultStatus) : ''}.
            {republishCount !== null && (republishCount > 0 ? ' تحديث التحليل انعكس فوراً على بصمة الفيلم المنشورة.' : '')}
          </p>
        )}
        {status === 'error' && (
          <p className={`${s.status} ${s.statusError}`} role="alert">{error}</p>
        )}
      </div>
    </div>
  );
}
