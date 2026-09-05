import { describe, expect, it } from 'vitest';
import manifest from '../manifest';

// AUDIT_2026-09-05 M7: the manifest hardcoded lang 'ar' / dir 'rtl' while
// the app runs in either language at the user's choice, so an English user's
// installed PWA advertised Arabic/RTL to the OS. It now declares no language
// and lets the OS derive direction from the text it is given.
describe('manifest', () => {
  it('declares no fixed language and an automatic direction', () => {
    const declared = manifest();

    expect(declared).not.toHaveProperty('lang');
    expect(declared.dir).toBe('auto');
  });

  // O-13أ / ADR-111: the installed app carries the product's own name and the
  // indigo accent, matching the domain and styles/tokens.css.
  it('installs as Kolme with the accent as its theme colour', () => {
    const declared = manifest();

    expect(declared.name).toBe('Kolme');
    expect(declared.short_name).toBe('Kolme');
    expect(declared.theme_color).toBe('#5b4bd6');
    expect(declared.background_color).toBe('#f4f4fa');
  });
});
