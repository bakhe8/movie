import { deployedEnvironment } from './database.config';

const LOCAL_FRONTEND = 'http://localhost:3000';

// The browser origin allowed to call the API. Local development falls back
// to the Next dev server; a deployed process must name its frontend, because
// the fallback there fails closed -- every browser request from the real
// site would be refused by CORS with nothing in the logs naming the cause
// (AUDIT_2026-09-05 §4). Same boot-time posture as JWT_SECRET's guard.
export function corsOrigin(): string {
  const configured = process.env.FRONTEND_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const deployed = deployedEnvironment();
  if (deployed) {
    throw new Error(
      `Refusing to start: ${deployed} but FRONTEND_URL is unset, so CORS would only ever allow ${LOCAL_FRONTEND}. ` +
        "Set FRONTEND_URL to the site's public origin (https://kolme.app, or the staging host).",
    );
  }
  return LOCAL_FRONTEND;
}
