'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { ADMIN_SECTION_COPY, MODEL_SERVICE_STATUS_COPY, MODEL_VERSION_STATUS_COPY, modelServiceStatus } from '../admin-copy';
import m from './monitoring.module.css';

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

function fmtDateTime(iso: string | null) {
  return iso ? formatDateTime(iso, 'ar') : '—';
}

// ADMIN-W2: same fetch/error/retry logic as the W1 fix (each widget is
// independent -- one resource's failure never hides the other two), moved
// here under the new admin light tokens instead of AdminScreen.module.css.
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
      <p className={`${m.count}`} role="status" aria-live="polite">
        تعذّر تحميل الجاهزية. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
      </p>
    );
  }
  if (!readiness) return <p className={m.count}>جارٍ التحميل…</p>;

  const items = [
    { label: 'قاعدة البيانات', ok: readiness.database.ok, detail: readiness.database.ok ? 'متصلة' : 'غير متصلة' },
    {
      label: 'عدد الأفلام',
      ok: readiness.catalog.ok,
      detail: `${readiness.catalog.titles} (الحد الأدنى المطلوب ${readiness.catalog.threshold})`,
    },
    { label: 'نسبة الأفلام المحلَّلة', ok: readiness.fingerprintCoverage.ok, detail: `${readiness.fingerprintCoverage.percent}%` },
    {
      label: 'خدمة الذكاء الاصطناعي',
      ok: readiness.modelService.ok,
      detail: MODEL_SERVICE_STATUS_COPY[modelServiceStatus(readiness.modelService.configured, readiness.modelService.reachable)],
    },
  ];
  return (
    <div className={m.cardRow} role="group" aria-label="الجاهزية">
      {items.map((i) => (
        <span key={i.label} className={`${m.badge} ${i.ok ? m.green : m.red}`}>{i.label}: {i.detail}</span>
      ))}
    </div>
  );
}

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
      <p className={m.count} role="status" aria-live="polite">
        تعذّر تحميل تحديثات ملفات الذوق. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
      </p>
    );
  }
  if (!data) return <p className={m.count}>جارٍ التحميل…</p>;

  return (
    <>
      <h3 className={m.subhead}>
        تحديث ملفات الذوق — قيد الانتظار {data.counts.queued} · قيد التنفيذ {data.counts.running} · نجح {data.counts.succeeded} · فشل {data.counts.failed}
      </h3>
      {data.recent.length === 0 ? (
        <p className={m.count}>لا عمليات تحديث بعد</p>
      ) : (
        <ul className={m.plainList}>
          {data.recent.map((row) => (
            <li key={row.id} className={m.cardRow}>
              <span className={m.mono}>{row.profileId.slice(0, 8)}</span>
              <span className={`${m.badge} ${row.status === 'failed' ? m.red : row.status === 'succeeded' ? m.green : m.yellow}`}>
                {JOB_STATUS_LABEL[row.status]}
              </span>
              <span>محاولات: {row.attempts}</span>
              <span>{row.lastError ?? '—'}</span>
              <span>{fmtDateTime(row.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

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

  if (busy) return <p className={m.count}>جارٍ التحميل…</p>;
  if (failed || !data) {
    return (
      <p className={m.count} role="status" aria-live="polite">
        تعذّر تحميل إصدارات النماذج. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
      </p>
    );
  }

  return (
    <>
      {data.versions.length === 0 ? (
        <p className={m.count}>لا يوجد إصدار معتمَد رسمياً بعد</p>
      ) : (
        <ul className={m.plainList}>
          {data.versions.map((row) => (
            <li key={row.version} className={m.cardRow}>
              <span className={m.mono}>{row.version}</span>
              <span className={`${m.badge} ${row.active ? m.green : ''}`}>
                {row.active ? MODEL_VERSION_STATUS_COPY.active : MODEL_VERSION_STATUS_COPY.registeredInactive}
              </span>
              <span>عدد ملفات الذوق: {row.stats?.snapshotCount ?? '—'}</span>
              <span>عدد المستخدمين: {row.stats?.profileCount ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}

      {data.unregistered.length > 0 && (
        <>
          <h3 className={m.subhead}>{MODEL_VERSION_STATUS_COPY.unregistered}</h3>
          <ul className={m.plainList}>
            {data.unregistered.map((row) => (
              <li key={row.modelVersion} className={m.cardRow}>
                <span className={m.mono}>{row.modelVersion}</span>
                <span>عدد ملفات الذوق: {row.snapshotCount}</span>
                <span>عدد المستخدمين: {row.profileCount}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ADMIN-W2 (plan §11.2): readiness/versions/experiments/triads -> النماذج
// والتعلّم. Read-only in W2; registration/activation is W4.
export function ModelsMonitor() {
  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.models.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.models.blurb}</p>
      </div>

      <h3 className={m.subhead}>الجاهزية العامة</h3>
      <ReadinessStrip />
      <TrainingJobsTable />
      <h3 className={m.subhead}>إصدارات محرك التوصيات</h3>
      <ModelVersionsTable />
    </div>
  );
}
