import { DefaultNamingStrategy, type NamingStrategyInterface, type Table } from 'typeorm';

// The one place foreign-key names come from (ADR-91). Every migration since
// M1 names its constraints `FK_<table>_<column>` by hand; TypeORM's default
// is a hash of table and columns, so the entities expected different names
// from the ones the database carries, and `schema:log` proposed dropping
// and recreating 35 foreign keys on every run -- noise that hid the two
// real drifts beside it (AUDIT_2026-09-05 follow-up, board 2026-09-05).
// With the convention as the strategy, a new relation and its generated
// migration agree without anyone typing `foreignKeyConstraintName`.
// Unique constraints, indexes and primary keys keep TypeORM's defaults: the
// hand-named ones are declared explicitly where they exist.
export class ConventionNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  foreignKeyName(tableOrName: Table | string, columnNames: string[]): string {
    const table = typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
    // A schema-qualified name ("public"."titles") contributes the table only.
    const bare = table.split('.').pop() as string;
    return `FK_${bare}_${columnNames.join('_')}`;
  }
}
