import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../manifest';

const css = readFileSync('app/styles/tokens.css', 'utf8');
const lightBlock = css.match(/:root\s*\{([^}]+)\}/)![1];
const light = Object.fromEntries([...lightBlock.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
function luminance(hex: string) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a: string, b: string) {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + .05) / (lo + .05);
}

describe('ADR-112 light foundation', () => {
  it('preserves both existing dark blocks exactly at the accepted baseline', () => {
    // Source baseline 30048ff: existing colours, selectors, typography and
    // specificity must not drift as a side effect of this light-only task.
    const start = css.indexOf('/* Dark by system');
    const end = css.indexOf('/* New semantic slots');
    expect(createHash('sha256').update(css.slice(start, end)).digest('hex'))
      .toBe('be42ab3f575dcc7238da1d54ad4b25b087657cbdbe3ab2c4097565bd769c148d');
  });

  it('gives system-light the complete palette without requiring a data attribute', () => {
    expect(light.bg).toBe('#f7f6fc');
    expect(light.accent).toBe('#2445e8');
    expect(light['position-highlight']).toBe('#e9ff72');
    expect(light['position-highlight-ink']).toBe('#202033');
    const slots = css.slice(css.indexOf('/* New semantic slots'), css.indexOf('/* Base application'));
    expect(slots.match(/--position-highlight: var\(--accent-soft\);/g)).toHaveLength(2);
    expect(slots.match(/--position-highlight-ink: var\(--accent\);/g)).toHaveLength(2);
  });

  it('keeps foregrounds AA on each light surface and their role washes', () => {
    const grounds = ['bg', 'surface', 'well', 'accent-soft', 'role-safe-soft', 'role-discovery-soft', 'role-outside-soft', 'role-later-soft'];
    const foregrounds = ['text', 'muted', 'accent', 'role-safe', 'role-discovery', 'role-outside', 'role-later'];
    for (const fg of foregrounds) for (const bg of grounds) {
      expect(contrast(light[fg], light[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(light['accent-ink'], light.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light['position-highlight-ink'], light['position-highlight'])).toBeGreaterThanOrEqual(4.5);
    for (const bg of ['bg', 'surface', 'well']) expect(contrast(light.line, light[bg])).toBeGreaterThanOrEqual(3);
  });

  it('synchronizes the CSS, boot, hydrated provider, install shell and icon colours', () => {
    const boot = readFileSync('public/theme-boot.js', 'utf8');
    const provider = readFileSync('app/lib/theme.tsx', 'utf8');
    const icon = readFileSync('app/lib/brand-icon.tsx', 'utf8');
    expect(boot).toContain(`: '${light.bg}'`);
    expect(provider).toContain(`const LIGHT_GROUND = '${light.bg}'`);
    expect(provider).toContain("const DARK_GROUND = '#06070f'");
    expect(icon).toContain(`const ACCENT = '${light.accent}'`);
    expect(manifest().background_color).toBe(light.bg);
    expect(manifest().theme_color).toBe(light.accent);
  });
});
