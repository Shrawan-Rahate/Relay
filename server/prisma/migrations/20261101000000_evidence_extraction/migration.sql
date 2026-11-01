-- Apply only to the local Relay databases; never reset or alter existing data.
DO $$
BEGIN
  IF current_database() NOT IN ('relay_dev', 'relay_shadow_dev') THEN
    RAISE EXCEPTION 'Evidence extraction migration requires a Relay database';
  END IF;
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
