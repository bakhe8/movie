import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR-91: foreign keys are named FK_<table>_<column> everywhere, enforced by
// ConventionNamingStrategy. Seven constraints still carried the hashed names
// InitialSchema generated before the convention existed -- six foreign keys
// and the (profileId, titleId) unique on user_title_states, whose hashes no
// longer even matched what TypeORM would derive today, since M1 renamed the
// table. Renames are catalog-only: no lock beyond the ALTER itself, no data
// touched, and every environment ran the same InitialSchema, so the old
// names are identical in all of them.
const RENAMES: [table: string, from: string, to: string][] = [
  ['embeddings', 'FK_2a09b46a5d8193d105199139699', 'FK_embeddings_titleId'],
  ['profiles', 'FK_315ecd98bd1a42dcf2ec4e2e985', 'FK_profiles_userId'],
  ['triads', 'FK_6e8f42795ee661bce521b280f1b', 'FK_triads_profileId'],
  ['user_model_snapshots', 'FK_1c5bdd1037bd8a996c4fcf0ee56', 'FK_user_model_snapshots_profileId'],
  ['user_title_states', 'FK_cabcb5c50825acf9bffa72e4f9a', 'FK_user_title_states_profileId'],
  ['user_title_states', 'FK_e17e49b956deb83c47cc245c32d', 'FK_user_title_states_titleId'],
  ['user_title_states', 'UQ_2c6ad0b2c9a9bfb6fee2a07aeb3', 'UQ_user_title_states_profileId_titleId'],
];

export class RenameLegacyConstraintsToConvention1788472000000 implements MigrationInterface {
  name = 'RenameLegacyConstraintsToConvention1788472000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, from, to] of RENAMES) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME CONSTRAINT "${from}" TO "${to}"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, from, to] of [...RENAMES].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME CONSTRAINT "${to}" TO "${from}"`);
    }
  }
}
