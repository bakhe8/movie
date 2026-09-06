import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AdminSetting } from '../../entities/admin-setting.entity';
import { AdminSettingVersion } from '../../entities/admin-setting-version.entity';
import { AdminSettingsService } from './admin-settings.service';

class FakeSettingsRepo {
  rows = new Map<string, AdminSetting>();
  find = vi.fn(async () => [...this.rows.values()]);
  findOne = vi.fn(async (options: { where: { key: string } }) => this.rows.get(options.where.key) ?? null);
  create = vi.fn((data: Partial<AdminSetting>) => ({ ...data }) as AdminSetting);
  save = vi.fn(async (row: AdminSetting) => {
    row.createdAt = row.createdAt ?? new Date();
    row.updatedAt = new Date();
    this.rows.set(row.key, row);
    return row;
  });
}

class FakeVersionsRepo {
  rows: AdminSettingVersion[] = [];
  private seq = 0;
  find = vi.fn(async (options: { where: { key: string; version?: number }; order?: unknown; take?: number }) => {
    let list = this.rows.filter((row) => row.key === options.where.key);
    if (options.where.version !== undefined) list = list.filter((row) => row.version === options.where.version);
    list = [...list].sort((a, b) => b.version - a.version);
    return list.slice(0, options.take ?? list.length);
  });
  findOne = vi.fn(async (options: { where: { key: string; version: number } }) =>
    this.rows.find((row) => row.key === options.where.key && row.version === options.where.version) ?? null,
  );
  create = vi.fn((data: Partial<AdminSettingVersion>) => ({ ...data }) as AdminSettingVersion);
  save = vi.fn(async (row: AdminSettingVersion) => {
    row.id = row.id ?? `v-${++this.seq}`;
    row.createdAt = row.createdAt ?? new Date();
    this.rows.push(row);
    return row;
  });
}

const actor = { id: 'admin-1', role: 'admin', ip: null };

function serviceOf() {
  const rows = new FakeSettingsRepo();
  const versions = new FakeVersionsRepo();
  const audit = { record: vi.fn(async () => ({})) };
  const service = new AdminSettingsService(rows as never, versions as never, audit as never);
  return { service, rows, versions, audit };
}

describe('AdminSettingsService.list/get', () => {
  it('resolves an unpublished setting to its hardcoded default', async () => {
    const { service } = serviceOf();
    const views = await service.list();
    const minTitles = views.find((v) => v.key === 'catalog.min_titles')!;
    expect(minTitles).toMatchObject({ value: 200, source: 'default', version: 0 });
  });

  it('resolves an unpublished setting to its env var over the hardcoded default', async () => {
    const original = process.env.CATALOG_MIN_TITLES;
    process.env.CATALOG_MIN_TITLES = '150';
    try {
      const { service } = serviceOf();
      const views = await service.list();
      expect(views.find((v) => v.key === 'catalog.min_titles')).toMatchObject({ value: 150, source: 'deploy' });
    } finally {
      if (original === undefined) delete process.env.CATALOG_MIN_TITLES;
      else process.env.CATALOG_MIN_TITLES = original;
    }
  });

  it('404s for an unregistered key', async () => {
    const { service } = serviceOf();
    await expect(service.get('does.not.exist')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminSettingsService.preview', () => {
  it('reports an invalid value without writing anything', async () => {
    const { service, rows, versions } = serviceOf();
    const result = await service.preview('catalog.min_titles', -5);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(rows.rows.size).toBe(0);
    expect(versions.rows.length).toBe(0);
  });

  it('reports a valid value alongside the current one', async () => {
    const { service } = serviceOf();
    const result = await service.preview('catalog.min_titles', 300);
    expect(result).toMatchObject({ valid: true, error: null, current: 200, proposed: 300 });
  });
});

describe('AdminSettingsService.update', () => {
  it('refuses an invalid value with a 400-shaped conflict, writing nothing', async () => {
    const { service, rows } = serviceOf();
    await expect(service.update('catalog.min_fingerprint_coverage', { value: 5, reason: 'x' }, actor)).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 400, reason: 'invalid_value' }),
    });
    expect(rows.rows.size).toBe(0);
  });

  it('publishes a new version, updates the current row, and audits with the reason', async () => {
    const { service, rows, versions, audit } = serviceOf();
    const result = await service.update('catalog.min_titles', { value: 300, reason: 'موسم جديد أضاف أفلاماً' }, actor);
    expect(result).toMatchObject({ value: 300, version: 1, source: 'control_plane' });
    expect(rows.rows.get('catalog.min_titles')).toMatchObject({ value: 300, version: 1 });
    expect(versions.rows).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.setting.update', reason: expect.stringContaining('موسم جديد') }));
  });

  it('takes effect immediately for a live reader (getValue), no restart', async () => {
    const { service } = serviceOf();
    expect(await service.getValue('catalog.min_titles')).toBe(200);
    await service.update('catalog.min_titles', { value: 300, reason: 'x' }, actor);
    expect(await service.getValue('catalog.min_titles')).toBe(300);
  });

  it('refuses a stale expectedVersion with the real current version and value', async () => {
    const { service } = serviceOf();
    await service.update('catalog.min_titles', { value: 300, reason: 'first' }, actor);
    await expect(service.update('catalog.min_titles', { value: 400, reason: 'second', expectedVersion: 0 }, actor)).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'version_conflict', currentVersion: 1, currentValue: 300 }),
    });
  });

  it('accepts a write whose expectedVersion matches the real current version', async () => {
    const { service } = serviceOf();
    await service.update('catalog.min_titles', { value: 300, reason: 'first' }, actor);
    const result = await service.update('catalog.min_titles', { value: 400, reason: 'second', expectedVersion: 1 }, actor);
    expect(result.version).toBe(2);
  });
});

describe('AdminSettingsService.rollback', () => {
  it('republishes an old version as a new one, never rewriting history', async () => {
    const { service, versions } = serviceOf();
    await service.update('catalog.min_titles', { value: 300, reason: 'v1' }, actor);
    await service.update('catalog.min_titles', { value: 500, reason: 'v2, a mistake' }, actor);

    const rolledBack = await service.rollback('catalog.min_titles', 1, undefined, actor);

    expect(rolledBack).toMatchObject({ value: 300, version: 3 });
    expect(versions.rows.map((v) => ({ version: v.version, value: v.value }))).toEqual([
      { version: 1, value: 300 },
      { version: 2, value: 500 },
      { version: 3, value: 300 },
    ]);
  });

  it('404s rolling back to a version that never existed', async () => {
    const { service } = serviceOf();
    await expect(service.rollback('catalog.min_titles', 99, undefined, actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminSettingsService.registerSetting', () => {
  it('refuses to register the same key twice', () => {
    const { service } = serviceOf();
    expect(() => service.registerSetting({
      key: 'catalog.min_titles', name: 'x', description: 'x', unit: null, type: 'number',
      defaultValue: 1, needsRestart: false, validate: () => null,
    })).toThrow();
  });

  it('lets another module extend the registry', async () => {
    const { service } = serviceOf();
    service.registerSetting({
      key: 'catalog.pull_batch_size', name: 'حجم دفعة السحب', description: 'x', unit: 'فيلم', type: 'number',
      defaultValue: 25, needsRestart: false, validate: (v) => (typeof v === 'number' && v > 0 ? null : 'invalid'),
    });
    expect((await service.list()).map((v) => v.key)).toEqual(expect.arrayContaining(['catalog.min_titles', 'catalog.pull_batch_size']));
  });
});
