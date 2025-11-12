/*
  Warnings:

  - You are about to drop the column `isAIReviewer` on the `DefaultChallengeReviewer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DefaultChallengeReviewer" DROP COLUMN "isAIReviewer",
ADD COLUMN     "aiWorkflowId" VARCHAR(14),
ALTER COLUMN "scorecardId" DROP NOT NULL;
