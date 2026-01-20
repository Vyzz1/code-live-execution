import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1768920682118 implements MigrationInterface {
    name = 'InitSchema1768920682118'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."code_sessions_language_enum" AS ENUM('python', 'javascript')`);
        await queryRunner.query(`CREATE TYPE "public"."code_sessions_status_enum" AS ENUM('ACTIVE', 'ARCHIVED')`);
        await queryRunner.query(`CREATE TABLE "code_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "language" "public"."code_sessions_language_enum" NOT NULL, "sourceCode" text NOT NULL, "status" "public"."code_sessions_status_enum" NOT NULL DEFAULT 'ACTIVE', "latestExecutionId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e3c2d96f2dca356bf47b3f5034d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5011ce23d46fe68f653d8d77d9" ON "code_sessions" ("language") `);
        await queryRunner.query(`CREATE INDEX "IDX_cca51966ef629fb2edfcc09264" ON "code_sessions" ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."executions_status_enum" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMEOUT')`);
        await queryRunner.query(`CREATE TABLE "executions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" "public"."executions_status_enum" NOT NULL DEFAULT 'QUEUED', "sourceCodeSnapshot" text NOT NULL, "stdout" text, "stderr" text, "exitCode" integer, "executionTimeMs" integer, "attempt" integer NOT NULL DEFAULT '0', "maxAttempts" integer NOT NULL DEFAULT '3', "idempotencyKey" character varying(128), "queuedAt" TIMESTAMP NOT NULL DEFAULT now(), "startedAt" TIMESTAMP, "finishedAt" TIMESTAMP, "errorType" character varying(64), "errorMessage" text, "sessionId" uuid, CONSTRAINT "PK_703e64e0ef651986191844b7b8b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5e2c70148fbf6287f4c4a5c8cd" ON "executions" ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_31bf4b6d5fbbb0ce1522dfe003" ON "executions" ("idempotencyKey") `);
        await queryRunner.query(`ALTER TABLE "executions" ADD CONSTRAINT "FK_6c81b6448311775355becce8d3d" FOREIGN KEY ("sessionId") REFERENCES "code_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "executions" DROP CONSTRAINT "FK_6c81b6448311775355becce8d3d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_31bf4b6d5fbbb0ce1522dfe003"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5e2c70148fbf6287f4c4a5c8cd"`);
        await queryRunner.query(`DROP TABLE "executions"`);
        await queryRunner.query(`DROP TYPE "public"."executions_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cca51966ef629fb2edfcc09264"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5011ce23d46fe68f653d8d77d9"`);
        await queryRunner.query(`DROP TABLE "code_sessions"`);
        await queryRunner.query(`DROP TYPE "public"."code_sessions_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."code_sessions_language_enum"`);
    }

}
