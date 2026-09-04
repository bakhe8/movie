import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, EventSubscriber, TransactionCommitEvent, UpdateEvent } from 'typeorm';
import { Triad } from '../../entities/triad.entity';
import { TrainingService } from './training.service';

// The training trigger listens to the persistence layer rather than to
// TriadsService, so the ranking path stays exactly what ADR-32/ADR-68 made
// it and the trigger cannot slow or fail a rank.
//
// Only a status *change* counts. replace() saves an active triad (status
// unchanged), an idempotent replay never reaches save(), and a triad
// inserted already-completed (a seed) is not a user finishing a round.
//
// afterUpdate only *notes* the profile; the trigger runs from
// afterTransactionCommit. afterUpdate fires INSIDE the writing transaction,
// so the count TrainingService issues -- even deferred to the next tick with
// setImmediate, as this once was -- runs on another connection that cannot
// see the row being written yet, and comes back one short. The third round
// then counted as the second and the trigger never fired at all. It passed
// for months only because a tmpfs test database committed faster than the
// next tick came round; a disk-backed one loses that race every time.
@Injectable()
@EventSubscriber()
export class TriadCompletedSubscriber implements EntitySubscriberInterface<Triad> {
  // Keyed by the queryRunner that will commit them: concurrent requests each
  // have their own, so one profile's round can never be flushed by another
  // request's commit.
  private readonly pending = new Map<unknown, Set<string>>();

  constructor(
    dataSource: DataSource,
    private readonly training: TrainingService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Triad;
  }

  afterUpdate(event: UpdateEvent<Triad>): void {
    const triad = event.entity as Partial<Triad> | undefined;
    if (!triad || triad.status !== 'completed' || !triad.profileId) {
      return;
    }
    if (!event.updatedColumns.some((column) => column.propertyName === 'status')) {
      return;
    }
    const profileIds = this.pending.get(event.queryRunner) ?? new Set<string>();
    profileIds.add(triad.profileId);
    this.pending.set(event.queryRunner, profileIds);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const profileIds = this.pending.get(event.queryRunner);
    if (!profileIds) {
      return;
    }
    this.pending.delete(event.queryRunner);
    for (const profileId of profileIds) {
      // Still detached from the request: the caller's response does not wait
      // on the model service, and a failure there is logged, never thrown.
      void this.training.onTriadCompleted(profileId);
    }
  }

  // A rolled-back round never happened, so its note must not survive to be
  // flushed by the next transaction on the same query runner.
  afterTransactionRollback(event: TransactionCommitEvent): void {
    this.pending.delete(event.queryRunner);
  }
}
