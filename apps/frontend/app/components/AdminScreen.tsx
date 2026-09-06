'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { AdminAccessBoundary } from './admin/AdminAccessBoundary';
import s from './AdminScreen.module.css';

type Tab = 'catalog' | 'features' | 'models' | 'privacy';

// ── Catalog tab ─────────────────────────────────────────────────────────────

type TitleRow = {
  id: string; internalId: string; titleEn: string; titleAr: string;
  releaseYear: number | null; hasFingerprint: boolean; hasV2: boolean;
  licenseStatus: string; sourceRecords: number; unreviewedFeatures: number;
};

// ADMIN-W1 (ADM-P1-03/04): debounce settles the *filter*, not the fetch, so
// a filter change and a page change never race each other into two
// concurrent identical requests. The one fetch effect below aborts its
// predecessor -- an in-flight request from a superseded filter/page can
// never overwrite a newer result (out-of-order responses, ADM-P1-04).
function CatalogTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [missing, setMissing] = useState<'' | 'fingerprint' | 'v2' | 'license'>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: TitleRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // A filter change always returns to page 1; this runs before the fetch
  // effect below observes the new debouncedQuery/missing.
  useEffect(() => {
    void (async () => {
      await Promise.resolve(); // defer setState out of synchronous effect context
      setPage(1);
    })();
  }, [debouncedQuery, missing]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve(); // defer setState out of synchronous effect context
      setBusy(true);
      setFailed(false);
      try {
        const data = await api.adminGetTitles({ query: debouncedQuery || undefined, missing: missing || undefined, page, limit: 50, signal: controller.signal });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // superseded, not a failure
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [debouncedQuery, missing, page, retryTick]);

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

      {result && <p className={s.count}>{result.total} عنوان{busy && ' — جارٍ التحديث…'}</p>}
      {failed && (
        <p className={s.forbidden} role="status" aria-live="polite">
          تعذّر تحميل الكتالوج.{' '}
          <button type="button" className={s.smallBtn} onClick={() => setRetryTick(t => t + 1)}>إعادة المحاولة</button>
        </p>
      )}

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
  id: string; titleId: string; featureKey: string; value: number | null;
  extractorVersion: string; reviewStatus: string;
  title: { id: string; internalId: string; titleEn: string; titleAr: string } | null;
};

function FeaturesTab() {
  const [reviewStatus, setReviewStatus] = useState('unreviewed');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: FeatureRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // ADM-P1-03/04: an in-flight request from a superseded filter/page is
  // aborted, so it can never land after (and overwrite) a newer one.
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

  // ADM-P1-05: apply the server's real reviewStatus (not an assumed
  // 'sampled'), and drop the row from view when it no longer matches the
  // active filter -- a corrected value also supersedes the row entirely.
  const markSampled = async (featureId: string) => {
    setReviewing(featureId);
    setReviewError(null);
    try {
      const { feature, correction } = await api.adminReviewFeature(featureId, { reviewStatus: 'sampled' });
      const newStatus = correction ? correction.reviewStatus : feature.reviewStatus;
      const stillMatchesFilter = !reviewStatus || newStatus === reviewStatus;
      setResult(prev => {
        if (!prev) return prev;
        if (stillMatchesFilter) {
          return { ...prev, items: prev.items.map(f => (f.id === featureId ? { ...f, reviewStatus: newStatus } : f)) };
        }
        return { ...prev, items: prev.items.filter(f => f.id !== featureId), total: Math.max(0, prev.total - 1) };
      });
    } catch {
      setReviewError('تعذّر حفظ المراجعة. حاول مرة أخرى.');
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

      {result && <p className={s.count}>{result.total} صف{busy && ' — جارٍ التحديث…'}</p>}
      {failed && (
        <p className={s.forbidden} role="status" aria-live="polite">
          تعذّر تحميل قائمة المراجعة.{' '}
          <button type="button" className={s.smallBtn} onClick={() => setRetryTick(t => t + 1)}>إعادة المحاولة</button>
        </p>
      )}
      {reviewError && (
        <p className={s.forbidden} role="alert">{reviewError}</p>
      )}

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
                <td className={s.mono}>{row.value?.toFixed(3) ?? '—'}</td>
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
  nextAttemptAt: string; finishedAt: string | null; createdAt: string; updatedAt: string;
};

const JOB_STATUS_LABEL: Record<TrainingJobRow['status'], string> = {
  queued: 'قيد الانتظار', running: 'قيد التنفيذ', succeeded: 'نجح', failed: 'فشل',
};

// GET admin/readiness (ADR-100): can training plausibly succeed right now --
// answered once per load, never on a hot path. Owns its own loading/error/
// retry (ADM-P1-06): a failure here must never hide the training table.
function ReadinessStrip() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const result = await api.adminGetReadiness();
        if (!cancelled) setReadiness(result);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (failed) {
    return (
      <div className={s.loading} role="status" aria-live="polite">
        تعذّر تحميل الجاهزية.{' '}
        <button type="button" className={s.smallBtn} onClick={() => setAttempt(a => a + 1)}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!readiness) return <div className={s.loading}>جارٍ التحميل…</div>;
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
// body, or (here) the unsanitized error. Independent loading/error/retry
// (ADM-P1-06), same as ReadinessStrip.
function TrainingJobsTable() {
  const [data, setData] = useState<{ counts: Record<TrainingJobRow['status'], number>; recent: TrainingJobRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const result = await api.adminGetTrainingJobs();
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (failed) {
    return (
      <div className={s.loading} role="status" aria-live="polite">
        تعذّر تحميل طابور التدريب.{' '}
        <button type="button" className={s.smallBtn} onClick={() => setAttempt(a => a + 1)}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!data) return <div className={s.loading}>جارٍ التحميل…</div>;
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
                {/* ADMIN-W1 (ADM-P1-07): the server's own updatedAt, not
                    finishedAt ?? createdAt -- a running/queued/failed row
                    was never "finished", so that fallback silently showed
                    the wrong moment. Date + time + zone, not day-only. */}
                <td>{fmtDateTime(row.updatedAt)}</td>
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

// ADMIN-W1 (ADM-P1-06): readiness and the training queue do not depend on
// the model-version list succeeding -- each Widget below owns its own
// loading/error/retry so one resource's failure never hides the other two.
function ModelVersionsTable() {
  const [data, setData] = useState<{ versions: ModelVersion[]; unregistered: { modelVersion: string; snapshotCount: number; profileCount: number }[] } | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setBusy(true);
      setFailed(false);
      try {
        const result = await api.adminGetModels();
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (busy) return <div className={s.loading}>جارٍ التحميل…</div>;
  if (failed || !data) {
    return (
      <div className={s.loading} role="status" aria-live="polite">
        تعذّر تحميل إصدارات النماذج.{' '}
        <button type="button" className={s.smallBtn} onClick={() => setAttempt(a => a + 1)}>إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <>
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
    </>
  );
}

function ModelsTab() {
  return (
    <div className={s.tabBody}>
      <ReadinessStrip />
      <TrainingJobsTable />
      <ModelVersionsTable />
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

// ADMIN-W1: routed through lib/format's Gregorian + Latin-digit contract
// (identity decision Q12) -- plain `ar-SA` defaults to the Umm al-Qura
// calendar and Arabic-Indic digits, which silently misdated every admin
// timestamp built that way (this file included, until now).
function fmt(iso: string | null) {
  return iso ? formatDate(iso, 'ar') : '—';
}

// ADMIN-W1 (ADM-P1-07): operational rows (training jobs) need a time and an
// explicit zone, unlike the day-only `fmt` used for the coarser privacy
// request dates above.
function fmtDateTime(iso: string | null) {
  return iso ? formatDateTime(iso, 'ar') : '—';
}

function PrivacyTab() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('scheduled');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: PrivacyRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // ADM-P1-03/04: abort a superseded filter/page request instead of letting
  // it race a newer one to the screen.
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

      {result && <p className={s.count}>{result.total} طلب{busy && ' — جارٍ التحديث…'}</p>}
      {failed && (
        <p className={s.forbidden} role="status" aria-live="polite">
          تعذّر تحميل طلبات الخصوصية.{' '}
          <button type="button" className={s.smallBtn} onClick={() => setRetryTick(t => t + 1)}>إعادة المحاولة</button>
        </p>
      )}

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

export function AdminScreen() {
  const [tab, setTab] = useState<Tab>('catalog');

  // Access boundary (ADMIN-W1, ADR-117): waits for session.ready, then a
  // real /admin/context probe distinguishing unauthenticated/forbidden/
  // network/timeout/server-error instead of collapsing every failure into
  // "no access" (AUDIT_2026-09-05 C1/M5's original fix, now made precise).
  return (
    <AdminAccessBoundary>
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
    </AdminAccessBoundary>
  );
}
