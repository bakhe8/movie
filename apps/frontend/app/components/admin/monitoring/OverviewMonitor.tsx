'use client';

import { useEffect, useState } from 'react';
import { api, type AdminMetricsReport } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { ADMIN_SECTION_COPY, FUNNEL_STEP_LABELS, RECOMMENDATION_OUTCOME_LABELS } from '../admin-copy';
import m from './monitoring.module.css';

function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 1000) / 10}%`;
}

function seconds(value: number | null): string {
  if (value === null) return '—';
  return value < 60 ? `${Math.round(value)} ثانية` : `${Math.round(value / 60)} دقيقة`;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={m.statTile}>
      <span className={m.statValue}>{value}</span>
      <span className={m.statLabel}>{label}</span>
    </div>
  );
}

const EVIDENCE_BAND_LABELS: Record<string, string> = {
  lt5: 'أقل من 5 ثلاثيات', '5-9': '5 إلى 9 ثلاثيات', '10-19': '10 إلى 19 ثلاثية', '20+': '20 ثلاثية فأكثر',
};

// ADMIN-W3 (BP §18.1, W0 case B6): read-only SQL over event rows, nothing
// pre-aggregated. No mutation import; a manual "days" choice only, never an
// auto-poll -- this endpoint is explicitly costly to compute (plan §18 W3).
export function OverviewMonitor() {
  const [q, setQ] = useAdminQueryState(['days'] as const);
  const days = Number(q.days) || 30;

  const [report, setReport] = useState<AdminMetricsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setBusy(true);
      setFailed(false);
      try {
        const data = await api.adminGetMetrics({ days, signal: controller.signal });
        setReport(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [days, attempt]);

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.overview.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.overview.blurb}</p>
      </div>

      <div className={m.toolbar}>
        <select className={m.select} value={String(days)} onChange={(e) => setQ({ days: e.target.value })}>
          <option value="7">آخر 7 أيام</option>
          <option value="30">آخر 30 يوماً</option>
          <option value="90">آخر 90 يوماً</option>
        </select>
      </div>

      {busy && !report && <p className={m.count}>جارٍ التحميل…</p>}
      {failed && (
        <p className={m.count} role="status" aria-live="polite">
          تعذّر تحميل النظرة العامة. <button type="button" className={m.pageBtn} onClick={() => setAttempt((a) => a + 1)}>إعادة المحاولة</button>
        </p>
      )}

      {report && (
        <>
          <p className={m.pageBlurb}>
            الفترة: {formatDate(report.window.from, 'ar')} — {formatDate(report.window.to, 'ar')}
            {busy && ' — جارٍ التحديث…'}
          </p>

          <h3 className={m.subhead}>الحسابات</h3>
          <div className={m.statGrid}>
            <StatTile label="إجمالي الحسابات" value={report.accounts.usersTotal} />
            <StatTile label="حسابات فعّالة" value={report.accounts.usersActive} />
            <StatTile label="تسجيلات جديدة في الفترة" value={report.accounts.registeredInWindow} />
            <StatTile label="إجمالي ملفات الذوق" value={report.accounts.profilesTotal} />
          </div>

          <h3 className={m.subhead}>رحلة المستخدم الجديد (من أنشأ حساباً في الفترة)</h3>
          <ul className={m.plainList}>
            {report.funnel.steps.map((step) => (
              <li key={step.step} className={m.cardRow}>
                <span>{FUNNEL_STEP_LABELS[step.step] ?? step.step}</span>
                <span className={m.mono}>{step.count}</span>
                <span>{pct(step.rate)}</span>
              </li>
            ))}
          </ul>

          <h3 className={m.subhead}>ثلاثيات الترتيب</h3>
          <div className={m.statGrid}>
            <StatTile label="مكتملة" value={report.triads.completed} />
            <StatTile label="متروكة" value={report.triads.skipped} />
            <StatTile label="نشطة الآن" value={report.triads.active} />
            <StatTile label="معدل الاستبدال" value={pct(report.triads.replacementRate)} />
            <StatTile label="متوسط زمن الإجابة" value={seconds(report.triads.answerSeconds.median)} />
          </div>

          <h3 className={m.subhead}>التوصيات</h3>
          <div className={m.statGrid}>
            <StatTile label="توصيات ظهرت" value={report.recommendations.shown} />
            <StatTile label="طلبات توصية" value={report.recommendations.requests} />
          </div>
          <ul className={m.plainList}>
            {Object.entries(report.recommendations.outcomes).map(([key, count]) => (
              <li key={key} className={m.cardRow}>
                <span>{RECOMMENDATION_OUTCOME_LABELS[key] ?? key}</span>
                <span className={m.mono}>{count}</span>
              </li>
            ))}
          </ul>

          <h3 className={m.subhead}>نموذج التوصيات</h3>
          <div className={m.statGrid}>
            <StatTile label="ملفات ذوق حُدّثت في الفترة" value={report.model.snapshotsInWindow} />
            <StatTile label="مستخدمون لديهم ملف ذوق" value={report.model.profilesWithSnapshot} />
            <StatTile
              label="دقة الترتيب على بيانات لم يُدرَّب عليها"
              value={report.model.meanHeldOutPairwiseAccuracy === null ? '—' : pct(report.model.meanHeldOutPairwiseAccuracy)}
            />
          </div>
          <ul className={m.plainList}>
            {Object.entries(report.model.latestSnapshotByEvidence).map(([band, count]) => (
              <li key={band} className={m.cardRow}>
                <span>{EVIDENCE_BAND_LABELS[band] ?? band}</span>
                <span className={m.mono}>{count}</span>
              </li>
            ))}
          </ul>

          <h3 className={m.subhead}>الكتالوج</h3>
          <div className={m.statGrid}>
            <StatTile label="إجمالي الأفلام" value={report.catalog.titles} />
            <StatTile label="بها تحليل" value={report.catalog.withFingerprint} />
            <StatTile label="تحليل كامل" value={report.catalog.withV2} />
            <StatTile label="لها معلومات حقوق" value={report.catalog.withKnownLicense} />
            <StatTile label="بحاجة مراجعة" value={report.catalog.unreviewedFeatures} />
          </div>

          <h3 className={m.subhead}>الخصوصية</h3>
          <div className={m.statGrid}>
            <StatTile label="حذف معلّق" value={report.privacy.pendingDeletes} />
          </div>

          <h3 className={m.subhead}>الاتجاه اليومي</h3>
          <div className={m.tableWrap}>
            <table className={m.table}>
              <thead>
                <tr>
                  <th>اليوم</th><th>تسجيلات</th><th>ثلاثيات مكتملة</th><th>توصيات ظهرت</th><th>مشاهدات فعلية</th>
                </tr>
              </thead>
              <tbody>
                {report.daily.map((row) => (
                  <tr key={row.day}>
                    <td>{formatDate(row.day, 'ar')}</td>
                    <td>{row.registrations}</td>
                    <td>{row.triadsCompleted}</td>
                    <td>{row.recommendationsShown}</td>
                    <td>{row.watchedOutcomes}</td>
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
