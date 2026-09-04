import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { AuditLog } from '../entities/audit-log.entity';
import { AvailabilitySnapshot } from '../entities/availability-snapshot.entity';
import { Consent } from '../entities/consent.entity';
import { ContentFeature } from '../entities/content-feature.entity';
import { Credit } from '../entities/credit.entity';
import { Embedding } from '../entities/embedding.entity';
import { ExperimentAssignment } from '../entities/experiment-assignment.entity';
import { Experiment } from '../entities/experiment.entity';
import { LibraryImport } from '../entities/library-import.entity';
import { LocalizedTitle } from '../entities/localized-title.entity';
import { ModelVersion } from '../entities/model-version.entity';
import { Outcome } from '../entities/outcome.entity';
import { Person } from '../entities/person.entity';
import { PrivacyRequest } from '../entities/privacy-request.entity';
import { Profile } from '../entities/profile.entity';
import { PublicQualitySource } from '../entities/public-quality-source.entity';
import { Recommendation } from '../entities/recommendation.entity';
import { PasswordReset } from '../entities/password-reset.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { SharedLatentSpaceVersion } from '../entities/shared-latent-space-version.entity';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';
import { TitleEdition } from '../entities/title-edition.entity';
import { Triad } from '../entities/triad.entity';
import { TriadReplacement } from '../entities/triad-replacement.entity';
import { User } from '../entities/user.entity';
import { UserModelSnapshot } from '../entities/user-model-snapshot.entity';
import { UserTitleState } from '../entities/user-title-state.entity';
import { WatchEvent } from '../entities/watch-event.entity';

// override: false (dotenv's default) so env vars already set on the process
// -- e.g. by the test suite's setup file -- take precedence over the .env
// file instead of being silently clobbered by it.
config({ path: resolve(process.cwd(), '../../.env') });

// Listed explicitly rather than glob-scanned: a missing entry is an
// EntityMetadataNotFoundError at boot, which is louder than a glob that
// silently matches nothing in a compiled build.
const ENTITIES: DataSourceOptions['entities'] = [
  User,
  PasswordReset,
  RefreshToken,
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
  LibraryImport,
  Recommendation,
  Outcome,
  WatchEvent,
  PublicQualitySource,
  AvailabilitySnapshot,
  SharedLatentSpaceVersion,
];

interface ConnectionOptions {
  type: 'postgres';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  entities: DataSourceOptions['entities'];
}

// DATABASE_URL wins when it is set. It has to: `services/workers/*.py` and
// every loader script connect through it and nothing else, so for a long time
// the two halves of this repo could be pointed at *different databases by the
// same .env* -- setting DATABASE_URL moved Python and left Node on DB_HOST.
// That is not hypothetical: it is how a load run in 2026-09 wrote 160 test
// accounts into the shared dev database while its operator believed it was
// talking to postgres-test. DB_HOST/DB_PORT/POSTGRES_* remain the fallback.
function fromDatabaseUrl(): Omit<ConnectionOptions, 'type' | 'entities'> | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DATABASE_URL is set but is not a valid URL: ${raw}`);
  }
  if (!url.protocol.startsWith('postgres')) {
    throw new Error(`DATABASE_URL must be a postgres:// URL, got ${url.protocol}`);
  }
  return {
    host: decodeURIComponent(url.hostname) || 'localhost',
    port: parseInt(url.port || '5432'),
    username: decodeURIComponent(url.username) || 'movieapp',
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || 'moviedb',
  };
}

export function getConnectionOptions(): ConnectionOptions {
  const fromUrl = fromDatabaseUrl();
  const password = fromUrl?.password || process.env.POSTGRES_PASSWORD;
  if (!password) {
    throw new Error(
      'POSTGRES_PASSWORD environment variable is required. Set it in your .env file before starting the app.',
    );
  }
  if (fromUrl) {
    return { type: 'postgres', ...fromUrl, password, entities: ENTITIES };
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.POSTGRES_USER || 'movieapp',
    password,
    database: process.env.POSTGRES_DB || 'moviedb',
    entities: ENTITIES,
  };
}

export function DatabaseConfig(): TypeOrmModuleOptions {
  return {
    ...getConnectionOptions(),
    migrations: ['dist/migrations/**/*.js'],
    // Schema is now managed exclusively through migrations (see src/migrations
    // and `npm run db:migrate`), not TypeORM's auto-sync, in every environment.
    synchronize: false,
    // L6 (2026-09-03 audit): `logging: true` printed every query with its
    // parameters -- password hashes on insert, emails -- to stdout in
    // development. Errors and schema/migration events are always logged;
    // full query logging is opt-in with DB_LOG_QUERIES=true.
    logging: process.env.DB_LOG_QUERIES === 'true' ? true : ['error', 'warn', 'schema', 'migration'],
    extra: {
      // pgvector support
      supportGeoJSON: true,
    },
  };
}
