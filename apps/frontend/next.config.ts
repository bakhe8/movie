import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Dev proxy: with NEXT_PUBLIC_API_URL=/api (apps/frontend/.env.local) the
// browser calls this server's own origin and Next forwards to the backend,
// so a phone on the LAN (http://<machine-ip>:3000) reaches the API without
// the backend having to know that origin (its CORS stays localhost-only).
// Without that variable the frontend keeps calling the backend directly.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || "http://localhost:3101";

// Next 16 blocks its dev resources (chunks, HMR) for any origin but localhost;
// a phone on the LAN needs the machine's address listed here. Comma-separated
// DEV_ORIGINS overrides the default.
const DEV_ORIGINS = (process.env.DEV_ORIGINS || "192.168.1.12").split(",").map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: DEV_ORIGINS,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` }];
  },
};

const sentryAuthEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN?.trim());
const sentryRelease = process.env.SENTRY_RELEASE?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || undefined;

export default withSentryConfig(nextConfig, {
  org: "kolme",
  project: "kolme-frontend",
  telemetry: false,
  silent: true,
  sourcemaps: {
    // Runtime error collection does not need a build token. Source-map upload
    // turns on automatically if a scoped SENTRY_AUTH_TOKEN is added later.
    disable: !sentryAuthEnabled,
  },
  release: {
    name: sentryRelease,
    create: sentryAuthEnabled,
    finalize: sentryAuthEnabled,
  },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
});
