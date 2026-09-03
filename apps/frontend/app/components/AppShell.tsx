'use client';

import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

export type View = 'home' | 'rank' | 'discover' | 'list' | 'profile';
export const VIEWS: readonly View[] = ['home', 'rank', 'discover', 'list', 'profile'];
type Lang = 'ar' | 'en';

const labels = {
  ar: {
    nav: 'أقسام التطبيق',
    home: 'الرئيسية',
    rank: 'رتّب',
    discover: 'اكتشف',
    list: 'قائمتي',
    // Short on purpose: five cells share 375px and a label must stay one line.
    profile: 'ملفي',
  },
  en: {
    nav: 'App sections',
    home: 'Home',
    rank: 'Rank',
    discover: 'Discover',
    list: 'My list',
    profile: 'Profile',
  },
};

// The toggle is written in the language it switches TO, so a reader who
// cannot read the current one still finds it; `lang` lets a screen reader
// pronounce it in that language.
const SWITCH = {
  ar: { text: 'EN', label: 'Switch to English', lang: 'en' },
  en: { text: 'عربي', label: 'التبديل إلى العربية', lang: 'ar' },
} as const;

// Direction-neutral line icons (24px grid, stroked in currentColor): nothing
// in them points start-or-end, so they read the same in RTL and LTR.
const ICONS: Record<View, ReactNode> = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20h14v-9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  rank: (
    <>
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </>
  ),
  discover: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  list: <path d="M6 3h12v18l-6-4-6 4z" />,
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
};

function Icon({ view }: { view: View }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[view]}
    </svg>
  );
}

export function LanguageToggle({
  lang,
  onToggle,
  className,
}: {
  lang: Lang;
  onToggle: () => void;
  className?: string;
}) {
  const target = SWITCH[lang];
  return (
    <button type="button" className={className} lang={target.lang} aria-label={target.label} onClick={onToggle}>
      {target.text}
    </button>
  );
}

/**
 * The frame around every signed-in screen. Header: brand (the document's h1;
 * screens title themselves with an h2) and the language toggle. Navigation:
 * only when `view`/`onNavigate` are given -- onboarding runs without it.
 */
export function AppShell({
  lang,
  onToggleLanguage,
  view,
  onNavigate,
  children,
}: {
  lang: Lang;
  onToggleLanguage: () => void;
  view?: View;
  onNavigate?: (view: View) => void;
  children: ReactNode;
}) {
  const t = labels[lang];
  return (
    <div className={styles.shell} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className={styles.header}>
        <h1 className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            R
          </span>
          Reel
        </h1>
        {view && onNavigate && (
          <nav className={styles.nav} aria-label={t.nav}>
            {VIEWS.map((item) => (
              <button
                key={item}
                type="button"
                className={styles.tab}
                aria-current={view === item ? 'page' : undefined}
                onClick={() => onNavigate(item)}
              >
                <Icon view={item} />
                <span>{t[item]}</span>
              </button>
            ))}
          </nav>
        )}
        <LanguageToggle lang={lang} onToggle={onToggleLanguage} className={styles.language} />
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
