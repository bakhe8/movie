import { describe, expect, it } from 'vitest';
import { Table } from 'typeorm';
import { ConventionNamingStrategy } from './naming-strategy';

describe('ConventionNamingStrategy', () => {
  const strategy = new ConventionNamingStrategy();

  it('names a foreign key FK_<table>_<column>, the way every migration since M1 does', () => {
    expect(strategy.foreignKeyName('recommendations', ['titleId'], 'titles', ['id'])).toBe('FK_recommendations_titleId');
  });

  it('takes the bare table name from a Table object or a schema-qualified name', () => {
    expect(strategy.foreignKeyName(new Table({ name: 'consents' }), ['userId'])).toBe('FK_consents_userId');
    expect(strategy.foreignKeyName('public.credits', ['personId'])).toBe('FK_credits_personId');
  });

  it('joins the columns of a composite key in order', () => {
    expect(strategy.foreignKeyName('experiment_assignments', ['experimentId', 'profileId'])).toBe(
      'FK_experiment_assignments_experimentId_profileId',
    );
  });

  it('leaves unique constraints and indexes on the default strategy', () => {
    expect(strategy.uniqueConstraintName('user_title_states', ['profileId', 'titleId'])).toMatch(/^UQ_[0-9a-f]{27}$/);
    expect(strategy.indexName('triads', ['profileId'])).toMatch(/^IDX_[0-9a-f]{26}$/);
  });
});
