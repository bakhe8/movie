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
});
