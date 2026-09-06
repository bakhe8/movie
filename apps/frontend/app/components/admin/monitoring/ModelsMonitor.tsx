'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
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
    { label: 'القاعدة', ok: readiness.database.ok, detail: readiness.database.ok ? 'متصلة' : 'غير متصلة' },
    { label: 'الكتالوج', ok: readiness.catalog.ok, detail: `${readiness.catalog.titles} / ${readiness.catalog.threshold}` },
    { label: 'تغطية البصمات', ok: readiness.fingerprintCoverage.ok, detail: `${readiness.fingerprintCoverage.percent}%` },
    {
      label: 'خدمة النموذج', ok: readiness.modelService.ok,
      detail: !readiness.modelService.configured ? 'غير مُهيَّأة' : readiness.modelService.reachable ? 'تجيب' : 'لا تجيب',
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
        تعذّر تحميل طابور التدريب. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
      </p>
    );
  }
  if (!data) return <p className={m.count}>جارٍ التحميل…</p>;

  return (
    <>
      <h3 className={m.subhead}>
        طابور التدريب — قيد الانتظار {data.counts.queued} · قيد التنفيذ {data.counts.running} · نجح {data.counts.succeeded} · فشل {data.counts.failed}
      </h3>
      {data.recent.length === 0 ? (
        <p className={m.count}>لا جولات تدريب بعد</p>
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
        <p className={m.count}>لا إصدارات مسجَّلة</p>
      ) : (
        <ul className={m.plainList}>
          {data.versions.map((row) => (
            <li key={row.version} className={m.cardRow}>
              <span className={m.mono}>{row.version}</span>
              <span>{row.rankerType}</span>
              <span>لقطات: {row.stats?.snapshotCount ?? '—'}</span>
              <span>ملفات: {row.stats?.profileCount ?? '—'}</span>
              {row.active && <span className={`${m.badge} ${m.green}`}>نشط</span>}
            </li>
          ))}
        </ul>
      )}

      {data.unregistered.length > 0 && (
        <>
          <h3 className={m.subhead}>إصدارات غير مسجَّلة (من اللقطات)</h3>
          <ul className={m.plainList}>
            {data.unregistered.map((row) => (
              <li key={row.modelVersion} className={m.cardRow}>
                <span className={m.mono}>{row.modelVersion}</span>
                <span>لقطات: {row.snapshotCount}</span>
                <span>ملفات: {row.profileCount}</span>
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
      <h3 className={m.subhead}>الجاهزية</h3>
      <ReadinessStrip />
      <TrainingJobsTable />
      <h3 className={m.subhead}>إصدارات النماذج</h3>
      <ModelVersionsTable />
    </div>
  );
}
