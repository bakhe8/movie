import { describe, expect, it, vi } from 'vitest';
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
  const base = { environment: 'test', serviceName: 'reel-backend', tracesSampleRate: 1 };

  it('starts nothing at all when both are unset', async () => {
    expect(await initObservability({ ...base, sentryDsn: null, otelEndpoint: null })).toEqual({
      sentry: false,
      tracing: false,
    });
  });

  // The packages are deliberately not dependencies of this repo yet (hosting
  // is undecided, ADR-24). Turning a flag on without installing them must
  // leave a clear message and a running app, not a crash at boot.
  it('reports a missing package and boots anyway', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const started = await initObservability({
      ...base,
      sentryDsn: 'https://key@sentry.example/1',
      otelEndpoint: 'http://collector:4318/v1/traces',
    });

    expect(started).toEqual({ sentry: false, tracing: false });
    error.mockRestore();
  });
});
