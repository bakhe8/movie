import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1788410140231 implements MigrationInterface {
    name = 'InitialSchema1788410140231'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Required for uuid_generate_v4() used as the default on every primary key below.
        // TypeORM's `synchronize: true` used to create this implicitly; migrations must do it explicitly.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "titles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "internalId" character varying NOT NULL, "titleEn" character varying NOT NULL, "titleAr" character varying NOT NULL, "description" character varying, "releaseYear" integer, "genres" text, "externalIds" json, "fingerprint" json, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_36f7d17a796fd367462ed5f0f73" UNIQUE ("internalId"), CONSTRAINT "PK_7c5aeca381c331c3aaf9d50931c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "embeddings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "titleId" uuid NOT NULL, "vector" real array NOT NULL, "modelVersion" character varying NOT NULL, "embeddingType" character varying NOT NULL, "metadata" json, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_19b6b451e1ef345884caca1f544" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password" character varying NOT NULL, "firstName" character varying, "lastName" character varying, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "name" character varying(255) NOT NULL, "preferredLanguage" character varying(5) NOT NULL DEFAULT 'en', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_1479b2613202259ddf9205c3315" UNIQUE ("userId", "name"), CONSTRAINT "PK_8e520eb4da7dc01d0e190447c8e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "triads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "profileId" uuid NOT NULL, "titleIds" uuid array NOT NULL, "ranking" integer array, "sessionId" character varying, "metadata" json, "status" character varying NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8d42f9ed507f24f7f5d92950fcc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user_model_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "profileId" uuid NOT NULL, "weights" real array NOT NULL, "biasTerms" json, "modelVersion" character varying NOT NULL, "trainingTriadCount" integer NOT NULL, "validationAccuracy" real, "pairwiseAccuracy" real, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_be73224cb5e6a41fc3fb0bee466" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user_title_state" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "profileId" uuid NOT NULL, "titleId" uuid NOT NULL, "state" character varying NOT NULL, "watchedAt" TIMESTAMP, "rating" real, "notes" text, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2c6ad0b2c9a9bfb6fee2a07aeb3" UNIQUE ("profileId", "titleId"), CONSTRAINT "PK_a89c6103ac78fb7ea656a426c45" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "embeddings" ADD CONSTRAINT "FK_2a09b46a5d8193d105199139699" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "profiles" ADD CONSTRAINT "FK_315ecd98bd1a42dcf2ec4e2e985" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "triads" ADD CONSTRAINT "FK_6e8f42795ee661bce521b280f1b" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" ADD CONSTRAINT "FK_1c5bdd1037bd8a996c4fcf0ee56" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_title_state" ADD CONSTRAINT "FK_cabcb5c50825acf9bffa72e4f9a" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_title_state" ADD CONSTRAINT "FK_e17e49b956deb83c47cc245c32d" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_title_state" DROP CONSTRAINT "FK_e17e49b956deb83c47cc245c32d"`);
        await queryRunner.query(`ALTER TABLE "user_title_state" DROP CONSTRAINT "FK_cabcb5c50825acf9bffa72e4f9a"`);
        await queryRunner.query(`ALTER TABLE "user_model_snapshots" DROP CONSTRAINT "FK_1c5bdd1037bd8a996c4fcf0ee56"`);
        await queryRunner.query(`ALTER TABLE "triads" DROP CONSTRAINT "FK_6e8f42795ee661bce521b280f1b"`);
        await queryRunner.query(`ALTER TABLE "profiles" DROP CONSTRAINT "FK_315ecd98bd1a42dcf2ec4e2e985"`);
        await queryRunner.query(`ALTER TABLE "embeddings" DROP CONSTRAINT "FK_2a09b46a5d8193d105199139699"`);
        await queryRunner.query(`DROP TABLE "user_title_state"`);
        await queryRunner.query(`DROP TABLE "user_model_snapshots"`);
        await queryRunner.query(`DROP TABLE "triads"`);
        await queryRunner.query(`DROP TABLE "profiles"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "embeddings"`);
        await queryRunner.query(`DROP TABLE "titles"`);
    }

}
