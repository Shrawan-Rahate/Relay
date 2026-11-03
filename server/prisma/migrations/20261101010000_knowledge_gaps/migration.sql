-- Apply only to Relay databases; preserve all existing tables and data.
DO $$
DECLARE
  v_prereq_count integer;
BEGIN
  IF current_database() IN ('relay_dev', 'relay_shadow_dev') THEN
    RETURN;
  END IF;

  IF current_database() IN ('railway', 'railway_pzo0') THEN
    IF to_regclass('"_prisma_migrations"') IS NULL
       OR to_regclass('"ExtractionRun"') IS NULL
       OR to_regclass('"KnowledgeClaim"') IS NULL
       OR to_regclass('"ClaimEvidence"') IS NULL THEN
      RAISE EXCEPTION 'Knowledge gap migration rejected: Relay prerequisite schema is missing in database %', current_database();
    END IF;

    SELECT count(*) INTO v_prereq_count
    FROM "_prisma_migrations"
    WHERE migration_name = '20261101000000_evidence_extraction'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;

    IF v_prereq_count < 1 THEN
      RAISE EXCEPTION 'Knowledge gap migration rejected: prerequisite migration 20261101000000_evidence_extraction is incomplete in database %', current_database();
    END IF;

    RETURN;
  END IF;

  RAISE EXCEPTION 'Knowledge gap migration requires a Relay database (current database: %)', current_database();
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
