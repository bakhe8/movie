import { beforeAll, describe, expect, it } from 'vitest';
import { initObservability, observabilityConfig } from './observability';

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
});

describe('initObservability', () => {
  // initObservability() loads the Sentry SDK with a dynamic import, so the
  // first test to enable it would otherwise pay the SDK's cold load inside
  // its own 5s budget -- 7-22s on a loaded machine when the whole suite
  // runs in parallel. Paid here once, under a hook budget sized for it.
  beforeAll(async () => {
    await import('@sentry/node');
  }, 60_000);

  const base = { environment: 'test', serviceName: 'reel-backend', tracesSampleRate: 1 };

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

  // Tracing is deliberately not started here: NodeSDK patches http, pg and
  // dns process-wide, which would leak into every other spec sharing this
  // worker. It is verified by booting the real app instead -- see the
  // observability check in the A-15 commit.
});
