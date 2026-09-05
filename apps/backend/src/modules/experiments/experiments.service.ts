import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { Experiment } from '../../entities/experiment.entity';
import { ExperimentAssignment } from '../../entities/experiment-assignment.entity';
import { captureException } from '../../observability/observability';

// ALPHA_PLAN 6.5: the `experiments` table (M4) read from the backend at
// last. An experiment's `config` names its arms and their shares:
//   { "arms": { "control": 0.5, "adaptive-v1": 0.5 } }
// Shares are relative weights, not required to sum to 1.
export interface ExperimentArms {
  arms?: Record<string, number>;
}

// The two first flags (ALPHA_PLAN 6.5). Ids, not free text, so a typo can
// never silently put everyone in control.
export const TRIAD_POLICY_EXPERIMENT = 'triad-policy';
export const EXPLORATION_SHARE_EXPERIMENT = 'exploration-share';

export const CONTROL_ARM = 'control';

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    @InjectRepository(Experiment)
    private readonly experimentsRepository: Repository<Experiment>,
    @InjectRepository(ExperimentAssignment)
    private readonly assignmentsRepository: Repository<ExperimentAssignment>,
  ) {}

  // Deterministic by (experiment, profile): the same profile always lands in
  // the same arm without reading its assignment first, so an assignment row
  // that never got written (a crash between the two) cannot flip anyone's
  // experience. The row is still written, because `§16` analysis reads
  // assignments, not this function.
  async armFor(experimentId: string, profileId: string): Promise<string> {
    const experiment = await this.experimentsRepository.findOne({ where: { id: experimentId, status: 'running' } });
    if (!experiment) {
      return CONTROL_ARM;
    }
    const arms = (experiment.config as ExperimentArms | null)?.arms;
    const entries = Object.entries(arms ?? {}).filter(([, weight]) => typeof weight === 'number' && weight > 0);
    if (entries.length === 0) {
      this.logger.warn(`experiment ${experimentId} is running with no usable arms; serving control`);
      return CONTROL_ARM;
    }

    const arm = this.pick(entries, experimentId, profileId);
    await this.recordAssignment(experimentId, profileId, arm);
    return arm;
  }

  // sha256(experimentId:profileId) → a fraction in [0,1), then the arm whose
  // cumulative share covers it. Hashing the pair, not the profile alone,
  // keeps two experiments from correlating their splits.
  private pick(entries: [string, number][], experimentId: string, profileId: string): string {
    const digest = createHash('sha256').update(`${experimentId}:${profileId}`).digest();
    const fraction = digest.readUInt32BE(0) / 2 ** 32;
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let cumulative = 0;
    for (const [arm, weight] of entries) {
      cumulative += weight / total;
      if (fraction < cumulative) {
        return arm;
      }
    }
    return entries[entries.length - 1][0];
  }

  // Written once and never rewritten: an arm that changed under a profile
  // would make its own event history unanalysable. A losing race on the
  // composite key is the same value anyway (the pick is deterministic).
  private async recordAssignment(experimentId: string, profileId: string, arm: string): Promise<void> {
    try {
      await this.assignmentsRepository
        .createQueryBuilder()
        .insert()
        .values({ experimentId, profileId, arm, assignedAt: new Date() })
        .orIgnore()
        .execute();
    } catch (error) {
      // An experiment must never break the request it decorates.
      this.logger.warn(`could not record assignment for ${experimentId}/${profileId}: ${String(error)}`);
      captureException(error, { experimentId });
    }
  }
}
