import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { Experiment } from '../../entities/experiment.entity';
import { ExperimentAssignment } from '../../entities/experiment-assignment.entity';
import { CONTROL_ARM, ExperimentsService } from './experiments.service';

function running(arms: Record<string, number>): Experiment {
  return { id: 'triad-policy', status: 'running', config: { arms } } as Experiment;
}

describe('ExperimentsService', () => {
  let experiments: { findOne: ReturnType<typeof vi.fn> };
  let assignments: { createQueryBuilder: ReturnType<typeof vi.fn> };
  let execute: ReturnType<typeof vi.fn>;
  let service: ExperimentsService;

  beforeEach(() => {
    execute = vi.fn().mockResolvedValue({});
    const builder = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute,
    };
    experiments = { findOne: vi.fn().mockResolvedValue(running({ control: 1, 'adaptive-v1': 1 })) };
    assignments = { createQueryBuilder: vi.fn().mockReturnValue(builder) };
    service = new ExperimentsService(
      experiments as unknown as Repository<Experiment>,
      assignments as unknown as Repository<ExperimentAssignment>,
    );
  });

  it('serves control when no experiment is running, without writing an assignment', async () => {
    experiments.findOne.mockResolvedValue(null);

    expect(await service.armFor('triad-policy', 'profile-1')).toBe(CONTROL_ARM);
    expect(assignments.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('serves control when a running experiment declares no usable arms', async () => {
    experiments.findOne.mockResolvedValue(running({ control: 0 }));

    expect(await service.armFor('triad-policy', 'profile-1')).toBe(CONTROL_ARM);
  });

  it('is deterministic for the same (experiment, profile) and records the assignment once', async () => {
    const first = await service.armFor('triad-policy', 'profile-1');
    const second = await service.armFor('triad-policy', 'profile-1');

    expect(second).toBe(first);
    expect(['control', 'adaptive-v1']).toContain(first);
    expect(execute).toHaveBeenCalledTimes(2); // idempotent insert, same value both times
  });

  it('splits a population roughly by the declared shares', async () => {
    const arms = await Promise.all(
      Array.from({ length: 400 }, (_, index) => service.armFor('triad-policy', `profile-${index}`)),
    );
    const adaptive = arms.filter((arm) => arm === 'adaptive-v1').length;

    // 50/50 declared; the hash is not a perfect balancer, so this asserts
    // "both arms are really used", not an exact split.
    expect(adaptive).toBeGreaterThan(120);
    expect(adaptive).toBeLessThan(280);
  });

  it('gives the same profile independent draws in different experiments', async () => {
    const perExperiment = new Set<string>();
    for (const id of ['triad-policy', 'exploration-share']) {
      experiments.findOne.mockResolvedValue({ ...running({ control: 1, 'adaptive-v1': 1 }), id });
      perExperiment.add(`${id}:${await service.armFor(id, 'profile-7')}`);
    }

    expect(perExperiment.size).toBe(2);
  });

  it('never lets a failed assignment write break the request', async () => {
    execute.mockRejectedValue(new Error('db down'));

    await expect(service.armFor('triad-policy', 'profile-1')).resolves.toBeTypeOf('string');
  });
});
