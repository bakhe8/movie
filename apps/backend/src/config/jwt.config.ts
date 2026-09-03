// The value shipped in .env.example. Accepting it in production would mean
// every deployment that forgot to set a secret shares one (audit L5).
const EXAMPLE_SECRET = 'your_jwt_secret_key_change_in_production';
const MIN_SECRET_LENGTH = 32;

let warned = false;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required. Set it in your .env file before starting the app.',
    );
  }
  const weak = secret === EXAMPLE_SECRET || secret.length < MIN_SECRET_LENGTH;
  if (weak) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `JWT_SECRET must be a random value of at least ${MIN_SECRET_LENGTH} characters in production (not the .env.example placeholder).`,
      );
    }
    if (!warned) {
      warned = true;
      console.warn(
        `[jwt] JWT_SECRET is the .env.example placeholder or shorter than ${MIN_SECRET_LENGTH} characters; tolerated outside production only.`,
      );
    }
  }
  return secret;
}

// Access tokens are short-lived now that refresh tokens exist (ADR-26);
// the string is whatever `jsonwebtoken` accepts ('15m', '1h', '7d').
export function getAccessTokenTtl(): string {
  return process.env.JWT_ACCESS_TTL?.trim() || '15m';
}

export function getRefreshTokenTtlDays(): number {
  const value = Number(process.env.JWT_REFRESH_TTL_DAYS);
  return Number.isInteger(value) && value > 0 ? value : 30;
}
