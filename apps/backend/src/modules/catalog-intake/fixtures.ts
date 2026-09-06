import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CatalogIdentity } from '../../scripts/catalog-identity';
import type { Dev1000Record } from '../../scripts/catalog-dev1000.lib';
import type { CatalogEntry } from '../../scripts/seed-demo.lib';

// CAT-J1: read-only access to the committed catalog fixtures for the verify
// and reconcile reports. Same resolution as seed-demo.ts's resolveFixturesDir
// (the source tree when it exists, else the packaged copy beside the code),
// repeated here in six lines rather than importing the seed module -- that
// would pull bcrypt and the whole persona builder into the API process for
// three JSON reads.
export function resolveFixturesDir(): string {
  const fromSource = path.resolve(__dirname, '..', '..', '..', 'src', 'scripts', 'fixtures');
  if (existsSync(fromSource)) {
    return fromSource;
  }
  return path.resolve(__dirname, '..', '..', 'scripts', 'fixtures');
}

function readJson<T>(fixturesDir: string, name: string): T | null {
  const file = path.join(fixturesDir, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export interface CatalogFixtures {
  /** `catalog.demo.identity.json` -- the reserved identities (ADR-116); required. */
  reserved: CatalogIdentity[];
  /** `catalog.demo.json` -- the release fixture the seed writes; required. */
  catalog: CatalogEntry[];
  /** `catalog.dev1000.staging.json` -- CAT-2's development record; optional. */
  staging: Dev1000Record[] | null;
}

export function loadCatalogFixtures(fixturesDir: string = resolveFixturesDir()): CatalogFixtures {
  const reserved = readJson<CatalogIdentity[]>(fixturesDir, 'catalog.demo.identity.json');
  const catalog = readJson<CatalogEntry[]>(fixturesDir, 'catalog.demo.json');
  if (!reserved || !catalog) {
    throw new Error(`catalog fixtures not found under ${fixturesDir}`);
  }
  return { reserved, catalog, staging: readJson<Dev1000Record[]>(fixturesDir, 'catalog.dev1000.staging.json') };
}
