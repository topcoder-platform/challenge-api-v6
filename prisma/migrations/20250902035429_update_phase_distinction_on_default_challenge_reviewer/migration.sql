-- CreateTable
CREATE TABLE "DefaultChallengeReviewer" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "isMemberReview" BOOLEAN NOT NULL,
    "memberReviewerCount" INTEGER,
    "phaseName" TEXT NOT NULL,
    "basePayment" DOUBLE PRECISION,
    "incrementalPayment" DOUBLE PRECISION,
    "opportunityType" "ReviewOpportunityTypeEnum",
    "isAIReviewer" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "DefaultChallengeReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DefaultChallengeReviewer_typeId_trackId_idx" ON "DefaultChallengeReviewer"("typeId", "trackId");

-- AddForeignKey
ALTER TABLE "DefaultChallengeReviewer" ADD CONSTRAINT "DefaultChallengeReviewer_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ChallengeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultChallengeReviewer" ADD CONSTRAINT "DefaultChallengeReviewer_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "ChallengeTrack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
