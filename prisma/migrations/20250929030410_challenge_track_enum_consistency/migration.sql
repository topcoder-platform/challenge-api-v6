/*
  Warnings:

  - The values [DEVELOP,QA] on the enum `ChallengeTrackEnum` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ChallengeTrackEnum_new" AS ENUM ('DESIGN', 'DATA_SCIENCE', 'DEVELOPMENT', 'QUALITY_ASSURANCE');
ALTER TABLE "ChallengeTrack" ALTER COLUMN "track" TYPE "ChallengeTrackEnum_new" USING ("track"::text::"ChallengeTrackEnum_new");
ALTER TYPE "ChallengeTrackEnum" RENAME TO "ChallengeTrackEnum_old";
ALTER TYPE "ChallengeTrackEnum_new" RENAME TO "ChallengeTrackEnum";
DROP TYPE "ChallengeTrackEnum_old";
COMMIT;
