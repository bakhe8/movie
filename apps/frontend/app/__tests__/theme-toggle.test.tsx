import '../../jest-dom-vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeToggle } from '../lib/theme';

/**
 * Guard 3 of 3 for the three-state theme choice (ADR-112; THEME_MODES §3).
 *
 * The control the visitor actually touches. Three options, always: `system`
 * is one of them, not the absence of a choice, and it must stay reachable
 * after the visitor has picked light or dark -- that is the only way back to
 * following the device.
 *
 * The control moves between surfaces (the phone's preferences drawer and the
 * wide header, AppShell), and L1 repaints what is under it. Neither may
 * reduce it to two states.
 */
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function toggle(lang: 'ar' | 'en' = 'ar') {
  return render(
    <ThemeProvider>
      <ThemeToggle lang={lang} />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('offers three options, named, in one group', () => {
    toggle();

    const group = screen.getByRole('radiogroup', { name: 'وضع العرض' });
    const options = screen.getAllByRole('radio');
    expect(group).toBeInTheDocument();
    expect(options.map((option) => option.textContent)).toEqual(['نظام', 'فاتح', 'داكن']);
  });

  it('marks the current one for assistive tech, not only by colour', async () => {
    const user = userEvent.setup();
    toggle();

    expect(screen.getByRole('radio', { name: 'نظام' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: 'داكن' }));

    expect(screen.getByRole('radio', { name: 'داكن' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'نظام' })).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the way back to the device after an explicit choice', async () => {
    const user = userEvent.setup();
    toggle();

    await user.click(screen.getByRole('radio', { name: 'فاتح' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(screen.getByRole('radio', { name: 'نظام' }));

    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('reel.theme')).toBe('system');
    expect(screen.getByRole('radio', { name: 'نظام' })).toHaveAttribute('aria-checked', 'true');
  });

  it('names the same three in English', () => {
    toggle('en');

    expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual(['Auto', 'Light', 'Dark']);
  });
});
