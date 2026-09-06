import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { ContentFeature } from '../../entities/content-feature.entity';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../../entities/title-fingerprint.type';
import { republishFingerprint } from '../../scripts/republish-fingerprint.lib';
import { AuditService } from '../audit/audit.service';
import {
  CreateSourceRecordDto,
  ListContentFeaturesQueryDto,
  ListTitlesQueryDto,
  ReviewContentFeatureDto,
  SampleContentFeaturesQueryDto,
  UpdateSourceRecordDto,
  UpdateTitleDto,
} from './dto/admin.dto';

export const HUMAN_REVIEW_EXTRACTOR = 'human-review-v1';

export interface Actor {
  id: string;
  role: string;
  ip: string | null;
}

export interface AdminTitleRow {
  id: string;
  internalId: string;
  titleEn: string;
  titleAr: string;
  releaseYear: number | null;
  originalLanguage: string | null;
  hasFingerprint: boolean;
  hasV2: boolean;
  // Worst license status across the title's source_records, or 'unknown'
  // when none exist -- the value BP §18.1's "no content without a known
  // license status" is judged on.
  licenseStatus: string;
  sourceRecords: number;
  unreviewedFeatures: number;
  updatedAt: Date;
}

const LICENSE_RANK: Record<string, number> = { unknown: 0, pending_review: 1, non_commercial_only: 2, commercial_allowed: 3 };

function worstLicense(statuses: string[]): string {
  if (!statuses.length) {
    return 'unknown';
  }
  return statuses.reduce((worst, status) => ((LICENSE_RANK[status] ?? 0) < (LICENSE_RANK[worst] ?? 0) ? status : worst));
}

// Internal board, catalog half (BP §5.1 "content review, fingerprint
// sources", §11.1 rights registry, §15.4 sample review; SPECIFICATION §5.5).
// Every write leaves an audit_log row with the acting admin.
@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectRepository(Title)
    private readonly titles: Repository<Title>,
    @InjectRepository(SourceRecord)
    private readonly sourceRecords: Repository<SourceRecord>,
    @InjectRepository(ContentFeature)
    private readonly contentFeatures: Repository<ContentFeature>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async listTitles(query: ListTitlesQueryDto) {
    const qb = this.titles.createQueryBuilder('title').orderBy('title.updatedAt', 'DESC');
    if (query.query) {
      qb.where('(title.titleEn ILIKE :q OR title.titleAr ILIKE :q OR title.internalId ILIKE :q)', { q: `%${query.query}%` });
    }
    if (query.missing === 'fingerprint') {
      qb.andWhere('title.fingerprint IS NULL');
    } else if (query.missing === 'v2') {
      qb.andWhere("title.fingerprint IS NOT NULL AND (title.fingerprint->'v2') IS NULL");
    } else if (query.missing === 'license') {
      qb.andWhere(
        `NOT EXISTS (SELECT 1 FROM source_records sr WHERE sr."titleId" = title.id AND sr."licenseStatus" <> 'unknown')`,
      );
    }
    const total = await qb.getCount();
    const rows = await qb.skip((query.page - 1) * query.limit).take(query.limit).getMany();
    const items = await this.decorate(rows);
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  // API.md §2.2 `titles/missing-fingerprints`: no published fingerprint, or
  // V1 only (the 28-key model treats a V1-only title as incomplete, ADR-69).
  async missingFingerprints(query: ListTitlesQueryDto) {
    const qb = this.titles
      .createQueryBuilder('title')
      .where("title.fingerprint IS NULL OR (title.fingerprint->'v2') IS NULL")
      .orderBy('title.internalId', 'ASC');
    const total = await qb.getCount();
    const rows = await qb.skip((query.page - 1) * query.limit).take(query.limit).getMany();
    return { items: await this.decorate(rows), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async getTitle(titleId: string) {
    const title = await this.requireTitle(titleId);
    const [summary] = await this.decorate([title]);
    return { ...title, summary };
  }

  // API.md §2.2 `titles/:id/provenance`: every rights row and every feature
  // row (current and superseded) behind the published fingerprint.
  async provenance(titleId: string) {
    await this.requireTitle(titleId);
    const sourceRecords = await this.sourceRecords.find({ where: { titleId }, order: { createdAt: 'ASC' } });
    const features = await this.contentFeatures.find({ where: { titleId }, order: { featureKey: 'ASC', validFrom: 'ASC' } });
    const byExtractor: Record<string, { rows: number; unreviewed: number; superseded: number }> = {};
    for (const feature of features) {
      const bucket = (byExtractor[feature.extractorVersion] ??= { rows: 0, unreviewed: 0, superseded: 0 });
      bucket.rows += 1;
      if (feature.reviewStatus === 'unreviewed') bucket.unreviewed += 1;
      if (feature.supersededBy) bucket.superseded += 1;
    }
    return { titleId, sourceRecords, features, byExtractor, licenseStatus: worstLicense(sourceRecords.map((r) => r.licenseStatus)) };
  }

  // ADMIN-W4 (ADM-P0-03): the change and its audit row now commit or fail
  // together -- a failed audit write must not leave a silent, untrailed edit.
  async updateTitle(titleId: string, dto: UpdateTitleDto, actor: Actor): Promise<Title> {
    return this.dataSource.transaction(async (manager) => {
      const title = await this.requireTitle(titleId, manager);
      const changed: string[] = [];
      for (const key of ['titleEn', 'titleAr', 'description', 'releaseYear', 'genres', 'originalLanguage', 'externalIds'] as const) {
        if (dto[key] !== undefined) {
          (title as unknown as Record<string, unknown>)[key] = dto[key];
          changed.push(key);
        }
      }
      const saved = await manager.save(title);
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'admin.title.update',
          resource: 'title',
          resourceId: titleId,
          status: 'ok',
          reason: `fields: ${changed.join(', ') || 'none'}`,
          ip: actor.ip,
        },
        manager,
      );
      return saved;
    });
  }

  async addSourceRecord(titleId: string, dto: CreateSourceRecordDto, actor: Actor): Promise<SourceRecord> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireTitle(titleId, manager);
      const record = await manager.save(
        manager.create(SourceRecord, {
          titleId,
          fieldName: dto.fieldName,
          source: dto.source,
          value: dto.value ?? null,
          license: dto.license ?? null,
          licenseStatus: dto.licenseStatus,
          allowsStorage: dto.allowsStorage ?? null,
          allowsDerivation: dto.allowsDerivation ?? null,
          allowsTraining: dto.allowsTraining ?? null,
          attributionRequired: dto.attributionRequired ?? null,
          fallbackPlan: dto.fallbackPlan ?? null,
          reviewStatus: dto.reviewStatus ?? 'human_verified',
          retrievedAt: new Date(),
          validFrom: new Date(),
        }),
      );
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'admin.source_record.create',
          resource: 'source_record',
          resourceId: record.id,
          status: 'ok',
          reason: `title ${titleId} ${dto.fieldName} ${dto.source} ${dto.licenseStatus}`,
          ip: actor.ip,
        },
        manager,
      );
      return record;
    });
  }

  // ADMIN-W4 (ADM-P0-04): the entity's own contract says a source record is
  // "never overwritten in place -- a correction creates a new row and points
  // the old one's supersededBy at it" (source-record.entity.ts), same as
  // content_features. This service used to mutate the row directly, quietly
  // erasing exactly the history that contract promises. Fixed to match:
  // supersede, never edit, so admin/titles/:id/provenance keeps showing the
  // full history alongside the current row -- editing an already-superseded
  // row is rejected (409) rather than forking history from the wrong point.
  async updateSourceRecord(recordId: string, dto: UpdateSourceRecordDto, actor: Actor): Promise<SourceRecord> {
    return this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(SourceRecord, { where: { id: recordId } });
      if (!record) {
        throw new NotFoundException('Source record not found');
      }
      if (record.supersededBy) {
        throw new ConflictException({
          statusCode: 409,
          message: 'This source record has already been superseded; edit the current record instead',
          error: 'Conflict',
          reason: 'already_superseded',
          currentRecordId: record.supersededBy,
        });
      }
      const fields = ['licenseStatus', 'reviewStatus', 'license', 'allowsStorage', 'allowsDerivation', 'allowsTraining', 'attributionRequired', 'fallbackPlan'] as const;
      const changed: string[] = [];
      for (const key of fields) {
        if (dto[key] !== undefined && dto[key] !== record[key]) {
          changed.push(`${key}: ${record[key] ?? 'null'} -> ${dto[key]}`);
        }
      }
      if (changed.length === 0) {
        return record; // no-op: nothing to supersede
      }
      const successor = await manager.save(
        manager.create(SourceRecord, {
          titleId: record.titleId,
          fieldName: record.fieldName,
          value: record.value,
          source: record.source,
          confidence: record.confidence,
          extractorVersion: record.extractorVersion,
          retentionUntil: record.retentionUntil,
          retrievedAt: record.retrievedAt,
          licenseStatus: dto.licenseStatus ?? record.licenseStatus,
          reviewStatus: dto.reviewStatus ?? record.reviewStatus,
          license: dto.license ?? record.license,
          allowsStorage: dto.allowsStorage ?? record.allowsStorage,
          allowsDerivation: dto.allowsDerivation ?? record.allowsDerivation,
          allowsTraining: dto.allowsTraining ?? record.allowsTraining,
          attributionRequired: dto.attributionRequired ?? record.attributionRequired,
          fallbackPlan: dto.fallbackPlan ?? record.fallbackPlan,
          validFrom: new Date(),
        }),
      );
      record.supersededBy = successor.id;
      await manager.save(record);
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'admin.source_record.update',
          resource: 'source_record',
          resourceId: recordId,
          status: 'ok',
          reason: `${changed.join(', ')}; new row ${successor.id} supersedes ${recordId}`,
          ip: actor.ip,
        },
        manager,
      );
      return successor;
    });
  }

  // The review queue: current rows (not superseded) by review status.
  async listContentFeatures(query: ListContentFeaturesQueryDto) {
    const where = {
      supersededBy: IsNull(),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.titleId ? { titleId: query.titleId } : {}),
      ...(query.featureKey ? { featureKey: query.featureKey } : {}),
      ...(query.extractorVersion ? { extractorVersion: query.extractorVersion } : {}),
    };
    const [items, total] = await this.contentFeatures.findAndCount({
      where,
      order: { validFrom: 'ASC', featureKey: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      relations: { title: true },
    });
    return {
      items: items.map((feature) => this.featureRow(feature)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  // BP §15.4 acceptance: a random sample of unreviewed current rows for a
  // human to check against the film.
  async sampleContentFeatures(query: SampleContentFeaturesQueryDto) {
    const qb = this.contentFeatures
      .createQueryBuilder('feature')
      .leftJoinAndSelect('feature.title', 'title')
      .where('feature.supersededBy IS NULL')
      .andWhere("feature.reviewStatus = 'unreviewed'");
    if (query.extractorVersion) {
      qb.andWhere('feature.extractorVersion = :v', { v: query.extractorVersion });
    }
    // limit(), not take(): take() wraps a joined query in a DISTINCT
    // subquery, and Postgres refuses ORDER BY RANDOM() there.
    const items = await qb.orderBy('RANDOM()').limit(query.size).getMany();
    return { items: items.map((feature) => this.featureRow(feature)), size: items.length };
  }

  async reviewContentFeature(featureId: string, dto: ReviewContentFeatureDto, actor: Actor) {
    const feature = await this.contentFeatures.findOne({ where: { id: featureId } });
    if (!feature) {
      throw new NotFoundException('Content feature not found');
    }
    return this.dataSource.transaction(async (manager) => {
      let correction: ContentFeature | null = null;
      if (dto.correctedValue !== undefined && dto.correctedValue !== feature.value) {
        // A correction is a new row; the extracted one is kept and marked
        // superseded (SCHEMA.md §1: originals are never edited in place).
        correction = await manager.save(
          manager.create(ContentFeature, {
            titleId: feature.titleId,
            featureKey: feature.featureKey,
            value: dto.correctedValue,
            distribution: null,
            uncertainty: 0,
            sourceIds: [],
            extractorVersion: HUMAN_REVIEW_EXTRACTOR,
            licenseStatus: feature.licenseStatus,
            reviewStatus: 'human_verified',
            validFrom: new Date(),
          }),
        );
        feature.supersededBy = correction.id;
      }
      feature.reviewStatus = dto.reviewStatus;
      const saved = await manager.save(feature);
      const republish = correction ? await this.republishTitleFingerprint(manager, feature.titleId) : null;
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'admin.content_feature.review',
          resource: 'content_feature',
          resourceId: featureId,
          status: 'ok',
          reason: [
            `${feature.featureKey} -> ${dto.reviewStatus}`,
            correction ? `corrected ${feature.value} -> ${correction.value} (${correction.id})` : null,
            republish && republish.changes.length > 0 ? `fingerprint republished (${republish.changes.length} key(s))` : null,
            dto.note ?? null,
          ]
            .filter(Boolean)
            .join('; '),
          ip: actor.ip,
        },
        manager,
      );
      return { feature: saved, correction, republish };
    });
  }

  private featureRow(feature: ContentFeature) {
    const { title, ...rest } = feature;
    return { ...rest, title: title ? { id: title.id, internalId: title.internalId, titleEn: title.titleEn, titleAr: title.titleAr } : null };
  }

  private async requireTitle(titleId: string, manager?: EntityManager): Promise<Title> {
    const title = await (manager ? manager.findOne(Title, { where: { id: titleId } }) : this.titles.findOne({ where: { id: titleId } }));
    if (!title) {
      throw new NotFoundException('Title not found');
    }
    return title;
  }

  // ADMIN-W4 (ADM-P0-02, the plan's own highest operational risk): a
  // correction in reviewContentFeature() used to write a new content_features
  // row and stop -- titles.fingerprint (what recommendation code actually
  // reads) never learned about it until someone remembered to run the
  // standalone republish-fingerprint script. Folding this into the same
  // transaction makes the correction's effect on the live fingerprint
  // immediate and atomic with the correction itself, using the exact overlay
  // rules already proven in republish-fingerprint.lib.ts/.ts (ADR-19: never
  // invents or blanks a value; a key with no current row is left as
  // published). Returns null when the title has no published fingerprint yet
  // -- there is nothing to fold a correction onto.
  private async republishTitleFingerprint(
    manager: EntityManager,
    titleId: string,
  ): Promise<{ changes: { featureKey: string; before: number | null; after: number }[] } | null> {
    const title = await manager.findOne(Title, { where: { id: titleId } });
    if (!title || !title.fingerprint) {
      return null;
    }
    const currentRows = await manager.find(ContentFeature, { where: { titleId, supersededBy: IsNull() } });
    const { fingerprint, changes } = republishFingerprint(
      title.fingerprint as unknown as Record<string, unknown>,
      currentRows.map((row) => ({ featureKey: row.featureKey, value: row.value, uncertainty: row.uncertainty })),
      FINGERPRINT_V2_DIMENSIONS,
      FINGERPRINT_V3_DIMENSIONS,
    );
    if (changes.length > 0) {
      await manager.update(Title, titleId, { fingerprint: fingerprint as unknown as Title['fingerprint'] });
    }
    return { changes };
  }

  private async decorate(rows: Title[]): Promise<AdminTitleRow[]> {
    if (!rows.length) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const records = await this.sourceRecords.find({ where: { titleId: In(ids) }, select: { titleId: true, licenseStatus: true } });
    const unreviewed = await this.contentFeatures
      .createQueryBuilder('feature')
      .select('feature.titleId', 'titleId')
      .addSelect('COUNT(*)', 'count')
      .where('feature.titleId IN (:...ids)', { ids })
      .andWhere('feature.supersededBy IS NULL')
      .andWhere("feature.reviewStatus = 'unreviewed'")
      .groupBy('feature.titleId')
      .getRawMany<{ titleId: string; count: string }>();
    const unreviewedByTitle = new Map(unreviewed.map((row) => [row.titleId, Number(row.count)]));
    return rows.map((title) => {
      const own = records.filter((record) => record.titleId === title.id);
      const v2 = (title.fingerprint as unknown as { v2?: { features?: Record<string, unknown> } } | null)?.v2?.features;
      return {
        id: title.id,
        internalId: title.internalId,
        titleEn: title.titleEn,
        titleAr: title.titleAr,
        releaseYear: title.releaseYear ?? null,
        originalLanguage: title.originalLanguage ?? null,
        hasFingerprint: title.fingerprint !== null && title.fingerprint !== undefined,
        hasV2: !!v2 && FINGERPRINT_V2_DIMENSIONS.every((key) => typeof v2[key] === 'number'),
        licenseStatus: worstLicense(own.map((record) => record.licenseStatus)),
        sourceRecords: own.length,
        unreviewedFeatures: unreviewedByTitle.get(title.id) ?? 0,
        updatedAt: title.updatedAt,
      };
    });
  }
}
