import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Profile } from './profile.entity';

export type TrainingJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
// 'invalid' = the trainer had nothing trainable (no completed learn triads,
// or none with published fingerprints) -- retrying without new data changes
// nothing, so this never auto-retries. 'error' = the model service itself
// failed or could not be reached -- transient by default, so this does.
export type TrainingJobErrorKind = 'invalid' | 'error';

// ADR-100 (remediation brief P0-02): a durable outer layer around the model
// service's own async job (ADR-25, services/workers/src/model_service.py),
// mirroring the mail outbox (ADR-97). The Python service's job ledger is
// in-memory and forgets everything on restart; this table is the one thing
// the backend and the admin board can trust to still be there afterward.
// `modelServiceJobId` is the Python job currently being waited on -- null
// while `status` is 'queued' (no attempt in flight yet, or the previous
// one's Python job was lost and a fresh one has not been dispatched).
@Entity('training_jobs')
@Index('IDX_training_jobs_status_nextAttemptAt', ['status', 'nextAttemptAt'])
export class TrainingJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profileId' })
  profile: Profile;

  @Index('IDX_training_jobs_profileId')
  @Column({ type: 'uuid' })
  profileId: string;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: TrainingJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  // The model service's own job id for the attempt in flight, if any.
  @Column({ type: 'varchar', nullable: true })
  modelServiceJobId: string | null;

  // When the sweep may next dispatch (or re-dispatch) this job. Ignored
  // while `status` is 'running' -- a running row is polled every sweep tick
  // regardless, since a status read is cheap and there is no backoff to
  // respect for "is it done yet".
  @Column({ type: 'timestamp' })
  nextAttemptAt: Date;

  @Column({ type: 'varchar', nullable: true })
  errorKind: TrainingJobErrorKind | null;

  // Sanitized and truncated (training-jobs.service.ts); never a raw
  // exception message, which could carry a connection string or a path.
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  // The same shape model_service.py's summarize() returns; never weights.
  @Column({ type: 'json', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
