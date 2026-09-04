import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

// One seam, so choosing a provider later is a new class and a config value,
// never a change to the flows that send (ALPHA_PLAN 3.2; the provider itself
// is owner decision O-3/§4.2 and deliberately not made here).
export abstract class Mailer {
  abstract send(mail: OutgoingMail): Promise<void>;
}

// The development transport: writes what would have been sent to the log and
// sends nothing. Chosen whenever MAIL_TRANSPORT is unset or 'log', which is
// every environment today -- so a reset link is readable by whoever runs the
// server, and by nobody else.
@Injectable()
export class LogMailer extends Mailer {
  private readonly logger = new Logger(LogMailer.name);

  async send(mail: OutgoingMail): Promise<void> {
    this.logger.log(`[mail:log] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
  }
}

// Named so an unset transport is a deliberate default rather than an
// accident, and an unknown one fails loudly at boot instead of silently
// dropping mail a user is waiting for.
export function mailerFor(config: ConfigService): Mailer {
  const transport = (config.get<string>('MAIL_TRANSPORT') ?? 'log').trim();
  if (transport === 'log') {
    return new LogMailer();
  }
  throw new Error(
    `MAIL_TRANSPORT='${transport}' has no adapter. Only 'log' exists today; the provider is an open owner decision (ALPHA_PLAN §4.2).`,
  );
}
