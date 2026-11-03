-- Apply only to Relay databases; never reset or alter existing data.
DO $$
DECLARE
  v_prereq_count integer;
BEGIN
  IF current_database() IN ('relay_dev', 'relay_shadow_dev') THEN
    RETURN;
  END IF;

  IF current_database() = 'railway' THEN
    IF to_regclass('"_prisma_migrations"') IS NULL
       OR to_regclass('"User"') IS NULL
       OR to_regclass('"Project"') IS NULL
       OR to_regclass('"ProjectMember"') IS NULL
       OR to_regclass('"Source"') IS NULL
       OR to_regclass('"SourceDocument"') IS NULL THEN
      RAISE EXCEPTION 'Evidence extraction migration rejected: Relay prerequisite schema is missing in database %', current_database();
    END IF;

    SELECT count(*) INTO v_prereq_count
    FROM "_prisma_migrations"
    WHERE migration_name IN (
      '20261031194429_init_identity',
      '20261031200941_init_sources',
      '20261031201842_github_source_type'
    )
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;

    IF v_prereq_count < 3 THEN
      RAISE EXCEPTION 'Evidence extraction migration rejected: prerequisite migrations are incomplete in database % (found % of 3)', current_database(), v_prereq_count;
    END IF;

    RETURN;
  END IF;

  RAISE EXCEPTION 'Evidence extraction migration requires a Relay database (current database: %)', current_database();
END $$;

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('DECISION', 'OWNER', 'DEPENDENCY', 'STATUS', 'RISK');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('UNVERIFIED');

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT NOT NULL,
    "modelVersion" TEXT,
    "provenance" JSONB NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'RUNNING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeClaim" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "type" "ClaimType" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "quote" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtractionRun_projectId_createdAt_idx" ON "ExtractionRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionRun_requestedById_idx" ON "ExtractionRun"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionRun_id_projectId_key" ON "ExtractionRun"("id", "projectId");

-- CreateIndex
CREATE INDEX "KnowledgeClaim_projectId_createdAt_idx" ON "KnowledgeClaim"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeClaim_runId_projectId_idx" ON "KnowledgeClaim"("runId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeClaim_id_projectId_key" ON "KnowledgeClaim"("id", "projectId");

-- CreateIndex
CREATE INDEX "ClaimEvidence_claimId_projectId_idx" ON "ClaimEvidence"("claimId", "projectId");

-- CreateIndex
CREATE INDEX "ClaimEvidence_documentId_projectId_idx" ON "ClaimEvidence"("documentId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_id_projectId_key" ON "SourceDocument"("id", "projectId");

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeClaim" ADD CONSTRAINT "KnowledgeClaim_runId_projectId_fkey" FOREIGN KEY ("runId", "projectId") REFERENCES "ExtractionRun"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_projectId_fkey" FOREIGN KEY ("claimId", "projectId") REFERENCES "KnowledgeClaim"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_documentId_projectId_fkey" FOREIGN KEY ("documentId", "projectId") REFERENCES "SourceDocument"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
