import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { AuditLog } from '../entities/audit-log.entity';
import { Consent } from '../entities/consent.entity';
import { ContentFeature } from '../entities/content-feature.entity';
import { Credit } from '../entities/credit.entity';
import { Embedding } from '../entities/embedding.entity';
import { ExperimentAssignment } from '../entities/experiment-assignment.entity';
import { Experiment } from '../entities/experiment.entity';
import { LocalizedTitle } from '../entities/localized-title.entity';
import { ModelVersion } from '../entities/model-version.entity';
import { Person } from '../entities/person.entity';
import { PrivacyRequest } from '../entities/privacy-request.entity';
import { Profile } from '../entities/profile.entity';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';
import { TitleEdition } from '../entities/title-edition.entity';
import { Triad } from '../entities/triad.entity';
import { TriadReplacement } from '../entities/triad-replacement.entity';
import { User } from '../entities/user.entity';
import { UserModelSnapshot } from '../entities/user-model-snapshot.entity';
import { UserTitleState } from '../entities/user-title-state.entity';

// override: false (dotenv's default) so env vars already set on the process
// -- e.g. by the test suite's setup file -- take precedence over the .env
// file instead of being silently clobbered by it.
config({ path: resolve(process.cwd(), '../../.env') });

interface ConnectionOptions {
  type: 'postgres';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  entities: DataSourceOptions['entities'];
}

export function getConnectionOptions(): ConnectionOptions {
  const password = process.env.POSTGRES_PASSWORD;
  if (!password) {
    throw new Error(
      'POSTGRES_PASSWORD environment variable is required. Set it in your .env file before starting the app.',
    );
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.POSTGRES_USER || 'movieapp',
    password,
    database: process.env.POSTGRES_DB || 'moviedb',
    entities: [
      User,
      Profile,
      Title,
      Triad,
      TriadReplacement,
      Embedding,
      UserModelSnapshot,
      UserTitleState,
      Consent,
      PrivacyRequest,
      AuditLog,
      Person,
      SourceRecord,
      LocalizedTitle,
      TitleEdition,
      Credit,
      ContentFeature,
      ModelVersion,
      Experiment,
      ExperimentAssignment,
    ],
  };
}

export function DatabaseConfig(): TypeOrmModuleOptions {
  return {
    ...getConnectionOptions(),
    migrations: ['dist/migrations/**/*.js'],
    // Schema is now managed exclusively through migrations (see src/migrations
    // and `npm run db:migrate`), not TypeORM's auto-sync, in every environment.
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
    extra: {
      // pgvector support
      supportGeoJSON: true,
    },
  };
}
