import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminSetting } from '../../entities/admin-setting.entity';
import { AdminSettingVersion } from '../../entities/admin-setting-version.entity';
import { AuditService } from '../audit/audit.service';
import type { Actor } from './admin-catalog.service';

export interface AdminSettingDef<T = unknown> {
  key: string;
  // Plain-language label and explanation -- the same admin-copy.ts
  // discipline as everywhere else in this board; shown in the settings form.
  name: string;
  description: string;
  unit: string | null;
  type: 'number' | 'boolean' | 'string';
  // The value used when no admin has ever published an override and (when
  // set) `envVar` is absent from the environment -- the 'default' source.
  defaultValue: T;
  // Checked as the 'deploy' source when no control-plane override exists.
  // Parsed by `type` the same way the value itself is validated.
  envVar?: string;
  // Returns an error message when `value` is unusable for this setting, or
  // null when it is fine -- checked on both preview and publish, and again
  // on rollback in case the definition's constraints changed since the
  // historical value was published.
  validate: (value: unknown) => string | null;
  // Display-only today (no restart orchestration exists yet): a setting
  // marked true still takes effect only after the next deploy/restart, and
  // the admin publishing it should be told so up front.
  needsRestart: boolean;
}

export type SettingSource = 'default' | 'deploy' | 'control_plane';

export interface AdminSettingView {
  key: string;
  name: string;
  description: string;
  unit: string | null;
  type: 'number' | 'boolean' | 'string';
  value: unknown;
  source: SettingSource;
  version: number;
  needsRestart: boolean;
  modifiedBy: string | null;
  modifiedAt: string | null;
  reason: string | null;
}

// ADMIN-W6 (plan §17.3): a typed, versioned settings registry -- no generic
// JSON/env editor. `registerSetting` mirrors AdminJobsService.registerType
// (ADMIN-W5 item 9): another module can extend the registry without editing
// this file, and AdminModule exports this service for exactly that.
// Definitions and their live values are cached in memory (refreshed on
// every publish) so `getValue()` is cheap enough for a hot read path --
// the "cache invalidation" the plan's W6 output list names.
@Injectable()
export class AdminSettingsService {
  private readonly definitions = new Map<string, AdminSettingDef>();
  private readonly cache = new Map<string, { value: unknown; source: SettingSource }>();
  private cacheLoaded = false;

  constructor(
    @InjectRepository(AdminSetting)
    private readonly rows: Repository<AdminSetting>,
    @InjectRepository(AdminSettingVersion)
    private readonly versions: Repository<AdminSettingVersion>,
    private readonly audit: AuditService,
  ) {
    this.registerSetting({
      key: 'catalog.min_titles',
      name: 'أدنى عدد أفلام لبدء التدريب',
      description: 'إن كان عدد أفلام الكتالوج أقل من هذا الرقم، يُعتبر النظام غير جاهز لبناء نماذج ذوق موثوقة.',
      unit: 'فيلم',
      type: 'number',
      defaultValue: 200,
      envVar: 'CATALOG_MIN_TITLES',
      needsRestart: false,
      validate: (value) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000 ? null : 'يجب أن يكون عدداً صحيحاً بين 1 و100000'),
    });
    this.registerSetting({
      key: 'catalog.min_fingerprint_coverage',
      name: 'أدنى نسبة تحليل مكتمل',
      description: 'إن كانت نسبة الأفلام ذات التحليل المنشور أقل من هذه النسبة، يُعتبر التحليل غير كافٍ لتشكيل ثلاثيات تدريب موثوقة.',
      unit: '%',
      type: 'number',
      defaultValue: 0.5,
      needsRestart: false,
      validate: (value) => (typeof value === 'number' && value >= 0 && value <= 1 ? null : 'يجب أن يكون رقماً بين 0 و1 (مثال: 0.5 يعني 50%)'),
    });
  }

  // The extension point other modules register their own settings through
  // (same shape as AdminJobsService.registerType): inject
  // AdminSettingsService and call this from your own module's constructor.
  registerSetting(def: AdminSettingDef): void {
    if (this.definitions.has(def.key)) {
      throw new Error(`admin setting '${def.key}' is already registered`);
    }
    this.definitions.set(def.key, def);
  }

  // Cheap, synchronous read for another service's hot path (e.g.
  // AdminModelsService.readiness()) -- reads the in-memory cache, never the
  // database, so a setting genuinely affects runtime behaviour without a
  // restart the moment it is published (loaded lazily on first use so
  // module init order does not matter).
  async getValue<T = unknown>(key: string): Promise<T> {
    if (!this.cacheLoaded) {
      await this.loadCache();
    }
    const def = this.definitions.get(key);
    if (!def) {
      throw new Error(`admin setting '${key}' is not registered`);
    }
    return (this.cache.get(key)?.value ?? this.resolveNonPublished(def).value) as T;
  }

  async list(): Promise<AdminSettingView[]> {
    if (!this.cacheLoaded) {
      await this.loadCache();
    }
    const rows = await this.rows.find();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return [...this.definitions.values()].map((def) => this.toView(def, byKey.get(def.key) ?? null));
  }

  async get(key: string): Promise<{ setting: AdminSettingView; history: AdminSettingVersion[] }> {
    const def = this.requireDef(key);
    const row = await this.rows.findOne({ where: { key } });
    const history = await this.versions.find({ where: { key }, order: { version: 'DESC' }, take: 20 });
    return { setting: this.toView(def, row), history };
  }

  // No write: validates `value` against the definition and reports what
  // would change, for the settings form to show before the operator
  // confirms (plan §17.3 "معاينة أثر").
  async preview(key: string, value: unknown): Promise<{ valid: boolean; error: string | null; current: unknown; proposed: unknown; needsRestart: boolean }> {
    const def = this.requireDef(key);
    const error = def.validate(value);
    const current = await this.getValue(key);
    return { valid: !error, error, current, proposed: value, needsRestart: def.needsRestart };
  }

  async update(key: string, dto: { value: unknown; reason: string; expectedVersion?: number }, actor: Actor): Promise<AdminSettingView> {
    const def = this.requireDef(key);
    const error = def.validate(dto.value);
    if (error) {
      throw new BadRequestException({ statusCode: 400, message: error, error: 'Bad Request', reason: 'invalid_value' });
    }
    const existing = await this.rows.findOne({ where: { key } });
    if (dto.expectedVersion !== undefined && (existing?.version ?? 0) !== dto.expectedVersion) {
      throw new ConflictException({
        statusCode: 409,
        message: `Expected version ${dto.expectedVersion} but the current version is ${existing?.version ?? 0}`,
        error: 'Conflict',
        reason: 'version_conflict',
        currentVersion: existing?.version ?? 0,
        currentValue: existing?.value ?? this.resolveNonPublished(def).value,
      });
    }
    const nextVersion = (existing?.version ?? 0) + 1;
    await this.versions.save(
      this.versions.create({ key, value: dto.value, version: nextVersion, modifiedBy: actor.id, reason: dto.reason }),
    );
    await this.rows.save(
      this.rows.create({ key, value: dto.value, version: nextVersion, modifiedBy: actor.id, reason: dto.reason }),
    );
    this.cache.set(key, { value: dto.value, source: 'control_plane' });
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.setting.update',
      resource: 'admin_setting',
      // Not a uuid (audit_log.resourceId's column type) -- a settings key is
      // a plain string, so it goes in `reason` like model_versions'
      // registerModel does for its own non-uuid key (the version string).
      resourceId: null,
      status: 'ok',
      reason: `${key} v${nextVersion}: ${JSON.stringify(dto.value)} -- ${dto.reason}`,
      ip: actor.ip,
    });
    return this.toView(def, await this.rows.findOne({ where: { key } }));
  }

  // A rollback is a publish of an old value, never a rewrite of history --
  // the value is re-validated against the *current* definition first, in
  // case its constraints changed since that version was published.
  async rollback(key: string, toVersion: number, reason: string | undefined, actor: Actor): Promise<AdminSettingView> {
    const target = await this.versions.findOne({ where: { key, version: toVersion } });
    if (!target) {
      throw new NotFoundException(`Version ${toVersion} of '${key}' not found`);
    }
    return this.update(key, { value: target.value, reason: reason ?? `rollback to v${toVersion}` }, actor);
  }

  private requireDef(key: string): AdminSettingDef {
    const def = this.definitions.get(key);
    if (!def) {
      throw new NotFoundException(`Setting '${key}' not found`);
    }
    return def;
  }

  private async loadCache(): Promise<void> {
    const rows = await this.rows.find();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    for (const def of this.definitions.values()) {
      const row = byKey.get(def.key);
      this.cache.set(def.key, row ? { value: row.value, source: 'control_plane' } : this.resolveNonPublished(def));
    }
    this.cacheLoaded = true;
  }

  private resolveNonPublished(def: AdminSettingDef): { value: unknown; source: SettingSource } {
    if (def.envVar) {
      const raw = process.env[def.envVar];
      if (raw !== undefined && raw !== '') {
        const parsed = def.type === 'number' ? Number(raw) : def.type === 'boolean' ? raw === 'true' : raw;
        if (!def.validate(parsed)) {
          return { value: parsed, source: 'deploy' };
        }
      }
    }
    return { value: def.defaultValue, source: 'default' };
  }

  private toView(def: AdminSettingDef, row: AdminSetting | null): AdminSettingView {
    const resolved = row ? { value: row.value, source: 'control_plane' as const } : this.resolveNonPublished(def);
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      unit: def.unit,
      type: def.type,
      value: resolved.value,
      source: resolved.source,
      version: row?.version ?? 0,
      needsRestart: def.needsRestart,
      modifiedBy: row?.modifiedBy ?? null,
      modifiedAt: row?.updatedAt?.toISOString() ?? null,
      reason: row?.reason ?? null,
    };
  }
}
