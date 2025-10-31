-- Add indexes to support faster `/v6/my-reviews` queries.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "challenge_status_type_track_created_at_idx"
  ON "Challenge" ("status", "typeId", "trackId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "challenge_phase_challenge_open_end_idx"
  ON "ChallengePhase" ("challengeId", "isOpen", "scheduledEndDate", "actualEndDate");

CREATE INDEX IF NOT EXISTS "challenge_name_trgm_idx"
  ON "Challenge"
  USING gin ("name" pg_catalog.gin_trgm_ops);
