/*
  Warnings:

  - The `type` column on the `ChallengeReviewer` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ReviewOpportunityTypeEnum" AS ENUM ('REGULAR_REVIEW', 'COMPONENT_DEV_REVIEW', 'SPEC_REVIEW', 'ITERATIVE_REVIEW', 'SCENARIOS_REVIEW');

-- AlterTable
ALTER TABLE "ChallengeReviewer" DROP COLUMN "type",
ADD COLUMN     "type" "ReviewOpportunityTypeEnum";

-- DropEnum
DROP TYPE "ReviewOpportunityType";
