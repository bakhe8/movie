'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from './monitoring.module.css';

type PrivacyRow = { id: string; type: string; status: string; requestedAt: string; executeAfter: string | null; completedAt: string | null };

const TYPE_LABEL: Record<string, string> = { export: 'تصدير', delete: 'حذف', reset: 'إعادة ضبط' };
const STATUS_LABEL: Record<string, string> = {
  requested: 'مطلوب', verifying: 'جارٍ التحقق', scheduled: 'مجدوَل',
  running: 'قيد التنفيذ', done: 'منجز', cancelled: 'ملغى',
};

function fmt(iso: string | null) {
  return iso ? formatDate(iso, 'ar') : '—';
}

function statusBadge(status: string) {
  const cls = status === 'done' ? m.green : status === 'scheduled' ? m.yellow : '';
  return <span className={`${m.badge} ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

// ADMIN-W2 (plan §11.2): read-only monitoring; no administrative privacy
// action exists yet ("مؤجل" until an audited, reviewed contract exists).
export function PrivacyMonitor() {
  const [q, setQ] = useAdminQueryState(['type', 'status', 'page'] as const);
  const type = q.type;
  const status = q.status || 'scheduled';
  const page = Number(q.page) || 1;

  const [result, setResult] = useState<{ items: PrivacyRow[]; total: number; totalPages: number } | null>(null);
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
        const data = await api.adminGetPrivacyRequests({ type: type || undefined, status: status || undefined, page, limit: 50, signal: controller.signal });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [type, status, page, retryTick]);

  const columns: AdminRecordListColumn<PrivacyRow>[] = [
    { key: 'id', header: 'المعرف', render: (r) => `${r.id.slice(0, 8)}…`, mono: true },
    { key: 'type', header: 'النوع', render: (r) => TYPE_LABEL[r.type] ?? r.type },
    { key: 'status', header: 'الحالة', render: (r) => statusBadge(r.status) },
    { key: 'requestedAt', header: 'تاريخ الطلب', render: (r) => fmt(r.requestedAt) },
    { key: 'executeAfter', header: 'موعد التنفيذ', render: (r) => fmt(r.executeAfter) },
    { key: 'completedAt', header: 'مكتمل في', render: (r) => fmt(r.completedAt) },
  ];

  return (
    <div>
      <div className={m.toolbar}>
        <select className={m.select} value={type} onChange={(e) => setQ({ type: e.target.value, page: '1' })}>
          <option value="">كل الأنواع</option>
          <option value="export">تصدير</option>
          <option value="delete">حذف</option>
          <option value="reset">إعادة ضبط</option>
        </select>
        <select className={m.select} value={status} onChange={(e) => setQ({ status: e.target.value, page: '1' })}>
          <option value="">كل الحالات</option>
          <option value="requested">مطلوب</option>
          <option value="verifying">جارٍ التحقق</option>
          <option value="scheduled">مجدوَل</option>
          <option value="running">قيد التنفيذ</option>
          <option value="done">منجز</option>
          <option value="cancelled">ملغى</option>
        </select>
      </div>

      {result && <p className={m.count}>{result.total} طلب{busy && ' — جارٍ التحديث…'}</p>}

      <AdminRecordList
        columns={columns}
        rows={result?.items ?? null}
        keyOf={(r) => r.id}
        loading={busy}
        failed={failed}
        failedLabel="تعذّر تحميل طلبات الخصوصية."
        onRetry={() => setRetryTick((t) => t + 1)}
        emptyLabel="لا طلبات"
        renderCard={(r) => (
          <>
            <p className={m.cardTitle}>{TYPE_LABEL[r.type] ?? r.type}</p>
            <div className={m.cardRow}>
              <span className={m.mono}>{r.id.slice(0, 8)}…</span>
              {statusBadge(r.status)}
              <span>{fmt(r.requestedAt)}</span>
            </div>
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
