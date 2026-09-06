'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { ADMIN_SECTION_COPY, auditActionLabel, auditResourceLabel } from '../admin-copy';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from './monitoring.module.css';

type AuditRow = {
  id: string; actorUserId: string | null; actorRole: string | null;
  action: string; resource: string; resourceId: string | null;
  status: string; reason: string | null; createdAt: string;
};

function statusBadge(status: string) {
  return <span className={`${m.badge} ${status === 'ok' ? m.green : m.red}`}>{status === 'ok' ? 'تم بنجاح' : status}</span>;
}

const COLUMNS: AdminRecordListColumn<AuditRow>[] = [
  { key: 'time', header: 'الوقت', render: (r) => formatDateTime(r.createdAt, 'ar') },
  { key: 'action', header: 'الإجراء', render: (r) => auditActionLabel(r.action) },
  { key: 'resource', header: 'على', render: (r) => auditResourceLabel(r.resource) },
  { key: 'actor', header: 'من نفّذه', render: (r) => r.actorRole ?? '—', mono: true },
  { key: 'status', header: 'النتيجة', render: (r) => statusBadge(r.status) },
  { key: 'reason', header: 'التفاصيل', render: (r) => r.reason ?? '—' },
];

// ADMIN-W3 (W0 case B5): read-only activity log, for accountability -- never
// editable here, and no mutation client is imported by this file.
// ADMIN-W4: `resource`/`resourceId` are also read from the URL so a write
// screen (user/title/model edit) can link straight to "what happened to this
// record" -- e.g. `?resource=user&resourceId=<id>` -- without a new endpoint.
export function AuditLogMonitor() {
  const [q, setQ] = useAdminQueryState(['page', 'resource', 'resourceId'] as const);
  const page = Number(q.page) || 1;

  const [result, setResult] = useState<{ items: AuditRow[]; total: number; totalPages: number } | null>(null);
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
        const data = await api.adminGetAuditLog({
          page, limit: 50,
          resource: q.resource || undefined,
          resourceId: q.resourceId || undefined,
          signal: controller.signal,
        });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [page, q.resource, q.resourceId, retryTick]);

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.audit.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.audit.blurb}</p>
      </div>

      {q.resourceId && (
        <p className={m.count}>
          مُصفّى على سجل واحد ({auditResourceLabel(q.resource || '')} {q.resourceId}).{' '}
          <button type="button" className={m.pageBtn} onClick={() => setQ({ resource: '', resourceId: '', page: '1' })}>
            إزالة التصفية
          </button>
        </p>
      )}

      {result && <p className={m.count}>{result.total} سطر{busy && ' — جارٍ التحديث…'}</p>}

      <AdminRecordList
        columns={COLUMNS}
        rows={result?.items ?? null}
        keyOf={(r) => r.id}
        loading={busy}
        failed={failed}
        failedLabel="تعذّر تحميل سجل العمليات."
        onRetry={() => setRetryTick((t) => t + 1)}
        emptyLabel="لا سجلات بعد"
        renderCard={(r) => (
          <>
            <p className={m.cardTitle}>{auditActionLabel(r.action)}</p>
            <div className={m.cardRow}>
              <span>{auditResourceLabel(r.resource)}</span>
              <span>{formatDateTime(r.createdAt, 'ar')}</span>
              {statusBadge(r.status)}
            </div>
            {r.reason && <p className={m.pageBlurb}>{r.reason}</p>}
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
