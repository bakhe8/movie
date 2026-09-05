import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./sentry/privacy";

const dsn = (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)?.trim();

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
  sampleRate: 1,
  tracesSampleRate: 0,
  enableLogs: false,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});
