import { MigrationInterface, QueryRunner } from 'typeorm';

/** Fail closed on legacy conflicts: never repair identity by relabelling a work. */
export class CatalogIdentityGuards1788490000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [provider, pattern] of Object.entries({ wikidata: '^Q[1-9][0-9]*$', imdb: '^tt[0-9]{7,}$', tmdb: '^[1-9][0-9]*$' })) {
      await queryRunner.query(`ALTER TABLE titles ADD CONSTRAINT "CHK_titles_${provider}_identity"
        CHECK (NOT COALESCE("externalIds"::jsonb ? '${provider}', false) OR
          (jsonb_typeof("externalIds"::jsonb -> '${provider}') = 'string' AND "externalIds" ->> '${provider}' ~ '${pattern}'))`);
      await queryRunner.query(`CREATE UNIQUE INDEX "UQ_titles_${provider}_identity" ON titles (("externalIds" ->> '${provider}'))
        WHERE "externalIds" ->> '${provider}' IS NOT NULL`);
    }
    await queryRunner.query(`CREATE FUNCTION catalog_identity_no_rebind() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE provider text;
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW."internalId" IS DISTINCT FROM OLD."internalId" THEN
          RAISE EXCEPTION 'catalog identity rebind: internalId/id are immutable' USING ERRCODE = '23514';
        END IF;
        FOREACH provider IN ARRAY ARRAY['wikidata', 'imdb', 'tmdb'] LOOP
          IF OLD."externalIds" ->> provider IS NOT NULL AND
             (NEW."externalIds" ->> provider) IS DISTINCT FROM (OLD."externalIds" ->> provider) THEN
            RAISE EXCEPTION 'catalog identity rebind: % %', OLD."internalId", provider USING ERRCODE = '23514';
          END IF;
        END LOOP;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER titles_identity_no_rebind BEFORE UPDATE ON titles
      FOR EACH ROW EXECUTE FUNCTION catalog_identity_no_rebind()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER titles_identity_no_rebind ON titles');
    await queryRunner.query('DROP FUNCTION catalog_identity_no_rebind()');
    for (const provider of ['wikidata', 'imdb', 'tmdb']) {
      await queryRunner.query(`DROP INDEX "UQ_titles_${provider}_identity"`);
      await queryRunner.query(`ALTER TABLE titles DROP CONSTRAINT "CHK_titles_${provider}_identity"`);
    }
  }
}
