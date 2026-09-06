'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from './monitoring.module.css';

type TitleRow = {
  id: string; internalId: string; titleEn: string; titleAr: string;
  releaseYear: number | null; hasFingerprint: boolean; hasV2: boolean;
  licenseStatus: string; sourceRecords: number; unreviewedFeatures: number;
};

const LICENSE_LABEL: Record<string, string> = {
  commercial_allowed: 'تجاري', non_commercial_only: 'غير تجاري', pending_review: 'قيد المراجعة',
};

function fingerprintBadge(row: TitleRow, m2: typeof m) {
  const cls = row.hasV2 ? m2.green : row.hasFingerprint ? m2.yellow : m2.red;
  return <span className={`${m2.badge} ${cls}`}>{row.hasV2 ? 'V2' : row.hasFingerprint ? 'V1' : 'لا'}</span>;
}

function licenseBadge(row: TitleRow, m2: typeof m) {
  const cls = row.licenseStatus === 'commercial_allowed' ? m2.green : row.licenseStatus === 'non_commercial_only' ? m2.yellow : m2.red;
  return <span className={`${m2.badge} ${cls}`}>{LICENSE_LABEL[row.licenseStatus] ?? 'غير معروف'}</span>;
}

const COLUMNS: AdminRecordListColumn<TitleRow>[] = [
  { key: 'internalId', header: 'المعرف', render: (r) => r.internalId, mono: true },
  { key: 'title', header: 'العنوان', render: (r) => r.titleAr || r.titleEn },
  { key: 'year', header: 'سنة', render: (r) => r.releaseYear ?? '—' },
  { key: 'fp', header: 'بصمة', render: (r) => fingerprintBadge(r, m) },
  { key: 'license', header: 'ترخيص', render: (r) => licenseBadge(r, m) },
  { key: 'unreviewed', header: 'غير مراجَع', render: (r) => (r.unreviewedFeatures > 0 ? <span className={m.badge}>{r.unreviewedFeatures}</span> : '—') },
];

// ADMIN-W2 (plan §11.2 "بحث وفلاتر الكتالوج" -> جودة البيانات → الكتالوج).
// Read-only: no mutation import here, matching every other row of that
// migration table for this section (editing lands with W4).
export function CatalogMonitor() {
  const [q, setQ] = useAdminQueryState(['query', 'missing', 'page'] as const);
  const [inputValue, setInputValue] = useState(q.query);
  const [debouncedQuery, setDebouncedQuery] = useState(q.query);
  const page = Number(q.page) || 1;
  const missing = (q.missing || '') as '' | 'fingerprint' | 'v2' | 'license';

  const [result, setResult] = useState<{ items: TitleRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(id);
  }, [inputValue]);

  useEffect(() => {
    if (debouncedQuery !== q.query) setQ({ query: debouncedQuery, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  // Browser back/forward changes the URL directly (not through typing):
  // resync the visible input so it never shows stale text for a restored
  // query (a same-value set below is a no-op, so this cannot loop with the
  // effect above).
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setInputValue(q.query);
    })();
  }, [q.query]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setBusy(true);
      setFailed(false);
      try {
        const data = await api.adminGetTitles({ query: q.query || undefined, missing: missing || undefined, page, limit: 50, signal: controller.signal });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [q.query, missing, page, retryTick]);

  return (
    <div>
      <div className={m.toolbar}>
        <input
          className={m.search}
          type="search"
          placeholder="بحث في العنوان أو المعرف..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        <select
          className={m.select}
          value={missing}
          onChange={(e) => setQ({ missing: e.target.value, page: '1' })}
        >
          <option value="">كل العناوين</option>
          <option value="fingerprint">بلا بصمة</option>
          <option value="v2">V1 فقط</option>
          <option value="license">بلا ترخيص</option>
        </select>
      </div>

      {result && <p className={m.count}>{result.total} عنوان{busy && ' — جارٍ التحديث…'}</p>}

      <AdminRecordList
        columns={COLUMNS}
        rows={result?.items ?? null}
        keyOf={(r) => r.id}
        loading={busy}
        failed={failed}
        failedLabel="تعذّر تحميل الكتالوج."
        onRetry={() => setRetryTick((t) => t + 1)}
        emptyLabel="لا نتائج"
        renderCard={(r) => (
          <>
            <p className={m.cardTitle}>{r.titleAr || r.titleEn}</p>
            <div className={m.cardRow}>
              <span>{r.internalId}</span>
              <span>{r.releaseYear ?? '—'}</span>
              {fingerprintBadge(r, m)}
              {licenseBadge(r, m)}
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
