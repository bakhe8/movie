import { MigrationInterface, QueryRunner } from "typeorm";

// Blueprint gap 6/gap 5 (confidence band, BP §9.2): the second of §9.2's
// three named diversity axes (directors/languages/genres) this codebase now
// has real data for -- Wikidata's original-language property (P364) is a
// structured field the demo catalog fixture already carries per title, so
// unlike director (which needs people/credits populated by a real ingestion
// pass against the loaded catalog -- still blocked, gap 6 stays open for that
// axis), a title's own language needs only a column to land on. Single value,
// not an array: BP §9.2 and the fixture both speak of one original language
// per title, matching Wikidata P364's cardinality (a handful of titles carry
// more than one; the catalog fetch already picks the first as the primary).
export class AddTrainingLanguageDiversity1788452000000 implements MigrationInterface {
    name = 'AddTrainingLanguageDiversity1788452000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "titles" ADD "originalLanguage" character varying`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD "trainingLanguageDiversity" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP COLUMN "trainingLanguageDiversity"`);
        await queryRunner.query(`ALTER TABLE "titles" DROP COLUMN "originalLanguage"`);
    }

}
