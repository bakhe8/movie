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
  release: string | null;
}

export function observabilityConfig(env: NodeJS.ProcessEnv = process.env): ObservabilityConfig {
  const rate = Number(env.OTEL_TRACES_SAMPLE_RATE);
  return {
    sentryDsn: env.SENTRY_DSN?.trim() || null,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || null,
    // Railway's environment name is the deployment classification. NODE_ENV
    // can be overridden independently by the runtime/build setup and must not
    // make production incidents appear under development in Sentry.
    environment:
      env.SENTRY_ENVIRONMENT?.trim() ||
      env.RAILWAY_ENVIRONMENT_NAME?.trim() ||
      env.NODE_ENV?.trim() ||
      'development',
    serviceName: env.OTEL_SERVICE_NAME?.trim() || 'reel-backend',
    // Sampling everything is right for a small alpha and wrong later; the
    // default is explicit here rather than left to an SDK's own.
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1,
    // Railway sets RAILWAY_GIT_COMMIT_SHA on every deploy (no config needed);
    // SENTRY_RELEASE overrides it for any other host. Unset in local dev,
    // where "which commit" is not a question Sentry needs to answer.
    release: env.SENTRY_RELEASE?.trim() || env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
  };
}

// P0-3: an error report exists to be read, so its message must survive
// scrubbing -- but PRIVACY.md §3 still applies to whatever the app happened
// to interpolate into that message (a caught mailer error carries the
// address it tried; a caught auth error can carry the bearer it rejected).
// Structural fields (event.user, request headers/IP) are already off via
// sendDefaultPii: false; this covers what free-text message strings and
// `extra` payloads can still leak.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_PATTERN = /\b(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+\S+|re_[A-Za-z0-9]{10,})\b/g;
const SENSITIVE_KEY_PATTERN = /token|password|secret|authorization|embedding|vector|taste|fingerprint/i;

function scrubText(value: string): string {
  return value.replace(EMAIL_PATTERN, '[redacted-email]').replace(TOKEN_PATTERN, '[redacted-token]');
}

// Walks `extra`/`contexts`-shaped objects: replaces values under a
// sensitive-looking key outright (a taste fingerprint is many numbers with
// no email/token shape to pattern-match) and scrubs every string it leaves
// in place. Bounded depth so a cyclic or pathological payload cannot hang
// the reporter that exists to survive failures, not cause one.
function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) {
    return value;
  }
  if (typeof value === 'string') {
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : scrubValue(item, depth + 1);
    }
    return result;
  }
  return value;
}

// Minimal shape of the Sentry event fields this touches -- not the SDK's own
// Event type, so this file still never imports @sentry/node at module scope.
interface ScrubbableEvent extends Record<string, unknown> {
  exception?: { values?: Array<{ value?: string; [key: string]: unknown }> };
  message?: string;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Array<{ message?: string; [key: string]: unknown }>;
}

// Exported so the same pass can be asserted directly in tests without
// constructing a full Sentry event envelope.
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const scrubbed: ScrubbableEvent = { ...event };
  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((entry) => ({
        ...entry,
        value: typeof entry.value === 'string' ? scrubText(entry.value) : entry.value,
      })),
    };
  }
  if (typeof scrubbed.message === 'string') {
    scrubbed.message = scrubText(scrubbed.message);
  }
  if (scrubbed.extra) {
    scrubbed.extra = scrubValue(scrubbed.extra) as Record<string, unknown>;
  }
  if (scrubbed.contexts) {
    scrubbed.contexts = scrubValue(scrubbed.contexts) as Record<string, unknown>;
  }
  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: typeof crumb.message === 'string' ? scrubText(crumb.message) : crumb.message,
    }));
  }
  return scrubbed as T;
}

// Set once Sentry actually starts, so `captureException` elsewhere in the app
// can report through the same client without every call site doing its own
// dynamic import (already cached after the first one, here, by Node) or its
// own "did it actually start" check.
let sentryClient: typeof import('@sentry/node') | null = null;

async function startSentry(config: ObservabilityConfig): Promise<boolean> {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: config.sentryDsn ?? undefined,
    environment: config.environment,
    release: config.release ?? undefined,
    tracesSampleRate: config.tracesSampleRate,
    // PRIVACY.md §3: an error report is not a place to collect anything about
    // a person. No request bodies, no headers, no IP address.
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
    beforeSendTransaction: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
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
  sentryClient = Sentry;
  logger.log(`Sentry enabled for environment ${config.environment}${config.release ? ` (release ${config.release})` : ''}`);
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

// The call sites this exists for are catch blocks that already decided the
// error is non-fatal and log a `.warn`/`.error` line -- this is the same
// error, reported to Sentry too, not a replacement for that log line. A
// no-op (not a throw) when Sentry never started, so every call site stays
// correct in dev and in tests with no DSN set.
//
// `tags` is for small, bounded identifiers a person would filter Sentry by
// -- a request id, a job id, a profile id -- never free text or anything
// listed in SENSITIVE_KEY_PATTERN above; beforeSend scrubs known-sensitive
// keys regardless, but a caller should not rely on that as its only guard.
export function captureException(error: unknown, tags?: Record<string, string>): void {
  if (!sentryClient?.getClient()?.getDsn()) {
    return;
  }
  sentryClient.captureException(error, tags ? { tags } : undefined);
}

// Sentry's Node SDK gives every incoming HTTP request its own isolated scope
// (httpIntegration, on by default since v8) purely from calling Sentry.init
// before the server starts listening -- which main.ts already does, before
// Nest/Express exist. Tagging "the current scope" from request-id.middleware
// therefore tags only this request's later captures, with no manual
// AsyncLocalStorage plumbing of our own.
export function tagRequestId(requestId: string): void {
  if (!sentryClient?.getClient()?.getDsn()) {
    return;
  }
  sentryClient.getCurrentScope().setTag('requestId', requestId);
}

// Test-only: observability.spec.ts starts real Sentry clients that this
// module's module-scope `sentryClient` would otherwise leak between tests.
export function resetSentryClientForTests(): void {
  sentryClient = null;
}
