import '../../jest-dom-vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEY, ThemeProvider, useTheme } from '../lib/theme';

/**
 * Guard 2 of 3 for the three-state theme choice (ADR-112; THEME_MODES §3).
 *
 * The provider is what keeps `system` a live third state rather than a
 * one-time guess: it removes the attribute, remembers the explicit selection,
 * and follows the device until the visitor says otherwise. L1 replaces the
 * light palette underneath all of this; none of it may change with the palette.
 */
// ADR-112: the montage light ground (styles/tokens.css --bg).
const LIGHT_GROUND = '#f7f6fc';
const DARK_GROUND = '#06070f';

// One fake OS, whose scheme can change while the page is open.
let systemDark = false;
const listeners = new Set<() => void>();

function setSystemDark(next: boolean) {
  systemDark = next;
  act(() => {
    listeners.forEach((fn) => fn());
  });
}

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setPreference('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setPreference('light')}>
        light
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        system
      </button>
    </div>
  );
}

const attribute = () => document.documentElement.getAttribute('data-theme');
const chrome = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '';
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return query.includes('dark') && systemDark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('starts on `system` with nothing stamped and nothing stored', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(attribute()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps following the device while the choice is `system`', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    setSystemDark(true);

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(chrome()).toBe(DARK_GROUND);
    // Following the device is not a choice: nothing is stamped or stored.
    expect(attribute()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('remembers an explicit choice and lets it beat the device', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'dark' }));

    expect(attribute()).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(chrome()).toBe(DARK_GROUND);

    // The device turning light must not undo what the visitor asked for.
    setSystemDark(false);
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(attribute()).toBe('dark');
  });

  it('holds an explicit light choice on a dark device', async () => {
    const user = userEvent.setup();
    setSystemDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'light' }));

    expect(attribute()).toBe('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(chrome()).toBe(LIGHT_GROUND);
  });

  it('gives the device back and remembers when the visitor returns to `system`', async () => {
    const user = userEvent.setup();
    setSystemDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'light' }));

    await user.click(screen.getByRole('button', { name: 'system' }));

    expect(attribute()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  // Private mode, or a browser set to block site data: the page obeys, it
  // just cannot remember for next time. This guard found the opposite -- the
  // write threw, the store was re-read, and the choice vanished, leaving the
  // control dead -- and theme.tsx now keeps a page-lifetime copy.
  it('still applies a choice when storage refuses to keep it', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'dark' }));

    expect(attribute()).toBe('dark');
    expect(screen.getByTestId('preference')).toHaveTextContent('dark');

    // And the way back still works, even though nothing was ever written.
    await user.click(screen.getByRole('button', { name: 'system' }));
    expect(attribute()).toBeNull();
    expect(screen.getByTestId('preference')).toHaveTextContent('system');

    setItem.mockRestore();
  });

  it('lets storage take over again once it works', async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage blocked');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'dark' }));
    await user.click(screen.getByRole('button', { name: 'light' }));

    // The second write succeeded, so the page-lifetime copy steps aside
    // instead of outranking what is now stored.
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    expect(attribute()).toBe('light');
    setItem.mockRestore();
  });
});
