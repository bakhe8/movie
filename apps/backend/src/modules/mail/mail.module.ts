import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getJwtSecret } from '../../config/jwt.config';
import { MailOutbox } from '../../entities/mail-outbox.entity';
import { MailBodyCipher } from './mail-body-cipher';
import { MailOutboxService } from './mail-outbox.service';
import { Mailer, mailerFor } from './mailer';

// Global so any flow can send without re-importing; there is exactly one
// transport per process and it is chosen once, at boot. Flows enqueue through
// MailOutboxService (ADR-97); the Mailer itself is exported for the probe
// script and tests only.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([MailOutbox])],
  providers: [
    { provide: Mailer, useFactory: (config: ConfigService) => mailerFor(config), inject: [ConfigService] },
    // The outbox body key is a subkey of JWT_SECRET, which production already
    // requires to be strong (jwt.config.ts); no second secret to provision.
    { provide: MailBodyCipher, useFactory: () => MailBodyCipher.fromSecret(getJwtSecret()) },
    MailOutboxService,
  ],
  exports: [Mailer, MailOutboxService],
})
export class MailModule {}
