import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
// A distinct HKDF label makes this an independent subkey of JWT_SECRET: a
// leak of one never yields the other, and no second secret has to be
// provisioned and rotated.
const HKDF_INFO = 'mail-outbox-body-v1';

// Seals a mail body for the outbox row (ADR-97). A password-reset mail is a
// live credential until its link expires, and ADR-85 promises that a
// database read alone never yields one; so the body rests only sealed, and
// only while the row is pending. Layout: iv || auth tag || ciphertext.
export class MailBodyCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_BYTES) {
      throw new Error(`MailBodyCipher needs a ${KEY_BYTES}-byte key, got ${key.length}`);
    }
  }

  static fromSecret(secret: string): MailBodyCipher {
    return new MailBodyCipher(Buffer.from(hkdfSync('sha256', secret, '', HKDF_INFO, KEY_BYTES)));
  }

  seal(text: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  // Throws on a wrong key, a truncated buffer or any tampering: GCM's tag
  // check fails closed, so a garbled body can never be sent.
  open(sealed: Buffer): string {
    if (sealed.length < IV_BYTES + TAG_BYTES) {
      throw new Error('sealed body is too short');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, sealed.subarray(0, IV_BYTES));
    decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }
}
