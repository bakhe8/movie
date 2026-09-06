import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { TitleRevision } from '../../entities/title-revision.entity';
import { AuditService } from '../audit/audit.service';
import { PUBLICATION_POLICY_VERSION, PublicationPolicyService } from './publication-policy.service';

// Not imported from admin-catalog.service.ts: that file is under active
// edit by another session as this is written, and this module must not
// depend on it changing shape underneath.
export interface PublishActor {
  id: string;
  role: string;
  ip: string | null;
}

export interface PublishTitleResult {
  titleId: string;
  publishedRevisionId: string;
  policyVersion: string;
  publishedAt: Date;
}

// Board 1D-9: the only place allowed to set `titles.publishedRevisionId`.
// One transaction, four things atomically: (1) row-lock the title so two
// callers can never race past each other, (2) confirm `expectedRevision`
// still matches what the caller last saw (optimistic concurrency on top of
// the lock -- catches a stale read from *before* the lock was requested),
// (3) re-evaluate `public-v1` against the row's *current* state inside the
// same transaction, never a cached/pre-computed answer, (4) write the new
// revision, switch the pointer, audit it, and read it back to confirm --
// all in the same commit or none of it. PUB-G1's guard (`publication-
// guard.ts`) is still not wired into any consumer; this only decides what
// the pointer *would* mean once that gate opens.
@Injectable()
export class PublishTitleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: PublicationPolicyService,
    private readonly audit: AuditService,
  ) {}

  async publish(titleId: string, expectedRevision: string | null | undefined, actor: PublishActor): Promise<PublishTitleResult> {
    const expected = expectedRevision ?? null;

    return this.dataSource.transaction(async (manager) => {
      const title = await manager.findOne(Title, { where: { id: titleId }, lock: { mode: 'pessimistic_write' } });
      if (!title) {
        throw new NotFoundException('Title not found');
      }

      if (title.publishedRevisionId !== expected) {
        throw new ConflictException({
          statusCode: 409,
          message: 'The title has already changed publication state since it was last read',
          error: 'Conflict',
          reason: 'revision_mismatch',
          expectedRevision: expected,
          actualRevision: title.publishedRevisionId,
        });
      }

      // Re-evaluated here, not trusted from any earlier preview: the only
      // fresh answer is one computed under this same row lock.
      const cited = await manager.find(SourceRecord, { where: { titleId } });
      const evaluation = this.policy.evaluate(title, cited);
      if (!evaluation.ready) {
        throw new ConflictException({
          statusCode: 409,
          message: 'The title does not pass the public-v1 policy',
          error: 'Conflict',
          reason: 'not_ready',
          blockerCodes: evaluation.blockerCodes,
        });
      }

      const evaluatedAt = new Date();
      const revision = await manager.save(
        manager.create(TitleRevision, {
          titleId: title.id,
          titleEn: title.titleEn,
          titleAr: title.titleAr,
          description: title.description,
          posterPath: title.posterPath,
          genres: title.genres && title.genres.length > 0 ? title.genres.join(',') : null,
          releaseYear: title.releaseYear,
          sourceRecordIds: cited.map((record) => record.id),
          policyVersion: PUBLICATION_POLICY_VERSION,
          blockerCodes: [],
          evaluatedAt,
        }),
      );

      // Conditional on the same expected value the lock already serialized
      // against -- belt-and-suspenders, not load-bearing on its own (the
      // row lock above is what actually prevents the race), but it means a
      // logic error here fails loudly (affectedRows = 0) instead of silently.
      const updateResult = await manager.update(
        Title,
        { id: title.id, publishedRevisionId: expected === null ? IsNull() : expected },
        { publishedRevisionId: revision.id },
      );
      if (updateResult.affected !== 1) {
        throw new ConflictException({
          statusCode: 409,
          message: 'The title changed publication state during this request',
          error: 'Conflict',
          reason: 'revision_mismatch',
          expectedRevision: expected,
        });
      }

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'publication.publish',
          resource: 'title',
          resourceId: title.id,
          status: 'ok',
          reason: `revision ${revision.id}`,
          ip: actor.ip,
        },
        manager,
      );

      // Readback: the response never trusts what this function computed in
      // memory, only what the transaction can still see committed.
      const confirmed = await manager.findOneOrFail(Title, { where: { id: title.id } });
      if (confirmed.publishedRevisionId !== revision.id) {
        throw new Error(`readback mismatch for title ${title.id}: expected ${revision.id}, saw ${confirmed.publishedRevisionId}`);
      }

      return {
        titleId: title.id,
        publishedRevisionId: revision.id,
        policyVersion: PUBLICATION_POLICY_VERSION,
        publishedAt: evaluatedAt,
      };
    });
  }
}
