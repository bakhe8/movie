import { beforeAll, describe, expect, it } from 'vitest';
import { sign } from 'jsonwebtoken';
import { IdentityThrottlerGuard } from './identity-throttler.guard';

const SECRET = 'test-secret-that-is-long-enough-for-the-guard-1234';

// getTracker is protected; the guard's collaborators are irrelevant to it, so
// the test reaches it directly rather than standing up a whole ThrottlerModule.
type Tracker = { getTracker(req: Record<string, unknown>): Promise<string> };
const guard = () => new IdentityThrottlerGuard(...([] as never[])) as unknown as Tracker;

function withToken(token: string, ip = '10.0.0.1') {
  return { ip, headers: { authorization: `Bearer ${token}` } };
}

describe('IdentityThrottlerGuard', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it('buckets an anonymous request by address', async () => {
    expect(await guard().getTracker({ ip: '10.0.0.1', headers: {} })).toBe('ip:10.0.0.1');
  });

  // The point of ALPHA_PLAN 7.6: two accounts behind one NAT are two buckets.
  it('buckets a signed-in request by user, not by address', async () => {
    const one = sign({ sub: 'user-1', email: 'a@example.com' }, SECRET);
    const two = sign({ sub: 'user-2', email: 'b@example.com' }, SECRET);

    expect(await guard().getTracker(withToken(one))).toBe('user:user-1');
    expect(await guard().getTracker(withToken(two))).toBe('user:user-2');
  });

  it('follows the same user across a change of address', async () => {
    const token = sign({ sub: 'user-1', email: 'a@example.com' }, SECRET);

    expect(await guard().getTracker(withToken(token, '10.0.0.1'))).toBe(
      await guard().getTracker(withToken(token, '203.0.113.9')),
    );
  });

  // Without verification a caller could mint a fresh `sub` per request and
  // never be limited at all -- the tracker must not trust an unsigned token.
  it('ignores a token signed with another key and falls back to the address', async () => {
    const forged = sign({ sub: 'whoever-i-like' }, 'not-the-app-secret');

    expect(await guard().getTracker(withToken(forged))).toBe('ip:10.0.0.1');
  });

  it('ignores an expired token and falls back to the address', async () => {
    const expired = sign({ sub: 'user-1' }, SECRET, { expiresIn: -60 });

    expect(await guard().getTracker(withToken(expired))).toBe('ip:10.0.0.1');
  });

  it.each(['Bearer', 'Bearer not.a.jwt', 'Basic dXNlcjpwYXNz', ''])(
    'falls back to the address for header %j',
    async (header) => {
      expect(await guard().getTracker({ ip: '10.0.0.1', headers: { authorization: header } })).toBe('ip:10.0.0.1');
    },
  );

  it('never returns an empty tracker when the address is unknown', async () => {
    expect(await guard().getTracker({ headers: {} })).toBe('ip:unknown');
  });
});
