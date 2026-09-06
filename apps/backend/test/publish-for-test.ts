import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Title } from '../src/entities/title.entity';
import { TitleRevision } from '../src/entities/title-revision.entity';

// PUB-G1 (ADR-118): the public read paths -- search, starter, detail, the
// recommendation candidate pool, the adaptive triad pool -- only return
// titles whose `publishedRevisionId` is set. A fixture title is invisible
// to all of them until it is published, so specs that create their own
// catalog rows and then expect to read them back call this.
//
// This writes the revision row and the pointer directly instead of going
// through `PublishTitleService`: most fixtures here exist to test some
// other surface and are deliberately minimal (no poster, description or
// genres), which the `public-v1` policy would correctly refuse. The publish
// transaction's own contract -- lock, expectedRevision, in-transaction
// re-evaluation, audit, readback -- is covered by publish-title.e2e-spec.ts,
// which uses complete titles and the real service.
export async function publishForTest(app: INestApplication, titleIds: string[]): Promise<void> {
  const dataSource = app.get(DataSource);
  const titles = dataSource.getRepository(Title);
  const revisions = dataSource.getRepository(TitleRevision);

  for (const titleId of titleIds) {
    const title = await titles.findOneOrFail({ where: { id: titleId } });
    const revision = await revisions.save(
      revisions.create({
        titleId,
        titleEn: title.titleEn,
        titleAr: title.titleAr,
        description: title.description,
        posterPath: title.posterPath,
        genres: title.genres && title.genres.length > 0 ? title.genres.join(',') : null,
        releaseYear: title.releaseYear,
        sourceRecordIds: [],
        policyVersion: 'public-v1',
        blockerCodes: [],
        evaluatedAt: new Date(),
      }),
    );
    await titles.update({ id: titleId }, { publishedRevisionId: revision.id });
  }
}
