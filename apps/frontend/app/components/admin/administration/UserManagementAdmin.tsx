'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api, type AdminUserRow } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import { useAdminQueryState } from '../../../lib/admin-query-state';
import { ADMIN_SECTION_COPY, USER_ROLE_LABELS, adminErrorReasonLabel } from '../admin-copy';
import { AdminRecordList, type AdminRecordListColumn } from '../AdminRecordList';
import m from '../monitoring/monitoring.module.css';
import s from './administration.module.css';

function roleBadge(role: 'user' | 'admin') {
  return <span className={`${m.badge} ${role === 'admin' ? m.green : ''}`}>{USER_ROLE_LABELS[role]}</span>;
}

function activeBadge(active: boolean) {
  return <span className={`${m.badge} ${active ? m.green : m.red}`}>{active ? 'نشط' : 'موقوف'}</span>;
}

// ADMIN-W4 (W0 case A5/W0 preservation "إدارة الحسابات"): the account edit
// itself lives in UserEditPanel below, reached by picking a row from this
// list -- the server, not this screen, is the source of truth on who may be
// changed (self-change and last-admin protections both live in
// AdminOpsService.updateUser, this only surfaces its refusal reason).
export function UserManagementAdmin() {
  const [q, setQ] = useAdminQueryState(['query', 'page', 'userId'] as const);
  const [inputValue, setInputValue] = useState(q.query);
  const [debouncedQuery, setDebouncedQuery] = useState(q.query);
  const page = Number(q.page) || 1;

  const [result, setResult] = useState<{ items: AdminUserRow[]; total: number; totalPages: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(id);
  }, [inputValue]);

  useEffect(() => {
    if (debouncedQuery !== q.query) setQ({ query: debouncedQuery, page: '1' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setInputValue(q.query);
    })();
  }, [q.query]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      setBusy(true);
      setFailed(false);
      try {
        const data = await api.adminGetUsers({ query: q.query || undefined, page, limit: 50, signal: controller.signal });
        setResult(data);
        setBusy(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
        setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [q.query, page, retryTick]);

  const selected = result?.items.find((u) => u.id === q.userId) ?? null;

  const applyLocalUpdate = (updated: AdminUserRow) => {
    setResult((prev) => (prev ? { ...prev, items: prev.items.map((u) => (u.id === updated.id ? updated : u)) } : prev));
  };

  const columns: AdminRecordListColumn<AdminUserRow>[] = [
    { key: 'email', header: 'البريد الإلكتروني', render: (r) => r.email, mono: true },
    { key: 'name', header: 'الاسم', render: (r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || '—' },
    { key: 'role', header: 'الصلاحية', render: (r) => roleBadge(r.role) },
    { key: 'active', header: 'الحالة', render: (r) => activeBadge(r.active) },
    { key: 'profiles', header: 'ملفات الذوق', render: (r) => r.profiles },
    { key: 'createdAt', header: 'تاريخ الإنشاء', render: (r) => formatDate(r.createdAt, 'ar') },
    { key: 'edit', header: '', render: (r) => <button type="button" className={s.secondaryBtn} onClick={() => setQ({ userId: r.id })}>تعديل</button> },
  ];

  return (
    <div>
      <div className={m.pageHeader}>
        <h2 className={m.pageTitle}>{ADMIN_SECTION_COPY.users.title}</h2>
        <p className={m.pageBlurb}>{ADMIN_SECTION_COPY.users.blurb}</p>
      </div>

      <div className={m.toolbar}>
        <input
          className={m.search}
          type="search"
          placeholder="بحث بالبريد الإلكتروني..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
      </div>

      {result && <p className={m.count}>{result.total} حساب{busy && ' — جارٍ التحديث…'}</p>}

      <AdminRecordList
        columns={columns}
        rows={result?.items ?? null}
        keyOf={(r) => r.id}
        loading={busy}
        failed={failed}
        failedLabel="تعذّر تحميل الحسابات."
        onRetry={() => setRetryTick((t) => t + 1)}
        emptyLabel="لا حسابات مطابقة"
        renderCard={(r) => (
          <>
            <p className={m.cardTitle}>{r.email}</p>
            <div className={m.cardRow}>
              {roleBadge(r.role)}
              {activeBadge(r.active)}
              <span>{r.profiles} ملف ذوق</span>
            </div>
            <div className={s.actions}>
              <button type="button" className={s.secondaryBtn} onClick={() => setQ({ userId: r.id })}>تعديل</button>
            </div>
          </>
        )}
      />

      {result && result.totalPages > 1 && (
        <div className={m.pages}>
          <button className={m.pageBtn} disabled={page <= 1} onClick={() => setQ({ page: String(page - 1) })}>السابق</button>
          <span>{page} / {result.totalPages}</span>
          <button className={m.pageBtn} disabled={page >= result.totalPages} onClick={() => setQ({ page: String(page + 1) })}>التالي</button>
        </div>
      )}

      {q.userId && (
        selected ? (
          <UserEditPanel
            key={selected.id}
            user={selected}
            onClose={() => setQ({ userId: '' })}
            onSaved={applyLocalUpdate}
          />
        ) : (
          <div className={s.formCard}>
            <p>هذا الحساب غير موجود في الصفحة الحالية من النتائج. ابحث عنه بالبريد الإلكتروني أولاً ثم اختر «تعديل».</p>
          </div>
        )
      )}
    </div>
  );
}

type SaveStatus = 'idle' | 'pending' | 'success' | 'error';

function UserEditPanel({ user, onClose, onSaved }: { user: AdminUserRow; onClose: () => void; onSaved: (updated: AdminUserRow) => void }) {
  const [role, setRole] = useState<'user' | 'admin'>(user.role);
  const [active, setActive] = useState(user.active);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<AdminUserRow | null>(null);

  const changed = role !== user.role || active !== user.active;

  const save = async () => {
    setStatus('pending');
    setErrorMessage(null);
    try {
      const patch: { role?: 'user' | 'admin'; active?: boolean; reason?: string } = {};
      if (role !== user.role) patch.role = role;
      if (active !== user.active) patch.active = active;
      if (reason.trim()) patch.reason = reason.trim();
      const updated = await api.adminUpdateUser(user.id, patch);
      setSaved(updated);
      setStatus('success');
      onSaved(updated);
    } catch (err) {
      const reasonCode = err instanceof ApiError && typeof err.details.reason === 'string' ? err.details.reason : undefined;
      setErrorMessage(adminErrorReasonLabel(reasonCode, 'تعذّر حفظ التعديل. حاول مرة أخرى.'));
      setStatus('error');
    }
  };

  return (
    <div className={s.formCard} role="region" aria-label="تعديل حساب">
      <h3 className={s.sectionHeading}>تعديل {user.email}</h3>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label htmlFor="user-role">الصلاحية</label>
          <select id="user-role" className={s.select} value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} disabled={status === 'pending'}>
            <option value="user">{USER_ROLE_LABELS.user}</option>
            <option value="admin">{USER_ROLE_LABELS.admin}</option>
          </select>
        </div>
        <div className={s.field}>
          <span>الحالة</span>
          <label className={s.checkboxRow}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={status === 'pending'} />
            حساب نشط
          </label>
        </div>
        <div className={`${s.field} ${s.fieldGridWide}`}>
          <label htmlFor="user-reason">سبب التعديل (يُسجَّل في سجل العمليات)</label>
          <textarea id="user-reason" className={s.textarea} value={reason} onChange={(e) => setReason(e.target.value)} disabled={status === 'pending'} />
        </div>
      </div>

      <div className={s.actions}>
        <button type="button" className={s.primaryBtn} disabled={!changed || status === 'pending'} onClick={save}>
          {status === 'pending' ? '…' : 'حفظ التعديل'}
        </button>
        <button type="button" className={s.secondaryBtn} onClick={onClose}>إغلاق</button>
      </div>

      {status === 'success' && saved && (
        <p className={`${s.banner} ${s.bannerSuccess}`} role="status" aria-live="polite">
          تم الحفظ. الصلاحية الآن: {USER_ROLE_LABELS[saved.role]}، الحالة: {saved.active ? 'نشط' : 'موقوف'}.{' '}
          <Link className={s.auditLink} href={`/admin/monitoring/audit?resource=user&resourceId=${saved.id}`}>عرض في سجل العمليات</Link>
        </p>
      )}
      {status === 'error' && errorMessage && (
        <p className={`${s.banner} ${s.bannerError}`} role="alert">{errorMessage}</p>
      )}
    </div>
  );
}
