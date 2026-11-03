-- Add audit storage only on Relay databases; preserve existing data.
DO $$
DECLARE
  v_prereq_count integer;
BEGIN
  IF current_database() IN ('relay_dev', 'relay_shadow_dev') THEN
    RETURN;
  END IF;

  IF current_database() IN ('railway', 'railway_pzo0') THEN
    IF to_regclass('"_prisma_migrations"') IS NULL
       OR to_regclass('"ClarificationResponse"') IS NULL
       OR to_regclass('"ClarificationResponseEvidence"') IS NULL THEN
      RAISE EXCEPTION 'Human review migration rejected: Relay prerequisite schema is missing in database %', current_database();
    END IF;

    SELECT count(*) INTO v_prereq_count
    FROM "_prisma_migrations"
    WHERE migration_name = '20261101020000_clarification_responses'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;

    IF v_prereq_count < 1 THEN
      RAISE EXCEPTION 'Human review migration rejected: prerequisite migration 20261101020000_clarification_responses is incomplete in database %', current_database();
    END IF;

    RETURN;
  END IF;

  RAISE EXCEPTION 'Human review migration requires a Relay database (current database: %)', current_database();
END $$;

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('APPROVE', 'EDIT', 'REJECT', 'DEFER');

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "correctedText" TEXT,
    "reason" TEXT,
    "resolveGap" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewDecision_responseId_projectId_idx" ON "ReviewDecision"("responseId", "projectId");

-- CreateIndex
CREATE INDEX "ReviewDecision_projectId_createdAt_idx" ON "ReviewDecision"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewDecision_reviewerId_idx" ON "ReviewDecision"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDecision_responseId_sequence_key" ON "ReviewDecision"("responseId", "sequence");

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_responseId_projectId_fkey" FOREIGN KEY ("responseId", "projectId") REFERENCES "ClarificationResponse"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Independent database protection against conflicting final reviews.
CREATE UNIQUE INDEX "ReviewDecision_one_final_per_response" ON "ReviewDecision" ("responseId", "projectId")
WHERE "action" IN ('APPROVE', 'EDIT', 'REJECT');

ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_valid_payload" CHECK (
  "sequence" > 0
  AND (("action" = 'EDIT' AND "correctedText" IS NOT NULL AND length(btrim("correctedText")) > 0)
       OR ("action" <> 'EDIT' AND "correctedText" IS NULL))
  AND ("action" NOT IN ('REJECT', 'DEFER') OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0))
  AND (NOT "resolveGap" OR "action" IN ('APPROVE', 'EDIT'))
);
