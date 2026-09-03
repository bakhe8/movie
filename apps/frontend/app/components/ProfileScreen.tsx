'use client';

import { useSession } from '../lib/session';

const labels = {
  ar: { title: 'الملف الشخصي', account: 'إدارة ملف ذوقك', logout: 'تسجيل الخروج' },
  en: { title: 'Profile', account: 'Manage your taste profile', logout: 'Log out' },
};

export function ProfileScreen({ lang }: { lang: 'ar' | 'en' }) {
  const { user, profile, logout } = useSession();
  const t = labels[lang];

  return (
    <>
      <h2>{t.title}</h2>
      <p className="muted">{t.account}</p>
      {user && (
        <p>
          {user.firstName} {user.lastName} · {user.email}
        </p>
      )}
      {profile && <p className="muted">{profile.name}</p>}
      <button className="cta" onClick={logout}>
        {t.logout}
      </button>
    </>
  );
}
