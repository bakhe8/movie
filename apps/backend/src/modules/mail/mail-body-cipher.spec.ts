import { describe, expect, it } from 'vitest';
import { MailBodyCipher } from './mail-body-cipher';

const SECRET = 'a-secret-long-enough-for-hkdf-derivation-0123456789';

describe('MailBodyCipher', () => {
  const body = 'افتح الرابط لتعيين كلمة مرور جديدة:\nhttps://app/reset-password?token=abc123';

  it('round-trips a body, including Arabic text', () => {
    const cipher = MailBodyCipher.fromSecret(SECRET);

    expect(cipher.open(cipher.seal(body))).toBe(body);
  });

  it('never stores the plaintext and never repeats a ciphertext', () => {
    const cipher = MailBodyCipher.fromSecret(SECRET);
    const first = cipher.seal(body);
    const second = cipher.seal(body);

    expect(first.toString('latin1')).not.toContain('token=abc123');
    expect(first.equals(second)).toBe(false);
  });

  // A rotated JWT_SECRET must fail closed rather than yield garbage to send.
  it('refuses a body sealed under a different secret', () => {
    const sealed = MailBodyCipher.fromSecret(SECRET).seal(body);

    expect(() => MailBodyCipher.fromSecret(`${SECRET}-rotated`).open(sealed)).toThrow();
  });

  it('refuses a tampered or truncated body', () => {
    const cipher = MailBodyCipher.fromSecret(SECRET);
    const sealed = cipher.seal(body);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0x01;

    expect(() => cipher.open(tampered)).toThrow();
    expect(() => cipher.open(sealed.subarray(0, 10))).toThrow(/too short/);
  });

  it('derives the same key from the same secret', () => {
    const sealed = MailBodyCipher.fromSecret(SECRET).seal(body);

    expect(MailBodyCipher.fromSecret(SECRET).open(sealed)).toBe(body);
  });
});
