import { Transform } from 'class-transformer';

/**
 * One spelling per address. `users.email` is a plain unique varchar and every
 * lookup (register, login, password reset, grant-admin) matched it byte for
 * byte, so an account created as `Name@Example.com` -- what a phone keyboard
 * produces -- could never log in or reset as `name@example.com`, and the
 * reset route, by design silent about unknown addresses (BP §21.3), gave no
 * hint. Found on kolme.app by the live round of 2026-09-05. Trimmed and
 * lower-cased at the door, before validation, on every DTO that carries an
 * address; the NormalizeUserEmails migration folds the rows that already
 * exist.
 */
export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export const NormalizeEmail = (): PropertyDecorator => Transform(({ value }) => normalizeEmail(value));
