/**
 * Post-deploy canary (P0-6, ADR-107). Drives the whole first-run journey
 * against a deployed API and fails loudly when a person could not reach a
 * recommendation:
 *
 *   API_BASE_URL=https://api.kolme.app CANARY_PASSWORD=... npm run canary
 *   ... npm run canary -- --accounts 20
 *
 * Runs as its own Railway Cron service (`canary`, every six hours) from the
 * backend image, never as a pre-deploy step: a deploy gate belongs to the
 * health check, and a journey that takes minutes and writes rows must not
 * stand between a fix and production.
 *
 * `--accounts N` walks N numbered canary accounts in sequence
 * (canary@kolme.app, canary+2@kolme.app, ...). Twenty of them in one run is
 * the readiness evidence the owner asked for instead of a separate Alpha
 * environment -- each account must already exist, created once through the
 * normal sign-up screen with the same CANARY_PASSWORD.
 *
 * Exit code 1 on any failed journey, so Railway's Cron failure notification
 * fires; the same failure is sent to Sentry when a DSN is configured.
 */
import { initObservability, captureException } from '../observability/observability';
import { CanaryFailure, canarySettingsFrom, runCanary } from './canary.lib';

async function main(): Promise<void> {
  const settings = canarySettingsFrom(process.env, process.argv.slice(2));
  await initObservability();

  const result = await runCanary(settings, {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => console.log(line),
  });

  console.log(`canary: ${result.reports.length} journey(s) passed, ${result.failures.length} failed against ${settings.baseUrl}`);
  if (result.failures.length === 0) {
    return;
  }
  for (const { email, error } of result.failures) {
    // Tags only, never the message: they are what a person filters Sentry by
    // (observability.captureException's own contract).
    captureException(error, {
      canary: 'journey',
      canaryStep: error instanceof CanaryFailure ? error.step : 'unknown',
      canaryAccount: email,
    });
    console.error(`canary ${email}: ${error.message}`);
    if (error instanceof CanaryFailure && error.detail !== undefined) {
      console.error(`  the API said: ${JSON.stringify(error.detail).slice(0, 1000)}`);
    }
  }
  process.exitCode = 1;
}

main().catch((error) => {
  // A failure before any journey started (missing configuration, or the
  // observability init itself): still a canary failure, still non-zero.
  captureException(error, { canary: 'startup' });
  console.error(error);
  process.exit(1);
});
