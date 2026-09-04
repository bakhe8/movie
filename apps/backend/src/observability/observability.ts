import { Logger } from '@nestjs/common';

// ALPHA_PLAN 7.5's tracing and error reporting. Both are off unless their
// endpoint/DSN is set; nothing is enabled by default in any environment.
//
// The SDKs are dependencies now that hosting is settled (ADR-88, Railway) --
// they were deliberately absent while it was open (ADR-86) -- but they are
// still loaded with a dynamic import inside the enable branch rather than at
// module scope. A tracing SDK that patches http, pg and dns is not something
// to load into a process that has been told not to trace.
//
// Called from main.ts before the Nest app is created: the instrumentation has
// to patch those modules before anything requires them.

const logger = new Logger('Observability');

export interface ObservabilityConfig {
  sentryDsn: string | null;
  otelEndpoint: string | null;
  environment: string;
  serviceName: string;
  tracesSampleRate: number;
}

export function observabilityConfig(env: NodeJS.ProcessEnv = process.env): ObservabilityConfig {
  const rate = Number(env.OTEL_TRACES_SAMPLE_RATE);
  return {
    sentryDsn: env.SENTRY_DSN?.trim() || null,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null,
    environment: env.NODE_ENV?.trim() || 'development',
    serviceName: env.OTEL_SERVICE_NAME?.trim() || 'reel-backend',
    // Sampling everything is right for a small alpha and wrong later; the
    // default is explicit here rather than left to an SDK's own.
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1,
  };
}

async function startSentry(config: ObservabilityConfig): Promise<boolean> {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: config.sentryDsn ?? undefined,
    environment: config.environment,
    tracesSampleRate: config.tracesSampleRate,
    // PRIVACY.md §3: an error report is not a place to collect anything about
    // a person. No request bodies, no headers, no IP address.
    sendDefaultPii: false,
  });
  // init() does not throw on a DSN it cannot parse: it prints "Invalid Sentry
  // Dsn" and still builds a client, whose getDsn() is then undefined and which
  // will never send anything. Reporting `true` there would claim error
  // reporting is on when it is silently off -- exactly the failure a
  // monitoring setup must not have -- so the parsed DSN is what we check.
  if (!Sentry.getClient()?.getDsn()) {
    logger.error('Sentry did not start: the DSN could not be parsed. Error reporting is OFF.');
    return false;
  }
  logger.log(`Sentry enabled for environment ${config.environment}`);
  return true;
}

async function startTracing(config: ObservabilityConfig): Promise<boolean> {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

  new NodeSDK({
    serviceName: config.serviceName,
    traceExporter: new OTLPTraceExporter({ url: config.otelEndpoint ?? undefined }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // The filesystem instrumentation spans every read the process makes,
        // which drowns the request traces this exists to show.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  }).start();
  logger.log(`OpenTelemetry tracing enabled, exporting to ${config.otelEndpoint}`);
  return true;
}

// Returns what actually started, so main.ts can log it and a test can assert
// that "unset" really means "nothing ran".
export async function initObservability(
  config: ObservabilityConfig = observabilityConfig(),
): Promise<{ sentry: boolean; tracing: boolean }> {
  // Never fatal: a monitoring backend that is down, misconfigured, or given a
  // malformed DSN must not stop the app it was meant to watch. The exporter
  // itself is already fire-and-forget -- a dead collector costs retries in
  // the background, not requests.
  const sentry = config.sentryDsn ? await startSentry(config).catch(reportAndDisable('Sentry')) : false;
  const tracing = config.otelEndpoint ? await startTracing(config).catch(reportAndDisable('tracing')) : false;
  return { sentry, tracing };
}

function reportAndDisable(what: string): (error: unknown) => false {
  return (error) => {
    logger.error(`${what} failed to start: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  };
}
