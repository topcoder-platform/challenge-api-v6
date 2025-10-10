-- Add optional timelineTemplateId to DefaultChallengeReviewer for template-specific defaults
ALTER TABLE "DefaultChallengeReviewer"
  ADD COLUMN "timelineTemplateId" TEXT;

-- Support lookups by type/track/timelineTemplate combo
CREATE INDEX IF NOT EXISTS "DefaultChallengeReviewer_typeId_trackId_timelineTemplateId_idx"
  ON "DefaultChallengeReviewer" ("typeId", "trackId", "timelineTemplateId");

-- Reference the timeline template record when provided
ALTER TABLE "DefaultChallengeReviewer"
  ADD CONSTRAINT "DefaultChallengeReviewer_timelineTemplateId_fkey"
  FOREIGN KEY ("timelineTemplateId") REFERENCES "TimelineTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
