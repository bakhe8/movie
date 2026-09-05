import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  // Optional rich part; the text part is always the whole message on its own,
  // so a client that refuses HTML loses nothing.
  html?: string | null;
  // Set by the outbox to its row id, so a retry after a lost response can
  // never deliver the same message twice on a provider that honours it.
  idempotencyKey?: string;
}

export interface MailReceipt {
  providerMessageId: string | null;
}

// The seam the product owns (ADR-85, ADR-97): callers hand a message to the
// outbox, the outbox hands it to whichever transport MAIL_TRANSPORT names.
// Delivery -- IP reputation, bounces, SPF/DKIM/DMARC -- is rented from a
// provider behind this class; the templates, tokens, retries and status
// stay in this codebase, so changing providers is one adapter and one
// variable. Every adapter must get two things right: never report a refused
// send as delivered, and never put a credential or the body in a log line.
export abstract class Mailer {
  abstract send(mail: OutgoingMail): Promise<MailReceipt>;
}

// The development transport: writes what would have been sent to the log and
// sends nothing. Chosen whenever MAIL_TRANSPORT is unset or 'log' outside
// production -- so a reset link is readable by whoever runs the server, and
// by nobody else. Refused in production (ADR-97): there it would print live
// reset links into a hosted log and deliver nothing, forever.
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger(LogMailer.name);

  async send(mail: OutgoingMail): Promise<MailReceipt> {
    this.logger.log(`[mail:log] to=${mail.to} subject=${mail.subject}${mail.html ? ' (+html)' : ''}\n${mail.text}`);
    return { providerMessageId: null };
  }
}

// ---- Resend over HTTPS --------------------------------------------------

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

// O-3's provider, reached by one HTTPS request rather than its SDK: the
// request is small enough to own, and HTTPS is what every Railway plan
// allows for outbound mail (SMTP egress is Pro-only there). `fetchImpl` is
// injectable so the adapter is tested without a network or a key.
@Injectable()
export class ResendHttpMailer extends Mailer {
  private readonly logger = new Logger(ResendHttpMailer.name);

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint: string = RESEND_ENDPOINT,
  ) {
    super();
  }

  async send(mail: OutgoingMail): Promise<MailReceipt> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (mail.idempotencyKey) {
      headers['Idempotency-Key'] = mail.idempotencyKey;
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: this.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          ...(mail.html ? { html: mail.html } : {}),
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[mail:resend] request failed to=${mail.to} subject=${mail.subject}: ${message}`);
      throw new Error(`Resend request failed: ${message}`);
    }
    const payload = (await response.json().catch(() => null)) as { id?: string; name?: string; message?: string } | null;
    if (!response.ok) {
      // Resend answers a refused send with a non-2xx status and
      // `{ name, message }`; the status alone is not enough to tell an
      // operator what to fix (unverified domain, bad key, quota).
      const detail = `${response.status}${payload?.name ? ` ${payload.name}` : ''}: ${payload?.message ?? 'no detail'}`;
      this.logger.error(`[mail:resend] send refused to=${mail.to} subject=${mail.subject} (${detail})`);
      throw new Error(`Resend rejected the message (${detail})`);
    }
    const id = payload?.id ?? null;
    this.logger.log(`[mail:resend] sent to=${mail.to} subject=${mail.subject} id=${id ?? 'unknown'}`);
    return { providerMessageId: id };
  }
}

// ---- Any SMTP server ----------------------------------------------------

// nodemailer reports recipients either as bare addresses or as objects.
type Recipient = string | { address: string };

// Everything this adapter uses from an SMTP client, so a test can pass a stub
// and the send path is exercised without a server. nodemailer's Transporter
// satisfies it structurally.
export interface SmtpTransportLike {
  sendMail(payload: { from: string; to: string; subject: string; text: string }): Promise<{
    messageId?: string;
    accepted?: Recipient[];
    rejected?: Recipient[];
  }>;
}

export interface SmtpOptions {
  host: string;
  port: number;
  // Implicit TLS from the first byte (port 465). Otherwise the session opens
  // in clear text and upgrades with STARTTLS.
  secure: boolean;
  auth?: { user: string; pass: string };
}

// The transport for a self-hosted or VPS deployment (ADR-95): any relay that
// speaks SMTP, with no vendor code path. Not usable from Railway below the
// Pro plan, which blocks outbound SMTP.
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);

  constructor(
    private readonly transport: SmtpTransportLike,
    private readonly from: string,
  ) {
    super();
  }

  async send(mail: OutgoingMail): Promise<MailReceipt> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    });
    // A server can take the session and still refuse the recipient: nodemailer
    // then resolves with the address under `rejected` and nothing under
    // `accepted`, so a caller that only caught exceptions would count that as
    // a delivery.
    const rejected = (info.rejected ?? []).map(addressOf);
    const accepted = (info.accepted ?? []).map(addressOf);
    if (rejected.length > 0 || accepted.length === 0) {
      // Recipient and subject only -- the body carries the reset link.
      this.logger.error(`[mail:smtp] send failed to=${mail.to} subject=${mail.subject}: recipient rejected by the server`);
      throw new Error(`SMTP server rejected the message for ${rejected.length > 0 ? rejected.join(', ') : mail.to}`);
    }
    this.logger.log(`[mail:smtp] sent to=${mail.to} subject=${mail.subject} id=${info.messageId ?? 'unknown'}`);
    return { providerMessageId: info.messageId ?? null };
  }
}

function addressOf(recipient: Recipient): string {
  return typeof recipient === 'string' ? recipient : recipient.address;
}

// ---- Selection at boot --------------------------------------------------

export interface MailerDeps {
  buildSmtpTransport?: (options: SmtpOptions) => SmtpTransportLike;
  fetchImpl?: typeof fetch;
}

export const SUPPORTED_TRANSPORTS = "'log' (development only), 'resend' (HTTPS, O-3) and 'smtp' (any SMTP relay)";

// Named so an unset transport is a deliberate default rather than an
// accident, and an unknown one fails loudly at boot instead of silently
// dropping mail a user is waiting for. The same applies to a transport
// missing its key, server or sender, and to `log` in production: failing at
// boot is the only way an operator finds out before a user does.
export function mailerFor(config: ConfigService, deps: MailerDeps = {}): Mailer {
  const transport = (config.get<string>('MAIL_TRANSPORT') ?? 'log').trim();
  const production = (config.get<string>('NODE_ENV') ?? '').trim() === 'production';
  const from = config.get<string>('MAIL_FROM_ADDRESS')?.trim();

  if (transport === 'log') {
    if (production) {
      throw new Error(
        "MAIL_TRANSPORT='log' is refused in production: it would print password-reset links to the server log and deliver nothing. Set 'resend' (RESEND_API_KEY + MAIL_FROM_ADDRESS) or 'smtp'.",
      );
    }
    return new LogMailer();
  }
  if (transport === 'resend') {
    const apiKey = config.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error("MAIL_TRANSPORT='resend' requires RESEND_API_KEY.");
    }
    if (!from) {
      throw new Error("MAIL_TRANSPORT='resend' requires MAIL_FROM_ADDRESS (a sender on a domain verified in Resend).");
    }
    return new ResendHttpMailer(apiKey, from, deps.fetchImpl ?? fetch);
  }
  if (transport === 'smtp') {
    const host = config.get<string>('SMTP_HOST')?.trim();
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASSWORD')?.trim();
    if (!host) {
      throw new Error("MAIL_TRANSPORT='smtp' requires SMTP_HOST.");
    }
    if (!from) {
      throw new Error("MAIL_TRANSPORT='smtp' requires MAIL_FROM_ADDRESS (a sender the SMTP server accepts).");
    }
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error("MAIL_TRANSPORT='smtp' needs SMTP_USER and SMTP_PASSWORD together, or neither.");
    }
    const port = parsePort(config.get<string>('SMTP_PORT'));
    const build = deps.buildSmtpTransport ?? defaultSmtpTransport;
    return new SmtpMailer(build({ host, port, secure: port === 465, auth: user && pass ? { user, pass } : undefined }), from);
  }
  throw new Error(`MAIL_TRANSPORT='${transport}' has no adapter. Supported: ${SUPPORTED_TRANSPORTS}.`);
}

// 587 (submission, STARTTLS) unless told otherwise; 465 switches to implicit TLS.
function parsePort(raw: string | undefined): number {
  const text = raw?.trim();
  if (!text) {
    return 587;
  }
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT='${text}' is not a port number.`);
  }
  return port;
}

// Split out so mailerFor() can be handed a stub and tested without a server.
// `requireTLS` makes nodemailer fail rather than send credentials over a
// session the server would not upgrade with STARTTLS; a credential-less
// local relay may stay in clear text.
function defaultSmtpTransport(options: SmtpOptions): SmtpTransportLike {
  return createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: !options.secure && options.auth !== undefined,
    auth: options.auth,
  });
}
