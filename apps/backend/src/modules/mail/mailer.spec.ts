import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { LogMailer, ResendMailer, mailerFor, type ResendLike } from './mailer';

// A ConfigService stand-in: only get() is used, and reading from a plain map
// keeps each case's environment visible in the case itself.
const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('mailerFor', () => {
  const client = () => ({ emails: { send: vi.fn() } }) as unknown as ResendLike;

  it('defaults to the log transport when MAIL_TRANSPORT is unset', () => {
    expect(mailerFor(configOf({}))).toBeInstanceOf(LogMailer);
  });

  it('builds the Resend adapter when asked for it, with the configured sender', () => {
    const mailer = mailerFor(
      configOf({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test_key', MAIL_FROM_ADDRESS: 'noreply@example.com' }),
      () => client(),
    );

    expect(mailer).toBeInstanceOf(ResendMailer);
  });

  it('passes the key to the client builder and nowhere else', () => {
    const build = vi.fn(() => client());

    mailerFor(
      configOf({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test_key', MAIL_FROM_ADDRESS: 'noreply@example.com' }),
      build,
    );

    expect(build).toHaveBeenCalledExactlyOnceWith('re_test_key');
  });

  // Failing at boot is the only way an operator finds out before a user does:
  // a resend transport with no key would otherwise accept a password-reset
  // request, answer 202 as ADR-85 requires, and send nothing forever.
  it.each([
    ['no API key', { MAIL_TRANSPORT: 'resend', MAIL_FROM_ADDRESS: 'noreply@example.com' }, /RESEND_API_KEY/],
    ['no sender address', { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test_key' }, /MAIL_FROM_ADDRESS/],
    ['a blank key', { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: '   ', MAIL_FROM_ADDRESS: 'a@b.c' }, /RESEND_API_KEY/],
  ])('refuses the resend transport with %s', (_case, values, expected) => {
    expect(() => mailerFor(configOf(values), () => client())).toThrow(expected);
  });

  it('still refuses a transport that has no adapter', () => {
    expect(() => mailerFor(configOf({ MAIL_TRANSPORT: 'sendgrid' }))).toThrow(/no adapter/);
  });
});

describe('ResendMailer', () => {
  let send: ReturnType<typeof vi.fn>;
  let mailer: ResendMailer;

  const mail = { to: 'someone@example.com', subject: 'Reset your password', text: 'https://app/reset?token=abc123' };

  beforeEach(() => {
    send = vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null });
    mailer = new ResendMailer({ emails: { send } } as unknown as ResendLike, 'noreply@example.com');
  });

  it('sends the message from the configured address', async () => {
    await mailer.send(mail);

    expect(send).toHaveBeenCalledExactlyOnceWith({
      from: 'noreply@example.com',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  });

  // Resend reports a rejected send in `error` instead of throwing. A caller
  // that only caught exceptions would count every bounce as a delivery.
  it('throws when Resend reports an error rather than treating it as sent', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'domain is not verified' } });

    await expect(mailer.send(mail)).rejects.toThrow(/domain is not verified/);
  });

  it('propagates a transport failure too', async () => {
    send.mockRejectedValue(new Error('socket hang up'));

    await expect(mailer.send(mail)).rejects.toThrow(/socket hang up/);
  });

  // The body of a password-reset mail is a working reset link (ADR-85).
  it('never writes the message body to the log, on success or on failure', async () => {
    const logs: string[] = [];
    const logger = mailer as unknown as { logger: { log: (m: string) => void; error: (m: string) => void } };
    logger.logger = { log: (m) => logs.push(m), error: (m) => logs.push(m) };

    await mailer.send(mail);
    send.mockResolvedValue({ data: null, error: { message: 'rejected' } });
    await mailer.send(mail).catch(() => undefined);

    expect(logs).toHaveLength(2);
    expect(logs.every((line) => !line.includes('token=abc123'))).toBe(true);
    expect(logs.every((line) => line.includes(mail.to))).toBe(true);
  });
});
