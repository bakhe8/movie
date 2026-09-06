'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { ADMIN_SECTION_COPY, MAIL_KIND_LABELS, MAIL_STATUS_LABELS } from '../admin-copy';
import m from './monitoring.module.css';

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

// ADMIN-W3: moved here from النماذج والتعلّم (plan §11's IA groups training
// jobs under التشغيل, not model versions) -- same fetch/error/retry logic
// as the W1 fix, unchanged.
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

// ADMIN-W3 (ADR-97, W0 case B6): counts and recent rows only -- never an
// address or a message body.
function MailOutboxTable() {
  const [data, setData] = useState<{
    counts: { pending: number; delivered: number; dead: number };
    recent: { id: string; kind: string; status: 'pending' | 'delivered' | 'dead'; attempts: number; nextAttemptAt: string; lastError: string | null; deliveredAt: string | null; createdAt: string }[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const result = await api.adminGetMailOutbox();
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
        تعذّر تحميل البريد الصادر. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
      </p>
    );
  }
  if (!data) return <p className={m.count}>جارٍ التحميل…</p>;

  return (
    <>
      <h3 className={m.subhead}>
        البريد الصادر — بانتظار الإرسال {data.counts.pending} · أُرسلت {data.counts.delivered} · فشلت نهائياً {data.counts.dead}
      </h3>
      {data.recent.length === 0 ? (
        <p className={m.count}>لا رسائل بعد</p>
      ) : (
        <ul className={m.plainList}>
          {data.recent.map((row) => (
            <li key={row.id} className={m.cardRow}>
              <span>{MAIL_KIND_LABELS[row.kind] ?? row.kind}</span>
              <span className={`${m.badge} ${row.status === 'dead' ? m.red : row.status === 'delivered' ? m.green : m.yellow}`}>
                {MAIL_STATUS_LABELS[row.status] ?? row.status}
              </span>
              <span>محاولات: {row.attempts}</span>
              <span>{row.lastError ?? '—'}</span>
              <span>{fmtDateTime(row.deliveredAt ?? row.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ADMIN-W3 (plan §11.2 "التشغيل"): the background jobs that keep the
// product current -- read-only, no mutation import.
export function OperationsMonitor() {
  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.operations.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.operations.blurb}</p>
      </div>
      <TrainingJobsTable />
      <MailOutboxTable />
    </div>
  );
}
