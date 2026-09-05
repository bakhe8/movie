import { describe, expect, it } from 'vitest';
import { canaryEmailFor, CANARY_EMAIL_PATTERN_SOURCE, isCanaryEmail } from './canary-account';

describe('canary addresses (ADR-107)', () => {
  it('recognises the plain and the numbered canary accounts', () => {
    expect(isCanaryEmail('canary@kolme.app')).toBe(true);
    expect(isCanaryEmail('canary+2@kolme.app')).toBe(true);
    expect(isCanaryEmail('canary+20@kolme.app')).toBe(true);
    // Registration normalises before saving (./email), but this is the guard
    // that decides whether a row is excluded from pooling for ever.
    expect(isCanaryEmail('  Canary@Kolme.App ')).toBe(true);
  });

  it('does not claim an address that merely looks like one', () => {
    expect(isCanaryEmail('canary@example.com')).toBe(false);
    expect(isCanaryEmail('canary+0@kolme.app')).toBe(false);
    expect(isCanaryEmail('canaryx@kolme.app')).toBe(false);
    expect(isCanaryEmail('notcanary@kolme.app')).toBe(false);
    // The dot is a literal, not "any character" -- the first spelling of
    // this pattern let `kolmeXapp` through.
    expect(isCanaryEmail('canary@kolmeXapp')).toBe(false);
  });

  it('numbers accounts from the plain address', () => {
    expect(canaryEmailFor(1)).toBe('canary@kolme.app');
    expect(canaryEmailFor(2)).toBe('canary+2@kolme.app');
    expect(() => canaryEmailFor(0)).toThrow(/positive integer/);
  });

  it('exports a pattern the backfill migration can hand to Postgres unchanged', () => {
    // POSIX ERE and JS agree on this subset; `[.]` and `[+]` avoid the two
    // escapes the dialects spell differently.
    expect(CANARY_EMAIL_PATTERN_SOURCE).toBe('^canary([+][1-9][0-9]*)?@kolme[.]app$');
  });
});
