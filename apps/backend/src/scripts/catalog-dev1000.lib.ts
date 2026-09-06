import { assertUniqueIdentities, type SourceReservation } from './catalog-identity';

/** D1000-2 development-stage tags; not release/consumer states (see docs section 2.2). */
export type DevStatus = 'BASELINE_389' | 'IDENTITY_VERIFIED_PENDING_PUBLICATION' | 'INCOMPLETE' | 'STAGED_NEW';

export interface Cat1bStatusRow {
  internalId: string;
  status: 'VERIFIED_FOR_ADMISSION' | 'UNRESOLVED' | 'REJECTED';
  reason: string;
}

export interface Dev1000Record extends SourceReservation {
  devStatus: DevStatus;
  blockReason?: string;
}

/** D1000-1: fold the reserved 425 identities + CAT-1B research status into one dev-stage record, without touching release fixtures. */
export function buildDev1000Baseline(identity: readonly SourceReservation[], cat1bStatus: readonly Cat1bStatusRow[]): Dev1000Record[] {
  assertUniqueIdentities(identity);
  const cat1bIds = new Set(cat1bStatus.map((row) => row.internalId));
  if (cat1bIds.size !== cat1bStatus.length) throw new Error('duplicate internalId in CAT-1B status rows');
  const cat1bByid = new Map(cat1bStatus.map((row) => [row.internalId, row]));
  const identityIds = new Set(identity.map((row) => row.internalId));
  for (const id of cat1bIds) {
    if (!identityIds.has(id)) throw new Error(`CAT-1B status row references unreserved internalId: ${id}`);
  }

  const records: Dev1000Record[] = identity.map((row) => {
    const cat1b = cat1bByid.get(row.internalId);
    if (!cat1b) return { ...row, devStatus: 'BASELINE_389' };
    const devStatus: DevStatus = cat1b.status === 'VERIFIED_FOR_ADMISSION' ? 'IDENTITY_VERIFIED_PENDING_PUBLICATION' : 'INCOMPLETE';
    return { ...row, devStatus, blockReason: cat1b.reason };
  });

  assertUniqueIdentities(records);
  return records;
}
