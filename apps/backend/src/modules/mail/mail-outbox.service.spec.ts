import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { MailOutbox } from '../../entities/mail-outbox.entity';
import { MailBodyCipher } from './mail-body-cipher';
import { MAX_ATTEMPTS, MailOutboxService } from './mail-outbox.service';
import type { Mailer } from './mailer';

const SECRET = 'a-secret-long-enough-for-hkdf-derivation-0123456789';
const DAY_MS = 24 * 60 * 60 * 1000;

// Just enough of a TypeORM repository, in memory, for the state machine to
// run without Postgres: FindOperators are read through their `.value`.
class FakeRepo {
  rows = new Map<string, MailOutbox>();
  private seq = 0;
  create = vi.fn((data: Partial<MailOutbox>) => ({ ...data }) as MailOutbox);
  save = vi.fn(async (row: MailOutbox) => {
    if (!row.id) {
      row.id = `row-${++this.seq}`;
    }
    row.createdAt = row.createdAt ?? new Date();
    row.updatedAt = new Date();
    this.rows.set(row.id, row);
    return row;
  });
  update = vi.fn(async (where: { id: string }, patch: Partial<MailOutbox>) => {
    Object.assign(this.rows.get(where.id)!, patch, { updatedAt: new Date() });
    return { affected: 1 };
  });
  find = vi.fn(async (options: { where?: { status?: string; nextAttemptAt?: { value: Date } }; take?: number }) => {
    let list = [...this.rows.values()];
    if (options.where?.status) {
      list = list.filter((row) => row.status === options.where!.status);
    }
    if (options.where?.nextAttemptAt) {
      list = list.filter((row) => row.nextAttemptAt <= options.where!.nextAttemptAt!.value);
    }
    list.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
    return list.slice(0, options.take ?? list.length);
  });
  count = vi.fn(async (options: { where: { status: string } }) =>
    [...this.rows.values()].filter((row) => row.status === options.where.status).length,
  );
  delete = vi.fn(async (where: { status: { value: string[] }; updatedAt: { value: Date } }) => {
    let affected = 0;
    for (const [id, row] of this.rows) {
      if (where.status.value.includes(row.status) && row.updatedAt < where.updatedAt.value) {
        this.rows.delete(id);
        affected += 1;
      }
    }
    return { affected };
  });
}

const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('MailOutboxService', () => {
  let repo: FakeRepo;
  let send: ReturnType<typeof vi.fn>;
  let service: MailOutboxService;
  let logs: string[];

  const mail = {
    userId: 'user-1',
    kind: 'password_reset',
    to: 'someone@example.com',
    subject: 'Reset your password',
    text: 'https://app/reset-password?token=abc123',
  };

  beforeEach(() => {
    repo = new FakeRepo();
    send = vi.fn(async () => ({ providerMessageId: 'msg-1' }));
    service = new MailOutboxService(
      repo as unknown as Repository<MailOutbox>,
      { send } as unknown as Mailer,
      MailBodyCipher.fromSecret(SECRET),
      configOf({ NODE_ENV: 'test' }),
    );
    logs = [];
    (service as unknown as { logger: Record<string, (m: string) => void> }).logger = {
      log: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
    };
  });

  it('writes the row, sends at once, and wipes the sealed body on delivery', async () => {
    const result = await service.enqueue(mail);

    expect(result.status).toBe('delivered');
    const row = repo.rows.get(result.id)!;
    expect(row).toMatchObject({
      userId: 'user-1',
      kind: 'password_reset',
      toAddress: mail.to,
      status: 'delivered',
      attempts: 1,
      providerMessageId: 'msg-1',
      bodySealed: null,
    });
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(send).toHaveBeenCalledExactlyOnceWith({ to: mail.to, subject: mail.subject, text: mail.text, idempotencyKey: result.id });
  });

  it('keeps the body sealed at rest while pending, never in clear text', async () => {
    send.mockRejectedValueOnce(new Error('provider outage'));

    const result = await service.enqueue(mail);

    const row = repo.rows.get(result.id)!;
    expect(row.status).toBe('pending');
    expect(row.bodySealed).toBeInstanceOf(Buffer);
    expect(row.bodySealed!.toString('latin1')).not.toContain('token=abc123');
    expect(logs.every((line) => !line.includes('token=abc123') && !line.includes(mail.to))).toBe(true);
  });

  it('retries a failed send with backoff and delivers on a later sweep', async () => {
    send.mockRejectedValueOnce(new Error('provider outage'));
    const queued = await service.enqueue(mail);
    const row = repo.rows.get(queued.id)!;
    expect(queued.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('provider outage');
    const firstDelay = row.nextAttemptAt.getTime() - Date.now();
    expect(firstDelay).toBeGreaterThan(25_000);
    expect(firstDelay).toBeLessThanOrEqual(30_000);

    // Not due yet: nothing happens.
    expect(await service.runDue(new Date())).toEqual({ attempted: 0, purged: 0 });
    expect(send).toHaveBeenCalledTimes(1);

    // Due: retried with the same message and the same idempotency key.
    const later = new Date(row.nextAttemptAt.getTime() + 1);
    expect(await service.runDue(later)).toEqual({ attempted: 1, purged: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual({ to: mail.to, subject: mail.subject, text: mail.text, idempotencyKey: queued.id });
    expect(row).toMatchObject({ status: 'delivered', attempts: 2, lastError: null, bodySealed: null, deliveredAt: later });
  });

  it('gives up after the attempt cap, marks the row dead and wipes the body', async () => {
    send.mockRejectedValue(new Error('still down'));
    const queued = await service.enqueue(mail);
    const row = repo.rows.get(queued.id)!;

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await service.runDue(new Date(row.nextAttemptAt.getTime() + 1));
    }

    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(row).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS, lastError: 'still down', bodySealed: null });
    await service.runDue(new Date(Date.now() + DAY_MS));
    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('marks an expired message dead without calling the provider', async () => {
    send.mockRejectedValueOnce(new Error('provider outage'));
    const queued = await service.enqueue({ ...mail, expiresAt: new Date(Date.now() + 60_000) });
    const row = repo.rows.get(queued.id)!;

    await service.runDue(new Date(Date.now() + 120_000));

    expect(send).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'dead', lastError: 'expired before delivery', bodySealed: null });
  });

  it('never sends a body it cannot read (a rotated key) and marks the row dead', async () => {
    const other = new MailOutboxService(
      repo as unknown as Repository<MailOutbox>,
      { send } as unknown as Mailer,
      MailBodyCipher.fromSecret(`${SECRET}-rotated`),
      configOf({ NODE_ENV: 'test' }),
    );
    send.mockRejectedValueOnce(new Error('provider outage'));
    const queued = await service.enqueue(mail);
    const row = repo.rows.get(queued.id)!;

    await other.runDue(new Date(row.nextAttemptAt.getTime() + 1));

    expect(send).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'dead', lastError: 'sealed body unreadable', bodySealed: null });
  });

  it('purges delivered and dead rows after the retention window, never pending ones', async () => {
    const delivered = await service.enqueue(mail);
    send.mockRejectedValueOnce(new Error('provider outage'));
    const pending = await service.enqueue(mail);
    // Age the delivered row past the window; the pending one is fresh.
    repo.rows.get(delivered.id)!.updatedAt = new Date(Date.now() - 8 * DAY_MS);

    const result = await service.runDue(new Date());

    expect(result.purged).toBe(1);
    expect(repo.rows.has(delivered.id)).toBe(false);
    expect(repo.rows.has(pending.id)).toBe(true);
  });

  it('summarises counts and the latest rows without an address or a body', async () => {
    await service.enqueue(mail);
    send.mockRejectedValueOnce(new Error('provider outage'));
    await service.enqueue(mail);

    const summary = await service.summary();

    expect(summary.counts).toEqual({ pending: 1, delivered: 1, dead: 0 });
    expect(summary.recent).toHaveLength(2);
    for (const row of summary.recent) {
      expect(row).not.toHaveProperty('toAddress');
      expect(row).not.toHaveProperty('bodySealed');
      expect(row).toMatchObject({ kind: 'password_reset', userId: 'user-1' });
    }
  });

  it('reads the sweep interval from configuration and never arms a timer under test', () => {
    expect(service.sweepIntervalMs).toBe(30_000);
    expect(new MailOutboxService(repo as unknown as Repository<MailOutbox>, { send } as unknown as Mailer, MailBodyCipher.fromSecret(SECRET), configOf({ MAIL_OUTBOX_SWEEP_INTERVAL_MS: '0' })).sweepIntervalMs).toBe(0);
    expect(new MailOutboxService(repo as unknown as Repository<MailOutbox>, { send } as unknown as Mailer, MailBodyCipher.fromSecret(SECRET), configOf({ MAIL_OUTBOX_SWEEP_INTERVAL_MS: 'soon' })).sweepIntervalMs).toBe(30_000);

    service.onModuleInit();
    expect((service as unknown as { sweepTimer: unknown }).sweepTimer).toBeNull();
  });
});
