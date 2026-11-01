-- Add audit storage only on Relay development databases; preserve existing data.
DO $$
BEGIN
  IF current_database() NOT IN ('relay_dev', 'relay_shadow_dev') THEN
    RAISE EXCEPTION 'Human review migration requires a Relay database';
  END IF;
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
