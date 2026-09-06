'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api, type AdminJobRecord, type AdminJobType } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { ADMIN_SECTION_COPY, JOB_STATUS_LABELS, adminErrorReasonLabel } from '../admin-copy';
import m from '../monitoring/monitoring.module.css';
import s from './administration.module.css';

function statusBadge(status: AdminJobRecord['status']) {
  const cls = status === 'failed' ? m.red : status === 'succeeded' ? m.green : status === 'cancelled' ? m.yellow : '';
  return <span className={`${m.badge} ${cls}`}>{JOB_STATUS_LABELS[status] ?? status}</span>;
}

// ADMIN-W5 (plan §17.2, §18 W5): the only screen that writes to the job
// queue -- creating one (allowlisted type, optional dry run, optional
// idempotency key) and cancelling one. No auto-poll (same choice
// OverviewMonitor made for a costly read): the operator refreshes on
// purpose, matching the mandated flow (load context, confirm, atomic write,
// readback) rather than a silent background timer.
export function JobsAdmin() {
  const [types, setTypes] = useState<AdminJobType[] | null>(null);
  const [recent, setRecent] = useState<AdminJobRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const [typeList, jobList] = await Promise.all([
          api.adminGetJobTypes(controller.signal),
          api.adminGetJobs({ limit: 10, signal: controller.signal }),
        ]);
        setTypes(typeList);
        setRecent(jobList.items);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);
  const applyLocalUpdate = (updated: AdminJobRecord) => {
    setRecent((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
  };

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.jobsAdmin.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.jobsAdmin.blurb}</p>
      </div>

      {failed && (
        <p className={m.count} role="status" aria-live="polite">
          تعذّر التحميل. <button type="button" className={m.pageBtn} onClick={reload}>إعادة المحاولة</button>
        </p>
      )}
      {!failed && !types && <p className={m.count}>جارٍ التحميل…</p>}
      {!failed && types && <CreateJobForm types={types} onCreated={reload} />}

      <div className={s.actions}>
        <h3 className={s.sectionHeading}>آخر المهام</h3>
        <button type="button" className={s.secondaryBtn} onClick={reload}>تحديث</button>
      </div>
      {!recent && !failed && <p className={m.count}>جارٍ التحميل…</p>}
      {recent && recent.length === 0 && <p className={m.count}>لا مهام بعد</p>}
      {recent && recent.length > 0 && (
        <ul className={m.plainList}>
          {recent.map((row) => (
            <JobRow key={row.id} row={row} onChanged={applyLocalUpdate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobRow({ row, onChanged }: { row: AdminJobRecord; onChanged: (updated: AdminJobRecord) => void }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const cancellable = row.status === 'queued' || row.status === 'running';

  const refresh = async () => {
    setStatus('pending');
    try {
      const updated = await api.adminGetJob(row.id);
      onChanged(updated);
      setStatus('idle');
    } catch {
      setStatus('idle');
    }
  };

  const cancel = async () => {
    setStatus('pending');
    setError(null);
    try {
      const updated = await api.adminCancelJob(row.id);
      onChanged(updated);
      setStatus('idle');
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      setError(adminErrorReasonLabel(reasonCode, 'تعذّر الإلغاء.'));
      setStatus('error');
    }
  };

  return (
    <li className={s.recordCard}>
      <div className={m.cardRow}>
        <span className={m.mono}>{row.type}</span>
        {statusBadge(row.status)}
        {row.dryRun && <span className={m.badge}>تجريبي</span>}
        <span>{formatDateTime(row.createdAt, 'ar')}</span>
        <button type="button" className={s.secondaryBtn} disabled={status === 'pending'} onClick={refresh}>تحديث</button>
        {cancellable && (
          <button type="button" className={s.dangerBtn} disabled={status === 'pending'} onClick={cancel}>إلغاء</button>
        )}
        <Link className={s.auditLink} href={`/admin/monitoring/audit?resource=admin_job&resourceId=${row.id}`}>سجل العمليات</Link>
      </div>
      {row.progress ? <p className={m.pageBlurb}>{JSON.stringify(row.progress)}</p> : null}
      {row.result ? <p className={m.pageBlurb}>{JSON.stringify(row.result)}</p> : null}
      {status === 'error' && error && <p role="alert" className={`${s.banner} ${s.bannerError}`}>{error}</p>}
    </li>
  );
}

type CreateStatus = 'idle' | 'pending' | 'success' | 'error';

function CreateJobForm({ types, onCreated }: { types: AdminJobType[]; onCreated: () => void }) {
  const [type, setType] = useState(types[0]?.type ?? '');
  const [dryRun, setDryRun] = useState(true);
  const [titleId, setTitleId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [status, setStatus] = useState<CreateStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [createdJob, setCreatedJob] = useState<AdminJobRecord | null>(null);

  const selected = types.find((t) => t.type === type);

  const submit = async () => {
    setStatus('pending');
    setError(null);
    try {
      const params = titleId.trim() ? { titleId: titleId.trim() } : undefined;
      const { job } = await api.adminCreateJob({ type, dryRun, params, idempotencyKey: idempotencyKey.trim() || undefined });
      setCreatedJob(job);
      setStatus('success');
      onCreated();
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      const allowlist = err instanceof ApiError && Array.isArray(err.details.allowlist) ? (err.details.allowlist as string[]).join('، ') : null;
      setError(adminErrorReasonLabel(reasonCode, 'تعذّر تشغيل المهمة.') + (allowlist ? ` الأنواع المتاحة: ${allowlist}.` : ''));
      setStatus('error');
    }
  };

  return (
    <div className={s.formCard}>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label htmlFor="job-type">نوع المهمة</label>
          <select id="job-type" className={s.select} value={type} onChange={(e) => setType(e.target.value)} disabled={status === 'pending'}>
            {types.map((t) => <option key={t.type} value={t.type}>{t.type}</option>)}
          </select>
        </div>
        <div className={s.field}>
          <span>الوضع</span>
          <label className={s.checkboxRow}>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={status === 'pending'} />
            تنفيذ تجريبي (بلا كتابة فعلية)
          </label>
        </div>
        <div className={s.field}>
          <label htmlFor="job-titleid">معرّف فيلم محدد (اختياري — فارغ يعني كل الكتالوج)</label>
          <input id="job-titleid" className={s.input} value={titleId} onChange={(e) => setTitleId(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="job-idem">مفتاح تكرار (اختياري — يمنع تشغيل نفس الطلب مرتين)</label>
          <input id="job-idem" className={s.input} value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} disabled={status === 'pending'} />
        </div>
        {selected && (
          <div className={`${s.field} ${s.fieldGridWide}`}>
            <span className={m.pageBlurb}>{selected.description}</span>
          </div>
        )}
      </div>
      <div className={s.actions}>
        <button type="button" className={s.primaryBtn} disabled={!type || status === 'pending'} onClick={submit}>
          {status === 'pending' ? '…' : 'تشغيل المهمة'}
        </button>
      </div>
      {status === 'success' && createdJob && (
        <p className={`${s.banner} ${s.bannerSuccess}`} role="status" aria-live="polite">
          بدأت المهمة (الحالة: {JOB_STATUS_LABELS[createdJob.status] ?? createdJob.status}). حدّث القائمة أدناه لمتابعة تقدمها.
        </p>
      )}
      {status === 'error' && error && <p className={`${s.banner} ${s.bannerError}`} role="alert">{error}</p>}
    </div>
  );
}
