import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { LogMailer, SmtpMailer, mailerFor, type SmtpOptions, type SmtpTransportLike } from './mailer';

// A ConfigService stand-in: only get() is used, and reading from a plain map
// keeps each case's environment visible in the case itself.
const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const smtpEnv = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com', MAIL_FROM_ADDRESS: 'noreply@example.com' };

describe('mailerFor', () => {
  const transport = () => ({ sendMail: vi.fn() }) as unknown as SmtpTransportLike;

  it('defaults to the log transport when MAIL_TRANSPORT is unset', () => {
    expect(mailerFor(configOf({}))).toBeInstanceOf(LogMailer);
  });

  it('builds the SMTP adapter when asked for it', () => {
    expect(mailerFor(configOf(smtpEnv), () => transport())).toBeInstanceOf(SmtpMailer);
  });

  // The credential reaches the transport builder and nothing else; the port
  // decides between STARTTLS (587, the default) and implicit TLS (465).
  it.each<[string, Record<string, string>, SmtpOptions]>([
    ['no credentials, default port', {}, { host: 'smtp.example.com', port: 587, secure: false, auth: undefined }],
    [
      'credentials on 587',
      { SMTP_USER: 'resend', SMTP_PASSWORD: 're_test_key' },
      { host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'resend', pass: 're_test_key' } },
    ],
    [
      'credentials on 465',
      { SMTP_PORT: '465', SMTP_USER: 'resend', SMTP_PASSWORD: 're_test_key' },
      { host: 'smtp.example.com', port: 465, secure: true, auth: { user: 'resend', pass: 're_test_key' } },
    ],
    ['a custom clear-text port', { SMTP_PORT: ' 2525 ' }, { host: 'smtp.example.com', port: 2525, secure: false, auth: undefined }],
  ])('hands the transport builder the parsed options with %s', (_case, extra, expected) => {
    const build = vi.fn(() => transport());

    mailerFor(configOf({ ...smtpEnv, ...extra }), build);

    expect(build).toHaveBeenCalledExactlyOnceWith(expected);
  });

  // Failing at boot is the only way an operator finds out before a user does:
  // an smtp transport with no server would otherwise accept a password-reset
  // request, answer 202 as ADR-85 requires, and send nothing forever.
  it.each([
    ['no host', { MAIL_TRANSPORT: 'smtp', MAIL_FROM_ADDRESS: 'noreply@example.com' }, /SMTP_HOST/],
    ['a blank host', { ...smtpEnv, SMTP_HOST: '   ' }, /SMTP_HOST/],
    ['no sender address', { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com' }, /MAIL_FROM_ADDRESS/],
    ['a user but no password', { ...smtpEnv, SMTP_USER: 'resend' }, /SMTP_USER and SMTP_PASSWORD together/],
    ['a password but no user', { ...smtpEnv, SMTP_PASSWORD: 're_test_key' }, /SMTP_USER and SMTP_PASSWORD together/],
    ['a port that is not a number', { ...smtpEnv, SMTP_PORT: 'submission' }, /SMTP_PORT/],
    ['a port out of range', { ...smtpEnv, SMTP_PORT: '70000' }, /SMTP_PORT/],
  ])('refuses the smtp transport with %s', (_case, values, expected) => {
    expect(() => mailerFor(configOf(values), () => transport())).toThrow(expected);
  });

  // The vendor SDK is gone (ADR-95); the old transport name must fail loudly
  // rather than silently fall back to logging.
  it.each(['resend', 'sendgrid'])("refuses the '%s' transport, which has no adapter", (name) => {
    expect(() => mailerFor(configOf({ MAIL_TRANSPORT: name }))).toThrow(/no adapter/);
  });
});

describe('SmtpMailer', () => {
  let sendMail: ReturnType<typeof vi.fn>;
  let mailer: SmtpMailer;

  const mail = { to: 'someone@example.com', subject: 'Reset your password', text: 'https://app/reset?token=abc123' };

  beforeEach(() => {
    sendMail = vi.fn().mockResolvedValue({ messageId: '<msg-1@example.com>', accepted: [mail.to], rejected: [] });
    mailer = new SmtpMailer({ sendMail } as unknown as SmtpTransportLike, 'noreply@example.com');
  });

  it('sends the message from the configured address', async () => {
    await mailer.send(mail);

    expect(sendMail).toHaveBeenCalledExactlyOnceWith({
      from: 'noreply@example.com',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  });

  // A server can accept the session and still refuse the recipient; nodemailer
  // then resolves rather than throws. A caller that only caught exceptions
  // would count every such refusal as a delivery.
  it('throws when the server rejected the recipient rather than treating it as sent', async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: [mail.to] });

    await expect(mailer.send(mail)).rejects.toThrow(/rejected the message for someone@example.com/);
  });

  it('reads an object-shaped rejected recipient too', async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: [{ address: mail.to }] });

    await expect(mailer.send(mail)).rejects.toThrow(/someone@example.com/);
  });

  it('throws when nothing was accepted even with nothing listed as rejected', async () => {
    sendMail.mockResolvedValue({ accepted: [], rejected: [] });

    await expect(mailer.send(mail)).rejects.toThrow(/rejected the message/);
  });

  it('propagates a transport failure too', async () => {
    sendMail.mockRejectedValue(new Error('socket hang up'));

    await expect(mailer.send(mail)).rejects.toThrow(/socket hang up/);
  });

  // The body of a password-reset mail is a working reset link (ADR-85).
  it('never writes the message body to the log, on success or on failure', async () => {
    const logs: string[] = [];
    const logger = mailer as unknown as { logger: { log: (m: string) => void; error: (m: string) => void } };
    logger.logger = { log: (m) => logs.push(m), error: (m) => logs.push(m) };

    await mailer.send(mail);
    sendMail.mockResolvedValue({ accepted: [], rejected: [mail.to] });
    await mailer.send(mail).catch(() => undefined);

    expect(logs).toHaveLength(2);
    expect(logs.every((line) => !line.includes('token=abc123'))).toBe(true);
    expect(logs.every((line) => line.includes(mail.to))).toBe(true);
  });
});
