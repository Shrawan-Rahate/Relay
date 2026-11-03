-- Add clarification storage only on Relay databases; retain existing data.
DO $$
DECLARE
  v_prereq_count integer;
BEGIN
  IF current_database() IN ('relay_dev', 'relay_shadow_dev') THEN
    RETURN;
  END IF;

  IF current_database() = 'railway' THEN
    IF to_regclass('"_prisma_migrations"') IS NULL
       OR to_regclass('"KnowledgeGap"') IS NULL
       OR to_regclass('"KnowledgeGapClaim"') IS NULL THEN
      RAISE EXCEPTION 'Clarification migration rejected: Relay prerequisite schema is missing in database %', current_database();
    END IF;

    SELECT count(*) INTO v_prereq_count
    FROM "_prisma_migrations"
    WHERE migration_name = '20261101010000_knowledge_gaps'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;

    IF v_prereq_count < 1 THEN
      RAISE EXCEPTION 'Clarification migration rejected: prerequisite migration 20261101010000_knowledge_gaps is incomplete in database %', current_database();
    END IF;

    RETURN;
  END IF;

  RAISE EXCEPTION 'Clarification migration requires a Relay database (current database: %)', current_database();
END $$;

-- CreateEnum
CREATE TYPE "ClarificationResponseStatus" AS ENUM ('PENDING_REVIEW');

-- CreateTable
CREATE TABLE "ClarificationResponse" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "gapId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "answerText" TEXT NOT NULL,
    "status" "ClarificationResponseStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClarificationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClarificationResponseEvidence" (
    "id" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "quote" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "documentSha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClarificationResponseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClarificationResponse_projectId_gapId_createdAt_id_idx" ON "ClarificationResponse"("projectId", "gapId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ClarificationResponse_gapId_projectId_idx" ON "ClarificationResponse"("gapId", "projectId");

-- CreateIndex
CREATE INDEX "ClarificationResponse_authorId_idx" ON "ClarificationResponse"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "ClarificationResponse_id_projectId_key" ON "ClarificationResponse"("id", "projectId");

-- CreateIndex
CREATE INDEX "ClarificationResponseEvidence_responseId_projectId_idx" ON "ClarificationResponseEvidence"("responseId", "projectId");

-- CreateIndex
CREATE INDEX "ClarificationResponseEvidence_documentId_projectId_idx" ON "ClarificationResponseEvidence"("documentId", "projectId");

-- AddForeignKey
ALTER TABLE "ClarificationResponse" ADD CONSTRAINT "ClarificationResponse_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationResponse" ADD CONSTRAINT "ClarificationResponse_gapId_projectId_fkey" FOREIGN KEY ("gapId", "projectId") REFERENCES "KnowledgeGap"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationResponse" ADD CONSTRAINT "ClarificationResponse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationResponseEvidence" ADD CONSTRAINT "ClarificationResponseEvidence_responseId_projectId_fkey" FOREIGN KEY ("responseId", "projectId") REFERENCES "ClarificationResponse"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationResponseEvidence" ADD CONSTRAINT "ClarificationResponseEvidence_documentId_projectId_fkey" FOREIGN KEY ("documentId", "projectId") REFERENCES "SourceDocument"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;
