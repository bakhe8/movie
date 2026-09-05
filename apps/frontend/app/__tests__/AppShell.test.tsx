import '../../jest-dom-vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../components/AppShell';

vi.mock('../lib/theme', () => ({
  ThemeToggle: () => <span data-testid="theme-toggle" />,
}));

// UX_AUDIT_MOBILE_2026-09-05 P0 #3 and #5: the phone header measured 113px --
// two rows -- because the preferences wrapper in the bar carried BOTH the
// shell's `prefsInline` (display: none until 900px) and the shared `prefs`
// class (display: flex), and the shared one won; and the brand read "Reel"
// while the domain reads kolme.app.
describe('AppShell header', () => {
  function bar() {
    const { container } = render(
      <AppShell lang="ar" onToggleLanguage={() => {}} view="home" onNavigate={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    const el = container.querySelector('header > div');
    if (!el) throw new Error('no top bar');
    return el as HTMLElement;
  }

  it('names the product Kolme and draws the triad mark, not an initial', () => {
    const heading = bar().querySelector('h1');

    expect(heading?.textContent).toBe('Kolme');
    expect(heading?.querySelectorAll('svg rect')).toHaveLength(3);
  });

  it('gives the bar preferences one class only, so they stay hidden on the phone', () => {
    const inline = bar().querySelector('[class*="prefsInline"]');

    expect(inline).not.toBeNull();
    expect(inline!.className.trim().split(/\s+/)).toHaveLength(1);
  });

  it('puts the preferences drawer under the bar, not in it', () => {
    const { container } = render(
      <AppShell lang="ar" onToggleLanguage={() => {}} view="home" onNavigate={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    const drawer = container.querySelector('header > div[hidden]');

    expect(drawer).not.toBeNull();
    expect(drawer!.querySelector('[data-testid="theme-toggle"]')).not.toBeNull();
  });
});

// AUDIT_2026-09-05 §4: switching sections replaced everything under the
// header while focus stayed on the tab that was clicked, so assistive tech
// kept announcing the old section. Focus now moves to the new content --
// but not on the very first render, where the browser's own starting point
// is the right one.
describe('AppShell focus management', () => {
  it('returns focus to the drawer trigger when Escape hides its contents', async () => {
    const user = userEvent.setup();
    render(<AppShell lang="ar" onToggleLanguage={() => {}} view="home" onNavigate={() => {}}><p>content</p></AppShell>);
    await user.click(screen.getByRole('button', { name: 'القائمة' }));
    const appearance = screen.getByRole('button', { name: /اختر مظهر تجربتك/ });
    appearance.focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'القائمة' })).toHaveFocus();
  });

  function shell(view: 'home' | 'rank') {
    return (
      <AppShell lang="ar" onToggleLanguage={() => {}} view={view} onNavigate={() => {}}>
        <p>{view}</p>
      </AppShell>
    );
  }

  it('leaves focus alone on first render, then moves it to the content when the section changes', () => {
    const { rerender } = render(shell('home'));
    const main = document.getElementById('main-content');

    expect(main).not.toBeNull();
    expect(document.activeElement).not.toBe(main);

    rerender(shell('rank'));

    expect(document.activeElement).toBe(main);
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('does not re-focus when re-rendered on the same section', () => {
    const { rerender } = render(shell('home'));
    rerender(shell('rank'));
    (document.activeElement as HTMLElement | null)?.blur();

    rerender(shell('rank'));

    expect(document.activeElement).not.toBe(document.getElementById('main-content'));
  });
});
