import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { PrivacyRequestsTombstone1788454000000 } from '../../migrations/1788454000000-PrivacyRequestsTombstone';
import { ConsentsTombstone1788460000000 } from '../../migrations/1788460000000-ConsentsTombstone';

// Lives here rather than beside the migrations: data-source.ts loads every
// `migrations/*.ts` file, and a spec there would be imported as a migration.
function runnerWith(tombstones: number) {
  const query = vi.fn(async (sql: string) => (sql.trimStart().startsWith('SELECT COUNT') ? [{ count: tombstones }] : []));
  return { runner: { query } as unknown as QueryRunner, query };
}

// H6 (AUDIT_2026-09-05): both rollbacks used to `DELETE ... WHERE "userId"
// IS NULL` to get back under NOT NULL -- destroying, inside a nominally
// reversible migration, the very rows PRIVACY.md §9 requires to outlive a
// deletion. They now refuse while tombstones exist, and never delete.
describe.each([
  ['privacy_requests', () => new PrivacyRequestsTombstone1788454000000()],
  ['consents', () => new ConsentsTombstone1788460000000()],
])('%s tombstone rollback (H6)', (table, migration) => {
  it('refuses to roll back while tombstone rows exist, before touching the schema', async () => {
    const { runner, query } = runnerWith(2);

    await expect(migration().down(runner)).rejects.toThrow(/2 tombstone row/);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rolls back without deleting anything once no tombstone exists', async () => {
    const { runner, query } = runnerWith(0);

    await migration().down(runner);

    const statements = query.mock.calls.map(([sql]) => sql as string);
    expect(statements.some((sql) => /^\s*DELETE/i.test(sql))).toBe(false);
    expect(statements).toContainEqual(expect.stringContaining(`ALTER TABLE "${table}" ALTER COLUMN "userId" SET NOT NULL`));
  });
});
