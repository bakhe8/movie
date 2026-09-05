import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, ThemeToggle, useTheme } from '../lib/theme';

let systemDark = false;
let mediaListeners: Set<() => void>;
function Probe() {
  const { preference, resolved } = useTheme();
  return <output data-testid="resolution">{preference}/{resolved}</output>;
}
function Mount({ lang = 'ar' }: { lang?: 'ar' | 'en' }) {
  return <ThemeProvider><ThemeToggle lang={lang}/><Probe/></ThemeProvider>;
}
beforeEach(() => {
  systemDark = false;
  mediaListeners = new Set();
  localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return systemDark; },
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
  })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove());
});
const chrome = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

describe('shared theme provider and toggle', () => {
  it.each(['ar', 'en'] as const)('switches all preferences with the existing storage key (%s)', lang => {
    systemDark = true;
    render(<Mount lang={lang}/>);
    expect(screen.getByTestId('resolution')).toHaveTextContent('system/dark');
    expect(chrome()).toBe('#06070f');
    expect(localStorage.getItem('reel.theme')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: lang === 'ar' ? 'فاتح' : 'Light' }));
    expect(screen.getByTestId('resolution')).toHaveTextContent('light/light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(chrome()).toBe('#f7f6fc');
    expect(localStorage.getItem('reel.theme')).toBe('light');
    fireEvent.click(screen.getByRole('radio', { name: lang === 'ar' ? 'داكن' : 'Dark' }));
    expect(chrome()).toBe('#06070f');
    expect(localStorage.getItem('reel.theme')).toBe('dark');
    fireEvent.click(screen.getByRole('radio', { name: lang === 'ar' ? 'نظام' : 'Auto' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(localStorage.getItem('reel.theme')).toBe('system');
    expect(screen.getByTestId('resolution')).toHaveTextContent('system/dark');
    expect(screen.getAllByRole('radio').filter(el => el.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });

  it.each(['light', 'dark'] as const)('restores %s on remount despite the opposite OS setting', saved => {
    localStorage.setItem('reel.theme', saved);
    systemDark = saved === 'light';
    const mounted = render(<Mount/>);
    expect(screen.getByTestId('resolution')).toHaveTextContent(`${saved}/${saved}`);
    mounted.unmount();
    render(<Mount/>);
    expect(screen.getByTestId('resolution')).toHaveTextContent(`${saved}/${saved}`);
    expect(chrome()).toBe(saved === 'light' ? '#f7f6fc' : '#06070f');
  });

  it('restores an explicit system choice and keeps following the OS after remount', () => {
    localStorage.setItem('reel.theme', 'system');
    systemDark = true;
    const mounted = render(<Mount/>);
    expect(screen.getByTestId('resolution')).toHaveTextContent('system/dark');
    mounted.unmount();

    systemDark = false;
    render(<Mount/>);
    expect(screen.getByTestId('resolution')).toHaveTextContent('system/light');
    expect(localStorage.getItem('reel.theme')).toBe('system');
  });

  it('follows live OS changes only in system mode and cleans up listeners', () => {
    const mounted = render(<Mount/>);
    expect(chrome()).toBe('#f7f6fc');
    act(() => { systemDark = true; mediaListeners.forEach(fn => fn()); });
    expect(chrome()).toBe('#06070f');
    fireEvent.click(screen.getByRole('radio', { name: 'فاتح' }));
    act(() => { systemDark = false; mediaListeners.forEach(fn => fn()); });
    act(() => { systemDark = true; mediaListeners.forEach(fn => fn()); });
    expect(screen.getByTestId('resolution')).toHaveTextContent('light/light');
    expect(chrome()).toBe('#f7f6fc');
    mounted.unmount();
    expect(mediaListeners.size).toBe(0);
  });

  it('reflects another tab changing or clearing the same stored preference', () => {
    render(<Mount/>);
    act(() => {
      localStorage.setItem('reel.theme', 'dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'reel.theme' }));
    });
    expect(screen.getByTestId('resolution')).toHaveTextContent('dark/dark');
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(screen.getByTestId('resolution')).toHaveTextContent('system/light');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(chrome()).toBe('#f7f6fc');
  });
});
