-- Add numOfCheckpointSubmissions to Challenge
ALTER TABLE "Challenge"
  ADD COLUMN IF NOT EXISTS "numOfCheckpointSubmissions" INTEGER NOT NULL DEFAULT 0;
