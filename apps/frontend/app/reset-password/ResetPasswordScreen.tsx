'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { BrandMark } from '../components/BrandMark';
import { DocumentLanguage } from '../legal/DocumentLanguage';
import styles from '../components/AuthScreen.module.css';

/**
 * Where the emailed reset link lands (ADR-85): `/reset-password?token=…`.
 * No session, no shell -- the reader is signed out by definition -- so it
 * wears the door's own styles and takes its language from `?lang=` like the
 * legal pages (Arabic by default; the link the backend mails carries no
 * language). Confirming spends the single-use token and revokes every live
 * session of the account, so the only way on is the door.
 */
type Lang = 'ar' | 'en';

const labels = {
  ar: {
    brand: 'Kolme',
    title: 'كلمة مرور جديدة',
    hint: 'اختر كلمة مرور جديدة لحسابك. بعد التعيين تُغلق جلساتك القديمة كلها.',
    password: 'كلمة المرور الجديدة',
    confirm: 'تأكيد كلمة المرور',
    passwordHint: 'من 8 إلى 64 حرفًا.',
    submit: 'عيّن كلمة المرور',
    loading: 'جارٍ التحميل…',
    mismatch: 'كلمتا المرور غير متطابقتين.',
    invalidLink: 'هذا الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من شاشة الدخول عبر «نسيت كلمة المرور؟».',
    failed: 'تعذّر تعيين كلمة المرور. حاول بعد قليل.',
    done: 'تم تعيين كلمة المرور الجديدة. سجّل الدخول بها الآن.',
    toLogin: 'إلى تسجيل الدخول',
    otherLang: 'English',
  },
  en: {
    brand: 'Kolme',
    title: 'New password',
    hint: 'Choose a new password for your account. Setting it signs out every other session.',
    password: 'New password',
    confirm: 'Confirm password',
    passwordHint: '8 to 64 characters.',
    submit: 'Set the password',
    loading: 'Loading…',
    mismatch: 'The two passwords do not match.',
    invalidLink: 'This link is invalid or has expired. Request a new one from the log-in screen via "Forgot your password?".',
    failed: 'The password could not be set. Try again in a moment.',
    done: 'Your new password is set. Log in with it now.',
    toLogin: 'To log in',
    otherLang: 'العربية',
  },
};

export function ResetPasswordScreen({ token, lang }: { token: string | null; lang: Lang }) {
  const t = labels[lang];
  const otherLang: Lang = lang === 'ar' ? 'en' : 'ar';
  const otherHref = `/reset-password?${new URLSearchParams({ ...(token ? { token } : {}), lang: otherLang })}`;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      setError(t.mismatch);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.confirmPasswordReset(token, password);
      setDone(true);
    } catch (caught) {
      // 400 is the service's verdict on the token itself (unknown, spent or
      // expired -- one message for all three, by design); anything else is
      // the request failing, which a retry may fix.
      setError(caught instanceof ApiError && caught.status === 400 ? t.invalidLink : t.failed);
    } finally {
      setSubmitting(false);
    }
  }

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
        {done ? (
          <>
            <p className={styles.lead} role="status">
              {t.done}
            </p>
            <Link href={`/?lang=${lang}`} className={styles.submit}>
              {t.toLogin}
            </Link>
          </>
        ) : !token ? (
          <>
            <p className={styles.error} role="alert">
              {t.invalidLink}
            </p>
            <Link href={`/?lang=${lang}`} className={styles.switch}>
              {t.toLogin}
            </Link>
          </>
        ) : (
          <>
            <p className={styles.lead}>{t.hint}</p>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="reset-password">{t.password}</label>
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={64}
                  required
                />
                <p className={styles.hint}>{t.passwordHint}</p>
              </div>
              <div className={styles.field}>
                <label htmlFor="reset-confirm">{t.confirm}</label>
                <input
                  id="reset-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  minLength={8}
                  maxLength={64}
                  required
                />
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button className={styles.submit} type="submit" disabled={submitting}>
                {submitting ? t.loading : t.submit}
              </button>
            </form>
            <Link href={`/?lang=${lang}`} className={styles.switch}>
              {t.toLogin}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
