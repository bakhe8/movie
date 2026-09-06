import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AdminJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

// ADMIN-W5 (plan §17.2 "مركز مهام دائم"): the one durable table behind every
// allowlisted admin task -- no shell, no free-form job name (AdminJobsService
// rejects a `type` it does not itself define a handler for). Mirrors
// `training_jobs` (ADR-100/109): a claim is one conditional `UPDATE ... WHERE
// status = 'queued'`, so two service replicas racing for the same row
// produce exactly one winner, and a stuck `running` row is reclaimed by lease
// rather than left forever. `cancelRequested` is cooperative -- a handler
// checks it between units of work, so cancelling a large batch stops it
// promptly without an unsafe mid-write abort.
@Entity('admin_jobs')
@Index('IDX_admin_jobs_status_nextAttemptAt', ['status', 'nextAttemptAt'])
export class AdminJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The allowlist key (AdminJobsService.handlers), never a caller-supplied
  // free-form name.
  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status: AdminJobStatus;

  @Column({ type: 'json', nullable: true })
  params: Record<string, unknown> | null;

  // A dry run reports what it would change without writing anything --
  // the "dry run وimpact" the plan requires before a real batch write.
  @Column({ type: 'boolean', default: false })
  dryRun: boolean;

  // Written mid-run by the handler (ctx.reportProgress) so a poll while
  // `status = 'running'` shows real progress, not a spinner.
  @Column({ type: 'json', nullable: true })
  progress: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  result: Record<string, unknown> | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  // Sanitized and truncated (admin-jobs.service.ts), same discipline as
  // training_jobs.lastError -- never a raw exception message.
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp' })
  nextAttemptAt: Date;

  @Column({ type: 'boolean', default: false })
  cancelRequested: boolean;

  // NULL for a schedule-triggered job (see `trigger`) -- there is no acting
  // admin to name, only the system.
  @Column({ type: 'uuid', nullable: true })
  requestedBy: string | null;

  // 'admin' = a signed-in admin called POST /admin/jobs; 'schedule' = an
  // internal caller (a future cron/interval) invoked AdminJobsService.create
  // directly with no Actor. Display-only, like requestedBy -- the real
  // record of who/what triggered a write is still the audit_log row.
  @Column({ type: 'varchar', length: 16, default: 'admin' })
  trigger: 'admin' | 'schedule';

  // Optional caller-supplied key: a repeated POST with the same key returns
  // the existing non-terminal (or recently terminal) row instead of starting
  // a second run of the same logical request. NULL for most jobs -- a
  // partial unique index (see the migration) never conflicts on NULL.
  @Column({ type: 'varchar', length: 200, nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
