'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type AdminProvenance, type AdminTitleDetail } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { ANALYSIS_STATUS_COPY, LICENSE_STATUS_LABELS, REVIEW_STATUS_COPY, analysisStatus, featureKeyLabel, featureValuePhrase } from '../admin-copy';
import { FEATURE_REASON_COPY } from '../../../lib/copy';
import s from './TitleDetailMonitor.module.css';
import m from './monitoring.module.css';

function fmt(iso: string | null) {
  return iso ? formatDate(iso, 'ar') : '—';
}

// ADMIN-W3 (W0 case B1): the title's full record plus its rights and
// analysis history -- read-only, current and superseded rows both kept
// (SCHEMA.md §1: originals are never edited in place).
export function TitleDetailMonitor({ titleId }: { titleId: string }) {
  const [title, setTitle] = useState<AdminTitleDetail | null>(null);
  const [provenance, setProvenance] = useState<AdminProvenance | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setFailed(false);
      try {
        const [titleResult, provenanceResult] = await Promise.all([
          api.adminGetTitleDetail(titleId, controller.signal),
          api.adminGetProvenance(titleId, controller.signal),
        ]);
        setTitle(titleResult);
        setProvenance(provenanceResult);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [titleId, attempt]);

  if (failed) {
    return (
      <p className={m.count} role="status" aria-live="polite">
        تعذّر تحميل تفاصيل الفيلم. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
      </p>
    );
  }
  if (!title || !provenance) return <p className={m.count}>جارٍ التحميل…</p>;

  const status = analysisStatus(title.summary.hasFingerprint, title.summary.hasV2);
  const currentFeatures = provenance.features.filter((f) => !f.supersededBy);

  return (
    <div>
      <Link className={s.backLink} href="/admin/monitoring/catalog">رجوع إلى الكتالوج</Link>

      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{title.titleAr || title.titleEn}</h2>
        <p className={m.pageBlurb}>{title.internalId} · {title.releaseYear ?? 'سنة غير معروفة'}</p>
      </div>

      <div className={s.card}>
        <div className={s.row}><span className={s.label}>الحالة</span><span className={`${m.badge} ${status === 'full' ? m.green : status === 'basic' ? m.yellow : m.red}`}>{ANALYSIS_STATUS_COPY[status]}</span></div>
        <div className={s.row}><span className={s.label}>حقوق العرض</span><span>{LICENSE_STATUS_LABELS[provenance.licenseStatus] ?? provenance.licenseStatus}</span></div>
        <div className={s.row}><span className={s.label}>اللغة الأصلية</span><span className={s.value}>{title.originalLanguage ?? '—'}</span></div>
        <div className={s.row}><span className={s.label}>الأنواع</span><span>{title.genres?.join('، ') || '—'}</span></div>
        <div className={s.row}><span className={s.label}>الوصف</span><span>{title.description || '—'}</span></div>
        <div className={s.row}><span className={s.label}>معرّفات خارجية</span><span className={s.value}>{title.externalIds ? Object.entries(title.externalIds).map(([k, v]) => `${k}:${v}`).join(' · ') : '—'}</span></div>
        <div className={s.row}><span className={s.label}>آخر تحديث</span><span>{fmt(title.updatedAt)}</span></div>
      </div>

      <h3 className={m.subhead}>سجل الحقوق ({provenance.sourceRecords.length})</h3>
      {provenance.sourceRecords.length === 0 ? (
        <p className={m.count}>لا سجلات حقوق بعد</p>
      ) : (
        <ul className={m.plainList}>
          {provenance.sourceRecords.map((r) => (
            <li key={r.id} className={m.cardRow}>
              <span>{r.fieldName}</span>
              <span>{r.source}</span>
              <span className={`${m.badge} ${r.licenseStatus === 'commercial_allowed' ? m.green : r.licenseStatus === 'non_commercial_only' ? m.yellow : m.red}`}>
                {LICENSE_STATUS_LABELS[r.licenseStatus] ?? r.licenseStatus}
              </span>
              {r.reviewStatus && <span className={m.badge}>{REVIEW_STATUS_COPY[r.reviewStatus] ?? r.reviewStatus}</span>}
              <span>{fmt(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className={m.subhead}>ملخص التحليل حسب المستخرِج</h3>
      {Object.keys(provenance.byExtractor).length === 0 ? (
        <p className={m.count}>لا تحليل بعد</p>
      ) : (
        <ul className={m.plainList}>
          {Object.entries(provenance.byExtractor).map(([extractor, counts]) => (
            <li key={extractor} className={m.cardRow}>
              <span className={m.mono}>{extractor}</span>
              <span>الإجمالي: {counts.rows}</span>
              <span>بانتظار المراجعة: {counts.unreviewed}</span>
              <span>استُبدلت: {counts.superseded}</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className={m.subhead}>الخصائص الحالية ({currentFeatures.length})</h3>
      {currentFeatures.length === 0 ? (
        <p className={m.count}>لا خصائص محلَّلة بعد</p>
      ) : (
        <ul className={m.plainList}>
          {currentFeatures.map((f) => {
            const phrase = f.value === null ? null : featureValuePhrase(f.featureKey, f.value, FEATURE_REASON_COPY.ar);
            return (
              <li key={f.id} className={m.cardRow}>
                <span>{featureKeyLabel(f.featureKey)}</span>
                <span>{phrase ? `${phrase} (${f.value?.toFixed(2)})` : f.value?.toFixed(3) ?? '—'}</span>
                <span className={m.badge}>{REVIEW_STATUS_COPY[f.reviewStatus] ?? f.reviewStatus}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
