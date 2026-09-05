import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { Title } from '../../entities/title.entity';
import type { AuditService } from '../audit/audit.service';
import type { ModelServiceClient } from '../training/model-service.client';
import type { TrainingJobsService } from '../training/training-jobs.service';
import { AdminModelsService } from './admin-models.service';

// Only the two additions from ADR-100 (remediation brief P0-02) --
// trainingJobsSummary() and readiness(). The rest of this service has no
// pre-existing spec file to extend.
function repoMock() {
  return { count: vi.fn(async () => 0) };
}

function configOf(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('AdminModelsService', () => {
  let titles: ReturnType<typeof repoMock>;
  let trainingJobs: { summary: ReturnType<typeof vi.fn> };
  let modelService: { enabled: boolean; reachable: ReturnType<typeof vi.fn> };

  function build(config: ConfigService = configOf()) {
    return new AdminModelsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      titles as unknown as Repository<Title>,
      {} as never,
      {} as unknown as AuditService,
      trainingJobs as unknown as TrainingJobsService,
      modelService as unknown as ModelServiceClient,
      config,
    );
  }

  beforeEach(() => {
    titles = repoMock();
    trainingJobs = { summary: vi.fn(async () => ({ counts: { queued: 0, running: 0, succeeded: 0, failed: 0 }, recent: [] })) };
    modelService = { enabled: true, reachable: vi.fn(async () => true) };
  });

  describe('trainingJobsSummary', () => {
    it('delegates to TrainingJobsService.summary with the requested page size', async () => {
      await build().trainingJobsSummary(5);
      expect(trainingJobs.summary).toHaveBeenCalledExactlyOnceWith(5);
    });
  });

  describe('readiness', () => {
    it('reports ok across the board when the catalog and fingerprints clear the floor and the model service answers', async () => {
      titles.count.mockResolvedValueOnce(300).mockResolvedValueOnce(250);

      const report = await build().readiness();

      expect(report).toEqual({
        database: { ok: true },
        catalog: { titles: 300, threshold: 200, ok: true },
        fingerprintCoverage: { published: 250, total: 300, percent: 83.3, ok: true },
        modelService: { configured: true, reachable: true, ok: true },
      });
    });

    it('flags a catalog under the configured floor', async () => {
      titles.count.mockResolvedValueOnce(12).mockResolvedValueOnce(12);
      const report = await build(configOf({ CATALOG_MIN_TITLES: '200' })).readiness();
      expect(report.catalog).toEqual({ titles: 12, threshold: 200, ok: false });
    });

    it('flags thin fingerprint coverage even with a catalog above the floor', async () => {
      titles.count.mockResolvedValueOnce(300).mockResolvedValueOnce(30);
      const report = await build().readiness();
      expect(report.fingerprintCoverage.ok).toBe(false);
      expect(report.fingerprintCoverage.percent).toBe(10);
    });

    it('never divides by zero on an empty catalog', async () => {
      titles.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      const report = await build().readiness();
      expect(report.fingerprintCoverage).toEqual({ published: 0, total: 0, percent: 0, ok: false });
    });

    it('flags the model service as not ok when configured but unreachable', async () => {
      titles.count.mockResolvedValueOnce(300).mockResolvedValueOnce(250);
      modelService.reachable.mockResolvedValueOnce(false);
      const report = await build().readiness();
      expect(report.modelService).toEqual({ configured: true, reachable: false, ok: false });
    });

    it('flags the model service as not ok when not configured at all, without even asking it', async () => {
      titles.count.mockResolvedValueOnce(300).mockResolvedValueOnce(250);
      modelService.enabled = false;
      const report = await build().readiness();
      expect(report.modelService).toEqual({ configured: false, reachable: true, ok: false });
    });
  });
});
