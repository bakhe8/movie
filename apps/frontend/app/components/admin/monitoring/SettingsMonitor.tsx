'use client';

import { useEffect, useState } from 'react';
import { api, type AdminSettingView } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { ADMIN_SECTION_COPY, SETTING_SOURCE_LABELS } from '../admin-copy';
import m from './monitoring.module.css';

function displayValue(setting: AdminSettingView): string {
  const value = typeof setting.value === 'number' ? String(setting.value) : String(setting.value);
  return setting.unit ? `${value} ${setting.unit}` : value;
}

// ADMIN-W6 (plan §17.3, §18 W6): read-only view of the settings registry --
// no mutation import here (publishing/rolling back a value lives in
// SettingsAdmin, the only place this section ever writes).
export function SettingsMonitor() {
  const [items, setItems] = useState<AdminSettingView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const data = await api.adminGetSettings(controller.signal);
        setItems(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [retryTick]);

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.settings.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.settings.blurb}</p>
      </div>

      {failed && (
        <p className={m.count} role="status" aria-live="polite">
          تعذّر تحميل الإعدادات. <button type="button" className={m.pageBtn} onClick={() => setRetryTick((t) => t + 1)}>إعادة المحاولة</button>
        </p>
      )}
      {!failed && !items && <p className={m.count}>جارٍ التحميل…</p>}
      {!failed && items && (
        <ul className={m.plainList}>
          {items.map((setting) => (
            <li key={setting.key} className={m.cardRow}>
              <span>{setting.name}</span>
              <span className={m.mono}>{displayValue(setting)}</span>
              <span className={m.badge}>{SETTING_SOURCE_LABELS[setting.source] ?? setting.source}</span>
              <span>{setting.modifiedAt ? formatDateTime(setting.modifiedAt, 'ar') : 'لم يُعدَّل بعد'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
