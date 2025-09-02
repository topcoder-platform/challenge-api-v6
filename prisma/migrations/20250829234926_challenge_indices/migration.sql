-- CreateEnum
CREATE TYPE "ReviewOpportunityType" AS ENUM ('REGULAR_REVIEW', 'COMPONENT_DEV_REVIEW', 'SPEC_REVIEW', 'ITERATIVE_REVIEW', 'SCENARIOS_REVIEW');

-- CreateTable
CREATE TABLE "ChallengeReviewer" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "isMemberReview" BOOLEAN NOT NULL,
    "memberReviewerCount" INTEGER,
    "phaseId" TEXT NOT NULL,
    "basePayment" DOUBLE PRECISION,
    "incrementalPayment" DOUBLE PRECISION,
    "type" "ReviewOpportunityType",
    "isAIReviewer" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "ChallengeReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChallengeReviewer_challengeId_idx" ON "ChallengeReviewer"("challengeId");

-- CreateIndex
CREATE INDEX "ChallengeReviewer_phaseId_idx" ON "ChallengeReviewer"("phaseId");

-- CreateIndex
CREATE INDEX "Challenge_createdAt_idx" ON "Challenge"("createdAt");

-- CreateIndex
CREATE INDEX "Challenge_updatedAt_idx" ON "Challenge"("updatedAt");

-- CreateIndex
CREATE INDEX "Challenge_typeId_idx" ON "Challenge"("typeId");

-- CreateIndex
CREATE INDEX "Challenge_trackId_idx" ON "Challenge"("trackId");

-- CreateIndex
CREATE INDEX "Challenge_submissionStartDate_idx" ON "Challenge"("submissionStartDate");

-- CreateIndex
CREATE INDEX "Challenge_submissionEndDate_idx" ON "Challenge"("submissionEndDate");

-- CreateIndex
CREATE INDEX "Challenge_registrationStartDate_idx" ON "Challenge"("registrationStartDate");

-- CreateIndex
CREATE INDEX "Challenge_registrationEndDate_idx" ON "Challenge"("registrationEndDate");

-- CreateIndex
CREATE INDEX "Challenge_startDate_idx" ON "Challenge"("startDate");

-- CreateIndex
CREATE INDEX "Challenge_endDate_idx" ON "Challenge"("endDate");

-- AddForeignKey
ALTER TABLE "ChallengeReviewer" ADD CONSTRAINT "ChallengeReviewer_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeReviewer" ADD CONSTRAINT "ChallengeReviewer_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
