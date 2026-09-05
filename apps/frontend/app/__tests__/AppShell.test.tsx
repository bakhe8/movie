import '../../jest-dom-vitest';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AppShell } from '../components/AppShell';

vi.mock('../lib/theme', () => ({
  ThemeToggle: () => null,
}));

// AUDIT_2026-09-05 §4: switching sections replaced everything under the
// header while focus stayed on the tab that was clicked, so assistive tech
// kept announcing the old section. Focus now moves to the new content --
// but not on the very first render, where the browser's own starting point
// is the right one.
describe('AppShell focus management', () => {
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
