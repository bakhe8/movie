/**
 * Human-review acceptance test (board C-4; ALPHA_PLAN 5.5; BP §15.4 "الدقة
 * البشرية"): how closely the admin board's human corrections agree with the
 * extractions they superseded. Reads `content_features` only (no DB write).
 *
 *   cd apps/backend && npx tsc && node dist/scripts/measure-review-agreement.js [--tolerance 0.15] [--gap-bound 0.2]
 *
 * (Built via tsc, not `npx tsx` directly -- a pre-existing esbuild/tsx
 * limitation on this repo's decorator metadata for plain `@Column()` fields
 * elsewhere in the entity set makes raw tsx fail on any script that opens
 * `DatabaseConfig()`, unrelated to this file; every DB-facing script in
 * `scripts/` is run the same way.)
 */
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

import { DatabaseConfig } from '../config/database.config';
import { ContentFeature } from '../entities/content-feature.entity';
import { agreementByFeature, agreementByLanguage, DEFAULT_TOLERANCE, formatAgreementReport, HUMAN_REVIEW_EXTRACTOR, overallAgreement, type ReviewedPair } from './measure-review-agreement.lib';

function parseArgs(argv: string[]): { tolerance: number; gapBound: number } {
  const args = { tolerance: DEFAULT_TOLERANCE, gapBound: 0.2 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--tolerance') {
      args.tolerance = Number(argv[++index]);
    } else if (argv[index] === '--gap-bound') {
      args.gapBound = Number(argv[++index]);
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
    const repository = dataSource.getRepository(ContentFeature);
    // Every current human-review row, joined to the row it superseded (the
    // model's original value) and that row's title for the language breakdown.
    const reviews = await repository.find({ where: { extractorVersion: HUMAN_REVIEW_EXTRACTOR }, relations: { supersededByFeature: false } });
    const pairs: ReviewedPair[] = [];
    for (const review of reviews) {
      if (review.value === null) {
        continue; // unknown is not a value to compare (ADR-19); shouldn't happen for a human correction, but never assumed
      }
      const original = await repository.findOne({ where: { supersededBy: review.id }, relations: { title: true } });
      if (original && original.value !== null) {
        pairs.push({ featureKey: review.featureKey, humanValue: review.value, originalValue: original.value, originalLanguage: original.title?.originalLanguage ?? null });
      }
    }

    const overall = overallAgreement(pairs, args.tolerance);
    const byFeature = agreementByFeature(pairs, args.tolerance);
    const byLanguage = agreementByLanguage(pairs, args.tolerance);
    const report = formatAgreementReport(overall, byFeature, byLanguage, args.tolerance, args.gapBound);
    console.log(report);
    if (overall.n === 0) {
      console.log('GATE: no reviewed rows yet -- nothing to gate on');
      return;
    }
    console.log(`GATE: overall agreement ${(overall.rate! * 100).toFixed(0)}%`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
