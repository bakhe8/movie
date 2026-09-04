import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer, mailerFor } from './mailer';

// Global so any flow can send without re-importing; there is exactly one
// transport per process and it is chosen once, at boot.
@Global()
@Module({
  providers: [{ provide: Mailer, useFactory: mailerFor, inject: [ConfigService] }],
  exports: [Mailer],
})
export class MailModule {}
