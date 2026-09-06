'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, type AdminSettingVersionRecord, type AdminSettingView } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { ADMIN_SECTION_COPY, SETTING_SOURCE_LABELS, adminErrorReasonLabel } from '../admin-copy';
import m from '../monitoring/monitoring.module.css';
import s from './administration.module.css';

// ADMIN-W6 (plan §17.3, §18 W6): the only screen that publishes or rolls
// back a setting -- load context (current value + history) → preview →
// confirm with a reason → atomic write → readback, the same mandated flow
// every other write screen in this board follows.
export function SettingsAdmin() {
  const [items, setItems] = useState<AdminSettingView[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const data = await api.adminGetSettings(controller.signal);
        setItems(data);
        setSelectedKey((prev) => (prev && data.some((s) => s.key === prev) ? prev : (data[0]?.key ?? null)));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.settingsAdmin.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.settingsAdmin.blurb}</p>
      </div>

      {failed && (
        <p className={m.count} role="status" aria-live="polite">
          تعذّر التحميل. <button type="button" className={m.pageBtn} onClick={reload}>إعادة المحاولة</button>
        </p>
      )}
      {!failed && !items && <p className={m.count}>جارٍ التحميل…</p>}
      {!failed && items && items.length === 0 && <p className={m.count}>لا إعدادات مسجَّلة بعد</p>}

      {!failed && items && items.length > 0 && (
        <div className={s.formCard}>
          <div className={s.field}>
            <label htmlFor="setting-key">الإعداد</label>
            <select id="setting-key" className={s.select} value={selectedKey ?? ''} onChange={(e) => setSelectedKey(e.target.value)}>
              {items.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {selectedKey && <SettingEditor key={selectedKey} settingKey={selectedKey} onChanged={reload} />}
    </div>
  );
}

type Status = 'idle' | 'pending' | 'success' | 'error';

function SettingEditor({ settingKey, onChanged }: { settingKey: string; onChanged: () => void }) {
  const [data, setData] = useState<{ setting: AdminSettingView; history: AdminSettingVersionRecord[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [rawValue, setRawValue] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ valid: boolean; error: string | null } | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const result = await api.adminGetSetting(settingKey, controller.signal);
        setData(result);
        setRawValue(String(result.setting.value));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [settingKey]);

  if (failed) return <p className={m.count} role="status" aria-live="polite">تعذّر تحميل تفاصيل الإعداد.</p>;
  if (!data) return <p className={m.count}>جارٍ التحميل…</p>;

  const { setting, history } = data;

  const parseValue = (): unknown => {
    if (setting.type === 'number') return Number(rawValue);
    if (setting.type === 'boolean') return rawValue === 'true';
    return rawValue;
  };

  const runPreview = async () => {
    setStatus('pending');
    setMessage(null);
    try {
      const result = await api.adminPreviewSetting(settingKey, parseValue());
      setPreview({ valid: result.valid, error: result.error });
      setStatus('idle');
    } catch {
      setStatus('idle');
      setPreview({ valid: false, error: 'تعذّرت المعاينة.' });
    }
  };

  const publish = async () => {
    setStatus('pending');
    setMessage(null);
    try {
      const updated = await api.adminUpdateSetting(settingKey, { value: parseValue(), reason, expectedVersion: setting.version });
      const result = await api.adminGetSetting(settingKey);
      setData(result);
      setReason('');
      setPreview(null);
      setStatus('success');
      setMessage(`تم النشر. الإصدار الآن v${updated.version}.`);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.details.reason === 'version_conflict') {
        setMessage(`تغيّر الإعداد من جهة أخرى (الإصدار الحالي الآن v${err.details.currentVersion}, القيمة ${String(err.details.currentValue)}). أعد تحميل الصفحة قبل المحاولة مرة أخرى.`);
      } else {
        const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
        setMessage(adminErrorReasonLabel(reasonCode, 'تعذّر النشر.'));
      }
      setStatus('error');
    }
  };

  const rollback = async (toVersion: number) => {
    setStatus('pending');
    setMessage(null);
    try {
      const updated = await api.adminRollbackSetting(settingKey, { toVersion });
      const result = await api.adminGetSetting(settingKey);
      setData(result);
      setRawValue(String(updated.value));
      setStatus('success');
      setMessage(`تمت العودة إلى قيمة الإصدار v${toVersion} (نُشرت كإصدار جديد v${updated.version}).`);
      onChanged();
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      setMessage(adminErrorReasonLabel(reasonCode, 'تعذّر التراجع.'));
      setStatus('error');
    }
  };

  return (
    <div className={s.formCard}>
      <h3 className={s.sectionHeading}>{setting.name}</h3>
      <p className={m.pageBlurb}>{setting.description}</p>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <span>القيمة الحالية</span>
          <span className={m.mono}>{String(setting.value)}{setting.unit ? ` ${setting.unit}` : ''}</span>
        </div>
        <div className={s.field}>
          <span>المصدر</span>
          <span className={m.badge}>{SETTING_SOURCE_LABELS[setting.source] ?? setting.source}</span>
        </div>
        <div className={s.field}>
          <label htmlFor="setting-value">القيمة الجديدة{setting.unit ? ` (${setting.unit})` : ''}</label>
          {setting.type === 'boolean' ? (
            <select id="setting-value" className={s.select} value={rawValue} onChange={(e) => { setRawValue(e.target.value); setPreview(null); }} disabled={status === 'pending'}>
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </select>
          ) : (
            <input
              id="setting-value"
              className={s.input}
              type={setting.type === 'number' ? 'number' : 'text'}
              value={rawValue}
              onChange={(e) => { setRawValue(e.target.value); setPreview(null); }}
              disabled={status === 'pending'}
            />
          )}
        </div>
        <div className={`${s.field} ${s.fieldGridWide}`}>
          <label htmlFor="setting-reason">سبب التعديل (يُسجَّل في سجل العمليات)</label>
          <textarea id="setting-reason" className={s.textarea} value={reason} onChange={(e) => setReason(e.target.value)} disabled={status === 'pending'} />
        </div>
      </div>

      <div className={s.actions}>
        <button type="button" className={s.secondaryBtn} disabled={status === 'pending'} onClick={runPreview}>معاينة</button>
        <button type="button" className={s.primaryBtn} disabled={status === 'pending' || !reason.trim() || preview?.valid === false} onClick={publish}>
          {status === 'pending' ? '…' : 'نشر'}
        </button>
      </div>

      {preview && (
        <p className={`${s.banner} ${preview.valid ? s.bannerSuccess : s.bannerError}`} role={preview.valid ? 'status' : 'alert'}>
          {preview.valid ? 'القيمة صالحة، جاهزة للنشر.' : preview.error}
        </p>
      )}
      {status === 'success' && message && <p className={`${s.banner} ${s.bannerSuccess}`} role="status" aria-live="polite">{message}</p>}
      {status === 'error' && message && <p className={`${s.banner} ${s.bannerError}`} role="alert">{message}</p>}

      <h4 className={s.sectionHeading}>سجل النسخ ({history.length})</h4>
      {history.length === 0 ? (
        <p className={m.count}>لم يُنشَر تعديل بعد</p>
      ) : (
        <ul className={m.plainList}>
          {history.map((version) => (
            <li key={version.id} className={m.cardRow}>
              <span>v{version.version}</span>
              <span className={m.mono}>{String(version.value)}</span>
              <span>{formatDateTime(version.createdAt, 'ar')}</span>
              <span>{version.reason ?? '—'}</span>
              {version.version !== setting.version && (
                <button type="button" className={s.secondaryBtn} disabled={status === 'pending'} onClick={() => rollback(version.version)}>
                  التراجع لهذه القيمة
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
