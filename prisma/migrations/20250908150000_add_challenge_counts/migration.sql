-- Add numOfRegistrants and numOfSubmissions to Challenge
ALTER TABLE "Challenge"
  ADD COLUMN IF NOT EXISTS "numOfRegistrants" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "numOfSubmissions" INTEGER NOT NULL DEFAULT 0;

-- Optional: Backfill existing rows to 0 (covered by DEFAULT + NOT NULL)
