import { ConfigService } from '@nestjs/config';

// Blueprint §12.2: the backend trains a profile after its Nth completed
// learning round and every M after that. Both are configuration (App. C
// leaves the exact counts open), read the same way by the service that
// enqueues on a completed round (TrainingService) and by the reconciler
// that catches profiles those enqueues missed (TrainingJobsService), so
// the two can never disagree about who is eligible.
export const DEFAULT_FIRST_TRIAD_COUNT = 3;
export const DEFAULT_EVERY_N_TRIADS = 5;

export function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function firstTriadCountFrom(config: ConfigService): number {
  return positiveInt(config.get<string>('TRAINING_FIRST_TRIAD_COUNT'), DEFAULT_FIRST_TRIAD_COUNT);
}

export function everyNTriadsFrom(config: ConfigService): number {
  return positiveInt(config.get<string>('TRAINING_EVERY_N_TRIADS'), DEFAULT_EVERY_N_TRIADS);
}
