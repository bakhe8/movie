'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
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

  if (!featureId) {
    return (
      <div className={s.card}>
        <p className={s.status}>لا يوجد سطر محدد للمراجعة. عُد إلى قائمة المراجعة واختر سطراً.</p>
        <Link className={s.backLink} href="/admin/monitoring/reviews">رجوع إلى المراقبة</Link>
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
    <div className={s.card}>
      <div className={s.row}><span className={s.label}>العنوان</span><span>{titleLabel || '—'}</span></div>
      <div className={s.row}><span className={s.label}>المفتاح</span><span className={s.value}>{featureKey || '—'}</span></div>
      <div className={s.row}><span className={s.label}>القيمة</span><span className={s.value}>{value || '—'}</span></div>
      <div className={s.row}><span className={s.label}>المستخرِج</span><span className={s.value}>{extractorVersion || '—'}</span></div>

      <div className={s.actions}>
        <button type="button" className={s.confirmBtn} disabled={status === 'pending' || status === 'success'} onClick={confirmSample}>
          {status === 'pending' ? '…' : 'تأكيد أخذ عينة'}
        </button>
        <Link className={s.backLink} href={backHref}>رجوع إلى المراقبة</Link>
      </div>

      {status === 'success' && (
        <p className={`${s.status} ${s.statusSuccess}`} role="status" aria-live="polite">
          تم الحفظ. الحالة الآن: {resultStatus}.
        </p>
      )}
      {status === 'error' && (
        <p className={`${s.status} ${s.statusError}`} role="alert">{error}</p>
      )}
    </div>
  );
}
