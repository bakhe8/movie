import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from './config/database.config';

// Used by the TypeORM CLI (migration:generate / migration:run / revert) and by
// `dist/migrate.js` in a built image. The NestJS app itself connects through
// DatabaseConfig() in ./config/database.config.ts.
//
// The migrations glob follows whichever form of this file is running, and is
// anchored to __dirname rather than the working directory: under ts-node it
// is the .ts sources, in a built image the .js files next to this one. A
// fixed 'src/migrations/**/*.ts' -- what this used to say -- finds nothing in
// the production image, where there is no src/ and no TypeScript at all, and
// "no pending migrations" is exactly what a broken migrate step looks like.
const compiled = __filename.endsWith('.js');

export const AppDataSource = new DataSource({
  ...getConnectionOptions(),
  migrations: [compiled ? `${__dirname}/migrations/*.js` : `${__dirname}/migrations/*.ts`],
  synchronize: false,
});
