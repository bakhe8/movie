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
  const value = params.get('value') ?? '';
  const extractorVersion = params.get('extractorVersion') ?? '';
  const returnReviewStatus = params.get('returnReviewStatus') ?? 'unreviewed';
  const returnPage = params.get('returnPage') ?? '1';

  const [status, setStatus] = useState<Status>('idle');
  const [resultStatus, setResultStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backHref = `/admin/monitoring/reviews?${new URLSearchParams({ reviewStatus: returnReviewStatus, page: returnPage }).toString()}`;
  const numericValue = Number(value);
  const valuePhrase = Number.isFinite(numericValue) ? featureValuePhrase(featureKey, numericValue, FEATURE_REASON_COPY.ar) : null;

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

  return (
    <div>
      <div className={s.pageHeader}>
        <h2 className={s.pageTitle}>{ADMIN_SECTION_COPY.review.title}</h2>
        <p className={s.pageBlurb}>{ADMIN_SECTION_COPY.review.blurb}</p>
      </div>
      <div className={s.card}>
        <div className={s.row}><span className={s.label}>الفيلم</span><span>{titleLabel || '—'}</span></div>
        <div className={s.row}><span className={s.label}>الخاصية</span><span>{featureKey ? featureKeyLabel(featureKey) : '—'}</span></div>
        <div className={s.row}><span className={s.label}>ما يقوله التحليل</span><span>{valuePhrase ? `${valuePhrase} (${numericValue.toFixed(2)})` : value || '—'}</span></div>
        <div className={s.row}><span className={s.label}>مصدر التحليل</span><span className={s.value}>{extractorVersion || '—'}</span></div>

        <div className={s.actions}>
          <button type="button" className={s.confirmBtn} disabled={status === 'pending' || status === 'success'} onClick={confirmSample}>
            {status === 'pending' ? '…' : CONFIRM_ANALYSIS_LABEL}
          </button>
          <Link className={s.backLink} href={backHref}>رجوع إلى المراقبة</Link>
        </div>

        {status === 'success' && (
          <p className={`${s.status} ${s.statusSuccess}`} role="status" aria-live="polite">
            تم الحفظ. الحالة الآن: {resultStatus ? (REVIEW_STATUS_COPY[resultStatus] ?? resultStatus) : ''}.
          </p>
        )}
        {status === 'error' && (
          <p className={`${s.status} ${s.statusError}`} role="alert">{error}</p>
        )}
      </div>
    </div>
  );
}
