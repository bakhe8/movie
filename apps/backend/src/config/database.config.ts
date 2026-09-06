import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions, NamingStrategyInterface } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { ConventionNamingStrategy } from './naming-strategy';
import { AnalyticsEvent } from '../entities/analytics-event.entity';
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
import { MailOutbox } from '../entities/mail-outbox.entity';
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
import { TitlePoster } from '../entities/title-poster.entity';
import { Triad } from '../entities/triad.entity';
import { TrainingJob } from '../entities/training-job.entity';
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
  MailOutbox,
  RefreshToken,
  Profile,
  Title,
  Triad,
  TrainingJob,
  TriadReplacement,
  Embedding,
  UserModelSnapshot,
  UserTitleState,
  Consent,
  PrivacyRequest,
  AuditLog,
  AnalyticsEvent,
  Person,
  SourceRecord,
  LocalizedTitle,
  TitleEdition,
  TitlePoster,
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
  namingStrategy?: NamingStrategyInterface;
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

// A deployed app that resolves to loopback is not talking to a database at
// all -- it is talking to itself. That surfaced as a bare ECONNREFUSED stack
// on the first Railway deploy, which says nothing about the cause; in a
// managed environment the database is always another host, so this is a
// configuration mistake with exactly one fix worth naming.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

// "Deployed" is anything that is not local development or a test run: a
// NODE_ENV of production, staging, preview or any other value -- and, since
// NODE_ENV=production comes from the image (apps/backend/Dockerfile) and a
// dashboard override can blank it, NODE_ENV unset while Railway's own
// service variables say this process is one of its services
// (AUDIT_2026-09-05 M3). Unset with no such marker stays local: the CLI
// scripts (migrations, test-db setup) run that way against 127.0.0.1 by
// design. Returns what made the call, for the error message, or null.
const LOCAL_NODE_ENVS = new Set(['development', 'test']);
const DEPLOYMENT_MARKERS = ['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID'];

export function deployedEnvironment(): string | null {
  const nodeEnv = process.env.NODE_ENV?.trim();
  if (nodeEnv) {
    return LOCAL_NODE_ENVS.has(nodeEnv) ? null : `NODE_ENV=${nodeEnv}`;
  }
  const marker = DEPLOYMENT_MARKERS.find((name) => process.env[name]);
  return marker ? `${marker} is set (a Railway service) with NODE_ENV unset` : null;
}

function assertNotLoopbackWhenDeployed(host: string, port: number, source: string): void {
  const deployed = deployedEnvironment();
  if (!deployed || !LOOPBACK.has(host)) {
    return;
  }
  throw new Error(
    `Refusing to start: ${deployed} but the database host resolves to ${host}:${port} (from ${source}), which is this container itself. ` +
      "Set DATABASE_URL to the database service's own internal address -- on Railway use the variable reference picker, " +
      'postgresql://<user>:<password>@<postgres RAILWAY_PRIVATE_DOMAIN>:5432/<db> -- and remove any DB_HOST/DB_PORT left over from local development.',
  );
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
    assertNotLoopbackWhenDeployed(fromUrl.host, fromUrl.port, 'DATABASE_URL');
    return { type: 'postgres', ...fromUrl, password, entities: ENTITIES, namingStrategy: new ConventionNamingStrategy() };
  }

  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432');
  assertNotLoopbackWhenDeployed(host, port, process.env.DB_HOST ? 'DB_HOST/DB_PORT' : 'the DB_HOST default, DATABASE_URL being unset');

  return {
    type: 'postgres',
    host,
    port,
    username: process.env.POSTGRES_USER || 'movieapp',
    password,
    database: process.env.POSTGRES_DB || 'moviedb',
    entities: ENTITIES,
    namingStrategy: new ConventionNamingStrategy(),
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
