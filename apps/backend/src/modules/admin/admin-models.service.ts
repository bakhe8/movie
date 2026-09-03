import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { Experiment } from '../../entities/experiment.entity';
import { ExperimentAssignment } from '../../entities/experiment-assignment.entity';
import { ModelVersion } from '../../entities/model-version.entity';
import { Triad } from '../../entities/triad.entity';
import { UserModelSnapshot } from '../../entities/user-model-snapshot.entity';
import { AuditService } from '../audit/audit.service';
import type { Actor } from './admin-catalog.service';
import { CreateModelVersionDto, UpdateModelVersionDto } from './dto/admin.dto';

export interface SnapshotStats {
  modelVersion: string;
  snapshots: number;
  profiles: number;
  latestAt: Date | null;
  meanHeldOutPairwiseAccuracy: number | null;
  meanHeldOutNll: number | null;
}

// Internal board, model half (BP §5.1 "model versions", §16.5 acceptance
// gate, §18.1 rollback; SPECIFICATION §5.5). model_versions rows are
// registered by hand until the trainer stamps them (ALPHA_PLAN 6.4);
// `active` marks the version the product serves -- exactly one at a time.
// Nothing reads `active` yet (RecommendationsService serves the latest
// snapshot per profile); wiring that read is the model-service owner's
// (board request), the pin itself lives here.
@Injectable()
export class AdminModelsService {
  constructor(
    @InjectRepository(ModelVersion)
    private readonly modelVersions: Repository<ModelVersion>,
    @InjectRepository(UserModelSnapshot)
    private readonly snapshots: Repository<UserModelSnapshot>,
    @InjectRepository(Experiment)
    private readonly experiments: Repository<Experiment>,
    @InjectRepository(ExperimentAssignment)
    private readonly assignments: Repository<ExperimentAssignment>,
    @InjectRepository(Triad)
    private readonly triads: Repository<Triad>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  // Registered versions side by side with what the snapshots table actually
  // holds, so a version that was trained but never registered still shows.
  async listModels() {
    const registered = await this.modelVersions.find({ order: { createdAt: 'DESC' } });
    const stats = await this.snapshotStats();
    const known = new Set(registered.map((row) => row.version));
    return {
      versions: registered.map((row) => ({ ...row, stats: stats.find((s) => s.modelVersion === row.version) ?? null })),
      unregistered: stats.filter((s) => !known.has(s.modelVersion)),
    };
  }

  async registerModel(dto: CreateModelVersionDto, actor: Actor): Promise<ModelVersion> {
    const existing = await this.modelVersions.findOne({ where: { version: dto.version } });
    if (existing) {
      throw new ConflictException({ statusCode: 409, message: 'Model version already registered', error: 'Conflict', reason: 'exists' });
    }
    const saved = await this.modelVersions.save(
      this.modelVersions.create({
        version: dto.version,
        rankerType: dto.rankerType,
        fingerprintSchemaVersion: dto.fingerprintSchemaVersion,
        codeRef: dto.codeRef ?? null,
        features: dto.features ?? null,
        thresholds: dto.thresholds ?? null,
        evalReport: dto.evalReport ?? null,
        active: false,
      }),
    );
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.model_version.register',
      resource: 'model_version',
      resourceId: null,
      status: 'ok',
      reason: `${dto.version} (${dto.rankerType}, ${dto.fingerprintSchemaVersion})`,
      ip: actor.ip,
    });
    return saved;
  }

  // Activation is the rollback control of BP §18.1: pin a version, and
  // pinning another later is the rollback. One active row at a time.
  async updateModel(version: string, dto: UpdateModelVersionDto, actor: Actor): Promise<ModelVersion> {
    const row = await this.modelVersions.findOne({ where: { version } });
    if (!row) {
      throw new NotFoundException('Model version not found');
    }
    return this.dataSource.transaction(async (manager) => {
      if (dto.active === true) {
        await manager.update(ModelVersion, { version: Not(version), active: true }, { active: false });
        row.active = true;
      } else if (dto.active === false) {
        row.active = false;
      }
      if (dto.evalReport !== undefined) row.evalReport = dto.evalReport;
      if (dto.thresholds !== undefined) row.thresholds = dto.thresholds;
      const saved = await manager.save(row);
      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          action: dto.active === true ? 'admin.model_version.activate' : 'admin.model_version.update',
          resource: 'model_version',
          resourceId: null,
          status: 'ok',
          reason: `${version} active=${saved.active}`,
          ip: actor.ip,
        },
        manager,
      );
      return saved;
    });
  }

  async listExperiments() {
    const rows = await this.experiments.find({ order: { startedAt: 'DESC' } });
    const counts = await this.assignments
      .createQueryBuilder('a')
      .select('a.experimentId', 'experimentId')
      .addSelect('a.arm', 'arm')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.experimentId')
      .addGroupBy('a.arm')
      .getRawMany<{ experimentId: string; arm: string; count: string }>();
    return rows.map((experiment) => ({
      ...experiment,
      arms: counts
        .filter((c) => c.experimentId === experiment.id)
        .reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.arm]: Number(c.count) }), {}),
    }));
  }

  // API.md §2.2 `triads/latest`: the newest completed rounds, as events --
  // pseudonymous profile ids only, never an email.
  async latestTriads(limit: number) {
    const rows = await this.triads.find({
      where: { status: 'completed' },
      order: { answeredAt: 'DESC', createdAt: 'DESC' },
      take: limit,
      select: {
        id: true,
        profileId: true,
        titleIds: true,
        ranking: true,
        policyVersion: true,
        modelVersion: true,
        selectionPropensity: true,
        shownAt: true,
        answeredAt: true,
        createdAt: true,
      },
    });
    return rows;
  }

  private async snapshotStats(): Promise<SnapshotStats[]> {
    const raw = await this.snapshots
      .createQueryBuilder('s')
      .select('s.modelVersion', 'modelVersion')
      .addSelect('COUNT(*)', 'snapshots')
      .addSelect('COUNT(DISTINCT s.profileId)', 'profiles')
      .addSelect('MAX(s.createdAt)', 'latestAt')
      .addSelect('AVG(s.heldOutPairwiseAccuracy)', 'acc')
      .addSelect('AVG(s.heldOutNll)', 'nll')
      .groupBy('s.modelVersion')
      .orderBy('MAX(s.createdAt)', 'DESC')
      .getRawMany<{ modelVersion: string; snapshots: string; profiles: string; latestAt: Date | null; acc: string | null; nll: string | null }>();
    return raw.map((row) => ({
      modelVersion: row.modelVersion,
      snapshots: Number(row.snapshots),
      profiles: Number(row.profiles),
      latestAt: row.latestAt,
      meanHeldOutPairwiseAccuracy: row.acc === null ? null : Number(row.acc),
      meanHeldOutNll: row.nll === null ? null : Number(row.nll),
    }));
  }
}
