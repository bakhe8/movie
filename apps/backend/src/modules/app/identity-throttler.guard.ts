import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { verify } from 'jsonwebtoken';
import { getJwtSecret } from '../../config/jwt.config';

// ALPHA_PLAN 7.6: the app-wide limit was per IP only, which is wrong in both
// directions -- a household, campus or carrier NAT shares one bucket between
// unrelated users, while one account rotating addresses gets a fresh bucket
// each time. So: per user when the request carries a valid access token, per
// IP otherwise (`main.ts` already resolves the real client address through
// one proxy hop).
//
// The token is verified here rather than read from `req.user`: this is a
// global APP_GUARD and Nest runs it *before* the route's JwtAuthGuard, so
// `req.user` is not populated yet. Decoding without verifying would be worse
// than no limit at all -- a caller could put a different random `sub` in an
// unsigned token on every request and never be counted.
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const userId = this.userIdFrom(req);
    // Namespaced so a user id can never collide with an address.
    return userId ? `user:${userId}` : `ip:${String(req.ip ?? 'unknown')}`;
  }

  private userIdFrom(req: Record<string, unknown>): string | null {
    const headers = req.headers as Record<string, string | string[] | undefined> | undefined;
    const authorization = headers?.authorization;
    const header = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    try {
      const payload = verify(header.slice('Bearer '.length), getJwtSecret());
      const sub = typeof payload === 'string' ? null : payload.sub;
      return typeof sub === 'string' && sub.length > 0 ? sub : null;
    } catch {
      // Expired, forged or malformed: fall back to the IP bucket. A caller
      // cannot escape a limit by sending a token the app rejects anyway.
      return null;
    }
  }
}
