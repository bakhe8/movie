'use client';

import { useId, useState, type ReactNode } from 'react';
import styles from './AppShell.module.css';
import { ThemeToggle } from '../lib/theme';
import prefStyles from '../lib/ThemeToggle.module.css';

export type View = 'home' | 'rank' | 'discover' | 'list' | 'profile';
export const VIEWS: readonly View[] = ['home', 'rank', 'discover', 'list', 'profile'];
type Lang = 'ar' | 'en';

const labels = {
  ar: {
    skip: 'تخطّ إلى المحتوى',
    nav: 'أقسام التطبيق',
    navTabs: 'تنقل الأقسام',
    home: 'الرئيسية',
    rank: 'رتّب',
    discover: 'اكتشف',
    list: 'قائمتي',
    // Short on purpose: five cells share 375px and a label must stay one line.
    profile: 'ملفي',
    menu: 'القائمة',
    close: 'إغلاق القائمة',
    search: 'بحث',
    prefs: 'التفضيلات',
  },
  en: {
    skip: 'Skip to content',
    nav: 'App sections',
    navTabs: 'Section tabs',
    home: 'Home',
    rank: 'Rank',
    discover: 'Discover',
    list: 'My list',
    profile: 'Profile',
    menu: 'Menu',
    close: 'Close menu',
    search: 'Search',
    prefs: 'Preferences',
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
// in them points start-or-end, so they read the same in RTL and LTR
// (identity decision Q22: media/search/menu icons never mirror).
const ICONS: Record<View | 'menu' | 'close' | 'search', ReactNode> = {
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
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
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
      {ICONS[name]}
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
 * The frame around every signed-in screen (identity decisions Q19 revised and
 * Q20): two bars.
 * - Top: on the phone, menu at the start, brand in the centre, search at the
 *   end; the menu holds the preferences (theme, language). On wide screens the
 *   sections sit inline in the header and the preferences are visible.
 * - Bottom (phone only): the five sections as fixed tabs.
 * Navigation appears only when `view`/`onNavigate` are given -- onboarding
 * runs without it.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const hasNav = Boolean(view && onNavigate);

  // The drawer closes with the action taken from it or from the bar: moving
  // to a section, or flipping the language (the header it belonged to moves on).
  function go(item: View) {
    setMenuOpen(false);
    onNavigate?.(item);
  }
  function toggleLanguage() {
    setMenuOpen(false);
    onToggleLanguage();
  }

  return (
    <div className={hasNav ? `${styles.shell} ${styles.withNav}` : styles.shell} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <a href="#main-content" className={styles.skipNav}>{t.skip}</a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.menuButton}`}
            aria-label={menuOpen ? t.close : t.menu}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>

          <h1 className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">
              R
            </span>
            Reel
          </h1>

          {hasNav && (
            <nav className={styles.inlineNav} aria-label={t.nav}>
              {VIEWS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={styles.inlineTab}
                  aria-current={view === item ? 'page' : undefined}
                  onClick={() => go(item)}
                >
                  <Icon name={item} />
                  <span>{t[item]}</span>
                </button>
              ))}
            </nav>
          )}

          <div className={`${prefStyles.prefs} ${styles.prefsInline}`}>
            <ThemeToggle lang={lang} />
            <LanguageToggle lang={lang} onToggle={toggleLanguage} className={styles.language} />
          </div>

          {hasNav ? (
            <button
              type="button"
              className={`${styles.iconButton} ${styles.searchButton}`}
              aria-label={t.search}
              onClick={() => go('discover')}
            >
              <Icon name="search" />
            </button>
          ) : (
            <span className={styles.searchSpacer} aria-hidden="true" />
          )}
        </div>

        {/* Preferences drawer (phone): theme and language, same controls as the
            wide header shows inline. */}
        <div id={menuId} className={styles.menu} hidden={!menuOpen}>
          <p className={styles.menuTitle}>{t.prefs}</p>
          <div className={prefStyles.prefs}>
            <ThemeToggle lang={lang} />
            <LanguageToggle lang={lang} onToggle={toggleLanguage} className={styles.language} />
          </div>
        </div>
      </header>

      <main id="main-content" className={styles.content}>{children}</main>

      {hasNav && (
        <nav className={styles.tabs} aria-label={t.navTabs}>
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.tab}
              aria-current={view === item ? 'page' : undefined}
              onClick={() => go(item)}
            >
              <Icon name={item} />
              <span>{t[item]}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
