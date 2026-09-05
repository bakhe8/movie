import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const boot = readFileSync('public/appearance-boot.js', 'utf8');
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-appearance');
  document.documentElement.removeAttribute('data-theme');
});

describe('appearance before hydration', () => {
  it.each(['cinema', 'premiere', 'montage'])('restores guest %s without changing light/dark', (appearance) => {
    localStorage.setItem('reel.appearance.v1:guest', appearance);
    document.documentElement.setAttribute('data-theme', 'light');
    runInNewContext(boot, { document, localStorage });
    expect(document.documentElement.getAttribute('data-appearance')).toBe(appearance);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('reel.appearance.v1:guest')).toBe(appearance);
  });

  it('uses the default for a corrupt value and never borrows an account preference', () => {
    localStorage.setItem('reel.appearance.v1:guest', 'invalid');
    localStorage.setItem('reel.appearance.v1:profile-1', 'premiere');
    localStorage.setItem('reel.session.v1', JSON.stringify({ user: { id: 'user-1' } }));
    runInNewContext(boot, { document, localStorage });
    expect(document.documentElement.getAttribute('data-appearance')).toBe('cinema');
  });

  it('starts normally if storage is unavailable', () => {
    expect(() => runInNewContext(boot, { document, localStorage: { getItem() { throw new Error('blocked'); } } })).not.toThrow();
    expect(document.documentElement.getAttribute('data-appearance')).toBe('cinema');
  });
});
