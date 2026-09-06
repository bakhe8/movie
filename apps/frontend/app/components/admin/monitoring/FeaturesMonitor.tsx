'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { FEATURE_REASON_COPY } from '../../../lib/copy';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { ADMIN_SECTION_COPY, REVIEW_STATUS_COPY, featureKeyLabel, featureValuePhrase } from '../admin-copy';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from './monitoring.module.css';

type FeatureRow = {
  id: string; titleId: string; featureKey: string; value: number;
  extractorVersion: string; reviewStatus: string;
  title: { id: string; internalId: string; titleEn: string; titleAr: string } | null;
};

function statusBadge(status: string) {
  const cls = status === 'human_verified' ? m.green : status === 'sampled' ? m.yellow : '';
  return <span className={`${m.badge} ${cls}`}>{REVIEW_STATUS_COPY[status] ?? status}</span>;
}

// ADMIN-W2 (owner feedback 2026-09-06): a bare 0-1 number told a reviewer
// nothing about whether the AI got it right. Show what the number claims
// about the film; keep the raw value alongside for anyone who wants it.
function valueDisplay(row: FeatureRow) {
  const phrase = featureValuePhrase(row.featureKey, row.value, FEATURE_REASON_COPY.ar);
  return phrase ? `${phrase} (${row.value.toFixed(2)})` : row.value.toFixed(3);
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
    { key: 'title', header: 'الفيلم', render: (r) => (r.title ? (r.title.titleAr || r.title.titleEn) : r.titleId.slice(0, 8)) },
    {
      key: 'key',
      header: 'الخاصية',
      render: (r) => (
        <>
          <span className={m.featureKey}>{featureKeyLabel(r.featureKey)}</span>
          <span className={m.featureKeyRaw}>{r.featureKey}</span>
        </>
      ),
    },
    { key: 'value', header: 'ما يقوله التحليل', render: (r) => valueDisplay(r) },
    { key: 'extractor', header: 'مصدر التحليل', render: (r) => r.extractorVersion, mono: true },
    { key: 'status', header: 'الحالة', render: (r) => statusBadge(r.reviewStatus) },
    {
      key: 'action',
      header: '',
      render: (r) => (r.reviewStatus === 'unreviewed' ? <Link className={m.link} href={returnTo(r)}>مراجعة هذا التحليل</Link> : null),
    },
  ];

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.reviews.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.reviews.blurb}</p>
      </div>

      <div className={m.toolbar}>
        <select className={m.select} value={reviewStatus} onChange={(e) => setQ({ reviewStatus: e.target.value, page: '1' })}>
          <option value="unreviewed">{REVIEW_STATUS_COPY.unreviewed}</option>
          <option value="sampled">{REVIEW_STATUS_COPY.sampled}</option>
          <option value="human_verified">{REVIEW_STATUS_COPY.human_verified}</option>
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
              <span>{featureKeyLabel(r.featureKey)}</span>
              <span>{valueDisplay(r)}</span>
              {statusBadge(r.reviewStatus)}
            </div>
            {r.reviewStatus === 'unreviewed' && <Link className={m.link} href={returnTo(r)}>مراجعة هذا التحليل</Link>}
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
