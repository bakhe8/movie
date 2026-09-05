'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, CONSENT_VERSION } from '../lib/api';
import { useSession } from '../lib/session';
import { LanguageToggle } from './AppShell';
import { BrandMark } from './BrandMark';
import styles from './AuthScreen.module.css';

type Mode = 'login' | 'register' | 'reset';

const labels = {
  ar: {
    brand: 'Kolme',
    // The brand sits above as the mark; the heading states the product's one ask.
    welcome: 'ثلاثة أفلام تكفي للبدء',
    hint: 'ترتّب ما شاهدت حسب إعجابك، فنبدأ بفهم ذوقك. لا نجوم ولا إعجاب.',
    login: 'تسجيل الدخول',
    register: 'إنشاء حساب',
    // terms_privacy: required to use the service (PRIVACY.md §3). Plain text
    // until /terms and /privacy pages exist (docs/CONSENT_COPY_2026-09-04.md §3).
    terms: 'أوافق على الشروط وإشعار الخصوصية.',
    termsLink: 'الشروط',
    privacyLink: 'إشعار الخصوصية',
    dataLink: 'المصادر والحقوق',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    passwordHint: 'من 8 إلى 64 حرفًا.',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    switchToRegister: 'ليس لديك حساب؟ أنشئ واحدًا',
    switchToLogin: 'لديك حساب بالفعل؟ سجّل الدخول',
    submitLogin: 'دخول',
    submitRegister: 'إنشاء الحساب',
    loading: 'جارٍ التحميل…',
    adults: 'الخدمة للبالغين. بعد إنشاء الحساب نسألك عن لغتك وسوقك ومنصاتك، ثم نوضح ما نجمعه ولماذا.',
    // Password reset (ADR-85): the same neutral reply for any address, so the
    // door never says which emails are registered.
    forgot: 'نسيت كلمة المرور؟',
    resetTitle: 'استعادة كلمة المرور',
    resetHint: 'اكتب بريدك وسنرسل رابطًا لتعيين كلمة مرور جديدة، صالحًا 30 دقيقة.',
    submitReset: 'أرسل الرابط',
    resetSent: 'إن كان البريد مسجّلًا لدينا فستصلك رسالة برابط التعيين خلال دقائق. تحقق من مجلد الرسائل غير المرغوبة أيضًا.',
    resetFailed: 'تعذّر إرسال الطلب. حاول بعد قليل.',
    backToLogin: 'العودة إلى تسجيل الدخول',
  },
  en: {
    brand: 'Kolme',
    welcome: 'Three films are enough to start',
    hint: 'Rank what you have watched by how much you liked it, and we start learning your taste. No stars, no likes.',
    login: 'Log in',
    register: 'Create account',
    terms: 'I agree to the Terms and Privacy Notice.',
    termsLink: 'Terms',
    privacyLink: 'Privacy Notice',
    dataLink: 'Sources and rights',
    email: 'Email',
    password: 'Password',
    passwordHint: '8 to 64 characters.',
    firstName: 'First name',
    lastName: 'Last name',
    switchToRegister: "Don't have an account? Create one",
    switchToLogin: 'Already have an account? Log in',
    submitLogin: 'Log in',
    submitRegister: 'Create account',
    loading: 'Loading…',
    adults: 'For adults. After creating the account we ask for your language, market and platforms, then explain what we collect and why.',
    forgot: 'Forgot your password?',
    resetTitle: 'Reset your password',
    resetHint: 'Enter your email and we will send a link to set a new password, valid for 30 minutes.',
    submitReset: 'Send the link',
    resetSent: 'If that address is registered, a message with the reset link is on its way. Check your spam folder too.',
    resetFailed: 'The request could not be sent. Try again in a moment.',
    backToLogin: 'Back to log in',
  },
};

export function AuthScreen({
  lang,
  onLanguageChange,
}: {
  lang: 'ar' | 'en';
  onLanguageChange?: (lang: 'ar' | 'en') => void;
}) {
  const { login, register, error, clearError } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // Unchecked by default; registration cannot be submitted without it.
  const [agreed, setAgreed] = useState(false);
  // Reset mode keeps its own outcome: the session's error belongs to
  // login/register, and a sent request has no error to show.
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const t = labels[lang];

  function switchMode(next: Mode) {
    clearError();
    setResetSent(false);
    setResetError(null);
    setMode(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'reset') {
        setResetError(null);
        try {
          await api.requestPasswordReset(email);
          setResetSent(true);
        } catch {
          setResetError(t.resetFailed);
        }
        return;
      }
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({ email, password, firstName, lastName });
        // The account exists and the token is set: record the agreement the
        // checkbox expressed. A failed write must not trap the user on the
        // door (the same non-blocking pattern as onboarding's consent write);
        // one retry, then the account proceeds and the consent screen later
        // re-asks nothing -- terms are re-recorded with the next consent write.
        try {
          await api.updateConsents([{ purpose: 'terms_privacy', version: CONSENT_VERSION, granted: true }]);
        } catch {
          try {
            await api.updateConsents([{ purpose: 'terms_privacy', version: CONSENT_VERSION, granted: true }]);
          } catch {
            // Left unrecorded for now; see the comment above.
          }
        }
      }
    } catch {
      // error state already set by useSession
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.auth} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <section className={styles.panel}>
        {/* The door has the same toggle as the shell: a reader who cannot read
            the current language must be able to switch before signing in. */}
        {onLanguageChange && (
          <LanguageToggle
            lang={lang}
            onToggle={() => onLanguageChange(lang === 'ar' ? 'en' : 'ar')}
            className={styles.language}
          />
        )}
        <p className={styles.brand}>
          <BrandMark size={18} />
          {t.brand}
        </p>
        <h1>{mode === 'reset' ? t.resetTitle : t.welcome}</h1>
        <p className={styles.lead}>{mode === 'reset' ? t.resetHint : t.hint}</p>
        {mode === 'reset' && resetSent ? (
          <p className={styles.hint} role="status">
            {t.resetSent}
          </p>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit} noValidate={false}>
            {mode === 'register' && (
              <div className={styles.two}>
                <div className={styles.field}>
                  <label htmlFor="auth-first-name">{t.firstName}</label>
                  <input
                    id="auth-first-name"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="auth-last-name">{t.lastName}</label>
                  <input
                    id="auth-last-name"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    required
                  />
                </div>
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor="auth-email">{t.email}</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            {mode !== 'reset' && (
              <div className={styles.field}>
                <label htmlFor="auth-password">{t.password}</label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={64}
                  required
                />
                {mode === 'register' && <p className={styles.hint}>{t.passwordHint}</p>}
              </div>
            )}
            {mode === 'register' && (
              <label className={styles.terms}>
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required />
                <span>
                  {t.terms}{' '}
                  <Link href={`/terms?lang=${lang}`} target="_blank" rel="noopener" className={styles.docLink}>
                    {t.termsLink}
                  </Link>
                  {' · '}
                  <Link href={`/privacy?lang=${lang}`} target="_blank" rel="noopener" className={styles.docLink}>
                    {t.privacyLink}
                  </Link>
                  {' · '}
                  <Link href={`/data-notice?lang=${lang}`} target="_blank" rel="noopener" className={styles.docLink}>
                    {t.dataLink}
                  </Link>
                </span>
              </label>
            )}
            {mode !== 'reset' && error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {mode === 'reset' && resetError && (
              <p className={styles.error} role="alert">
                {resetError}
              </p>
            )}
            <button className={styles.submit} type="submit" disabled={submitting || (mode === 'register' && !agreed)}>
              {submitting ? t.loading : mode === 'login' ? t.submitLogin : mode === 'register' ? t.submitRegister : t.submitReset}
            </button>
          </form>
        )}
        {mode === 'login' && (
          <button className={styles.switch} type="button" onClick={() => switchMode('reset')}>
            {t.forgot}
          </button>
        )}
        <button className={styles.switch} type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? t.switchToRegister : mode === 'register' ? t.switchToLogin : t.backToLogin}
        </button>
        {mode === 'register' && <p className={styles.adults}>{t.adults}</p>}
      </section>
    </main>
  );
}
