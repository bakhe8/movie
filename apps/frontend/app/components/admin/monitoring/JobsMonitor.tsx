'use client';

import { useEffect, useState } from 'react';
import { api, type AdminJobRecord } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { ADMIN_SECTION_COPY, JOB_STATUS_LABELS } from '../admin-copy';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from './monitoring.module.css';

function statusBadge(status: AdminJobRecord['status']) {
  const cls = status === 'failed' ? m.red : status === 'succeeded' ? m.green : status === 'cancelled' ? m.yellow : '';
  return <span className={`${m.badge} ${cls}`}>{JOB_STATUS_LABELS[status] ?? status}</span>;
}

function progressText(row: AdminJobRecord): string {
  if (!row.progress) return '—';
  const { processed, total } = row.progress as { processed?: number; total?: number };
  return typeof processed === 'number' && typeof total === 'number' ? `${processed} / ${total}` : '—';
}

const COLUMNS: AdminRecordListColumn<AdminJobRecord>[] = [
  { key: 'type', header: 'النوع', render: (r) => r.type, mono: true },
  { key: 'status', header: 'الحالة', render: (r) => statusBadge(r.status) },
  { key: 'dryRun', header: 'تجريبي', render: (r) => (r.dryRun ? 'نعم' : '—') },
  { key: 'progress', header: 'التقدّم', render: (r) => progressText(r) },
  { key: 'attempts', header: 'المحاولات', render: (r) => r.attempts },
  { key: 'error', header: 'آخر خطأ', render: (r) => r.lastError ?? '—' },
  { key: 'createdAt', header: 'وقت الطلب', render: (r) => formatDateTime(r.createdAt, 'ar') },
];

// ADMIN-W5 (plan §17.2, §18 W5): read-only view of the durable job queue --
// no mutation import here (creating/cancelling a job lives in JobsAdmin, the
// only place this section ever writes, matching the monitoring/
// administration split every other section follows).
export function JobsMonitor() {
  const [q, setQ] = useAdminQueryState(['type', 'status', 'page'] as const);
  const page = Number(q.page) || 1;

  const [result, setResult] = useState<{ items: AdminJobRecord[]; total: number; totalPages: number } | null>(null);
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
        const data = await api.adminGetJobs({ type: q.type || undefined, status: q.status || undefined, page, limit: 50, signal: controller.signal });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [q.type, q.status, page, retryTick]);

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.jobs.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.jobs.blurb}</p>
      </div>

      <div className={m.toolbar}>
        <select className={m.select} value={q.status} onChange={(e) => setQ({ status: e.target.value, page: '1' })}>
          <option value="">كل الحالات</option>
          {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {result && <p className={m.count}>{result.total} مهمة{busy && ' — جارٍ التحديث…'}</p>}

      <AdminRecordList
        columns={COLUMNS}
        rows={result?.items ?? null}
        keyOf={(r) => r.id}
        loading={busy}
        failed={failed}
        failedLabel="تعذّر تحميل المهام."
        onRetry={() => setRetryTick((t) => t + 1)}
        emptyLabel="لا مهام بعد"
        renderCard={(r) => (
          <>
            <p className={m.cardTitle}>{r.type}</p>
            <div className={m.cardRow}>
              {statusBadge(r.status)}
              <span>{progressText(r)}</span>
              <span>{formatDateTime(r.createdAt, 'ar')}</span>
            </div>
            {r.lastError && <p className={m.pageBlurb}>{r.lastError}</p>}
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
