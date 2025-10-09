-- Add optional phaseId to DefaultChallengeReviewer and link to Phase
ALTER TABLE "DefaultChallengeReviewer"
  ADD COLUMN "phaseId" TEXT;

-- Index for faster lookups by phase
CREATE INDEX IF NOT EXISTS "DefaultChallengeReviewer_phaseId_idx"
  ON "DefaultChallengeReviewer" ("phaseId");

-- Foreign key to Phase(id)
ALTER TABLE "DefaultChallengeReviewer"
  ADD CONSTRAINT "DefaultChallengeReviewer_phaseId_fkey"
  FOREIGN KEY ("phaseId") REFERENCES "Phase"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
  
-- DropForeignKey
ALTER TABLE "DefaultChallengeReviewer" DROP CONSTRAINT "DefaultChallengeReviewer_phaseId_fkey";

-- AddForeignKey
ALTER TABLE "DefaultChallengeReviewer" ADD CONSTRAINT "DefaultChallengeReviewer_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

