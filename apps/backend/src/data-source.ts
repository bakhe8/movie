import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from './config/database.config';

// Used by the TypeORM CLI only (migration:generate / migration:run / migration:revert).
// The NestJS app itself connects through DatabaseConfig() in ./config/database.config.ts.
export const AppDataSource = new DataSource({
  ...getConnectionOptions(),
  migrations: ['src/migrations/**/*.ts'],
  synchronize: false,
});
