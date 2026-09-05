'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import styles from './ThemeToggle.module.css';

/**
 * Theme preference (docs/IDENTITY_DECISIONS_2026-09-03.md, Q1–Q2).
 *
 * Three states: `system` (default; never stored unless chosen explicitly),
 * `light`, `dark`. An explicit choice is stored in localStorage under
 * STORAGE_KEY and applied as `data-theme` on <html>; `system` removes the
 * attribute so the CSS falls back to `prefers-color-scheme`.
 *
 * The attribute is also set BEFORE first paint by public/theme-boot.js
 * (loaded `beforeInteractive` from app/layout.tsx), so a saved choice never
 * flashes the wrong theme. That file duplicates the four constants below on
 * purpose -- it must not import anything -- so keep them in sync.
 *
 * Persistence is local to the browser for now: the profile API has no theme
 * field yet (language is persisted through `preferredLanguage`). Adding a
 * server-side field is a separate change; until then the choice follows the
 * device, which is the only thing readable before the first paint anyway.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

// The storage key keeps its original name through the rename to Kolme
// (O-13أ): it is not shown anywhere, and changing it would silently discard
// every visitor's saved theme choice.
export const STORAGE_KEY = 'reel.theme';
// The two grounds are --bg in each theme (styles/tokens.css).
const LIGHT_GROUND = '#f7f6fc';
const DARK_GROUND = '#06070f';
const QUERY = '(prefers-color-scheme: dark)';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Writes the resolved theme to the document: attribute + browser chrome colour. */
function apply(pref: ThemePreference, resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', resolved === 'dark' ? DARK_GROUND : LIGHT_GROUND);
}

// --- External stores ------------------------------------------------------
// The stored preference and the OS scheme both live outside React, so they
// are read through useSyncExternalStore: the server snapshot is `system` /
// light (matching the first client render), and the client snapshot is the
// real value, so there is no setState-in-effect and no hydration mismatch.

const listeners = new Set<() => void>();

function subscribePreference(callback: () => void) {
  listeners.add(callback);
  // Another tab changing the preference should be reflected here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) callback();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}

function notifyPreference() {
  listeners.forEach((listener) => listener());
}

function subscribeSystem(callback: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

const readSystemDark = () => window.matchMedia(QUERY).matches;
const serverPreference = (): ThemePreference => 'system';
const serverSystemDark = () => false;

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribePreference, readStored, serverPreference);
  // While on `system`, the OS scheme is followed live (Q1: "system" means live).
  const systemDark = useSyncExternalStore(subscribeSystem, readSystemDark, serverSystemDark);
  const resolved: ResolvedTheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  // Side effects only (attribute + meta); the boot script already did this
  // once before first paint, so this is a no-op on load and the real update
  // on every later change.
  useEffect(() => {
    apply(preference, resolved);
  }, [preference, resolved]);

  const setPreference = useCallback((pref: ThemePreference) => {
    try {
      if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Storage unavailable (private mode, blocked): the choice still applies
      // for this page and simply is not remembered.
    }
    notifyPreference();
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

type Lang = 'ar' | 'en';

const LABELS: Record<Lang, { group: string; system: string; light: string; dark: string }> = {
  ar: { group: 'وضع العرض', system: 'نظام', light: 'فاتح', dark: 'داكن' },
  en: { group: 'Appearance', system: 'Auto', light: 'Light', dark: 'Dark' },
};

const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Three-state segmented control, sized like the language toggle so the two
 * sit in one group (Q2). Written as a radio group for assistive tech.
 */
export function ThemeToggle({ lang, className }: { lang: Lang; className?: string }) {
  const { preference, setPreference } = useTheme();
  const t = LABELS[lang];
  return (
    <div className={[styles.group, className].filter(Boolean).join(' ')} role="radiogroup" aria-label={t.group}>
      {ORDER.map((pref) => (
        <button
          key={pref}
          type="button"
          role="radio"
          aria-checked={preference === pref}
          className={styles.option}
          onClick={() => setPreference(pref)}
        >
          {t[pref]}
        </button>
      ))}
    </div>
  );
}
