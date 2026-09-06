import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDev1000Baseline, type Cat1bStatusRow } from './catalog-dev1000.lib';
import identity from './fixtures/catalog.demo.identity.json';
import cat1bStatus from './fixtures/catalog.cat1b.status.json';

/** D1000-1: materialize the 425-record dev-1000 baseline once. Re-run only after identity.json or the CAT-1B status fixture changes. */
const records = buildDev1000Baseline(identity, cat1bStatus.rows as Cat1bStatusRow[]);
const outPath = join(__dirname, 'fixtures', 'catalog.dev1000.staging.json');
writeFileSync(outPath, JSON.stringify(records, null, 2) + '\n');
console.log(`wrote ${records.length} dev1000 records to ${outPath}`);
