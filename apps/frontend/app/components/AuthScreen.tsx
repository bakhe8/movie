'use client';

import { useState } from 'react';
import { api, CONSENT_VERSION } from '../lib/api';
import { useSession } from '../lib/session';
import { LanguageToggle } from './AppShell';
import styles from './AuthScreen.module.css';

type Mode = 'login' | 'register';

const labels = {
  ar: {
    brand: 'Reel',
    // The brand sits above as the mark; the heading states the product's one ask.
    welcome: 'ثلاثة أفلام تكفي للبدء',
    hint: 'ترتّب ما شاهدت حسب إعجابك، فنبدأ بفهم ذوقك. لا نجوم ولا إعجاب.',
    login: 'تسجيل الدخول',
    register: 'إنشاء حساب',
    // terms_privacy: required to use the service (PRIVACY.md §3). Plain text
    // until /terms and /privacy pages exist (docs/CONSENT_COPY_2026-09-04.md §3).
    terms: 'أوافق على الشروط وإشعار الخصوصية.',
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
  },
  en: {
    brand: 'Reel',
    welcome: 'Three films are enough to start',
    hint: 'Rank what you have watched by how much you liked it, and we start learning your taste. No stars, no likes.',
    login: 'Log in',
    register: 'Create account',
    terms: 'I agree to the Terms and Privacy Notice.',
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
  const t = labels[lang];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
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
        <p className={styles.brand}>{t.brand}</p>
        <h1>{t.welcome}</h1>
        <p className={styles.lead}>{t.hint}</p>
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
          {mode === 'register' && (
            <label className={styles.terms}>
              <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required />
              <span>{t.terms}</span>
            </label>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button className={styles.submit} type="submit" disabled={submitting || (mode === 'register' && !agreed)}>
            {submitting ? t.loading : mode === 'login' ? t.submitLogin : t.submitRegister}
          </button>
        </form>
        <button
          className={styles.switch}
          type="button"
          onClick={() => {
            clearError();
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? t.switchToRegister : t.switchToLogin}
        </button>
        {mode === 'register' && <p className={styles.adults}>{t.adults}</p>}
      </section>
    </main>
  );
}
