/**
 * Which addresses belong to the post-deploy canary (ADR-107).
 *
 * The canary walks the whole first-run journey against the live API every
 * six hours, so it produces exactly the same rows a real user does: watch
 * events, triads, rankings, a trained snapshot. Those rows are honest for
 * the canary's own purpose and poison for every other one -- a synthetic
 * taste in the pooled retrain, a synthetic funnel in the analytics table.
 * `users.isCanary` is the single flag that keeps them out, and this file is
 * the single place that decides which account carries it, so the rule lives
 * in one spot instead of being re-spelled at each reader.
 *
 * The addresses are a closed, product-owned shape rather than configuration:
 * `canary@kolme.app` for the single journey, `canary+2@kolme.app` ... for
 * the numbered ones `--accounts N` drives. The flag is stamped at
 * registration (AuthService.register), so an account created later is
 * excluded from the moment it exists -- which an "exclude by email at read
 * time" rule would have had to re-derive at every reader instead.
 */
export const CANARY_EMAIL_DOMAIN = 'kolme.app';
export const CANARY_EMAIL_LOCAL_PART = 'canary';

// `canary@kolme.app` and `canary+<n>@kolme.app`, lower-case only: every
// address reaching the database has passed normalizeEmail() (see ./email).
// One pattern string, used as a JS regex here and as the POSIX regex of the
// backfill migration, so the two cannot drift apart unnoticed.
export const CANARY_EMAIL_PATTERN_SOURCE =
  '^' + CANARY_EMAIL_LOCAL_PART + '([+][1-9][0-9]*)?@' + CANARY_EMAIL_DOMAIN.split('.').join('[.]') + '$';

const CANARY_EMAIL_PATTERN = new RegExp(CANARY_EMAIL_PATTERN_SOURCE);

export function isCanaryEmail(email: string): boolean {
  return CANARY_EMAIL_PATTERN.test(email.trim().toLowerCase());
}

// The address for journey `index` (1-based): the first canary is the plain
// address, so a single-journey run needs no plus-addressing at all.
export function canaryEmailFor(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`canary account index must be a positive integer, got ${index}`);
  }
  const localPart = index === 1 ? CANARY_EMAIL_LOCAL_PART : `${CANARY_EMAIL_LOCAL_PART}+${index}`;
  return `${localPart}@${CANARY_EMAIL_DOMAIN}`;
}
