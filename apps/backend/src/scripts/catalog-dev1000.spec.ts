import { describe, expect, it } from 'vitest';
import { buildDev1000Baseline, type Cat1bStatusRow } from './catalog-dev1000.lib';
import identity from './fixtures/catalog.demo.identity.json';
import cat1bStatus from './fixtures/catalog.cat1b.status.json';

describe('D1000-1 dev-1000 baseline build', () => {
  it('folds the 425 reserved identities and the 36 CAT-1B statuses into one dev record', () => {
    const records = buildDev1000Baseline(identity, cat1bStatus.rows as Cat1bStatusRow[]);
    expect(records).toHaveLength(425);
    const counts: Record<string, number> = {};
    for (const record of records) counts[record.devStatus] = (counts[record.devStatus] ?? 0) + 1;
    expect(counts).toEqual({ BASELINE_389: 389, IDENTITY_VERIFIED_PENDING_PUBLICATION: 16, INCOMPLETE: 20 });
  });
  it('keeps every identity field untouched and attaches blockReason only to CAT-1B rows', () => {
    const records = buildDev1000Baseline(identity, cat1bStatus.rows as Cat1bStatusRow[]);
    const byId = new Map(records.map((row) => [row.internalId, row]));
    expect(byId.get('DEMO0001')).toEqual({ ...identity[0], devStatus: 'BASELINE_389' });
    const verified = byId.get('DEMO0312')!;
    expect(verified.devStatus).toBe('IDENTITY_VERIFIED_PENDING_PUBLICATION');
    expect(verified.blockReason).toContain('Dahomey');
    const rejected = byId.get('DEMO0364')!;
    expect(rejected.devStatus).toBe('INCOMPLETE');
    expect(rejected.blockReason).toContain('rejected');
  });
  it('rejects a CAT-1B status row for an unreserved internalId', () => {
    const bogus: Cat1bStatusRow[] = [{ internalId: 'DEMO9999', status: 'UNRESOLVED', reason: 'x' }];
    expect(() => buildDev1000Baseline(identity, bogus)).toThrow('unreserved internalId');
  });
  it('rejects duplicate internalIds within the CAT-1B status rows', () => {
    const dup: Cat1bStatusRow[] = [
      { internalId: 'DEMO0312', status: 'UNRESOLVED', reason: 'a' },
      { internalId: 'DEMO0312', status: 'REJECTED', reason: 'b' },
    ];
    expect(() => buildDev1000Baseline(identity, dup)).toThrow('duplicate internalId');
  });
});
