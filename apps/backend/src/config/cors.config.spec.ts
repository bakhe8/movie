import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { corsOrigin } from './cors.config';

describe('corsOrigin', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, FRONTEND_URL: process.env.FRONTEND_URL };

  beforeEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  afterEach(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = saved.FRONTEND_URL;
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
  });

  it('uses FRONTEND_URL when set, without a trailing slash', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://kolme.app/';

    expect(corsOrigin()).toBe('https://kolme.app');
  });

  it('falls back to the Next dev server for local development', () => {
    process.env.NODE_ENV = 'development';

    expect(corsOrigin()).toBe('http://localhost:3000');
  });

  // AUDIT_2026-09-05 §4: the fallback fails closed in a deployment -- every
  // browser request from the real site refused by CORS -- so it is a boot
  // error there, named after the one variable that fixes it.
  it.each([['production'], ['staging']])('refuses to start under NODE_ENV=%s with FRONTEND_URL unset', (nodeEnv) => {
    process.env.NODE_ENV = nodeEnv;

    expect(() => corsOrigin()).toThrow(/FRONTEND_URL is unset/);
  });

  it('refuses on a Railway service with NODE_ENV unset too', () => {
    delete process.env.NODE_ENV;
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';

    expect(() => corsOrigin()).toThrow(/FRONTEND_URL/);
  });
});
