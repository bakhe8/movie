import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { getJwtSecret } from '../config/jwt.config';
import { MailOutbox } from '../entities/mail-outbox.entity';
import { MailBodyCipher } from '../modules/mail/mail-body-cipher';
import { MailOutboxService } from '../modules/mail/mail-outbox.service';
import { mailerFor } from '../modules/mail/mailer';

// Sends one probe message to <address> through the configured MAIL_TRANSPORT
// and the outbox (ADR-97) -- exactly the path a password-reset mail takes --
// and prints where the row ended up. This is how delivery to a real mailbox
// is proven before a provider is trusted (the owner's mail decision, step 6);
// with MAIL_TRANSPORT=log it proves the database path only. A probe the
// provider refused stays `pending` with its body sealed, and the running
// backend's sweep retries it like any other message.
//
//   npx tsx apps/backend/src/scripts/mail-probe.ts someone@example.com
async function main() {
  const to = process.argv[2]?.trim();
  if (!to || !to.includes('@')) {
    console.error('usage: mail-probe <address>');
    process.exit(2);
  }
  const config = new ConfigService();
  const transport = config.get<string>('MAIL_TRANSPORT') ?? 'log';
  const dataSource = new DataSource(DatabaseConfig() as never);
  await dataSource.initialize();
  try {
    const rows = dataSource.getRepository(MailOutbox);
    const cipher = MailBodyCipher.fromSecret(getJwtSecret());
    const outbox = new MailOutboxService(rows, mailerFor(config), cipher, config);
    const text = `Probe sent at ${new Date().toISOString()} through MAIL_TRANSPORT=${transport}. If you can read this, delivery works.`;
    const result = await outbox.enqueue({ kind: 'probe', to, subject: 'Reel mail probe', text });
    const row = await rows.findOneByOrFail({ id: result.id });
    console.log(
      JSON.stringify(
        {
          id: row.id,
          transport,
          status: row.status,
          attempts: row.attempts,
          providerMessageId: row.providerMessageId,
          lastError: row.lastError,
          // A pending row must still carry a body the sweep can open.
          bodyAtRest: row.bodySealed === null ? 'wiped' : cipher.open(row.bodySealed) === text ? 'sealed, intact' : 'sealed, UNREADABLE',
        },
        null,
        2,
      ),
    );
    process.exit(row.status === 'delivered' ? 0 : 1);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
