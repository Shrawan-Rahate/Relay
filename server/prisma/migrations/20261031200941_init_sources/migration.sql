-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MARKDOWN', 'CSV');

-- CreateTable
CREATE TABLE "Source" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "importedById" UUID NOT NULL,
    "type" "SourceType" NOT NULL,
    "filename" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Source_importedById_idx" ON "Source"("importedById");

-- CreateIndex
CREATE UNIQUE INDEX "Source_projectId_sha256_key" ON "Source"("projectId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Source_id_projectId_key" ON "Source"("id", "projectId");

-- CreateIndex
CREATE INDEX "SourceDocument_projectId_idx" ON "SourceDocument"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_sourceId_position_key" ON "SourceDocument"("sourceId", "position");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_sourceId_projectId_fkey" FOREIGN KEY ("sourceId", "projectId") REFERENCES "Source"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
