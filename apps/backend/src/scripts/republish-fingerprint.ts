/**
 * Republish `titles.fingerprint` from the current `content_features` rows
 * (board request C-3 / archive F12): a correction never touches the
 * published fingerprint on its own (SCHEMA.md: originals kept, corrections
 * are new superseding rows) -- this step folds current, non-superseded
 * values back onto it so a correction reaches the trainer and the API.
 *
 *   cd apps/backend && npx tsx src/scripts/republish-fingerprint.ts [--title-id UUID] [--dry-run]
 *
 * Not urgent (no real correction exists yet, per the board): safe to run
 * any time -- a title whose current rows already match what is published
 * is left untouched, and `--dry-run` prints the plan without writing.
 */
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

import { DatabaseConfig } from '../config/database.config';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../entities/title-fingerprint.type';
import { republishFingerprint } from './republish-fingerprint.lib';

function parseArgs(argv: string[]): { titleId: string | null; dryRun: boolean } {
  const args = { titleId: null as string | null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--title-id') {
      args.titleId = argv[++index];
    } else if (argv[index] === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();
  try {
    const titleRows: { id: string; fingerprint: Record<string, unknown> | null }[] = await dataSource.query(
      `SELECT id, fingerprint FROM titles WHERE fingerprint IS NOT NULL ${args.titleId ? 'AND id = $1' : ''} ORDER BY id`,
      args.titleId ? [args.titleId] : [],
    );
    const featureRows: { titleId: string; featureKey: string; value: number | null; uncertainty: number | null }[] = await dataSource.query(
      `SELECT "titleId", "featureKey", value, uncertainty FROM content_features
       WHERE "supersededBy" IS NULL ${args.titleId ? 'AND "titleId" = $1' : ''}`,
      args.titleId ? [args.titleId] : [],
    );
    const rowsByTitle = new Map<string, typeof featureRows>();
    for (const row of featureRows) {
      rowsByTitle.set(row.titleId, [...(rowsByTitle.get(row.titleId) ?? []), row]);
    }

    let titlesChanged = 0;
    let keysChanged = 0;
    for (const title of titleRows) {
      const { fingerprint, changes } = republishFingerprint(title.fingerprint, rowsByTitle.get(title.id) ?? [], FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS);
      if (changes.length === 0) {
        continue;
      }
      titlesChanged += 1;
      keysChanged += changes.length;
      const changeText = changes.map((change) => `${change.featureKey}: ${change.before ?? 'unknown'} -> ${change.after}`).join(', ');
      console.log(`  ${title.id}: ${changeText}`);
      if (!args.dryRun) {
        await dataSource.query(`UPDATE titles SET fingerprint = $1 WHERE id = $2`, [JSON.stringify(fingerprint), title.id]);
      }
    }
    console.log(
      `${args.dryRun ? '[dry run] ' : ''}republish: ${titleRows.length} title(s) with a published fingerprint scanned, ` +
        `${titlesChanged} with a correction not yet reflected (${keysChanged} key(s)); the rest already match their current content_features rows`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
