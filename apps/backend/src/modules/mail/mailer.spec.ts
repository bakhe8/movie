import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  LogMailer,
  RESEND_ENDPOINT,
  ResendHttpMailer,
  SmtpMailer,
  mailerFor,
  type SmtpOptions,
  type SmtpTransportLike,
} from './mailer';

// A ConfigService stand-in: only get() is used, and reading from a plain map
// keeps each case's environment visible in the case itself.
const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const mail = { to: 'someone@example.com', subject: 'Reset your password', text: 'https://app/reset?token=abc123' };

// Captures every log line of an adapter so the tests can prove what never
// reaches the log: the body (a working reset link) and the credential.
function captureLogs(mailer: object): string[] {
  const logs: string[] = [];
  (mailer as { logger: { log: (m: string) => void; error: (m: string) => void; warn: (m: string) => void } }).logger = {
    log: (m) => logs.push(m),
    error: (m) => logs.push(m),
    warn: (m) => logs.push(m),
  };
  return logs;
}

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('mailerFor', () => {
  const transport = () => ({ sendMail: vi.fn() }) as unknown as SmtpTransportLike;
  const smtpEnv = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com', MAIL_FROM_ADDRESS: 'noreply@example.com' };
  const resendEnv = { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test_key', MAIL_FROM_ADDRESS: 'noreply@example.com' };

  it('defaults to the log transport when MAIL_TRANSPORT is unset', () => {
    expect(mailerFor(configOf({}))).toBeInstanceOf(LogMailer);
  });

  // ADR-96: a production process that only logs reset links must not start.
  it.each([['unset', {}], ["'log'", { MAIL_TRANSPORT: 'log' }]])(
    'refuses the log transport in production when MAIL_TRANSPORT is %s',
    (_case, values) => {
      expect(() => mailerFor(configOf({ NODE_ENV: 'production', ...values }))).toThrow(/refused in production/);
    },
  );

  it('still allows the log transport outside production', () => {
    expect(mailerFor(configOf({ NODE_ENV: 'test', MAIL_TRANSPORT: 'log' }))).toBeInstanceOf(LogMailer);
  });

  it('builds the Resend adapter in production with a key and a sender', () => {
    expect(mailerFor(configOf({ NODE_ENV: 'production', ...resendEnv }), { fetchImpl: vi.fn() })).toBeInstanceOf(ResendHttpMailer);
  });

  it.each([
    ['no API key', { MAIL_TRANSPORT: 'resend', MAIL_FROM_ADDRESS: 'noreply@example.com' }, /RESEND_API_KEY/],
    ['a blank key', { ...resendEnv, RESEND_API_KEY: '   ' }, /RESEND_API_KEY/],
    ['no sender address', { MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_test_key' }, /MAIL_FROM_ADDRESS/],
  ])('refuses the resend transport with %s', (_case, values, expected) => {
    expect(() => mailerFor(configOf(values))).toThrow(expected);
  });

  it('builds the SMTP adapter when asked for it', () => {
    expect(mailerFor(configOf(smtpEnv), { buildSmtpTransport: () => transport() })).toBeInstanceOf(SmtpMailer);
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
  ])('hands the SMTP transport builder the parsed options with %s', (_case, extra, expected) => {
    const build = vi.fn(() => transport());

    mailerFor(configOf({ ...smtpEnv, ...extra }), { buildSmtpTransport: build });

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
    expect(() => mailerFor(configOf(values), { buildSmtpTransport: () => transport() })).toThrow(expected);
  });

  it('refuses a transport that has no adapter', () => {
    expect(() => mailerFor(configOf({ MAIL_TRANSPORT: 'sendgrid' }))).toThrow(/no adapter/);
  });
});

describe('ResendHttpMailer', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;
  let mailer: ResendHttpMailer;

  beforeEach(() => {
    fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg-1' }));
    mailer = new ResendHttpMailer('re_test_key', 'noreply@example.com', fetchImpl as unknown as typeof fetch);
  });

  it('posts the message to the Resend API with the key as a bearer token', async () => {
    const receipt = await mailer.send({ ...mail, idempotencyKey: 'row-1' });

    expect(receipt).toEqual({ providerMessageId: 'msg-1' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'row-1',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'noreply@example.com',
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends no idempotency header when the caller gave no key', async () => {
    await mailer.send(mail);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
  });

  // A refused send is a non-2xx answer with { name, message }: it must throw,
  // and the reason must be visible to an operator.
  it('throws with the provider detail when Resend refuses the message', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(403, { name: 'validation_error', message: 'domain is not verified' }));

    await expect(mailer.send(mail)).rejects.toThrow(/403 validation_error: domain is not verified/);
  });

  it('throws on a non-2xx answer without a JSON body too', async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });

    await expect(mailer.send(mail)).rejects.toThrow(/502: no detail/);
  });

  it('propagates a network failure or timeout', async () => {
    fetchImpl.mockRejectedValue(new Error('fetch failed'));

    await expect(mailer.send(mail)).rejects.toThrow(/Resend request failed: fetch failed/);
  });

  // The body is a working reset link (ADR-85) and the key is a credential.
  it('never writes the body or the key to the log, on success or on failure', async () => {
    const logs = captureLogs(mailer);

    await mailer.send(mail);
    fetchImpl.mockResolvedValue(jsonResponse(422, { name: 'validation_error', message: 'rejected' }));
    await mailer.send(mail).catch(() => undefined);
    fetchImpl.mockRejectedValue(new Error('socket hang up'));
    await mailer.send(mail).catch(() => undefined);

    expect(logs).toHaveLength(3);
    expect(logs.every((line) => !line.includes('token=abc123') && !line.includes('re_test_key'))).toBe(true);
    expect(logs.every((line) => line.includes(mail.to))).toBe(true);
  });
});

describe('SmtpMailer', () => {
  let sendMail: ReturnType<typeof vi.fn>;
  let mailer: SmtpMailer;

  beforeEach(() => {
    sendMail = vi.fn().mockResolvedValue({ messageId: '<msg-1@example.com>', accepted: [mail.to], rejected: [] });
    mailer = new SmtpMailer({ sendMail } as unknown as SmtpTransportLike, 'noreply@example.com');
  });

  it('sends the message from the configured address and returns the message id', async () => {
    const receipt = await mailer.send(mail);

    expect(receipt).toEqual({ providerMessageId: '<msg-1@example.com>' });
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

  it('never writes the message body to the log, on success or on failure', async () => {
    const logs = captureLogs(mailer);

    await mailer.send(mail);
    sendMail.mockResolvedValue({ accepted: [], rejected: [mail.to] });
    await mailer.send(mail).catch(() => undefined);

    expect(logs).toHaveLength(2);
    expect(logs.every((line) => !line.includes('token=abc123'))).toBe(true);
    expect(logs.every((line) => line.includes(mail.to))).toBe(true);
  });
});
