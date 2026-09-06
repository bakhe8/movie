'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from './monitoring.module.css';

type FeatureRow = {
  id: string; titleId: string; featureKey: string; value: number;
  extractorVersion: string; reviewStatus: string;
  title: { id: string; internalId: string; titleEn: string; titleAr: string } | null;
};

const STATUS_LABEL: Record<string, string> = { unreviewed: 'غير مراجَع', sampled: 'عينة', human_verified: 'بشري' };

function statusBadge(status: string) {
  const cls = status === 'human_verified' ? m.green : status === 'sampled' ? m.yellow : '';
  return <span className={`${m.badge} ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

// ADMIN-W2 (ADR-117 "Decision — separation"): read-only. The sample action
// (F4) lives only in administration -- this deep-links there with the same
// record and current filters/page, and imports no mutation client at all.
export function FeaturesMonitor() {
  const [q, setQ] = useAdminQueryState(['reviewStatus', 'page'] as const);
  const reviewStatus = q.reviewStatus || 'unreviewed';
  const page = Number(q.page) || 1;

  const [result, setResult] = useState<{ items: FeatureRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setBusy(true);
      setFailed(false);
      try {
        const data = await api.adminGetContentFeatures({ reviewStatus: reviewStatus || undefined, page, limit: 50, signal: controller.signal });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [reviewStatus, page, retryTick]);

  // The administration screen has no GET-by-id route (only the filtered
  // list and the sample endpoint exist); carrying the row's own display
  // fields here avoids inventing a new read endpoint for a W2 package that
  // adds no backend calls of any kind.
  const returnTo = (row: FeatureRow) => {
    const params = new URLSearchParams({
      featureId: row.id,
      titleLabel: row.title ? (row.title.titleAr || row.title.titleEn) : row.titleId.slice(0, 8),
      featureKey: row.featureKey,
      value: String(row.value),
      extractorVersion: row.extractorVersion,
      returnReviewStatus: reviewStatus,
      returnPage: String(page),
    });
    return `/admin/administration/review?${params.toString()}`;
  };

  const columns: AdminRecordListColumn<FeatureRow>[] = [
    { key: 'title', header: 'العنوان', render: (r) => (r.title ? (r.title.titleAr || r.title.titleEn) : r.titleId.slice(0, 8)) },
    { key: 'key', header: 'المفتاح', render: (r) => r.featureKey, mono: true },
    { key: 'value', header: 'القيمة', render: (r) => r.value.toFixed(3), mono: true },
    { key: 'extractor', header: 'المستخرِج', render: (r) => r.extractorVersion, mono: true },
    { key: 'status', header: 'الحالة', render: (r) => statusBadge(r.reviewStatus) },
    {
      key: 'action',
      header: '',
      render: (r) => (r.reviewStatus === 'unreviewed' ? <Link className={m.link} href={returnTo(r)}>فتح في الإدارة</Link> : null),
    },
  ];

  return (
    <div>
      <div className={m.toolbar}>
        <select className={m.select} value={reviewStatus} onChange={(e) => setQ({ reviewStatus: e.target.value, page: '1' })}>
          <option value="unreviewed">غير مراجَع</option>
          <option value="sampled">مأخوذ عينة</option>
          <option value="human_verified">بشري مُتحقَّق</option>
          <option value="">الكل</option>
        </select>
      </div>

      {result && <p className={m.count}>{result.total} صف{busy && ' — جارٍ التحديث…'}</p>}

      <AdminRecordList
        columns={columns}
        rows={result?.items ?? null}
        keyOf={(r) => r.id}
        loading={busy}
        failed={failed}
        failedLabel="تعذّر تحميل قائمة المراجعة."
        onRetry={() => setRetryTick((t) => t + 1)}
        emptyLabel="لا نتائج"
        renderCard={(r) => (
          <>
            <p className={m.cardTitle}>{r.title ? (r.title.titleAr || r.title.titleEn) : r.titleId.slice(0, 8)}</p>
            <div className={m.cardRow}>
              <span>{r.featureKey}</span>
              <span>{r.value.toFixed(3)}</span>
              {statusBadge(r.reviewStatus)}
            </div>
            {r.reviewStatus === 'unreviewed' && <Link className={m.link} href={returnTo(r)}>فتح في الإدارة</Link>}
          </>
        )}
      />

      {result && result.totalPages > 1 && (
        <div className={m.pages}>
          <button className={m.pageBtn} disabled={page <= 1} onClick={() => setQ({ page: String(page - 1) })}>السابق</button>
          <span>{page} / {result.totalPages}</span>
          <button className={m.pageBtn} disabled={page >= result.totalPages} onClick={() => setQ({ page: String(page + 1) })}>التالي</button>
        </div>
      )}
    </div>
  );
}
