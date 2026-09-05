'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import s from './AdminScreen.module.css';

type Tab = 'catalog' | 'features' | 'models' | 'privacy';

// ── Catalog tab ─────────────────────────────────────────────────────────────

type TitleRow = {
  id: string; internalId: string; titleEn: string; titleAr: string;
  releaseYear: number | null; hasFingerprint: boolean; hasV2: boolean;
  licenseStatus: string; sourceRecords: number; unreviewedFeatures: number;
};

function CatalogTab() {
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState<'' | 'fingerprint' | 'v2' | 'license'>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: TitleRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, miss: '' | 'fingerprint' | 'v2' | 'license', pg: number) => {
    await Promise.resolve(); // defer setBusy out of synchronous effect context
    setBusy(true);
    try {
      const data = await api.adminGetTitles({ query: q || undefined, missing: miss || undefined, page: pg, limit: 50 });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(1); load(query, missing, 1); }, 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, missing, load]);

  useEffect(() => {
    const id = setTimeout(() => { void load(query, missing, page); }, 0);
    return () => clearTimeout(id);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={s.tabBody}>
      <div className={s.toolbar}>
        <input
          className={s.search}
          type="search"
          placeholder="بحث في العنوان أو المعرف..."
          value={query}
          onChange={e => { setQuery(e.target.value); }}
        />
        <select className={s.filter} value={missing} onChange={e => setMissing(e.target.value as typeof missing)}>
          <option value="">كل العناوين</option>
          <option value="fingerprint">بلا بصمة</option>
          <option value="v2">V1 فقط</option>
          <option value="license">بلا ترخيص</option>
        </select>
      </div>

      {result && <p className={s.count}>{result.total} عنوان</p>}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>المعرف</th>
              <th>العنوان</th>
              <th>سنة</th>
              <th>بصمة</th>
              <th>ترخيص</th>
              <th>غير مراجَع</th>
            </tr>
          </thead>
          <tbody>
            {busy && !result && (
              <tr><td colSpan={6} className={s.loading}>جارٍ التحميل…</td></tr>
            )}
            {result?.items.map(row => (
              <tr key={row.id}>
                <td className={s.mono}>{row.internalId}</td>
                <td>{row.titleAr || row.titleEn}</td>
                <td>{row.releaseYear ?? '—'}</td>
                <td>
                  <span className={`${s.badge} ${row.hasV2 ? s.green : row.hasFingerprint ? s.yellow : s.red}`}>
                    {row.hasV2 ? 'V2' : row.hasFingerprint ? 'V1' : 'لا'}
                  </span>
                </td>
                <td>
                  <span className={`${s.badge} ${row.licenseStatus === 'commercial_allowed' ? s.green : row.licenseStatus === 'non_commercial_only' ? s.yellow : s.red}`}>
                    {row.licenseStatus === 'commercial_allowed' ? 'تجاري' : row.licenseStatus === 'non_commercial_only' ? 'غير تجاري' : row.licenseStatus === 'pending_review' ? 'قيد المراجعة' : 'غير معروف'}
                  </span>
                </td>
                <td>{row.unreviewedFeatures > 0 ? <span className={s.badge}>{row.unreviewedFeatures}</span> : '—'}</td>
              </tr>
            ))}
            {result?.items.length === 0 && (
              <tr><td colSpan={6} className={s.loading}>لا نتائج</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {result && result.totalPages > 1 && (
        <div className={s.pages}>
          <button className={s.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
          <span>{page} / {result.totalPages}</span>
          <button className={s.pageBtn} disabled={page >= result.totalPages} onClick={() => setPage(p => p + 1)}>التالي</button>
        </div>
      )}
    </div>
  );
}

// ── Features (review queue) tab ──────────────────────────────────────────────

type FeatureRow = {
  id: string; titleId: string; featureKey: string; value: number;
  extractorVersion: string; reviewStatus: string;
  title: { id: string; internalId: string; titleEn: string; titleAr: string } | null;
};

function FeaturesTab() {
  const [reviewStatus, setReviewStatus] = useState('unreviewed');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: FeatureRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(async (rs: string, pg: number) => {
    await Promise.resolve(); // defer setBusy out of synchronous effect context
    setBusy(true);
    try {
      const data = await api.adminGetContentFeatures({ reviewStatus: rs || undefined, page: pg, limit: 50 });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { void load(reviewStatus, page); }, 0);
    return () => clearTimeout(id);
  }, [reviewStatus, page, load]);

  const markSampled = async (featureId: string) => {
    setReviewing(featureId);
    try {
      await api.adminReviewFeature(featureId, { reviewStatus: 'sampled' });
      setResult(prev => prev ? {
        ...prev,
        items: prev.items.map(f => f.id === featureId ? { ...f, reviewStatus: 'sampled' } : f),
      } : prev);
    } finally {
      setReviewing(null);
    }
  };

  return (
    <div className={s.tabBody}>
      <div className={s.toolbar}>
        <select className={s.filter} value={reviewStatus} onChange={e => { setReviewStatus(e.target.value); setPage(1); }}>
          <option value="unreviewed">غير مراجَع</option>
          <option value="sampled">مأخوذ عينة</option>
          <option value="human_verified">بشري مُتحقَّق</option>
          <option value="">الكل</option>
        </select>
      </div>

      {result && <p className={s.count}>{result.total} صف</p>}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>العنوان</th>
              <th>المفتاح</th>
              <th>القيمة</th>
              <th>المستخرِج</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {busy && !result && (
              <tr><td colSpan={6} className={s.loading}>جارٍ التحميل…</td></tr>
            )}
            {result?.items.map(row => (
              <tr key={row.id}>
                <td>{row.title ? (row.title.titleAr || row.title.titleEn) : row.titleId.slice(0, 8)}</td>
                <td className={s.mono}>{row.featureKey}</td>
                <td className={s.mono}>{row.value.toFixed(3)}</td>
                <td className={s.mono}>{row.extractorVersion}</td>
                <td>
                  <span className={`${s.badge} ${row.reviewStatus === 'human_verified' ? s.green : row.reviewStatus === 'sampled' ? s.yellow : ''}`}>
                    {row.reviewStatus === 'unreviewed' ? 'غير مراجَع' : row.reviewStatus === 'sampled' ? 'عينة' : 'بشري'}
                  </span>
                </td>
                <td>
                  {row.reviewStatus === 'unreviewed' && (
                    <button
                      className={s.smallBtn}
                      disabled={reviewing === row.id}
                      onClick={() => markSampled(row.id)}
                    >
                      {reviewing === row.id ? '…' : 'عينة'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {result?.items.length === 0 && (
              <tr><td colSpan={6} className={s.loading}>لا نتائج</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {result && result.totalPages > 1 && (
        <div className={s.pages}>
          <button className={s.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
          <span>{page} / {result.totalPages}</span>
          <button className={s.pageBtn} disabled={page >= result.totalPages} onClick={() => setPage(p => p + 1)}>التالي</button>
        </div>
      )}
    </div>
  );
}

// ── Models tab ───────────────────────────────────────────────────────────────

type ModelVersion = {
  version: string; rankerType: string; active: boolean;
  fingerprintSchemaVersion: string; createdAt: string;
  stats: { snapshotCount: number; profileCount: number } | null;
};

type Readiness = {
  database: { ok: boolean };
  catalog: { titles: number; threshold: number; ok: boolean };
  fingerprintCoverage: { published: number; total: number; percent: number; ok: boolean };
  modelService: { configured: boolean; reachable: boolean; ok: boolean };
};

type TrainingJobRow = {
  id: string; profileId: string; status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number; errorKind: 'invalid' | 'error' | null; lastError: string | null;
  nextAttemptAt: string; finishedAt: string | null; createdAt: string;
};

const JOB_STATUS_LABEL: Record<TrainingJobRow['status'], string> = {
  queued: 'قيد الانتظار', running: 'قيد التنفيذ', succeeded: 'نجح', failed: 'فشل',
};

// GET admin/readiness (ADR-100): can training plausibly succeed right now --
// answered once per load, never on a hot path.
function ReadinessStrip() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  useEffect(() => {
    api.adminGetReadiness().then(setReadiness).catch(() => setReadiness(null));
  }, []);
  if (!readiness) return null;
  const items: { label: string; ok: boolean; detail: string }[] = [
    { label: 'القاعدة', ok: readiness.database.ok, detail: readiness.database.ok ? 'متصلة' : 'غير متصلة' },
    { label: 'الكتالوج', ok: readiness.catalog.ok, detail: `${readiness.catalog.titles} / ${readiness.catalog.threshold}` },
    { label: 'تغطية البصمات', ok: readiness.fingerprintCoverage.ok, detail: `${readiness.fingerprintCoverage.percent}%` },
    {
      label: 'خدمة النموذج',
      ok: readiness.modelService.ok,
      detail: !readiness.modelService.configured ? 'غير مُهيَّأة' : readiness.modelService.reachable ? 'تجيب' : 'لا تجيب',
    },
  ];
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr>{items.map(i => <th key={i.label}>{i.label}</th>)}</tr></thead>
        <tbody>
          <tr>
            {items.map(i => (
              <td key={i.label}>
                <span className={`${s.badge} ${i.ok ? s.green : s.red}`}>{i.detail}</span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// GET admin/training-jobs (ADR-100): the same shape as the mail outbox's
// admin view -- counts by status and the recent rows, never an address, a
// body, or (here) the unsanitized error.
function TrainingJobsTable() {
  const [data, setData] = useState<{ counts: Record<TrainingJobRow['status'], number>; recent: TrainingJobRow[] } | null>(null);
  useEffect(() => {
    api.adminGetTrainingJobs().then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  return (
    <>
      <h3 className={s.subhead}>
        طابور التدريب — قيد الانتظار {data.counts.queued} · قيد التنفيذ {data.counts.running} · نجح {data.counts.succeeded} · فشل {data.counts.failed}
      </h3>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr><th>الملف</th><th>الحالة</th><th>محاولات</th><th>الخطأ</th><th>آخر تحديث</th></tr>
          </thead>
          <tbody>
            {data.recent.map(row => (
              <tr key={row.id}>
                <td className={s.mono}>{row.profileId.slice(0, 8)}</td>
                <td>
                  <span className={`${s.badge} ${row.status === 'failed' ? s.red : row.status === 'succeeded' ? s.green : s.yellow}`}>
                    {JOB_STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td>{row.attempts}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{fmt(row.finishedAt ?? row.createdAt)}</td>
              </tr>
            ))}
            {data.recent.length === 0 && (
              <tr><td colSpan={5} className={s.loading}>لا جولات تدريب بعد</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ModelsTab() {
  const [data, setData] = useState<{ versions: ModelVersion[]; unregistered: { modelVersion: string; snapshotCount: number; profileCount: number }[] } | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    api.adminGetModels().then(setData).catch(() => setData(null)).finally(() => setBusy(false));
  }, []);

  if (busy) return <div className={s.loading}>جارٍ التحميل…</div>;
  if (!data) return <div className={s.loading}>تعذّر التحميل.</div>;

  return (
    <div className={s.tabBody}>
      <ReadinessStrip />
      <TrainingJobsTable />
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>الإصدار</th>
              <th>نوع المصنّف</th>
              <th>مخطط البصمة</th>
              <th>لقطات</th>
              <th>ملفات شخصية</th>
              <th>نشط</th>
            </tr>
          </thead>
          <tbody>
            {data.versions.map(row => (
              <tr key={row.version} className={row.active ? s.activeRow : undefined}>
                <td className={s.mono}>{row.version}</td>
                <td className={s.mono}>{row.rankerType}</td>
                <td className={s.mono}>{row.fingerprintSchemaVersion}</td>
                <td>{row.stats?.snapshotCount ?? '—'}</td>
                <td>{row.stats?.profileCount ?? '—'}</td>
                <td>{row.active ? <span className={`${s.badge} ${s.green}`}>نشط</span> : '—'}</td>
              </tr>
            ))}
            {data.versions.length === 0 && (
              <tr><td colSpan={6} className={s.loading}>لا إصدارات مسجَّلة</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {data.unregistered.length > 0 && (
        <>
          <h3 className={s.subhead}>إصدارات غير مسجَّلة (من اللقطات)</h3>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th>الإصدار</th><th>لقطات</th><th>ملفات شخصية</th></tr>
              </thead>
              <tbody>
                {data.unregistered.map(row => (
                  <tr key={row.modelVersion}>
                    <td className={s.mono}>{row.modelVersion}</td>
                    <td>{row.snapshotCount}</td>
                    <td>{row.profileCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Privacy requests tab ─────────────────────────────────────────────────────

type PrivacyRow = { id: string; type: string; status: string; requestedAt: string; executeAfter: string | null; completedAt: string | null };

const PR_TYPE_LABEL: Record<string, string> = { export: 'تصدير', delete: 'حذف', reset: 'إعادة ضبط' };
const PR_STATUS_LABEL: Record<string, string> = {
  requested: 'مطلوب', verifying: 'جارٍ التحقق', scheduled: 'مجدوَل',
  running: 'قيد التنفيذ', done: 'منجز', cancelled: 'ملغى',
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function PrivacyTab() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('scheduled');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: PrivacyRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (t: string, st: string, pg: number) => {
    await Promise.resolve(); // defer setBusy out of synchronous effect context
    setBusy(true);
    try {
      const data = await api.adminGetPrivacyRequests({ type: t || undefined, status: st || undefined, page: pg, limit: 50 });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { void load(type, status, page); }, 0);
    return () => clearTimeout(id);
  }, [type, status, page, load]);

  return (
    <div className={s.tabBody}>
      <div className={s.toolbar}>
        <select className={s.filter} value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
          <option value="">كل الأنواع</option>
          <option value="export">تصدير</option>
          <option value="delete">حذف</option>
          <option value="reset">إعادة ضبط</option>
        </select>
        <select className={s.filter} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">كل الحالات</option>
          <option value="requested">مطلوب</option>
          <option value="verifying">جارٍ التحقق</option>
          <option value="scheduled">مجدوَل</option>
          <option value="running">قيد التنفيذ</option>
          <option value="done">منجز</option>
          <option value="cancelled">ملغى</option>
        </select>
      </div>

      {result && <p className={s.count}>{result.total} طلب</p>}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>المعرف</th>
              <th>النوع</th>
              <th>الحالة</th>
              <th>تاريخ الطلب</th>
              <th>موعد التنفيذ</th>
              <th>مكتمل في</th>
            </tr>
          </thead>
          <tbody>
            {busy && !result && (
              <tr><td colSpan={6} className={s.loading}>جارٍ التحميل…</td></tr>
            )}
            {result?.items.map(row => (
              <tr key={row.id}>
                <td className={s.mono}>{row.id.slice(0, 8)}…</td>
                <td>{PR_TYPE_LABEL[row.type] ?? row.type}</td>
                <td>
                  <span className={`${s.badge} ${row.status === 'done' ? s.green : row.status === 'cancelled' ? '' : row.status === 'scheduled' ? s.yellow : ''}`}>
                    {PR_STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
                <td>{fmt(row.requestedAt)}</td>
                <td>{fmt(row.executeAfter)}</td>
                <td>{fmt(row.completedAt)}</td>
              </tr>
            ))}
            {result?.items.length === 0 && (
              <tr><td colSpan={6} className={s.loading}>لا طلبات</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {result && result.totalPages > 1 && (
        <div className={s.pages}>
          <button className={s.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
          <span>{page} / {result.totalPages}</span>
          <button className={s.pageBtn} disabled={page >= result.totalPages} onClick={() => setPage(p => p + 1)}>التالي</button>
        </div>
      )}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<Tab, string> = {
  catalog: 'الكتالوج',
  features: 'مراجعة البصمات',
  models: 'النماذج',
  privacy: 'الخصوصية',
};

type Access = 'checking' | 'allowed' | 'forbidden';

export function AdminScreen() {
  const [tab, setTab] = useState<Tab>('catalog');
  const [access, setAccess] = useState<Access>('checking');

  // Gate the whole screen on a real admin check (AUDIT_2026-09-05 C1/M5):
  // the tab UI below must not mount before this resolves, and ANY non-2xx
  // response (401 for an anonymous visitor included, not just 403) must
  // deny access -- checking `err.status === 403` only let an anonymous
  // visitor's 401 fall through and leave the admin shell visible.
  useEffect(() => {
    let cancelled = false;
    api.adminGetTitles({ limit: 1 })
      .then(() => { if (!cancelled) setAccess('allowed'); })
      .catch(() => { if (!cancelled) setAccess('forbidden'); });
    return () => { cancelled = true; };
  }, []);

  if (access !== 'allowed') {
    return (
      <div className={s.screen}>
        <p className={s.forbidden}>
          {access === 'checking' ? 'جارٍ التحقق من الصلاحية...' : 'ليس لديك صلاحية الوصول إلى لوحة الإدارة.'}
        </p>
      </div>
    );
  }

  return (
    <div className={s.screen}>
      <header className={s.header}>
        <h1 className={s.title}>لوحة الإدارة</h1>
      </header>

      <div className={s.tabs} role="tablist">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'catalog' && <CatalogTab />}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'models' && <ModelsTab />}
      {tab === 'privacy' && <PrivacyTab />}
    </div>
  );
}
