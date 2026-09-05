import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { MailOutbox, MailOutboxStatus } from '../../entities/mail-outbox.entity';
import { MailBodyCipher } from './mail-body-cipher';
import { Mailer } from './mailer';
import { captureException } from '../../observability/observability';

export interface QueuedMail {
  userId?: string | null;
  kind: string;
  to: string;
  subject: string;
  text: string;
  // After this the message is worthless (a reset link past its TTL) and is
  // marked dead instead of retried.
  expiresAt?: Date | null;
}

export interface OutboxResult {
  id: string;
  status: MailOutboxStatus;
}

export interface OutboxSummaryRow {
  id: string;
  userId: string | null;
  kind: string;
  status: MailOutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  expiresAt: Date | null;
  lastError: string | null;
  providerMessageId: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxSummary {
  counts: Record<MailOutboxStatus, number>;
  recent: OutboxSummaryRow[];
}

// Attempt n (1-based) that failed waits BACKOFF_MS[n - 1] before the next;
// after MAX_ATTEMPTS the row is dead. Roughly an hour in total, longer than
// any provider blip this product has to ride out and shorter than a reset
// link's usefulness would make sense to exceed.
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
const SWEEP_BATCH = 20;
// Delivered and dead rows are an operator's trail, not a data store: they go
// after a week, like nothing in them is needed for longer.
const RETENTION_DAYS = 7;
const LAST_ERROR_MAX = 500;

// The Postgres outbox (ADR-97). enqueue() writes the row and makes the first
// attempt at once, so the common case is still one round trip; a failure
// leaves the row pending and the sweep retries it with backoff until it is
// delivered, dead or expired. The sealed body is wiped the moment the row
// leaves `pending`. One process sweeps at a time (`numReplicas: 1` in every
// deployment); a second replica would need a row claim (SKIP LOCKED).
@Injectable()
export class MailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailOutboxService.name);
  readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    @InjectRepository(MailOutbox)
    private readonly rows: Repository<MailOutbox>,
    private readonly mailer: Mailer,
    private readonly cipher: MailBodyCipher,
    private readonly config: ConfigService,
  ) {
    const raw = Number(config.get<string>('MAIL_OUTBOX_SWEEP_INTERVAL_MS'));
    this.sweepIntervalMs = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SWEEP_INTERVAL_MS;
  }

  // Disabled under test so suites drive runDue() by hand; disabled with
  // MAIL_OUTBOX_SWEEP_INTERVAL_MS=0 when an external scheduler owns it.
  onModuleInit(): void {
    if (this.sweepIntervalMs === 0 || this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.runDue().catch((error: unknown) => {
        this.logger.error(`outbox sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async enqueue(mail: QueuedMail): Promise<OutboxResult> {
    const row = await this.rows.save(
      this.rows.create({
        userId: mail.userId ?? null,
        kind: mail.kind,
        toAddress: mail.to,
        subject: mail.subject,
        bodySealed: this.cipher.seal(mail.text),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        expiresAt: mail.expiresAt ?? null,
      }),
    );
    return this.attempt(row);
  }

  // Every pending row whose time has come, oldest first, then the purge.
  async runDue(now: Date = new Date()): Promise<{ attempted: number; purged: number }> {
    if (this.sweeping) {
      return { attempted: 0, purged: 0 };
    }
    this.sweeping = true;
    try {
      const due = await this.rows.find({
        where: { status: 'pending', nextAttemptAt: LessThanOrEqual(now) },
        order: { nextAttemptAt: 'ASC' },
        take: SWEEP_BATCH,
      });
      for (const row of due) {
        await this.attempt(row, now);
      }
      const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const purged = await this.rows.delete({ status: In(['delivered', 'dead']), updatedAt: LessThan(cutoff) });
      return { attempted: due.length, purged: purged.affected ?? 0 };
    } finally {
      this.sweeping = false;
    }
  }

  async summary(recent = 20): Promise<OutboxSummary> {
    const counts: Record<MailOutboxStatus, number> = { pending: 0, delivered: 0, dead: 0 };
    for (const status of Object.keys(counts) as MailOutboxStatus[]) {
      counts[status] = await this.rows.count({ where: { status } });
    }
    const rows = await this.rows.find({ order: { createdAt: 'DESC' }, take: recent });
    return {
      counts,
      // No address and no body: the board sees where a message stands, not
      // what it said or to whom.
      recent: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        status: row.status,
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt,
        expiresAt: row.expiresAt,
        lastError: row.lastError,
        providerMessageId: row.providerMessageId,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  private async attempt(row: MailOutbox, now: Date = new Date()): Promise<OutboxResult> {
    if (row.expiresAt && row.expiresAt <= now) {
      return this.finish(row, 'dead', row.attempts, 'expired before delivery', null, now);
    }
    let text: string;
    try {
      text = this.cipher.open(row.bodySealed ?? Buffer.alloc(0));
    } catch {
      // A rotated JWT_SECRET, or a row written by another key: fail closed.
      return this.finish(row, 'dead', row.attempts, 'sealed body unreadable', null, now);
    }
    const attempts = row.attempts + 1;
    try {
      const receipt = await this.mailer.send({ to: row.toAddress, subject: row.subject, text, idempotencyKey: row.id });
      return this.finish(row, 'delivered', attempts, null, receipt.providerMessageId, now);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, LAST_ERROR_MAX);
      if (attempts >= MAX_ATTEMPTS) {
        this.logger.error(`[outbox] ${row.kind} ${row.id} dead after ${attempts} attempts: ${message}`);
        captureException(error, { outboxKind: row.kind, outboxId: row.id });
        return this.finish(row, 'dead', attempts, message, null, now);
      }
      const delay = BACKOFF_MS[attempts - 1];
      await this.rows.update(
        { id: row.id },
        { attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + delay) },
      );
      // Row id and kind only: never the address or the body.
      this.logger.warn(`[outbox] ${row.kind} ${row.id} attempt ${attempts} failed, retry in ${Math.round(delay / 1000)}s: ${message}`);
      return { id: row.id, status: 'pending' };
    }
  }

  private async finish(
    row: MailOutbox,
    status: Exclude<MailOutboxStatus, 'pending'>,
    attempts: number,
    lastError: string | null,
    providerMessageId: string | null,
    now: Date,
  ): Promise<OutboxResult> {
    await this.rows.update(
      { id: row.id },
      {
        status,
        attempts,
        lastError,
        providerMessageId,
        deliveredAt: status === 'delivered' ? now : null,
        bodySealed: null,
      },
    );
    if (status === 'dead') {
      this.logger.error(`[outbox] ${row.kind} ${row.id} dead: ${lastError}`);
    }
    return { id: row.id, status };
  }
}
