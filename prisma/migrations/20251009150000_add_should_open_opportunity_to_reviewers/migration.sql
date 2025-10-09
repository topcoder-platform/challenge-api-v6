-- Add shouldOpenOpportunity flag to reviewer tables
ALTER TABLE "ChallengeReviewer"
  ADD COLUMN IF NOT EXISTS "shouldOpenOpportunity" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "DefaultChallengeReviewer"
  ADD COLUMN IF NOT EXISTS "shouldOpenOpportunity" BOOLEAN NOT NULL DEFAULT TRUE;

