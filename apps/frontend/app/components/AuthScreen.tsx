'use client';

import { useState } from 'react';
import { useSession } from '../lib/session';

type Mode = 'login' | 'register';

const labels = {
  ar: {
    brand: 'Reel',
    welcome: 'أهلاً بك في Reel',
    hint: 'رتّب ثلاث أفلام شاهدتها لنبدأ بفهم ذوقك.',
    login: 'تسجيل الدخول',
    register: 'إنشاء حساب',
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    switchToRegister: 'ليس لديك حساب؟ أنشئ واحدًا',
    switchToLogin: 'لديك حساب بالفعل؟ سجّل الدخول',
    submitLogin: 'دخول',
    submitRegister: 'إنشاء الحساب',
    loading: 'جارٍ التحميل…',
  },
  en: {
    brand: 'Reel',
    welcome: 'Welcome to Reel',
    hint: 'Rank three films you have watched to start building your taste profile.',
    login: 'Log in',
    register: 'Create account',
    email: 'Email',
    password: 'Password',
    firstName: 'First name',
    lastName: 'Last name',
    switchToRegister: "Don't have an account? Create one",
    switchToLogin: 'Already have an account? Log in',
    submitLogin: 'Log in',
    submitRegister: 'Create account',
    loading: 'Loading…',
  },
};

export function AuthScreen({ lang }: { lang: 'ar' | 'en' }) {
  const { login, register, error, clearError } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const t = labels[lang];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({ email, password, firstName, lastName });
      }
    } catch {
      // error state already set by useSession
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <section>
        <p className="eyebrow">{t.brand}</p>
        <h1>{t.welcome}</h1>
        <p className="muted">{t.hint}</p>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <>
              <input
                placeholder={t.firstName}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
              <input
                placeholder={t.lastName}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                required
              />
            </>
          )}
          <input
            type="email"
            placeholder={t.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            placeholder={t.password}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          {error && <p className="notice">{error}</p>}
          <button className="cta" type="submit" disabled={submitting}>
            {submitting ? t.loading : mode === 'login' ? t.submitLogin : t.submitRegister}
          </button>
        </form>
        <button
          className="link"
          type="button"
          onClick={() => {
            clearError();
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? t.switchToRegister : t.switchToLogin}
        </button>
      </section>
    </main>
  );
}
