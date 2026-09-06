import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdentityThrottlerGuard } from './identity-throttler.guard';
import { DatabaseConfig } from '../../config/database.config';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { ConsentsModule } from '../consents/consents.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { TitlesModule } from '../titles/titles.module';
import { TriadsModule } from '../triads/triads.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { UserTitleStateModule } from '../user-title-state/user-title-state.module';
import { WatchEventsModule } from '../watch-events/watch-events.module';
import { OutcomesModule } from '../outcomes/outcomes.module';
import { TrainingModule } from '../training/training.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { AdminModule } from '../admin/admin.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PublicationModule } from '../publication/publication.module';
import { CatalogIntakeModule } from '../catalog-intake/catalog-intake.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', resolve(process.cwd(), '../../.env')],
    }),
    // 60/min per identity by default. Overridable because the load harness
    // (ALPHA_PLAN 7.6) has to out-run a human to measure anything, and a
    // real deployment will want to tune it without a release.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.THROTTLE_TTL_MS) || 60_000,
          limit: Number(process.env.THROTTLE_LIMIT) || 60,
        },
      ],
    }),
    TypeOrmModule.forRoot(DatabaseConfig()),
    MailModule,
    AuthModule,
    ProfilesModule,
    TitlesModule,
    TriadsModule,
    RecommendationsModule,
    UserTitleStateModule,
    ConsentsModule,
    WatchEventsModule,
    OutcomesModule,
    TrainingModule,
    PrivacyModule,
    AdminModule,
    AnalyticsModule,
    PublicationModule,
    CatalogIntakeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      // Per user when signed in, per IP otherwise (ALPHA_PLAN 7.6).
      useClass: IdentityThrottlerGuard,
    },
  ],
})
export class AppModule {}
