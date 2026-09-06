import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CatalogIntake, type CatalogIntakeStatus, type IntakeProvenance } from '../../entities/catalog-intake.entity';
import { Title } from '../../entities/title.entity';
import { ID_PROVIDERS } from '../../scripts/catalog-identity';
import { sanitizeError } from '../training/training-jobs.service';
import type { DiscoveredCandidate, ResolvedFacts } from './sources/catalog-source';
import {
  INTAKE_EVALUATOR_VERSION,
  evaluateIntake,
  findPossibleDuplicate,
  normalizeTitleKey,
  statusFor,
  type DuplicateProbe,
  type IntakeEvaluation,
} from './intake-evaluator';

// CAT-J1 (ADR-121): every write to `catalog_intake`, and the two reads the
// control center needs. Nothing here touches `titles` -- `titles` is only
// READ, to answer "is this provider id already admitted?" and to build the
// soft-duplicate probe. Admission (the one write that would create a title)
// lives in `catalog_admit`, which refuses until PUB-G1 is confirmed live.

export interface IntakeUpsertOutcome {
  id: string;
  created: boolean;
  status: CatalogIntakeStatus;
  evaluation: IntakeEvaluation;
}

export interface IntakeListQuery {
  status?: CatalogIntakeStatus;
  blockerCode?: string;
  source?: string;
  page: number;
  limit: number;
}

@Injectable()
export class CatalogIntakeService {
  constructor(
    @InjectRepository(CatalogIntake)
    private readonly intake: Repository<CatalogIntake>,
    @InjectRepository(Title)
    private readonly titles: Repository<Title>,
  ) {}

  /** `titles.internalId` for every admitted provider id -- the exact-duplicate lookup, one query. */
  async admittedIdentityIndex(): Promise<Map<string, string>> {
    const rows = await this.titles.find({ select: { internalId: true, externalIds: true } });
    const index = new Map<string, string>();
    for (const row of rows) {
      for (const provider of ID_PROVIDERS) {
        const value = row.externalIds?.[provider];
        if (value) index.set(`${provider}:${value}`, row.internalId);
      }
    }
    return index;
  }

  /** Normalized (title, year) of every admitted title plus every other intake row, for the soft-duplicate flag. */
  async duplicateProbes(excludeIntakeId?: string): Promise<DuplicateProbe[]> {
    const [titles, intake] = await Promise.all([
      this.titles.find({ select: { internalId: true, titleEn: true, releaseYear: true } }),
      this.intake.find({ select: { id: true, titleEn: true, releaseYear: true, status: true } }),
    ]);
    const probes: DuplicateProbe[] = [];
    for (const row of titles) {
      if (row.titleEn) probes.push({ key: normalizeTitleKey(row.titleEn), year: row.releaseYear ?? null, ref: row.internalId });
    }
    for (const row of intake) {
      if (row.id !== excludeIntakeId && row.titleEn && row.status !== 'duplicate') {
        probes.push({ key: normalizeTitleKey(row.titleEn), year: row.releaseYear ?? null, ref: `intake:${row.id}` });
      }
    }
    return probes;
  }

  /** The existing intake row sharing any provider id with the candidate, if one exists. */
  async findByProviderIds(ids: { wikidataId?: string | null; imdbId?: string | null; tmdbId?: string | null }): Promise<CatalogIntake | null> {
    const where: Record<string, string>[] = [];
    if (ids.wikidataId) where.push({ wikidataId: ids.wikidataId });
    if (ids.imdbId) where.push({ imdbId: ids.imdbId });
    if (ids.tmdbId) where.push({ tmdbId: ids.tmdbId });
    if (where.length === 0) return null;
    return this.intake.findOne({ where });
  }

  /**
   * Record one discovered candidate: a new row, or the existing row for the
   * same provider ids re-evaluated. `facts` is what the source resolved
   * (null = the fetch failed; the row keeps its last good values and gains
   * SOURCE_FETCH_FAILED). Provider ids on an existing row are never changed
   * or removed -- only added when previously null (ADR-116's cumulative rule,
   * applied before admission too). Rows already `admitted` are left alone.
   */
  async recordCandidate(
    candidate: DiscoveredCandidate,
    facts: ResolvedFacts | null,
    fetchError: string | null,
    context: { admittedIndex: Map<string, string>; probes: DuplicateProbe[]; now: Date; dryRun: boolean },
  ): Promise<IntakeUpsertOutcome> {
    const existing = await this.findByProviderIds({
      wikidataId: candidate.wikidataId ?? facts?.wikidataId,
      imdbId: candidate.imdbId ?? facts?.imdbId,
      tmdbId: candidate.tmdbId ?? facts?.tmdbId,
    });
    if (existing?.status === 'admitted') {
      return { id: existing.id, created: false, status: 'admitted', evaluation: evaluateIntake({}) };
    }

    const row = existing ?? this.intake.create({ source: candidate.source, status: 'discovered', genres: [], countries: [], provenance: {}, attempts: 0 });
    const keepOrAdd = (current: string | null | undefined, incoming: string | null | undefined) => current ?? incoming ?? null;
    row.wikidataId = keepOrAdd(row.wikidataId, candidate.wikidataId ?? facts?.wikidataId);
    row.imdbId = keepOrAdd(row.imdbId, candidate.imdbId ?? facts?.imdbId);
    row.tmdbId = keepOrAdd(row.tmdbId, candidate.tmdbId ?? facts?.tmdbId);
    row.criteria = { ...(row.criteria ?? {}), ...candidate.criteria, ...(candidate.sitelinks !== null ? { sitelinks: candidate.sitelinks } : {}) };
    row.attempts += 1;
    row.lastAttemptAt = context.now;

    const provenance: Record<string, IntakeProvenance> = { ...(row.provenance ?? {}) };
    if (facts) {
      const set = <T>(field: keyof CatalogIntake & string, fact: { value: T; provenance: IntakeProvenance } | null) => {
        if (!fact) return;
        (row as unknown as Record<string, unknown>)[field] = fact.value;
        provenance[field] = fact.provenance;
      };
      set('titleEn', facts.titleEn);
      set('titleAr', facts.titleAr);
      set('description', facts.description);
      set('descriptionAr', facts.descriptionAr);
      set('releaseYear', facts.releaseYear);
      set('genres', facts.genres);
      set('originalLanguage', facts.originalLanguage);
      set('countries', facts.countries);
      if (facts.titleEn === null && candidate.titleEn) row.titleEn = row.titleEn ?? candidate.titleEn;
      row.lastError = null;
    } else {
      row.lastError = fetchError ? sanitizeError(fetchError) : 'source fetch failed';
      if (!row.titleEn && candidate.titleEn) row.titleEn = candidate.titleEn;
      if (row.releaseYear === null && candidate.year !== null) row.releaseYear = candidate.year;
    }
    row.provenance = provenance;

    // Duplicates: exact (a provider id already in `titles`) beats suspected.
    const duplicateOfTitle =
      ID_PROVIDERS.map((provider) => {
        const value = row[`${provider}Id` as 'wikidataId' | 'imdbId' | 'tmdbId'];
        return value ? context.admittedIndex.get(`${provider}:${value}`) ?? null : null;
      }).find((hit) => hit !== null) ?? null;
    const possibleDuplicateOf = duplicateOfTitle ? null : findPossibleDuplicate({ titleEn: row.titleEn, releaseYear: row.releaseYear }, context.probes);

    const evaluation = evaluateIntake({
      wikidataId: row.wikidataId,
      imdbId: row.imdbId,
      tmdbId: row.tmdbId,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      description: row.description,
      descriptionIsStub: facts?.descriptionIsStub ?? false,
      releaseYear: row.releaseYear,
      expectedYear: candidate.year,
      genres: row.genres,
      unmappedGenres: facts?.unmappedGenres ?? null,
      posterPath: row.posterPath,
      isFilm: facts?.isFilm ?? null,
      duplicateOfTitle,
      possibleDuplicateOf,
      sourceFetchFailed: facts === null,
    });
    row.evaluatorVersion = INTAKE_EVALUATOR_VERSION;
    row.blockerCodes = evaluation.blockerCodes;
    row.evaluatedAt = context.now;
    row.duplicateOf = duplicateOfTitle ?? possibleDuplicateOf;
    row.status = facts === null && !existing ? 'discovered' : statusFor(evaluation);

    if (!context.dryRun) {
      await this.intake.save(row);
    }
    return { id: row.id ?? '(dry-run)', created: !existing, status: row.status, evaluation };
  }

  async list(query: IntakeListQuery) {
    const qb = this.intake.createQueryBuilder('intake').orderBy('intake.updatedAt', 'DESC');
    if (query.status) qb.andWhere('intake.status = :status', { status: query.status });
    if (query.source) qb.andWhere('intake.source = :source', { source: query.source });
    if (query.blockerCode) qb.andWhere(':code = ANY(intake."blockerCodes")', { code: query.blockerCode });
    const total = await qb.getCount();
    const items = await qb.skip((query.page - 1) * query.limit).take(query.limit).getMany();
    return { items, page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(id: string): Promise<CatalogIntake | null> {
    return this.intake.findOne({ where: { id } });
  }

  async stats(): Promise<{ total: number; byStatus: Record<string, number>; byBlockerCode: Record<string, number>; lastAttemptAt: Date | null }> {
    const byStatusRows = await this.intake
      .createQueryBuilder('intake')
      .select('intake.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('intake.status')
      .getRawMany<{ status: string; count: string }>();
    const byCodeRows = await this.intake
      .createQueryBuilder('intake')
      .select('code')
      .addSelect('COUNT(*)', 'count')
      .from((qb) => qb.select('unnest(intake."blockerCodes")', 'code').from(CatalogIntake, 'intake'), 'codes')
      .groupBy('code')
      .getRawMany<{ code: string; count: string }>()
      .catch(() => [] as { code: string; count: string }[]);
    const last = await this.intake
      .createQueryBuilder('intake')
      .select('MAX(intake."lastAttemptAt")', 'last')
      .getRawOne<{ last: Date | string | null }>();
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of byStatusRows) {
      byStatus[row.status] = Number(row.count);
      total += Number(row.count);
    }
    const byBlockerCode: Record<string, number> = {};
    for (const row of byCodeRows) byBlockerCode[row.code] = Number(row.count);
    return { total, byStatus, byBlockerCode, lastAttemptAt: last?.last ? new Date(last.last) : null };
  }

  /** Candidates a re-verify pass should refresh: not admitted, not exact duplicates. */
  async pendingForReverify(limit: number): Promise<CatalogIntake[]> {
    return this.intake.find({
      where: { status: In(['discovered', 'blocked', 'verified'] as CatalogIntakeStatus[]) },
      order: { lastAttemptAt: 'ASC' },
      take: limit,
    });
  }
}
