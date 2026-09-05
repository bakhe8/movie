<<<<<<< HEAD
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard 1 of 3 for the three-state theme choice (ADR-112; THEME_MODES §3).
 *
 * The boot script is the only thing that runs before the first paint, so it
 * decides what a returning visitor sees in the moment before React exists.
 * It is plain JS in `public/`, which no bundler touches and no other test
 * covers: the file is read from disk and run here exactly as the browser
 * would run it.
 *
 * What these guards protect, while L1 replaces the light palette:
 * - `system` writes NO attribute. The light palette lives on bare `:root`,
 *   so a light OS with no saved choice must reach it with nothing stamped.
 *   A theme implemented only under `[data-theme="light"]` would silently
 *   strand exactly those visitors, and this is the test that fails first.
 * - The stored key stays `reel.theme`: renaming it discards every saved
 *   choice in the wild.
 * - The browser chrome colour matches the ground the page actually paints.
 */
const BOOT = readFileSync(join(process.cwd(), 'public', 'theme-boot.js'), 'utf8');

// The grounds are --bg in each theme (styles/tokens.css). L1 changes the light
// one; when it does, this constant and the script move together or the browser
// chrome ends up a different colour from the page under it.
const LIGHT_GROUND = '#f4f4fa';
const DARK_GROUND = '#06070f';

function boot({ stored, systemDark, storageThrows = false }: { stored?: string; systemDark: boolean; storageThrows?: boolean }) {
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '';

  const store = new Map<string, string>();
  if (stored) store.set('reel.theme', stored);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('storage blocked');
      return store.get(key) ?? null;
    },
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark') && systemDark, media: query }));

  new Function(BOOT)();

  return {
    attribute: document.documentElement.getAttribute('data-theme'),
    chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('theme boot, before the first paint', () => {
  it('stamps nothing for a visitor who never chose, so `system` reaches the bare :root palette', () => {
    expect(boot({ systemDark: false }).attribute).toBeNull();
    expect(boot({ systemDark: true }).attribute).toBeNull();
  });

  it('follows the device when the choice is `system`', () => {
    expect(boot({ systemDark: true }).chrome).toBe(DARK_GROUND);
    expect(boot({ systemDark: false }).chrome).toBe(LIGHT_GROUND);
  });

  it('stamps an explicit choice, and lets it beat the device in both directions', () => {
    const lightOnDarkDevice = boot({ stored: 'light', systemDark: true });
    expect(lightOnDarkDevice.attribute).toBe('light');
    expect(lightOnDarkDevice.chrome).toBe(LIGHT_GROUND);

    const darkOnLightDevice = boot({ stored: 'dark', systemDark: false });
    expect(darkOnLightDevice.attribute).toBe('dark');
    expect(darkOnLightDevice.chrome).toBe(DARK_GROUND);
  });

  it('reads the key it has always read, since renaming it would discard saved choices', () => {
    expect(BOOT).toContain("'reel.theme'");
  });

  it('treats a value it does not recognise as no choice at all', () => {
    expect(boot({ stored: 'sepia', systemDark: false }).attribute).toBeNull();
  });

  it('leaves the page alone when storage is blocked, instead of throwing before paint', () => {
    const blocked = boot({ systemDark: true, storageThrows: true });

    expect(blocked.attribute).toBeNull();
    // The script gave up quietly; CSS still resolves the scheme on its own.
    expect(blocked.chrome).toBeNull();
=======
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
>>>>>>> pr-1
  });
});
