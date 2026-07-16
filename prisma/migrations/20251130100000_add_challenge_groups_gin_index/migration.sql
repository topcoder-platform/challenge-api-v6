-- Improve search responsiveness for group-constrained queries
CREATE INDEX IF NOT EXISTS "challenge_groups_gin_idx"
  ON "Challenge"
  USING GIN ("groups");
