-- Add published handover storage only on Relay databases.
DO $$
DECLARE
  v_prereq_count integer;
BEGIN
  IF current_database() IN ('relay_dev', 'relay_shadow_dev') THEN
    RETURN;
  END IF;

  IF current_database() IN ('railway', 'railway_pzo0') THEN
    IF to_regclass('"_prisma_migrations"') IS NULL
       OR to_regclass('"ReviewDecision"') IS NULL
       OR to_regclass('"ClarificationResponse"') IS NULL THEN
      RAISE EXCEPTION 'Verified handover migration rejected: Relay prerequisite schema is missing in database %', current_database();
    END IF;

    SELECT count(*) INTO v_prereq_count
    FROM "_prisma_migrations"
    WHERE migration_name = '20261101030000_human_review'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL;

    IF v_prereq_count < 1 THEN
      RAISE EXCEPTION 'Verified handover migration rejected: prerequisite migration 20261101030000_human_review is incomplete in database %', current_database();
    END IF;

    RETURN;
  END IF;

  RAISE EXCEPTION 'Verified handover migration requires a Relay database (current database: %)', current_database();
END $$;

-- CreateTable
CREATE TABLE "HandoverSnapshot" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "authorId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "contentSha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverReceipt" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoverSnapshot_authorId_idx" ON "HandoverSnapshot"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverSnapshot_projectId_version_key" ON "HandoverSnapshot"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverSnapshot_id_projectId_version_key" ON "HandoverSnapshot"("id", "projectId", "version");

-- CreateIndex
CREATE INDEX "HandoverReceipt_projectId_snapshotId_id_idx" ON "HandoverReceipt"("projectId", "snapshotId", "id");

-- CreateIndex
CREATE INDEX "HandoverReceipt_snapshotId_projectId_snapshotVersion_idx" ON "HandoverReceipt"("snapshotId", "projectId", "snapshotVersion");

-- CreateIndex
CREATE INDEX "HandoverReceipt_userId_idx" ON "HandoverReceipt"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverReceipt_snapshotId_userId_key" ON "HandoverReceipt"("snapshotId", "userId");

-- AddForeignKey
ALTER TABLE "HandoverSnapshot" ADD CONSTRAINT "HandoverSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverSnapshot" ADD CONSTRAINT "HandoverSnapshot_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReceipt" ADD CONSTRAINT "HandoverReceipt_snapshotId_projectId_snapshotVersion_fkey" FOREIGN KEY ("snapshotId", "projectId", "snapshotVersion") REFERENCES "HandoverSnapshot"("id", "projectId", "version") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReceipt" ADD CONSTRAINT "HandoverReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverReceipt" ADD CONSTRAINT "HandoverReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HandoverSnapshot" ADD CONSTRAINT "HandoverSnapshot_valid_version" CHECK ("version" > 0);
ALTER TABLE "HandoverReceipt" ADD CONSTRAINT "HandoverReceipt_valid_version" CHECK ("snapshotVersion" > 0);

-- Published content and acknowledgement timestamps can never be rewritten.
-- Deletion remains available for parent-project lifecycle and fixture cleanup.
CREATE FUNCTION relay_reject_handover_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published handover snapshots and receipts are immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "HandoverSnapshot_immutable" BEFORE UPDATE ON "HandoverSnapshot"
FOR EACH ROW EXECUTE FUNCTION relay_reject_handover_update();
CREATE TRIGGER "HandoverReceipt_immutable" BEFORE UPDATE ON "HandoverReceipt"
FOR EACH ROW EXECUTE FUNCTION relay_reject_handover_update();
