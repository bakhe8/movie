import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const boot = readFileSync('public/theme-boot.js', 'utf8');
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove());
});

describe('theme before hydration — ADR-112', () => {
  it.each([
    [null, false, null, '#f7f6fc'],
    [null, true, null, '#06070f'],
    ['system', false, null, '#f7f6fc'],
    ['system', true, null, '#06070f'],
    ['light', true, 'light', '#f7f6fc'],
    ['dark', false, 'dark', '#06070f'],
    ['invalid', true, null, '#06070f'],
  ])('resolves stored %s / system dark %s before React', (stored, dark, attr, ground) => {
    if (stored) localStorage.setItem('reel.theme', stored as string);
    document.documentElement.setAttribute('data-theme', 'obsolete');
    const matchMedia = vi.fn(() => ({ matches: dark }));
    runInNewContext(boot, { document, localStorage, window: { matchMedia } });
    expect(document.documentElement.getAttribute('data-theme')).toBe(attr);
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(ground);
    // Boot never rewrites an existing user's stored preference.
    expect(localStorage.getItem('reel.theme')).toBe(stored);
    runInNewContext(boot, { document, localStorage, window: { matchMedia } });
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it('does not block page startup when browser storage is unavailable', () => {
    expect(() => runInNewContext(boot, {
      document, window: {}, localStorage: { getItem() { throw new Error('blocked'); } },
    })).not.toThrow();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
