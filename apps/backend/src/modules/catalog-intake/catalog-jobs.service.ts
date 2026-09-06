import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SourceRecord } from '../../entities/source-record.entity';
import { Title } from '../../entities/title.entity';
import { AdminJobsService, NonRetryableJobError, type AdminJobRunContext, type AdminJobTypeDef } from '../admin/admin-jobs.service';
import { CatalogIntakeService } from './catalog-intake.service';
import { reconcileCatalog } from './catalog-reconcile.lib';
import { verifyCatalog } from './catalog-verify.lib';
import { loadCatalogFixtures } from './fixtures';
import type { CatalogSourceAdapter, DiscoveryCriteria, SourceRunContext } from './sources/catalog-source';
import { MAX_DISCOVERY_LIMIT } from './sources/wikidata.lib';
import { WikidataSource } from './sources/wikidata.source';

export const CATALOG_JOB_TYPES = {
  verify: 'catalog_verify',
  reconcile: 'catalog_reconcile',
  pull: 'catalog_pull',
  admit: 'catalog_admit',
} as const;

// CAT-J1 (ADR-121): admission into `titles` stays refused until the
// coordinator confirms PUB-G1 is live on every public surface AND grants an
// explicit go. `0585dca` wired the guard; the go has not been given. Flipping
// this constant is that go -- a reviewed commit, never a runtime setting.
export const ADMIT_ENABLED = false;
export const ADMIT_DISABLED_REASON = 'DEPENDENCY_DISABLED: PUB-G1 not confirmed live; catalog_admit refuses by design until the coordinator authorises admission (ADR-121)';

// How often a long handler touches its admin_jobs row so the 5-minute
// running lease (keyed on `updatedAt`) never expires under legitimate
// network work: at least every HEARTBEAT_MS, or every HEARTBEAT_ITEMS.
const HEARTBEAT_MS = 30_000;
const HEARTBEAT_ITEMS = 10;
const DEFAULT_REVERIFY_LIMIT = 50;
const MAX_REVERIFY_LIMIT = 200;
const SAMPLE_LIMIT = 25;

const QID = /^Q[1-9]\d*$/;

// The J1 job types (board 1D-8 / D1000-3 / D1000-5), registered into
// ADMIN-W5's allowlist at module init through `registerType`, so this scope
// never edits an ADMIN-owned file. Two are read-only reports over what is
// already admitted (J1a); one pulls candidates into `catalog_intake` (J1b);
// the last exists so the allowlist and the control center already know the
// admit step by name, and refuses every call until G1 is confirmed.
@Injectable()
export class CatalogJobsService implements OnModuleInit {
  private readonly logger = new Logger(CatalogJobsService.name);
  private readonly sources = new Map<string, CatalogSourceAdapter>();
  private jobs: AdminJobsService | null = null;

  constructor(
    private readonly adminJobs: AdminJobsService,
    private readonly intake: CatalogIntakeService,
    @InjectRepository(Title)
    private readonly titles: Repository<Title>,
    @InjectRepository(SourceRecord)
    private readonly sourceRecords: Repository<SourceRecord>,
    wikidata: WikidataSource,
  ) {
    this.sources.set(wikidata.key, wikidata);
  }

  // ADMIN-W5's extension point (board request J1-1): AdminModule exports the
  // job center and `registerType` throws on a duplicate key, so a second
  // module claiming `catalog_*` is a deploy-time error, never last-write-wins.
  onModuleInit(): void {
    for (const def of this.typeDefs()) {
      this.adminJobs.registerType(def);
    }
    this.jobs = this.adminJobs;
  }

  /** The job center, once registration succeeded (the scheduler enqueues through it). */
  get jobCenter(): AdminJobsService | null {
    return this.jobs;
  }

  sourceKeys(): string[] {
    return [...this.sources.keys()];
  }

  typeDefs(): AdminJobTypeDef[] {
    return [
      {
        key: CATALOG_JOB_TYPES.verify,
        description:
          'يفحص كل فيلم مُدرَج في الكتالوج بقواعد intake-v1 (الهوية الثلاثية، العنوانان، الوصف، الأنواع، البوستر، السنة، البصمة)، ويطابق المُدرَج مع الهويات المحجوزة وسجل التطوير، ويعدّ صفوف الحقوق الناقصة. قراءة فقط؛ لا يغيّر شيئاً.',
        handler: (params, ctx) => this.verifyHandler(params, ctx),
      },
      {
        key: CATALOG_JOB_TYPES.reconcile,
        description:
          'يقارن ملف الكتالوج المُلتزَم (catalog.demo.json) مع جدول الأفلام حقلاً بحقل ويُخرج قائمة الفروق. قراءة فقط؛ الإصلاح قرار بشري لاحق (إعادة seed أو تعديل إداري مُدقَّق).',
        handler: (params, ctx) => this.reconcileHandler(params, ctx),
        validateParams: (params) => (params.driftLimit !== undefined && !(Number.isInteger(params.driftLimit) && Number(params.driftLimit) > 0) ? 'driftLimit must be a positive integer' : null),
      },
      {
        key: CATALOG_JOB_TYPES.pull,
        description:
          'يكتشف أفلاماً جديدة من مصدر (wikidata حالياً) وفق معايير (دول، سنوات، حدّ)، ويقيّمها بـ intake-v1، ويحفظها في طابور الإدخال catalog_intake فقط. لا يكتب إلى جدول الأفلام أبداً؛ الإدراج قرار بشري منفصل. مع dryRun يعرض ما كان سيُحفَظ دون حفظ.',
        handler: (params, ctx) => this.pullHandler(params, ctx),
        validateParams: (params) => this.validatePullParams(params),
      },
      {
        key: CATALOG_JOB_TYPES.admit,
        description:
          'إدراج مرشح من طابور الإدخال في الكتالوج. معطّل بالتصميم حتى يؤكد المنسّق وصل حارس النشر (PUB-G1) ويأذن صراحة؛ كل استدعاء يُرفض الآن بلا إعادة محاولة.',
        handler: () => this.admitHandler(),
        validateParams: (params) => (typeof params.intakeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(params.intakeId) ? 'intakeId (uuid) is required' : null),
      },
    ];
  }

  // ---- J1a: read-only reports ------------------------------------------

  private async verifyHandler(_params: Record<string, unknown>, ctx: AdminJobRunContext): Promise<Record<string, unknown>> {
    await ctx.reportProgress({ stage: 'loading' });
    const [titles, sourceRecords] = await Promise.all([
      this.titles.find({
        select: { id: true, internalId: true, titleEn: true, titleAr: true, description: true, releaseYear: true, genres: true, posterPath: true, externalIds: true, fingerprint: true },
      }),
      this.sourceRecords.find({ select: { titleId: true, fieldName: true, source: true, retentionUntil: true } }),
    ]);
    const fixtures = loadCatalogFixtures();
    await ctx.reportProgress({ stage: 'evaluating', titles: titles.length, sourceRecords: sourceRecords.length });
    const report = verifyCatalog({
      titles: titles.map((title) => ({ ...title, fingerprint: (title.fingerprint as unknown as Record<string, unknown> | null) ?? null })),
      sourceRecords,
      reserved: fixtures.reserved,
      staging: fixtures.staging,
      sampleLimit: SAMPLE_LIMIT,
    });
    return report as unknown as Record<string, unknown>;
  }

  private async reconcileHandler(params: Record<string, unknown>, ctx: AdminJobRunContext): Promise<Record<string, unknown>> {
    await ctx.reportProgress({ stage: 'loading' });
    const titles = await this.titles.find({
      select: { internalId: true, titleEn: true, titleAr: true, description: true, releaseYear: true, genres: true, originalLanguage: true, posterPath: true, externalIds: true },
    });
    const fixtures = loadCatalogFixtures();
    const driftLimit = typeof params.driftLimit === 'number' ? params.driftLimit : undefined;
    return reconcileCatalog(fixtures.catalog, titles, driftLimit) as unknown as Record<string, unknown>;
  }

  // ---- J1b: pull into intake ---------------------------------------------

  private validatePullParams(params: Record<string, unknown>): string | null {
    const source = params.source ?? 'wikidata';
    if (typeof source !== 'string' || !this.sources.has(source)) return `source must be one of: ${this.sourceKeys().join(', ')}`;
    const criteria = params.criteria;
    if (criteria !== undefined && (typeof criteria !== 'object' || criteria === null || Array.isArray(criteria))) return 'criteria must be an object';
    const c = (criteria ?? {}) as Record<string, unknown>;
    const discover = params.discover ?? true;
    if (typeof discover !== 'boolean') return 'discover must be a boolean';
    if (discover) {
      if (!Array.isArray(c.countryQids) || c.countryQids.length === 0 || !c.countryQids.every((qid) => typeof qid === 'string' && QID.test(qid))) {
        return 'criteria.countryQids must be a non-empty array of Wikidata QIDs (e.g. ["Q79"])';
      }
      for (const key of ['yearFrom', 'yearTo', 'minSitelinks', 'limit'] as const) {
        if (c[key] !== undefined && !Number.isInteger(c[key])) return `criteria.${key} must be an integer`;
      }
      if (typeof c.limit === 'number' && (c.limit < 1 || c.limit > MAX_DISCOVERY_LIMIT)) return `criteria.limit must be between 1 and ${MAX_DISCOVERY_LIMIT}`;
      if (c.excludeOriginalLanguages !== undefined && !(Array.isArray(c.excludeOriginalLanguages) && c.excludeOriginalLanguages.every((label) => typeof label === 'string'))) {
        return 'criteria.excludeOriginalLanguages must be an array of strings';
      }
    }
    if (params.reverify !== undefined && typeof params.reverify !== 'boolean') return 'reverify must be a boolean';
    if (params.reverifyLimit !== undefined && !(Number.isInteger(params.reverifyLimit) && Number(params.reverifyLimit) > 0 && Number(params.reverifyLimit) <= MAX_REVERIFY_LIMIT)) {
      return `reverifyLimit must be an integer between 1 and ${MAX_REVERIFY_LIMIT}`;
    }
    return null;
  }

  private async pullHandler(params: Record<string, unknown>, ctx: AdminJobRunContext): Promise<Record<string, unknown>> {
    const sourceKey = typeof params.source === 'string' ? params.source : 'wikidata';
    const source = this.sources.get(sourceKey);
    if (!source) throw new NonRetryableJobError(`unknown source '${sourceKey}'`);
    const criteria = (params.criteria ?? {}) as DiscoveryCriteria;
    const discover = params.discover !== false;
    const reverify = params.reverify === true;
    const reverifyLimit = typeof params.reverifyLimit === 'number' ? params.reverifyLimit : DEFAULT_REVERIFY_LIMIT;
    const now = new Date();

    const progress: Record<string, unknown> = { stage: 'discover', source: sourceKey, dryRun: ctx.dryRun };
    const heartbeat = this.heartbeat(ctx, progress);
    const runCtx: SourceRunContext = {
      isCancelled: () => ctx.isCancelled(),
      heartbeat: (done, total) => heartbeat({ done, total }),
    };

    const admittedIndex = await this.intake.admittedIdentityIndex();
    const byStatus: Record<string, number> = {};
    const byCode: Record<string, number> = {};
    const sample: { wikidataId: string | null; titleEn: string | null; status: string; blockerCodes: string[] }[] = [];
    let discovered = 0;
    let alreadyAdmitted = 0;
    let created = 0;
    let updated = 0;
    let fetchFailed = 0;

    const record = async (candidate: Parameters<CatalogIntakeService['recordCandidate']>[0], outcome: Awaited<ReturnType<CatalogSourceAdapter['resolveMany']>> extends Map<string, infer O> ? O | undefined : never) => {
      const probes = await this.intake.duplicateProbes();
      const facts = outcome?.ok ? outcome.facts : null;
      const error = outcome && !outcome.ok ? outcome.error : outcome === undefined ? 'source returned no entity' : null;
      if (!facts) fetchFailed += 1;
      const result = await this.intake.recordCandidate(candidate, facts, error, { admittedIndex, probes, now, dryRun: ctx.dryRun });
      if (result.status === 'admitted') return;
      if (result.created) created += 1;
      else updated += 1;
      byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
      for (const code of result.evaluation.blockerCodes) byCode[code] = (byCode[code] ?? 0) + 1;
      if (sample.length < SAMPLE_LIMIT) {
        sample.push({ wikidataId: candidate.wikidataId, titleEn: candidate.titleEn, status: result.status, blockerCodes: result.evaluation.blockerCodes });
      }
    };

    if (discover) {
      const candidates = await source.discover(criteria, runCtx);
      discovered = candidates.length;
      // Anything whose provider id is already in `titles` is not a candidate
      // at all -- it is counted, never re-fetched, never written.
      const fresh = candidates.filter((candidate) => {
        const hit =
          (candidate.wikidataId && admittedIndex.get(`wikidata:${candidate.wikidataId}`)) ||
          (candidate.imdbId && admittedIndex.get(`imdb:${candidate.imdbId}`)) ||
          (candidate.tmdbId && admittedIndex.get(`tmdb:${candidate.tmdbId}`));
        if (hit) alreadyAdmitted += 1;
        return !hit;
      });
      progress.stage = 'resolve';
      progress.discovered = discovered;
      progress.alreadyAdmitted = alreadyAdmitted;
      await heartbeat({ done: 0, total: fresh.length });
      const outcomes = await source.resolveMany(fresh.map((candidate) => candidate.wikidataId).filter((id): id is string => !!id), runCtx);
      progress.stage = 'record';
      let done = 0;
      for (const candidate of fresh) {
        if (await ctx.isCancelled()) break;
        await record(candidate, candidate.wikidataId ? outcomes.get(candidate.wikidataId) : undefined);
        done += 1;
        await heartbeat({ done, total: fresh.length, created, updated });
      }
    }

    let reverified = 0;
    if (reverify && !(await ctx.isCancelled())) {
      progress.stage = 'reverify';
      const pending = (await this.intake.pendingForReverify(reverifyLimit)).filter((row) => row.source === sourceKey && row.wikidataId);
      const outcomes = await source.resolveMany(pending.map((row) => row.wikidataId!), runCtx);
      for (const row of pending) {
        if (await ctx.isCancelled()) break;
        await record(
          {
            source: row.source,
            wikidataId: row.wikidataId,
            imdbId: row.imdbId,
            tmdbId: row.tmdbId,
            titleEn: row.titleEn,
            year: typeof row.criteria?.expectedYear === 'number' ? (row.criteria.expectedYear as number) : row.releaseYear,
            sitelinks: null,
            originalLanguageLabel: null,
            criteria: {},
          },
          outcomes.get(row.wikidataId!),
        );
        reverified += 1;
        await heartbeat({ done: reverified, total: pending.length });
      }
    }

    return { source: sourceKey, dryRun: ctx.dryRun, discovered, alreadyAdmitted, created, updated, reverified, fetchFailed, byStatus, byCode, sample };
  }

  // ---- admit: refuses until PUB-G1 is confirmed and authorised -----------

  private async admitHandler(): Promise<Record<string, unknown>> {
    if (!ADMIT_ENABLED) {
      throw new NonRetryableJobError(ADMIT_DISABLED_REASON);
    }
    // Unreachable until ADMIT_ENABLED flips in a reviewed commit; the real
    // admission (row lock on titles + cumulative-identity preflight + INSERT
    // titles/source_records + audit + readback) lands in that same commit.
    throw new NonRetryableJobError('catalog_admit is not implemented yet');
  }

  // ---- helpers -------------------------------------------------------------

  private heartbeat(ctx: AdminJobRunContext, progress: Record<string, unknown>): (patch: Record<string, unknown>) => Promise<void> {
    let lastReport = 0;
    let sinceReport = 0;
    return async (patch) => {
      Object.assign(progress, patch);
      sinceReport += 1;
      const now = Date.now();
      if (now - lastReport >= HEARTBEAT_MS || sinceReport >= HEARTBEAT_ITEMS || lastReport === 0) {
        lastReport = now;
        sinceReport = 0;
        await ctx.reportProgress({ ...progress, at: new Date(now).toISOString() });
      }
    };
  }
}
