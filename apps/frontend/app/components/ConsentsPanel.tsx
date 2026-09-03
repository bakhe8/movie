'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, CONSENT_VERSION, type Consent, type ConsentPurpose } from '../lib/api';
import { formatDate } from '../lib/format';
import styles from './ConsentsPanel.module.css';

type Lang = 'ar' | 'en';

/**
 * The consent controls inside the profile's privacy section (PRIVACY.md §3,
 * blueprint §13.1): the declinable purposes as switches the user can change
 * at any time -- the promise onboarding's copy makes -- and the purposes the
 * service cannot run without, listed as recorded, not switchable. Every
 * change is one PUT of one purpose at the current copy version; the list is
 * re-read afterwards so what is shown is what the server holds.
 */
type Declinable = 'personalization_pooled' | 'analytics_first_party';
type Required = 'terms_privacy' | 'watch_history' | 'personalization_individual';

const DECLINABLE: Declinable[] = ['personalization_pooled', 'analytics_first_party'];
const REQUIRED: Required[] = ['terms_privacy', 'watch_history', 'personalization_individual'];

const labels = {
  ar: {
    title: 'موافقاتك',
    lead: 'ما يمكنك تغييره في أي وقت، وما تقوم عليه الخدمة.',
    changeable: 'قابلة للتغيير',
    required: 'مطلوبة لعمل الخدمة',
    requiredNote: 'سُجّلت عند التسجيل والتهيئة. سحبها يعني إغلاق الحساب، وحذف الحساب لم يُبنَ بعد.',
    purposes: {
      personalization_pooled: {
        head: 'المساهمة في النموذج الجماعي',
        body: 'ترتيباتك المستعارة، دون أن تُنسب إليك، تساعد نموذجًا جماعيًا يحسّن الثلاثيات والترشيحات للجميع. إيقافها لا يمس نموذجك الشخصي.',
      },
      analytics_first_party: {
        head: 'تحليلات المنتج',
        body: 'أحداث تشغيلية على أنظمتنا فقط، لا طرف ثالث ولا إعلانات، لقياس أداء التوصيات.',
      },
      terms_privacy: { head: 'الشروط وإشعار الخصوصية', body: '' },
      watch_history: { head: 'تخزين ما شاهدت وقائمتك', body: '' },
      personalization_individual: { head: 'نموذج ذوقك الخاص', body: '' },
    } satisfies Record<Declinable | Required, { head: string; body: string }>,
    on: 'مفعّلة',
    off: 'متوقفة',
    notRecorded: 'لم تُسجَّل بعد',
    since: (date: string) => `منذ ${date}`,
    changed: (date: string) => `آخر تغيير ${date}`,
    saved: 'حُفظ.',
    failed: 'تعذّر الحفظ. حاول مجددًا.',
    loadFailed: 'تعذّر تحميل الموافقات.',
    retry: 'إعادة المحاولة',
    loading: 'جارٍ التحميل…',
  },
  en: {
    title: 'Your consents',
    lead: 'What you can change any time, and what the service runs on.',
    changeable: 'Changeable',
    required: 'Required for the service',
    requiredNote: 'Recorded at registration and onboarding. Withdrawing them means closing the account; account deletion is not built yet.',
    purposes: {
      personalization_pooled: {
        head: 'Contribute to the shared model',
        body: 'Your pseudonymous rankings, never attributed to you, help a shared model that improves triads and recommendations for everyone. Turning it off does not affect your personal model.',
      },
      analytics_first_party: {
        head: 'Product analytics',
        body: 'Operational events on our own systems only, no third party and no advertising, to measure recommendation quality.',
      },
      terms_privacy: { head: 'Terms and Privacy Notice', body: '' },
      watch_history: { head: 'Storing what you watched and your list', body: '' },
      personalization_individual: { head: 'Your own taste model', body: '' },
    } satisfies Record<Declinable | Required, { head: string; body: string }>,
    on: 'On',
    off: 'Off',
    notRecorded: 'Not recorded yet',
    since: (date: string) => `since ${date}`,
    changed: (date: string) => `last changed ${date}`,
    saved: 'Saved.',
    failed: 'Could not save. Please try again.',
    loadFailed: 'Consents could not be loaded.',
    retry: 'Try again',
    loading: 'Loading…',
  },
};

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed' };

// The row that counts for a purpose: the latest written one.
function latestByPurpose(consents: Consent[]): Partial<Record<ConsentPurpose, Consent>> {
  const latest: Partial<Record<ConsentPurpose, Consent>> = {};
  for (const consent of consents) {
    const current = latest[consent.purpose];
    if (!current || Date.parse(consent.grantedAt) > Date.parse(current.grantedAt)) latest[consent.purpose] = consent;
  }
  return latest;
}

export function ConsentsPanel({ lang }: { lang: Lang }) {
  const t = labels[lang];
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [latest, setLatest] = useState<Partial<Record<ConsentPurpose, Consent>>>({});
  const [busy, setBusy] = useState<Declinable | null>(null);
  const [notice, setNotice] = useState<{ key: 'saved' | 'failed' } | null>(null);

  const load = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const consents = await api.getConsents();
      setLatest(latestByPurpose(consents));
      setPhase({ kind: 'ready' });
    } catch {
      setPhase({ kind: 'failed' });
    }
  }, []);

  // First read: state is set only inside the promise callbacks, after the
  // response, never synchronously in the effect; `load` serves the retry.
  useEffect(() => {
    let cancelled = false;
    api
      .getConsents()
      .then((consents) => {
        if (cancelled) return;
        setLatest(latestByPurpose(consents));
        setPhase({ kind: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // One purpose per write, at the current copy version; then re-read, so the
  // switch shows what the server holds rather than what was asked for.
  async function change(purpose: Declinable, granted: boolean) {
    setBusy(purpose);
    setNotice(null);
    try {
      await api.updateConsents([{ purpose, version: CONSENT_VERSION, granted }]);
      const consents = await api.getConsents();
      setLatest(latestByPurpose(consents));
      setNotice({ key: 'saved' });
    } catch {
      setNotice({ key: 'failed' });
    } finally {
      setBusy(null);
    }
  }

  const when = (consent: Consent | undefined) => {
    if (!consent) return t.notRecorded;
    const date = formatDate(consent.revokedAt ?? consent.grantedAt, lang);
    return consent.revokedAt ? t.changed(date) : t.since(date);
  };

  return (
    <div className={styles.panel}>
      <p className={styles.title}>{t.title}</p>
      <p className={styles.lead}>{t.lead}</p>

      {phase.kind === 'loading' && <p className={styles.muted}>{t.loading}</p>}
      {phase.kind === 'failed' && (
        <div className={styles.row}>
          <span className={styles.muted}>{t.loadFailed}</span>
          <button type="button" className={styles.retry} onClick={load}>
            {t.retry}
          </button>
        </div>
      )}

      {phase.kind === 'ready' && (
        <>
          <p className={styles.group}>{t.changeable}</p>
          <ul className={styles.list}>
            {DECLINABLE.map((purpose) => {
              const consent = latest[purpose];
              const granted = Boolean(consent?.granted && !consent?.revokedAt);
              return (
                <li key={purpose} className={styles.item}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={granted}
                      disabled={busy !== null}
                      onChange={(event) => change(purpose, event.target.checked)}
                    />
                    <span className={styles.head}>{t.purposes[purpose].head}</span>
                    <span className={styles.state}>{granted ? t.on : t.off}</span>
                  </label>
                  <p className={styles.body}>{t.purposes[purpose].body}</p>
                  <p className={styles.when}>{when(consent)}</p>
                </li>
              );
            })}
          </ul>

          <p className={styles.group}>{t.required}</p>
          <ul className={styles.list}>
            {REQUIRED.map((purpose) => (
              <li key={purpose} className={styles.item}>
                <p className={styles.headLine}>
                  <span className={styles.head}>{t.purposes[purpose].head}</span>
                  <span className={styles.state}>{latest[purpose]?.granted ? t.on : t.notRecorded}</span>
                </p>
                <p className={styles.when}>{when(latest[purpose])}</p>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{t.requiredNote}</p>
        </>
      )}

      {notice && (
        <p className={notice.key === 'failed' ? `${styles.status} ${styles.error}` : styles.status} role="status">
          {notice.key === 'failed' ? t.failed : t.saved}
        </p>
      )}
    </div>
  );
}
