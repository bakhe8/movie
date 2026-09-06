'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { BrandMark } from '../../components/BrandMark';
import { DocumentLanguage } from '../../legal/DocumentLanguage';
import styles from '../../components/AuthScreen.module.css';

/**
 * Where the email-change confirmation link lands (owner-approved design
 * 2026-09-06): `/account/confirm-email?token=…`. The link is mailed to the
 * new address, which may be read on a device with no session at all, so this
 * wears the door's own styles like /reset-password and confirms
 * automatically on load rather than waiting for a form submit -- there is
 * nothing else to ask for. Confirming moves the account's email but ends no
 * session (unlike a password reset, this answers no fear that the account
 * was compromised).
 */
type Lang = 'ar' | 'en';

const labels = {
  ar: {
    brand: 'Kolme',
    title: 'تأكيد البريد الإلكتروني',
    loading: 'جارٍ التأكيد…',
    invalidLink: 'هذا الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من إعدادات حسابك.',
    done: (email: string) => `تم تأكيد بريدك الجديد: ${email}`,
    toApp: 'إلى التطبيق',
    otherLang: 'English',
  },
  en: {
    brand: 'Kolme',
    title: 'Confirm your email',
    loading: 'Confirming…',
    invalidLink: 'This link is invalid or has expired. Request a new one from your account settings.',
    done: (email: string) => `Your new email is confirmed: ${email}`,
    toApp: 'To the app',
    otherLang: 'العربية',
  },
};

export function ConfirmEmailScreen({ token, lang }: { token: string | null; lang: Lang }) {
  const t = labels[lang];
  const otherLang: Lang = lang === 'ar' ? 'en' : 'ar';
  const otherHref = `/account/confirm-email?${new URLSearchParams({ ...(token ? { token } : {}), lang: otherLang })}`;
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'done'; email: string } | { kind: 'invalid' }>(
    token ? { kind: 'loading' } : { kind: 'invalid' },
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .confirmEmailChange(token)
      .then((result) => {
        if (!cancelled) setState({ kind: 'done', email: result.email });
      })
      .catch(() => {
        // Whatever the cause (unknown, spent, expired token, or a request
        // failure), there is no retry action to offer beyond requesting a
        // fresh link from account settings, so every case reads the same.
        if (!cancelled) setState({ kind: 'invalid' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className={styles.auth} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <DocumentLanguage lang={lang} />
      <section className={styles.panel}>
        <Link href={otherHref} className={`${styles.language} ${styles.docLink}`} lang={otherLang}>
          {t.otherLang}
        </Link>
        <p className={styles.brand}>
          <BrandMark size={18} />
          {t.brand}
        </p>
        <h1>{t.title}</h1>
        {state.kind === 'loading' && <p className={styles.lead}>{t.loading}</p>}
        {state.kind === 'invalid' && (
          <p className={styles.error} role="alert">
            {t.invalidLink}
          </p>
        )}
        {state.kind === 'done' && (
          <p className={styles.lead} role="status">
            {t.done(state.email)}
          </p>
        )}
        {state.kind !== 'loading' && (
          <Link href={`/?lang=${lang}`} className={styles.switch}>
            {t.toApp}
          </Link>
        )}
      </section>
    </main>
  );
}
