-- DropForeignKey
ALTER TABLE "DefaultChallengeReviewer" DROP CONSTRAINT "DefaultChallengeReviewer_phaseId_fkey";

-- AddForeignKey
ALTER TABLE "DefaultChallengeReviewer" ADD CONSTRAINT "DefaultChallengeReviewer_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
