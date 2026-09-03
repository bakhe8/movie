import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseConfig } from '../../config/database.config';
import { AuthModule } from '../auth/auth.module';
import { ConsentsModule } from '../consents/consents.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { TitlesModule } from '../titles/titles.module';
import { TriadsModule } from '../triads/triads.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { UserTitleStateModule } from '../user-title-state/user-title-state.module';
import { WatchEventsModule } from '../watch-events/watch-events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', resolve(process.cwd(), '../../.env')],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 60 }],
    }),
    TypeOrmModule.forRoot(DatabaseConfig()),
    AuthModule,
    ProfilesModule,
    TitlesModule,
    TriadsModule,
    RecommendationsModule,
    UserTitleStateModule,
    ConsentsModule,
    WatchEventsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
