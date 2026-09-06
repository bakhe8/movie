'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { ADMIN_SECTION_COPY, MODEL_VERSION_STATUS_COPY, adminErrorReasonLabel } from '../admin-copy';
import m from '../monitoring/monitoring.module.css';
import s from './administration.module.css';

type ModelRow = {
  version: string; rankerType: string; active: boolean; fingerprintSchemaVersion: string; createdAt: string;
  stats: { snapshotCount: number; profileCount: number } | null;
};
type UnregisteredRow = { modelVersion: string; snapshotCount: number; profileCount: number };

// ADMIN-W4 (W0 case A6, ADM-P0-05): registering a version never activates it
// -- the server keeps exactly one active version at a time
// (AdminModelsService.updateModel's single transaction), so activating one
// here is a separate, explicit step with its own confirmation, not a side
// effect of the registration form.
export function ModelRegistrationAdmin() {
  const [versions, setVersions] = useState<ModelRow[] | null>(null);
  const [unregistered, setUnregistered] = useState<UnregisteredRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const data = await api.adminGetModels();
        if (controller.signal.aborted) return;
        setVersions(data.versions);
        setUnregistered(data.unregistered);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.modelRegistration.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.modelRegistration.blurb}</p>
      </div>

      <RegisterForm onRegistered={reload} />

      <h3 className={s.sectionHeading}>الإصدارات المسجَّلة</h3>
      {failed && (
        <p className={m.count} role="status" aria-live="polite">
          تعذّر تحميل الإصدارات. <button type="button" className={m.pageBtn} onClick={reload}>إعادة المحاولة</button>
        </p>
      )}
      {!failed && !versions && <p className={m.count}>جارٍ التحميل…</p>}
      {!failed && versions && versions.length === 0 && <p className={m.count}>لا إصدارات مسجَّلة بعد</p>}
      {!failed && versions && versions.length > 0 && (
        <ul className={m.plainList}>
          {versions.map((v) => (
            <ModelRow key={v.version} row={v} onActivated={reload} />
          ))}
        </ul>
      )}

      {unregistered.length > 0 && (
        <>
          <h3 className={s.sectionHeading}>ظهرت من الاستخدام الفعلي ولم تُسجَّل بعد</h3>
          <ul className={m.plainList}>
            {unregistered.map((u) => (
              <li key={u.modelVersion} className={m.cardRow}>
                <span className={m.mono}>{u.modelVersion}</span>
                <span>{MODEL_VERSION_STATUS_COPY.unregistered}</span>
                <span>{u.profileCount} ملف ذوق</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ModelRow({ row, onActivated }: { row: ModelRow; onActivated: () => void }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setStatus('pending');
    setError(null);
    try {
      await api.adminUpdateModel(row.version, { active: true });
      onActivated();
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      setError(adminErrorReasonLabel(reasonCode, 'تعذّر التفعيل. حاول مرة أخرى.'));
      setStatus('error');
    }
  };

  return (
    <li className={m.cardRow}>
      <span className={m.mono}>{row.version}</span>
      <span>{row.rankerType}</span>
      <span className={`${m.badge} ${row.active ? m.green : ''}`}>{row.active ? MODEL_VERSION_STATUS_COPY.active : MODEL_VERSION_STATUS_COPY.registeredInactive}</span>
      <span>{row.stats ? `${row.stats.snapshotCount} نسخة ذوق مبنية عليه` : 'لا استخدام بعد'}</span>
      <span>{formatDate(row.createdAt, 'ar')}</span>
      {!row.active && (
        <button type="button" className={s.secondaryBtn} disabled={status === 'pending'} onClick={activate}>
          {status === 'pending' ? '…' : 'تفعيل هذا الإصدار'}
        </button>
      )}
      <Link className={s.auditLink} href={`/admin/monitoring/audit?resource=model_version&resourceId=${row.version}`}>سجل العمليات</Link>
      {status === 'error' && error && <span role="alert" className={s.bannerError}>{error}</span>}
    </li>
  );
}

type RegisterStatus = 'idle' | 'pending' | 'success' | 'error';

function RegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const [version, setVersion] = useState('');
  const [rankerType, setRankerType] = useState('');
  const [fingerprintSchemaVersion, setFingerprintSchemaVersion] = useState('v1+v2');
  const [codeRef, setCodeRef] = useState('');
  const [status, setStatus] = useState<RegisterStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = version.trim().length > 0 && rankerType.trim().length > 0 && fingerprintSchemaVersion.trim().length > 0;

  const submit = async () => {
    setStatus('pending');
    setError(null);
    try {
      await api.adminRegisterModel({
        version: version.trim(),
        rankerType: rankerType.trim(),
        fingerprintSchemaVersion: fingerprintSchemaVersion.trim(),
        codeRef: codeRef.trim() || undefined,
      });
      setStatus('success');
      setVersion('');
      setRankerType('');
      setCodeRef('');
      onRegistered();
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      setError(adminErrorReasonLabel(reasonCode, 'تعذّر تسجيل الإصدار. حاول مرة أخرى.'));
      setStatus('error');
    }
  };

  return (
    <div className={s.formCard}>
      <h3 className={s.sectionHeading}>تسجيل إصدار جديد</h3>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label htmlFor="mv-version">اسم الإصدار</label>
          <input id="mv-version" className={s.input} value={version} onChange={(e) => setVersion(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="mv-ranker">نوع خوارزمية الترتيب</label>
          <input id="mv-ranker" className={s.input} value={rankerType} onChange={(e) => setRankerType(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="mv-schema">إصدار مخطط بصمة الفيلم المطلوب</label>
          <input id="mv-schema" className={s.input} value={fingerprintSchemaVersion} onChange={(e) => setFingerprintSchemaVersion(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="mv-coderef">مرجع الشيفرة (اختياري)</label>
          <input id="mv-coderef" className={s.input} value={codeRef} onChange={(e) => setCodeRef(e.target.value)} disabled={status === 'pending'} />
        </div>
      </div>
      <div className={s.actions}>
        <button type="button" className={s.primaryBtn} disabled={!canSubmit || status === 'pending'} onClick={submit}>
          {status === 'pending' ? '…' : 'تسجيل'}
        </button>
      </div>
      {status === 'success' && <p className={`${s.banner} ${s.bannerSuccess}`} role="status" aria-live="polite">تم تسجيل الإصدار. لم يُفعَّل بعد.</p>}
      {status === 'error' && error && <p className={`${s.banner} ${s.bannerError}`} role="alert">{error}</p>}
    </div>
  );
}
