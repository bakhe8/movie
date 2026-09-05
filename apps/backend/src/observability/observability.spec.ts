import { beforeAll, describe, expect, it, vi } from 'vitest';
import { captureException, initObservability, observabilityConfig, resetSentryClientForTests, scrubEvent, tagRequestId } from './observability';

describe('observabilityConfig', () => {
  it('is off when neither variable is set -- the default in every environment', () => {
    const config = observabilityConfig({} as NodeJS.ProcessEnv);

    expect(config.sentryDsn).toBeNull();
    expect(config.otelEndpoint).toBeNull();
  });

  it('treats whitespace as unset, so a blank line in .env does not half-enable anything', () => {
    const config = observabilityConfig({ SENTRY_DSN: '   ', OTEL_EXPORTER_OTLP_ENDPOINT: '' } as NodeJS.ProcessEnv);

    expect(config.sentryDsn).toBeNull();
    expect(config.otelEndpoint).toBeNull();
  });

  it('reads the endpoints and the service name when they are set', () => {
    const config = observabilityConfig({
      SENTRY_DSN: 'https://key@sentry.example/1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/v1/traces',
      OTEL_SERVICE_NAME: 'reel-backend-staging',
      NODE_ENV: 'staging',
    } as NodeJS.ProcessEnv);

    expect(config).toMatchObject({
      sentryDsn: 'https://key@sentry.example/1',
      otelEndpoint: 'http://collector:4318/v1/traces',
      serviceName: 'reel-backend-staging',
      environment: 'staging',
    });
  });

  it.each([['2'], ['-1'], ['nonsense'], [undefined]])('falls back to a full sample rate for %j', (rate) => {
    expect(observabilityConfig({ OTEL_TRACES_SAMPLE_RATE: rate } as NodeJS.ProcessEnv).tracesSampleRate).toBe(1);
  });

  it('accepts a sample rate inside the range', () => {
    expect(observabilityConfig({ OTEL_TRACES_SAMPLE_RATE: '0.25' } as NodeJS.ProcessEnv).tracesSampleRate).toBe(0.25);
  });

  it('prefers SENTRY_RELEASE, falls back to Railway\'s commit sha, then null', () => {
    expect(observabilityConfig({} as NodeJS.ProcessEnv).release).toBeNull();
    expect(observabilityConfig({ RAILWAY_GIT_COMMIT_SHA: 'abc123' } as NodeJS.ProcessEnv).release).toBe('abc123');
    expect(
      observabilityConfig({ SENTRY_RELEASE: 'v1', RAILWAY_GIT_COMMIT_SHA: 'abc123' } as NodeJS.ProcessEnv).release,
    ).toBe('v1');
  });
});

describe('scrubEvent', () => {
  it('redacts an email address inside an exception message', () => {
    const event = { exception: { values: [{ value: 'send failed to=person@example.com' }] } };
    expect(scrubEvent(event).exception.values[0].value).toBe('send failed to=[redacted-email]');
  });

  it('redacts a bearer token and a JWT-shaped string in the top-level message', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(scrubEvent({ message: `Bearer sometoken123456789012345678` }).message).toBe('[redacted-token]');
    expect(scrubEvent({ message: jwt }).message).toBe('[redacted-token]');
  });

  it('redacts values under a sensitive-looking key in extra/contexts instead of scanning them for shape', () => {
    const event = {
      extra: { tasteFingerprint: [0.1, 0.2, 0.3], jobId: 'job-1' },
      contexts: { auth: { password: 'hunter2' } },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.extra).toEqual({ tasteFingerprint: '[redacted]', jobId: 'job-1' });
    expect(scrubbed.contexts).toEqual({ auth: { password: '[redacted]' } });
  });

  it('scrubs breadcrumb messages too', () => {
    const event = { breadcrumbs: [{ message: 'mail to person@example.com queued' }] };
    expect(scrubEvent(event).breadcrumbs[0].message).toBe('mail to [redacted-email] queued');
  });
});

describe('initObservability', () => {
  // initObservability() loads the Sentry SDK with a dynamic import, so the
  // first test to enable it would otherwise pay the SDK's cold load inside
  // its own 5s budget -- 7-22s on a loaded machine when the whole suite
  // runs in parallel. Paid here once, under a hook budget sized for it.
  beforeAll(async () => {
    await import('@sentry/node');
  }, 60_000);

  const base = { environment: 'test', serviceName: 'reel-backend', tracesSampleRate: 1, release: null };

  it('starts nothing at all when both are unset', async () => {
    expect(await initObservability({ ...base, sentryDsn: null, otelEndpoint: null })).toEqual({
      sentry: false,
      tracing: false,
    });
  });

  // A DSN the SDK cannot parse must not stop the app it exists to watch.
  it('reports a malformed Sentry DSN and boots anyway', async () => {
    const started = await initObservability({ ...base, sentryDsn: 'not-a-dsn', otelEndpoint: null });

    expect(started).toEqual({ sentry: false, tracing: false });
  });

  // The other half of the same claim: a DSN it *can* parse reports true, so
  // the return value distinguishes the two rather than always saying yes.
  it('reports true for a DSN the SDK can parse', async () => {
    const started = await initObservability({
      ...base,
      sentryDsn: 'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/0',
      otelEndpoint: null,
    });

    expect(started.sentry).toBe(true);
  });

  it('captureException and tagRequestId are no-ops when Sentry never started', async () => {
    resetSentryClientForTests();
    await initObservability({ ...base, sentryDsn: null, otelEndpoint: null });

    // Neither throws nor requires a client; there is nothing else to assert
    // from outside the module without importing @sentry/node's own mock
    // internals, which would test the SDK rather than this wiring.
    expect(() => captureException(new Error('boom'))).not.toThrow();
    expect(() => tagRequestId('req-1')).not.toThrow();
  });

  it('captureException reports through the started client once one exists', async () => {
    const started = await initObservability({
      ...base,
      sentryDsn: 'https://0123456789abcdef0123456789abcdef@o0.ingest.sentry.io/0',
      otelEndpoint: null,
    });
    expect(started.sentry).toBe(true);

    // The module's own `captureException` export is a frozen ESM binding
    // vitest cannot spy on directly; the client instance it delegates to is
    // an ordinary object, so that is what this asserts against.
    const Sentry = await import('@sentry/node');
    const client = Sentry.getClient();
    const spy = vi.spyOn(client!, 'captureException');
    captureException(new Error('boom'), { jobId: 'job-1' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [reportedError, reportedHint] = spy.mock.calls[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedHint).toMatchObject({ captureContext: { tags: { jobId: 'job-1' } } });
    spy.mockRestore();
  });

  // Tracing is deliberately not started here: NodeSDK patches http, pg and
  // dns process-wide, which would leak into every other spec sharing this
  // worker. It is verified by booting the real app instead -- see the
  // observability check in the A-15 commit.
});
