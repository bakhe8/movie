type EventShape = {
  breadcrumbs?: Array<Record<string, unknown>>;
  contexts?: Record<string, unknown>;
  exception?: {
    values?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  extra?: Record<string, unknown>;
  message?: string;
  request?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  user?: unknown;
  [key: string]: unknown;
};

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_PATTERN = /\b(?:[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+\S+|re_[A-Za-z0-9]{10,})\b/g;
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|email|password|secret|token|api.?key|user.?id|session|embedding|vector|taste|fingerprint/i;
const URL_KEY_PATTERN = /url|href/i;

function stripUrlDetails(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function scrubText(value: string): string {
  return value
    .replace(ABSOLUTE_URL_PATTERN, stripUrlDetails)
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(TOKEN_PATTERN, "[redacted-token]");
}

function scrubValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (depth > 8) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return URL_KEY_PATTERN.test(key) ? stripUrlDetails(value) : scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, "", depth + 1));
  }
  if (value && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      scrubbed[nestedKey] = scrubValue(nestedValue, nestedKey, depth + 1);
    }
    return scrubbed;
  }
  return value;
}

function safeRequest(request: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (typeof request.method === "string") {
    result.method = request.method;
  }
  if (typeof request.url === "string") {
    result.url = stripUrlDetails(request.url);
  }
  return result;
}

export function scrubSentryEvent<T extends object>(event: T): T {
  const source = event as EventShape;
  const scrubbed: EventShape = { ...source };

  // Error reports identify a failing route and release, not a person. Drop
  // the user block and reduce request data to method plus a query-free URL.
  delete scrubbed.user;
  if (source.request) {
    scrubbed.request = safeRequest(source.request);
  }
  if (typeof source.message === "string") {
    scrubbed.message = scrubText(source.message);
  }
  if (typeof source.transaction === "string") {
    scrubbed.transaction = scrubText(source.transaction);
  }
  if (source.exception?.values) {
    scrubbed.exception = {
      ...source.exception,
      values: source.exception.values.map((entry) => ({
        ...entry,
        value: typeof entry.value === "string" ? scrubText(entry.value) : entry.value,
      })),
    };
  }
  if (source.extra) {
    scrubbed.extra = scrubValue(source.extra) as Record<string, unknown>;
  }
  if (source.contexts) {
    scrubbed.contexts = scrubValue(source.contexts) as Record<string, unknown>;
  }
  if (source.tags) {
    scrubbed.tags = scrubValue(source.tags) as Record<string, unknown>;
  }
  if (source.breadcrumbs) {
    scrubbed.breadcrumbs = source.breadcrumbs.map((breadcrumb) => scrubValue(breadcrumb) as Record<string, unknown>);
  }

  return scrubbed as T;
}
