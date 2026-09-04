import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

// One seam, so choosing a provider is a new class and a config value, never a
// change to the flows that send (ALPHA_PLAN 3.2). O-3 chose Resend; `log`
// stays the default, so local development and tests never send real mail.
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

// Minimal shape of what this adapter uses from the Resend SDK, so a test can
// pass a stub and the send path is exercised without a network or a key.
export interface ResendLike {
  emails: {
    send(payload: { from: string; to: string; subject: string; text: string }): Promise<{
      data: { id: string } | null;
      error: { message: string; name?: string } | null;
    }>;
  };
}

// O-3's provider. Two things it must get right: never pretend a failed send
// succeeded, and never put the API key or the message body in a log line.
@Injectable()
export class ResendMailer extends Mailer {
  private readonly logger = new Logger(ResendMailer.name);

  constructor(
    private readonly client: ResendLike,
    private readonly from: string,
  ) {
    super();
  }

  async send(mail: OutgoingMail): Promise<void> {
    // Resend reports a rejected send in `error` rather than by throwing, so a
    // caller that only caught exceptions would record every bounce as a
    // delivery. The password-reset flow answers 202 either way (ADR-85), and
    // this log line is the only place an operator can see it went nowhere.
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    if (error) {
      // Recipient and subject only -- the body carries the reset link.
      this.logger.error(`[mail:resend] send failed to=${mail.to} subject=${mail.subject}: ${error.message}`);
      throw new Error(`Resend rejected the message: ${error.message}`);
    }
    this.logger.log(`[mail:resend] sent to=${mail.to} subject=${mail.subject} id=${data?.id ?? 'unknown'}`);
  }
}

// Named so an unset transport is a deliberate default rather than an
// accident, and an unknown one fails loudly at boot instead of silently
// dropping mail a user is waiting for. The same applies to a `resend`
// transport with no key or no sender: failing at boot is the only way an
// operator finds out before a user does.
export function mailerFor(config: ConfigService, buildClient: (key: string) => ResendLike = defaultResendClient): Mailer {
  const transport = (config.get<string>('MAIL_TRANSPORT') ?? 'log').trim();
  if (transport === 'log') {
    return new LogMailer();
  }
  if (transport === 'resend') {
    const apiKey = config.get<string>('RESEND_API_KEY')?.trim();
    const from = config.get<string>('MAIL_FROM_ADDRESS')?.trim();
    if (!apiKey) {
      throw new Error("MAIL_TRANSPORT='resend' requires RESEND_API_KEY.");
    }
    if (!from) {
      throw new Error("MAIL_TRANSPORT='resend' requires MAIL_FROM_ADDRESS (a sender on a domain verified in Resend).");
    }
    return new ResendMailer(buildClient(apiKey), from);
  }
  throw new Error(`MAIL_TRANSPORT='${transport}' has no adapter. Supported: 'log' (default) and 'resend' (O-3).`);
}

// Split out so mailerFor() can be handed a stub and tested without a key or
// a network, which is how the adapter's behaviour is covered.
function defaultResendClient(apiKey: string): ResendLike {
  return new Resend(apiKey) as unknown as ResendLike;
}
