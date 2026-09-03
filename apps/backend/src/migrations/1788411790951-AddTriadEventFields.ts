import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTriadEventFields1788411790951 implements MigrationInterface {
    name = 'AddTriadEventFields1788411790951'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "triads" ADD "displayOrder" uuid array`);
        await queryRunner.query(`ALTER TABLE "triads" ADD "policyVersion" character varying`);
        await queryRunner.query(`ALTER TABLE "triads" ADD "selectionPropensity" real`);
        await queryRunner.query(`ALTER TABLE "triads" ADD "experimentId" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "experimentId"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "selectionPropensity"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "policyVersion"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP COLUMN "displayOrder"`);
    }

}
