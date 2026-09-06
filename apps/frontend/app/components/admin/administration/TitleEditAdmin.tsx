'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ApiError, api, type AdminProvenance, type AdminSourceRecord, type AdminTitleDetail } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { ADMIN_SECTION_COPY, LICENSE_STATUS_LABELS, REVIEW_STATUS_COPY, adminErrorReasonLabel } from '../admin-copy';
import m from '../monitoring/monitoring.module.css';
import s from './administration.module.css';

const LICENSE_STATUS_OPTIONS = Object.entries(LICENSE_STATUS_LABELS);
const REVIEW_STATUS_OPTIONS = Object.entries(REVIEW_STATUS_COPY);

// ADMIN-W4 (W0 case A2/A3, ADM-P0-03/04): title fields and source-record
// rights both live here, the only screen that writes to catalog data.
// Deep-linked with `?titleId=` from the monitoring title-detail page (same
// pattern as FeatureReviewAdmin) -- there is no standalone browse here
// because a title is always picked from the catalog list first.
export function TitleEditAdmin() {
  const params = useSearchParams();
  const titleId = params.get('titleId');

  const [title, setTitle] = useState<AdminTitleDetail | null>(null);
  const [provenance, setProvenance] = useState<AdminProvenance | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!titleId) return;
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
  }, [titleId, reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  if (!titleId) {
    return (
      <div>
        <div className={m.pageHeader}>
          <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.titleEdit.title}</h2>
          <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.titleEdit.blurb}</p>
        </div>
        <p className={m.count}>
          لا يوجد فيلم محدد. اختر فيلماً من <Link className={s.auditLink} href="/admin/monitoring/catalog">الكتالوج</Link> ثم «تعديل».
        </p>
      </div>
    );
  }

  if (failed) {
    return (
      <p className={m.count} role="status" aria-live="polite">
        تعذّر تحميل بيانات الفيلم. <button type="button" className={m.pageBtn} onClick={reload}>إعادة المحاولة</button>
      </p>
    );
  }
  if (!title || !provenance) return <p className={m.count}>جارٍ التحميل…</p>;

  const currentRecords = provenance.sourceRecords.filter((r) => !r.supersededBy);
  const supersededRecords = provenance.sourceRecords.filter((r) => r.supersededBy);

  return (
    <div>
      <Link className={s.auditLink} href={`/admin/monitoring/catalog/${titleId}`}>رجوع إلى تفاصيل الفيلم</Link>

      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{title.titleAr || title.titleEn}</h2>
        <p className={m.pageBlurb}>{title.internalId}</p>
      </div>

      <TitleFieldsForm title={title} onSaved={(updated) => setTitle((prev) => (prev ? { ...prev, ...updated } : prev))} />

      <h3 className={s.sectionHeading}>سجلات حقوق العرض الحالية ({currentRecords.length})</h3>
      {currentRecords.length === 0 && <p className={m.count}>لا سجلات حقوق حالية</p>}
      <ul className={m.plainList}>
        {currentRecords.map((record) => (
          <SourceRecordEditRow key={record.id} record={record} onSaved={reload} />
        ))}
      </ul>

      {supersededRecords.length > 0 && (
        <>
          <h3 className={s.sectionHeading}>سجلات مُستبدَلة ({supersededRecords.length})</h3>
          <ul className={m.plainList}>
            {supersededRecords.map((record) => (
              <li key={record.id} className={m.cardRow}>
                <span>{record.fieldName}</span>
                <span>{record.source}</span>
                <span className={m.badge}>{LICENSE_STATUS_LABELS[record.licenseStatus] ?? record.licenseStatus}</span>
                <span>استُبدلت بسجل جديد</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className={s.sectionHeading}>إضافة سجل حقوق جديد</h3>
      <AddSourceRecordForm titleId={titleId} onSaved={reload} />

      <p className={m.count}>
        <Link className={s.auditLink} href={`/admin/monitoring/audit?resource=title&resourceId=${titleId}`}>عرض سجل العمليات لهذا الفيلم</Link>
      </p>
    </div>
  );
}

type SaveStatus = 'idle' | 'pending' | 'success' | 'error';

function TitleFieldsForm({ title, onSaved }: { title: AdminTitleDetail; onSaved: (updated: Partial<AdminTitleDetail>) => void }) {
  const [titleEn, setTitleEn] = useState(title.titleEn);
  const [titleAr, setTitleAr] = useState(title.titleAr);
  const [description, setDescription] = useState(title.description ?? '');
  const [releaseYear, setReleaseYear] = useState(title.releaseYear !== null ? String(title.releaseYear) : '');
  const [genres, setGenres] = useState((title.genres ?? []).join('، '));
  const [originalLanguage, setOriginalLanguage] = useState(title.originalLanguage ?? '');
  const [imdb, setImdb] = useState(title.externalIds?.imdb ?? '');
  const [tmdb, setTmdb] = useState(title.externalIds?.tmdb ?? '');
  const [wikidata, setWikidata] = useState(title.externalIds?.wikidata ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setStatus('pending');
    setError(null);
    const patch: Parameters<typeof api.adminUpdateTitle>[1] = {};
    if (titleEn !== title.titleEn) patch.titleEn = titleEn;
    if (titleAr !== title.titleAr) patch.titleAr = titleAr;
    if (description !== (title.description ?? '')) patch.description = description;
    const yearNum = releaseYear ? Number(releaseYear) : undefined;
    if (yearNum !== (title.releaseYear ?? undefined)) patch.releaseYear = yearNum;
    const genreList = genres.split('،').map((g) => g.trim()).filter(Boolean);
    const originalGenres = title.genres ?? [];
    if (genreList.join('|') !== originalGenres.join('|')) patch.genres = genreList;
    if (originalLanguage !== (title.originalLanguage ?? '')) patch.originalLanguage = originalLanguage || undefined;
    const externalIds: { imdb?: string; tmdb?: string; wikidata?: string } = {};
    if (imdb) externalIds.imdb = imdb;
    if (tmdb) externalIds.tmdb = tmdb;
    if (wikidata) externalIds.wikidata = wikidata;
    const originalExternal = title.externalIds ?? {};
    if (JSON.stringify(externalIds) !== JSON.stringify({ imdb: originalExternal.imdb, tmdb: originalExternal.tmdb, wikidata: originalExternal.wikidata })) {
      patch.externalIds = externalIds;
    }

    if (Object.keys(patch).length === 0) {
      setStatus('idle');
      return;
    }

    try {
      const updated = await api.adminUpdateTitle(title.id, patch);
      setStatus('success');
      onSaved(updated);
    } catch {
      setError('تعذّر حفظ التعديل. حاول مرة أخرى.');
      setStatus('error');
    }
  };

  return (
    <div className={s.formCard}>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label htmlFor="t-en">العنوان بالإنجليزية</label>
          <input id="t-en" className={s.input} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="t-ar">العنوان بالعربية</label>
          <input id="t-ar" className={s.input} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={`${s.field} ${s.fieldGridWide}`}>
          <label htmlFor="t-desc">الوصف</label>
          <textarea id="t-desc" className={s.textarea} value={description} onChange={(e) => setDescription(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="t-year">سنة الإصدار</label>
          <input id="t-year" className={s.input} type="number" value={releaseYear} onChange={(e) => setReleaseYear(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="t-lang">اللغة الأصلية</label>
          <input id="t-lang" className={s.input} value={originalLanguage} onChange={(e) => setOriginalLanguage(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={`${s.field} ${s.fieldGridWide}`}>
          <label htmlFor="t-genres">الأنواع (مفصولة بفاصلة عربية «، »)</label>
          <input id="t-genres" className={s.input} value={genres} onChange={(e) => setGenres(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="t-imdb">معرّف IMDb</label>
          <input id="t-imdb" className={s.input} value={imdb} onChange={(e) => setImdb(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="t-tmdb">معرّف TMDB</label>
          <input id="t-tmdb" className={s.input} value={tmdb} onChange={(e) => setTmdb(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="t-wikidata">معرّف Wikidata</label>
          <input id="t-wikidata" className={s.input} value={wikidata} onChange={(e) => setWikidata(e.target.value)} disabled={status === 'pending'} />
        </div>
      </div>
      <div className={s.actions}>
        <button type="button" className={s.primaryBtn} disabled={status === 'pending'} onClick={save}>
          {status === 'pending' ? '…' : 'حفظ بيانات الفيلم'}
        </button>
      </div>
      {status === 'success' && <p className={`${s.banner} ${s.bannerSuccess}`} role="status" aria-live="polite">تم الحفظ.</p>}
      {status === 'error' && error && <p className={`${s.banner} ${s.bannerError}`} role="alert">{error}</p>}
    </div>
  );
}

function SourceRecordEditRow({ record, onSaved }: { record: AdminSourceRecord; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState(record.licenseStatus);
  const [reviewStatus, setReviewStatus] = useState(record.reviewStatus ?? 'unreviewed');
  const [license, setLicense] = useState(record.license ?? '');
  const [allowsStorage, setAllowsStorage] = useState(record.allowsStorage ?? false);
  const [allowsDerivation, setAllowsDerivation] = useState(record.allowsDerivation ?? false);
  const [allowsTraining, setAllowsTraining] = useState(record.allowsTraining ?? false);
  const [attributionRequired, setAttributionRequired] = useState(record.attributionRequired ?? false);
  const [fallbackPlan, setFallbackPlan] = useState(record.fallbackPlan ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setStatus('pending');
    setError(null);
    const patch: Parameters<typeof api.adminUpdateSourceRecord>[1] = {};
    if (licenseStatus !== record.licenseStatus) patch.licenseStatus = licenseStatus;
    if (reviewStatus !== (record.reviewStatus ?? 'unreviewed')) patch.reviewStatus = reviewStatus;
    if (license !== (record.license ?? '')) patch.license = license;
    if (allowsStorage !== (record.allowsStorage ?? false)) patch.allowsStorage = allowsStorage;
    if (allowsDerivation !== (record.allowsDerivation ?? false)) patch.allowsDerivation = allowsDerivation;
    if (allowsTraining !== (record.allowsTraining ?? false)) patch.allowsTraining = allowsTraining;
    if (attributionRequired !== (record.attributionRequired ?? false)) patch.attributionRequired = attributionRequired;
    if (fallbackPlan !== (record.fallbackPlan ?? '')) patch.fallbackPlan = fallbackPlan;

    if (Object.keys(patch).length === 0) {
      setStatus('idle');
      setOpen(false);
      return;
    }

    try {
      await api.adminUpdateSourceRecord(record.id, patch);
      setStatus('success');
      onSaved();
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      setError(adminErrorReasonLabel(reasonCode, 'تعذّر حفظ التعديل. حاول مرة أخرى.'));
      setStatus('error');
    }
  };

  return (
    <li className={s.recordCard}>
      <div className={m.cardRow}>
        <span>{record.fieldName}</span>
        <span>{record.source}</span>
        <span className={m.badge}>{LICENSE_STATUS_LABELS[record.licenseStatus] ?? record.licenseStatus}</span>
        {record.reviewStatus && <span className={m.badge}>{REVIEW_STATUS_COPY[record.reviewStatus] ?? record.reviewStatus}</span>}
        <span>{formatDate(record.createdAt, 'ar')}</span>
        <button type="button" className={s.secondaryBtn} onClick={() => setOpen((o) => !o)}>{open ? 'إغلاق' : 'تعديل'}</button>
      </div>

      {open && (
        <div className={s.fieldGrid}>
          <div className={s.field}>
            <label htmlFor={`src-license-${record.id}`}>حالة الترخيص</label>
            <select id={`src-license-${record.id}`} className={s.select} value={licenseStatus} onChange={(e) => setLicenseStatus(e.target.value)} disabled={status === 'pending'}>
              {LICENSE_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className={s.field}>
            <label htmlFor={`src-review-${record.id}`}>حالة المراجعة</label>
            <select id={`src-review-${record.id}`} className={s.select} value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} disabled={status === 'pending'}>
              {REVIEW_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className={s.field}>
            <label htmlFor={`src-lictext-${record.id}`}>نص الترخيص</label>
            <input id={`src-lictext-${record.id}`} className={s.input} value={license} onChange={(e) => setLicense(e.target.value)} disabled={status === 'pending'} />
          </div>
          <div className={s.field}>
            <label htmlFor={`src-fallback-${record.id}`}>خطة بديلة إن سُحب الإذن</label>
            <input id={`src-fallback-${record.id}`} className={s.input} value={fallbackPlan} onChange={(e) => setFallbackPlan(e.target.value)} disabled={status === 'pending'} />
          </div>
          <label className={s.checkboxRow}><input type="checkbox" checked={allowsStorage} onChange={(e) => setAllowsStorage(e.target.checked)} disabled={status === 'pending'} /> يسمح بالتخزين</label>
          <label className={s.checkboxRow}><input type="checkbox" checked={allowsDerivation} onChange={(e) => setAllowsDerivation(e.target.checked)} disabled={status === 'pending'} /> يسمح بالاشتقاق</label>
          <label className={s.checkboxRow}><input type="checkbox" checked={allowsTraining} onChange={(e) => setAllowsTraining(e.target.checked)} disabled={status === 'pending'} /> يسمح بالتدريب</label>
          <label className={s.checkboxRow}><input type="checkbox" checked={attributionRequired} onChange={(e) => setAttributionRequired(e.target.checked)} disabled={status === 'pending'} /> يتطلب نسب المصدر</label>

          <div className={`${s.actions} ${s.fieldGridWide}`}>
            <button type="button" className={s.primaryBtn} disabled={status === 'pending'} onClick={save}>{status === 'pending' ? '…' : 'حفظ'}</button>
          </div>
          {status === 'error' && error && <p className={`${s.banner} ${s.bannerError} ${s.fieldGridWide}`} role="alert">{error}</p>}
        </div>
      )}
    </li>
  );
}

function AddSourceRecordForm({ titleId, onSaved }: { titleId: string; onSaved: () => void }) {
  const [fieldName, setFieldName] = useState('');
  const [source, setSource] = useState('');
  const [licenseStatus, setLicenseStatus] = useState('unknown');
  const [license, setLicense] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = fieldName.trim().length > 0 && source.trim().length > 0;

  const submit = async () => {
    setStatus('pending');
    setError(null);
    try {
      await api.adminAddSourceRecord(titleId, { fieldName: fieldName.trim(), source: source.trim(), licenseStatus, license: license.trim() || undefined });
      setStatus('success');
      setFieldName('');
      setSource('');
      setLicense('');
      onSaved();
    } catch {
      setError('تعذّر إضافة السجل. حاول مرة أخرى.');
      setStatus('error');
    }
  };

  return (
    <div className={s.formCard}>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label htmlFor="new-src-field">الحقل المصدر</label>
          <input id="new-src-field" className={s.input} value={fieldName} onChange={(e) => setFieldName(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="new-src-source">مصدر المعلومة</label>
          <input id="new-src-source" className={s.input} value={source} onChange={(e) => setSource(e.target.value)} disabled={status === 'pending'} />
        </div>
        <div className={s.field}>
          <label htmlFor="new-src-license">حالة الترخيص</label>
          <select id="new-src-license" className={s.select} value={licenseStatus} onChange={(e) => setLicenseStatus(e.target.value)} disabled={status === 'pending'}>
            {LICENSE_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={s.field}>
          <label htmlFor="new-src-lictext">نص الترخيص (اختياري)</label>
          <input id="new-src-lictext" className={s.input} value={license} onChange={(e) => setLicense(e.target.value)} disabled={status === 'pending'} />
        </div>
      </div>
      <div className={s.actions}>
        <button type="button" className={s.primaryBtn} disabled={!canSubmit || status === 'pending'} onClick={submit}>
          {status === 'pending' ? '…' : 'إضافة سجل'}
        </button>
      </div>
      {status === 'success' && <p className={`${s.banner} ${s.bannerSuccess}`} role="status" aria-live="polite">تمت الإضافة.</p>}
      {status === 'error' && error && <p className={`${s.banner} ${s.bannerError}`} role="alert">{error}</p>}
    </div>
  );
}
