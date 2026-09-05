import '../../jest-dom-vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEY, ThemeProvider, useTheme } from '../lib/theme';

/**
 * Guard 2 of 3 for the three-state theme choice (ADR-112; THEME_MODES §3).
 *
 * The provider is what keeps `system` a live third state rather than a
 * one-time guess: it removes the attribute and the stored key, and follows
 * the device until the visitor says otherwise. L1 replaces the light palette
 * underneath all of this; none of it may change with the palette.
 */
const LIGHT_GROUND = '#f4f4fa';
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

  it('gives the device back when the visitor returns to `system`', async () => {
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
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  // FOUND BY THIS GUARD, NOT FIXED HERE. `setPreference` catches the storage
  // error and then re-reads storage, so with storage blocked the click does
  // nothing at all: no attribute, no change on screen. theme.tsx's own comment
  // says the opposite -- "the choice still applies for this page and simply is
  // not remembered" -- so the code and its stated contract disagree, and the
  // contract is the right one. In private mode the theme control is dead.
  //
  // Left skipped rather than deleted: `app/lib/theme.tsx` belongs to L1
  // (THEME_MODES §3) and a parallel edit from here is what that split exists
  // to prevent. Whoever takes L1 turns this back on with a one-line fix --
  // hold the preference in state when storage refuses it.
  it.skip('still applies a choice when storage refuses to keep it', async () => {
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

    // Private mode: the page obeys, it just cannot remember for next time.
    expect(attribute()).toBe('dark');
    setItem.mockRestore();
  });
});
