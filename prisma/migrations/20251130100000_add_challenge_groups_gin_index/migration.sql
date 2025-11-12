-- Improve search responsiveness for group-constrained queries
CREATE INDEX IF NOT EXISTS "challenge_groups_gin_idx"
  ON "challenges"."Challenge"
  USING GIN ("groups");
