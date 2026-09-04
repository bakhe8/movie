import { Logger } from '@nestjs/common';

// ALPHA_PLAN 7.5's tracing and error reporting. Both are off unless their
// endpoint/DSN is set, and neither package is a dependency of this repo yet:
// hosting is still undecided (ADR-24), and a tracing SDK that ships in every
// install to do nothing is cost with no reader. They are therefore loaded
// through a runtime import of a name TypeScript cannot resolve at build
// time, so the app builds and runs with them absent -- and says plainly what
// to install if the flag is on and they are.
//
//   npm i @sentry/node                 # SENTRY_DSN
//   npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
//         @opentelemetry/exporter-trace-otlp-http   # OTEL_EXPORTER_OTLP_ENDPOINT
//
// Called from main.ts before the Nest app is created: instrumentation has to
// patch the HTTP and pg modules before anything requires them.

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
    // default is explicit rather than hidden inside an SDK.
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1,
  };
}

// Kept in a variable so TypeScript treats it as a runtime module name it
// cannot resolve, rather than a missing dependency at build time.
async function optionalImport(name: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function startSentry(config: ObservabilityConfig): Promise<boolean> {
  const sentry = await optionalImport('@sentry/node');
  if (!sentry) {
    logger.error('SENTRY_DSN is set but @sentry/node is not installed; run `npm i @sentry/node`. Continuing without it.');
    return false;
  }
  (sentry.init as (options: Record<string, unknown>) => void)({
    dsn: config.sentryDsn,
    environment: config.environment,
    tracesSampleRate: config.tracesSampleRate,
    // PRIVACY.md §3: an error report is not a place to collect anything about
    // a person. No request bodies, no headers, no IP.
    sendDefaultPii: false,
  });
  logger.log(`Sentry enabled for environment ${config.environment}`);
  return true;
}

async function startTracing(config: ObservabilityConfig): Promise<boolean> {
  const sdk = await optionalImport('@opentelemetry/sdk-node');
  const instrumentations = await optionalImport('@opentelemetry/auto-instrumentations-node');
  const exporter = await optionalImport('@opentelemetry/exporter-trace-otlp-http');
  if (!sdk || !instrumentations || !exporter) {
    logger.error(
      'OTEL_EXPORTER_OTLP_ENDPOINT is set but the OpenTelemetry packages are not installed; ' +
        'run `npm i @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http`. ' +
        'Continuing without tracing.',
    );
    return false;
  }
  const NodeSDK = sdk.NodeSDK as new (options: Record<string, unknown>) => { start(): void };
  const OTLPTraceExporter = exporter.OTLPTraceExporter as new (options: Record<string, unknown>) => unknown;
  const getNodeAutoInstrumentations = instrumentations.getNodeAutoInstrumentations as () => unknown;

  new NodeSDK({
    serviceName: config.serviceName,
    traceExporter: new OTLPTraceExporter({ url: config.otelEndpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
  }).start();
  logger.log(`OpenTelemetry tracing enabled, exporting to ${config.otelEndpoint}`);
  return true;
}

// Returns what actually started, so main.ts can log it and a test can assert
// that "unset" really means "nothing ran".
export async function initObservability(
  config: ObservabilityConfig = observabilityConfig(),
): Promise<{ sentry: boolean; tracing: boolean }> {
  // Never fatal: a monitoring backend that is down or misconfigured must not
  // stop the app it was meant to watch.
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
