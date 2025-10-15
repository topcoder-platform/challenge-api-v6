-- AlterTable
ALTER TABLE "ChallengeReviewer" ADD COLUMN     "fixedAmount" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "ChallengeReviewer" RENAME COLUMN "basePayment" TO "baseCoefficient";
ALTER TABLE "ChallengeReviewer" RENAME COLUMN "incrementalPayment" TO "incrementalCoefficient";
ALTER TABLE "DefaultChallengeReviewer" ADD COLUMN     "fixedAmount" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "DefaultChallengeReviewer" RENAME COLUMN "basePayment" TO "baseCoefficient";
ALTER TABLE "DefaultChallengeReviewer" RENAME COLUMN "incrementalPayment" TO "incrementalCoefficient";
