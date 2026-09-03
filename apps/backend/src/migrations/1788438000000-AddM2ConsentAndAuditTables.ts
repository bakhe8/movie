import { MigrationInterface, QueryRunner } from "typeorm";

// M2 of the migration plan (SCHEMA.md §2.4): consents, privacy_requests and
// audit_log. Schema only -- no service/controller writes to these yet; that
// is blueprint gap 7 (onboarding consent) and PRIVACY.md §5's user-rights
// endpoints, both still to build. `consents.userId` cascades with the user
// (a live consent record has no reason to survive its subject); privacy_requests
// and audit_log deliberately do not cascade, matching SCHEMA.md's DDL exactly --
// PRIVACY.md §5 calls both a "tombstone" that should survive an erasure, which
// is in tension with a NOT NULL, no-cascade FK to a row that erasure deletes.
// Left unresolved on purpose: no delete flow exists yet to hit this edge case,
// and resolving it (SET NULL vs. a denormalized snapshot) is a decision for
// whoever builds that flow, not one to make silently in a schema-only migration.
export class AddM2ConsentAndAuditTables1788438000000 implements MigrationInterface {
    name = 'AddM2ConsentAndAuditTables1788438000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "consents" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" uuid NOT NULL,
                "purpose" character varying NOT NULL,
                "version" character varying NOT NULL,
                "granted" boolean NOT NULL,
                "grantedAt" TIMESTAMP NOT NULL,
                "revokedAt" TIMESTAMP,
                CONSTRAINT "UQ_consents_userId_purpose_version" UNIQUE ("userId", "purpose", "version"),
                CONSTRAINT "PK_consents" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "consents" ADD CONSTRAINT "FK_consents_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_consents_userId" ON "consents" ("userId")`);

        await queryRunner.query(`
            CREATE TABLE "privacy_requests" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" uuid NOT NULL,
                "type" character varying NOT NULL,
                "status" character varying NOT NULL,
                "requestedAt" TIMESTAMP NOT NULL,
                "executeAfter" TIMESTAMP,
                "completedAt" TIMESTAMP,
                "artifactUrl" character varying,
                "executionLog" json,
                CONSTRAINT "PK_privacy_requests" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "privacy_requests" ADD CONSTRAINT "FK_privacy_requests_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX "IDX_privacy_requests_userId" ON "privacy_requests" ("userId")`);

        await queryRunner.query(`
            CREATE TABLE "audit_log" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "actorUserId" uuid,
                "actorRole" character varying,
                "action" character varying NOT NULL,
                "resource" character varying NOT NULL,
                "resourceId" uuid,
                "status" character varying NOT NULL,
                "reason" character varying(500),
                "ipHash" character varying,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_audit_log_actorUserId" ON "audit_log" ("actorUserId")`);
        await queryRunner.query(`CREATE INDEX "IDX_audit_log_resource_resourceId" ON "audit_log" ("resource", "resourceId")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_audit_log_resource_resourceId"`);
        await queryRunner.query(`DROP INDEX "IDX_audit_log_actorUserId"`);
        await queryRunner.query(`DROP TABLE "audit_log"`);

        await queryRunner.query(`DROP INDEX "IDX_privacy_requests_userId"`);
        await queryRunner.query(`ALTER TABLE "privacy_requests" DROP CONSTRAINT "FK_privacy_requests_userId"`);
        await queryRunner.query(`DROP TABLE "privacy_requests"`);

        await queryRunner.query(`DROP INDEX "IDX_consents_userId"`);
        await queryRunner.query(`ALTER TABLE "consents" DROP CONSTRAINT "FK_consents_userId"`);
        await queryRunner.query(`DROP TABLE "consents"`);
    }

}
