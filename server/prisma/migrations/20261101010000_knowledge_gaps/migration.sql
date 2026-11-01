-- Apply only to Relay development databases; preserve all existing tables and data.
DO $$
BEGIN
  IF current_database() NOT IN ('relay_dev', 'relay_shadow_dev') THEN
    RAISE EXCEPTION 'Knowledge gap migration requires a Relay database';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "KnowledgeGapCategory" AS ENUM ('MISSING_OWNER', 'UNCLEAR_STATUS', 'UNRESOLVED_DEPENDENCY', 'POTENTIAL_CONFLICT');

-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "KnowledgeGap" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "category" "KnowledgeGapCategory" NOT NULL,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'OPEN',
    "question" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGapClaim" (
    "gapId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGapClaim_pkey" PRIMARY KEY ("gapId","claimId")
);

-- CreateIndex
CREATE INDEX "KnowledgeGap_projectId_status_id_idx" ON "KnowledgeGap"("projectId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGap_id_projectId_key" ON "KnowledgeGap"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGap_projectId_fingerprint_key" ON "KnowledgeGap"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "KnowledgeGapClaim_claimId_projectId_idx" ON "KnowledgeGapClaim"("claimId", "projectId");

-- CreateIndex
CREATE INDEX "KnowledgeGapClaim_gapId_projectId_idx" ON "KnowledgeGapClaim"("gapId", "projectId");

-- AddForeignKey
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGapClaim" ADD CONSTRAINT "KnowledgeGapClaim_gapId_projectId_fkey" FOREIGN KEY ("gapId", "projectId") REFERENCES "KnowledgeGap"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGapClaim" ADD CONSTRAINT "KnowledgeGapClaim_claimId_projectId_fkey" FOREIGN KEY ("claimId", "projectId") REFERENCES "KnowledgeClaim"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
