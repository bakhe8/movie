import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, TransactionCommitEvent, UpdateEvent } from 'typeorm';
import { Triad } from '../../entities/triad.entity';
import { TrainingService } from './training.service';
import { TriadCompletedSubscriber } from './triad-completed.subscriber';

describe('TriadCompletedSubscriber', () => {
  let training: { onTriadCompleted: ReturnType<typeof vi.fn> };
  let subscriber: TriadCompletedSubscriber;
  const runner = { id: 'runner-1' };

  function update(overrides: Partial<Triad> = {}, columns = ['status'], queryRunner: unknown = runner) {
    return {
      entity: { status: 'completed', profileId: 'profile-1', ...overrides },
      updatedColumns: columns.map((propertyName) => ({ propertyName })),
      queryRunner,
    } as unknown as UpdateEvent<Triad>;
  }

  const commit = (queryRunner: unknown = runner) => ({ queryRunner }) as unknown as TransactionCommitEvent;

  beforeEach(() => {
    training = { onTriadCompleted: vi.fn().mockResolvedValue(undefined) };
    subscriber = new TriadCompletedSubscriber(
      { subscribers: [] } as unknown as DataSource,
      training as unknown as TrainingService,
    );
  });

  // The bug this shape exists to prevent: afterUpdate runs inside the writing
  // transaction, so counting completed triads from there reads a connection
  // that cannot see the row yet and comes back one short.
  it('does not trigger while the transaction is still open', () => {
    subscriber.afterUpdate(update());

    expect(training.onTriadCompleted).not.toHaveBeenCalled();
  });

  it('triggers once the transaction commits', () => {
    subscriber.afterUpdate(update());
    subscriber.afterTransactionCommit(commit());

    expect(training.onTriadCompleted).toHaveBeenCalledExactlyOnceWith('profile-1');
  });

  it('triggers once per profile even if several of its triads completed in one transaction', () => {
    subscriber.afterUpdate(update({ profileId: 'profile-1' }));
    subscriber.afterUpdate(update({ profileId: 'profile-1' }));
    subscriber.afterUpdate(update({ profileId: 'profile-2' }));
    subscriber.afterTransactionCommit(commit());

    expect(training.onTriadCompleted.mock.calls.flat()).toEqual(['profile-1', 'profile-2']);
  });

  // Concurrent requests each have their own query runner; one commit must not
  // flush another request's pending round.
  it('flushes only the rounds noted on the committing query runner', () => {
    // The same object, not an equal one: the map is keyed by the runner's
    // identity, exactly as TypeORM hands it to both hooks.
    const runnerA = { id: 'runner-a' };
    const runnerB = { id: 'runner-b' };
    subscriber.afterUpdate(update({ profileId: 'profile-1' }, ['status'], runnerA));
    subscriber.afterUpdate(update({ profileId: 'profile-2' }, ['status'], runnerB));

    subscriber.afterTransactionCommit(commit(runnerA));

    expect(training.onTriadCompleted).toHaveBeenCalledExactlyOnceWith('profile-1');
  });

  it('forgets a rolled-back round instead of leaving it for the next commit', () => {
    subscriber.afterUpdate(update());
    subscriber.afterTransactionRollback(commit());
    subscriber.afterTransactionCommit(commit());

    expect(training.onTriadCompleted).not.toHaveBeenCalled();
  });

  it('does not fire twice if the same runner commits again with nothing pending', () => {
    subscriber.afterUpdate(update());
    subscriber.afterTransactionCommit(commit());
    subscriber.afterTransactionCommit(commit());

    expect(training.onTriadCompleted).toHaveBeenCalledOnce();
  });

  it.each([
    ['a status that is not completed', { status: 'active' as const }, ['status']],
    ['a triad with no profile', { profileId: undefined }, ['status']],
  ])('ignores %s', (_case, overrides, columns) => {
    subscriber.afterUpdate(update(overrides as Partial<Triad>, columns));
    subscriber.afterTransactionCommit(commit());

    expect(training.onTriadCompleted).not.toHaveBeenCalled();
  });

  // replace() saves an already-active triad; that is not a finished round.
  it('ignores a save that did not change the status column', () => {
    subscriber.afterUpdate(update({}, ['ranking', 'answeredAt']));
    subscriber.afterTransactionCommit(commit());

    expect(training.onTriadCompleted).not.toHaveBeenCalled();
  });
});
