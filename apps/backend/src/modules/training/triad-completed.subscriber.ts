import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, EventSubscriber, UpdateEvent } from 'typeorm';
import { Triad } from '../../entities/triad.entity';
import { TrainingService } from './training.service';

// The training trigger listens to the persistence layer rather than to
// TriadsService, so the ranking path stays exactly what ADR-32/ADR-68 made
// it and the trigger cannot slow or fail a rank: a triad row whose status
// just became 'completed' schedules TrainingService.onTriadCompleted() on
// the next tick, after the transaction that wrote it has returned.
//
// Only a status *change* counts. replace() saves an active triad (status
// unchanged), an idempotent replay never reaches save(), and a triad
// inserted already-completed (a seed) is not a user finishing a round.
@Injectable()
@EventSubscriber()
export class TriadCompletedSubscriber implements EntitySubscriberInterface<Triad> {
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
    const statusChanged = event.updatedColumns.some((column) => column.propertyName === 'status');
    if (!statusChanged) {
      return;
    }
    const profileId = triad.profileId;
    setImmediate(() => {
      void this.training.onTriadCompleted(profileId);
    });
  }
}
