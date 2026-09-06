/**
 * Board 1D-9, one-time initial publish. Calls the *same*
 * `PublishTitleService.publish()` the admin endpoint calls -- once per
 * title, each its own locked/re-evaluated/audited/read-back transaction --
 * for every title the `public-v1` evaluator currently finds ready and that
 * has never been published. Nothing else is touched: a title that is not
 * ready is skipped without a publish attempt, and one already published is
 * left exactly as it is.
 *
 * Run only with an explicit, current owner authorisation for the database
 * it points at (`DATABASE_URL`/.env). `--dry-run` lists what it would do
 * and writes nothing.
 *
 *   cd apps/backend && npx tsx src/scripts/pub-1d9-initial-publish.ts [--dry-run]
 */
import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { AuditLog } from '../entities/audit-log.entity';
import { SourceRecord } from '../entities/source-record.entity';
import { Title } from '../entities/title.entity';
import { AuditService } from '../modules/audit/audit.service';
import { PublicationPolicyService } from '../modules/publication/publication-policy.service';
import { PublishActor, PublishTitleService } from '../modules/publication/publish-title.service';

const REPORT = path.resolve(__dirname, 'pub-1d9-initial-publish-report.md');

// The audit log's own "the system itself, not a person": this script is an
// operator action, not an admin clicking publish, and the trail should say so.
const ACTOR: PublishActor = { id: null, role: 'script:pub-1d9-initial-publish', ip: null };

type Outcome = 'published' | 'skipped_not_ready' | 'skipped_already_published' | 'refused' | 'error';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // Built by hand rather than through NestFactory: this runs under `tsx`,
  // which emits no decorator metadata, so Nest's constructor injection
  // cannot resolve here (same reason `column-types.spec.ts` exists). The
  // services themselves are the exact ones the HTTP path uses.
  const dataSource = new DataSource(DatabaseConfig() as DataSourceOptions);
  await dataSource.initialize();

  try {
    const titlesRepository = dataSource.getRepository(Title);
    const sourceRecordsRepository = dataSource.getRepository(SourceRecord);
    const policy = new PublicationPolicyService();
    const audit = new AuditService(
      dataSource.getRepository(AuditLog),
      new ConfigService({ AUDIT_IP_SALT: process.env.AUDIT_IP_SALT ?? '' }),
    );
    const publisher = new PublishTitleService(dataSource, policy, audit);

    const titles = await titlesRepository.find();
    const sourceRecords = await sourceRecordsRepository.find();
    const byTitleId = new Map<string, SourceRecord[]>();
    for (const record of sourceRecords) {
      if (!record.titleId) continue;
      const bucket = byTitleId.get(record.titleId);
      if (bucket) bucket.push(record);
      else byTitleId.set(record.titleId, [record]);
    }

    const results: { internalId: string; outcome: Outcome; detail?: string }[] = [];

    for (const title of titles) {
      if (title.publishedRevisionId) {
        results.push({ internalId: title.internalId, outcome: 'skipped_already_published' });
        continue;
      }
      const evaluation = policy.evaluate(title, byTitleId.get(title.id) ?? []);
      if (!evaluation.ready) {
        results.push({ internalId: title.internalId, outcome: 'skipped_not_ready', detail: evaluation.blockerCodes.join(', ') });
        continue;
      }
      if (dryRun) {
        results.push({ internalId: title.internalId, outcome: 'published', detail: 'dry-run, nothing written' });
        continue;
      }
      try {
        // expectedRevision null: this title has never been published, and
        // the transaction re-checks that under its own row lock.
        await publisher.publish(title.id, null, ACTOR);
        results.push({ internalId: title.internalId, outcome: 'published' });
      } catch (error) {
        const response = (error as { response?: { reason?: string; blockerCodes?: string[] } }).response;
        if (response?.reason) {
          results.push({
            internalId: title.internalId,
            outcome: 'refused',
            detail: `${response.reason}${response.blockerCodes?.length ? `: ${response.blockerCodes.join(', ')}` : ''}`,
          });
        } else {
          results.push({ internalId: title.internalId, outcome: 'error', detail: (error as Error).message });
        }
      }
    }

    const count = (outcome: Outcome) => results.filter((row) => row.outcome === outcome).length;
    const published = count('published');
    const notReady = count('skipped_not_ready');
    const refused = count('refused');
    const errored = count('error');
    const already = count('skipped_already_published');

    console.log(
      `pub-1d9 initial publish${dryRun ? ' [--dry-run]' : ''}: ${titles.length} titles -> published ${published}, not-ready skipped ${notReady}, already published ${already}, refused ${refused}, errors ${errored}`,
    );

    // Readback over the whole catalog, independent of what publish() itself
    // reported: what does the database actually say now?
    const pointerSet = await titlesRepository.count({ where: {} }).then(async () => {
      const rows = await titlesRepository.find({ select: { id: true, publishedRevisionId: true } });
      return rows.filter((row) => row.publishedRevisionId !== null).length;
    });
    console.log(`readback: ${pointerSet}/${titles.length} titles now have publishedRevisionId set`);

    const lines = [
      '# PUB-1D9 — initial manual publish',
      '',
      `Generated by \`src/scripts/pub-1d9-initial-publish.ts\`${dryRun ? ' (--dry-run: nothing written)' : ''} on ${new Date().toISOString().slice(0, 10)}.`,
      '',
      '## Counts',
      '',
      `- Titles examined: ${titles.length}`,
      `- Published this run: ${published}`,
      `- Skipped, not ready under public-v1 (left unpublished on purpose): ${notReady}`,
      `- Skipped, already published: ${already}`,
      `- Refused by the publish transaction (409): ${refused}`,
      `- Errors: ${errored}`,
      '',
      `- Readback: ${pointerSet}/${titles.length} titles have a non-null publishedRevisionId`,
      '',
      '## Not published (and why)',
      '',
      ...results
        .filter((row) => row.outcome !== 'published' && row.outcome !== 'skipped_already_published')
        .map((row) => `- ${row.internalId}: ${row.outcome}${row.detail ? ` (${row.detail})` : ''}`),
      '',
    ];
    await writeFile(REPORT, `${lines.join('\n')}\n`, 'utf8');
    console.log(`saved -> ${path.basename(REPORT)}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
