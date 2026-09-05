import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

// One seam, so choosing a provider is a config value, never a change to the
// flows that send (ALPHA_PLAN 3.2, ADR-85). `log` stays the default, so local
// development and tests never send real mail; `smtp` reaches any server that
// speaks SMTP -- O-3's Resend included -- with no vendor SDK (ADR-95).
export abstract class Mailer {
  abstract send(mail: OutgoingMail): Promise<void>;
}

// The development transport: writes what would have been sent to the log and
// sends nothing. Chosen whenever MAIL_TRANSPORT is unset or 'log' -- so a
// reset link is readable by whoever runs the server, and by nobody else.
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger(LogMailer.name);

  async send(mail: OutgoingMail): Promise<void> {
    this.logger.log(`[mail:log] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
  }
}

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

// The one real transport. Two things it must get right: never pretend a
// refused send succeeded, and never put a credential or the message body in
// a log line.
@Injectable()
export class SmtpMailer extends Mailer {
  private readonly logger = new Logger(SmtpMailer.name);

  constructor(
    private readonly transport: SmtpTransportLike,
    private readonly from: string,
  ) {
    super();
  }

  async send(mail: OutgoingMail): Promise<void> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    // A server can take the session and still refuse the recipient: nodemailer
    // then resolves with the address under `rejected` and nothing under
    // `accepted`, so a caller that only caught exceptions would count that as
    // a delivery. The password-reset flow answers 202 either way (ADR-85), and
    // this log line is the only place an operator can see it went nowhere.
    const rejected = (info.rejected ?? []).map(addressOf);
    const accepted = (info.accepted ?? []).map(addressOf);
    if (rejected.length > 0 || accepted.length === 0) {
      // Recipient and subject only -- the body carries the reset link.
      this.logger.error(`[mail:smtp] send failed to=${mail.to} subject=${mail.subject}: recipient rejected by the server`);
      throw new Error(`SMTP server rejected the message for ${rejected.length > 0 ? rejected.join(', ') : mail.to}`);
    }
    this.logger.log(`[mail:smtp] sent to=${mail.to} subject=${mail.subject} id=${info.messageId ?? 'unknown'}`);
  }
}

function addressOf(recipient: Recipient): string {
  return typeof recipient === 'string' ? recipient : recipient.address;
}

// Named so an unset transport is a deliberate default rather than an
// accident, and an unknown one fails loudly at boot instead of silently
// dropping mail a user is waiting for. The same applies to an `smtp`
// transport with no server or no sender: failing at boot is the only way an
// operator finds out before a user does.
export function mailerFor(
  config: ConfigService,
  buildTransport: (options: SmtpOptions) => SmtpTransportLike = defaultSmtpTransport,
): Mailer {
  const transport = (config.get<string>('MAIL_TRANSPORT') ?? 'log').trim();
  if (transport === 'log') {
    return new LogMailer();
  }
  if (transport === 'smtp') {
    const host = config.get<string>('SMTP_HOST')?.trim();
    const from = config.get<string>('MAIL_FROM_ADDRESS')?.trim();
    const user = config.get<string>('SMTP_USER')?.trim();
    const pass = config.get<string>('SMTP_PASSWORD')?.trim();
    if (!host) {
      throw new Error("MAIL_TRANSPORT='smtp' requires SMTP_HOST.");
    }
    if (!from) {
      throw new Error("MAIL_TRANSPORT='smtp' requires MAIL_FROM_ADDRESS (a sender the SMTP server accepts; on Resend, one on a domain verified there).");
    }
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error("MAIL_TRANSPORT='smtp' needs SMTP_USER and SMTP_PASSWORD together, or neither.");
    }
    const port = parsePort(config.get<string>('SMTP_PORT'));
    return new SmtpMailer(
      buildTransport({ host, port, secure: port === 465, auth: user && pass ? { user, pass } : undefined }),
      from,
    );
  }
  throw new Error(`MAIL_TRANSPORT='${transport}' has no adapter. Supported: 'log' (default) and 'smtp' (ADR-95; Resend is reached over SMTP too).`);
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

// Split out so mailerFor() can be handed a stub and tested without a server,
// which is how the adapter's behaviour is covered. `requireTLS` makes
// nodemailer fail rather than send credentials over a session the server
// would not upgrade with STARTTLS; a credential-less local relay may stay in
// clear text.
function defaultSmtpTransport(options: SmtpOptions): SmtpTransportLike {
  return createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: !options.secure && options.auth !== undefined,
    auth: options.auth,
  });
}
