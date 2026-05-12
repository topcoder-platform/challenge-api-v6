-- Add the "AI" and "AI Exponential League" tags to selected challenges.
--
-- Replace the ARRAY values below with the challenge IDs to update, then run this
-- against the PostgreSQL database that contains the "challenges" schema.
-- Existing tags are preserved, and either tag is only appended when it is not
-- already present on a challenge.

BEGIN;

CREATE TEMP TABLE "_challenge_ai_tag_input" (
  "challengeId" TEXT PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO "_challenge_ai_tag_input" ("challengeId")
SELECT DISTINCT input."challengeId"
FROM unnest(
  ARRAY[
    -- '00000000-0000-0000-0000-000000000000'
  ]::text[]
) AS input("challengeId")
WHERE input."challengeId" IS NOT NULL;

-- IDs from the input array that do not match an existing challenge.
SELECT input."challengeId" AS "missingChallengeId"
FROM "_challenge_ai_tag_input" input
LEFT JOIN "challenges"."Challenge" c
  ON c."id" = input."challengeId"
WHERE c."id" IS NULL
ORDER BY input."challengeId";

-- Summary before the update.
WITH requested_tags AS (
  SELECT ARRAY['AI', 'AI Exponential League']::text[] AS "tags"
),
matched_challenges AS (
  SELECT
    c."id",
    c."tags",
    requested_tags."tags" AS "requestedTags"
  FROM "challenges"."Challenge" c
  INNER JOIN "_challenge_ai_tag_input" input
    ON input."challengeId" = c."id"
  CROSS JOIN requested_tags
)
SELECT
  COUNT(*) AS "matchingChallenges",
  COUNT(*) FILTER (
    WHERE NOT COALESCE("tags", ARRAY[]::text[]) @> "requestedTags"
  ) AS "challengesNeedingUpdate"
FROM matched_challenges;

WITH requested_tags AS (
  SELECT ARRAY['AI', 'AI Exponential League']::text[] AS "tags"
),
updated AS (
  UPDATE "challenges"."Challenge" c
  SET
    "tags" = COALESCE(c."tags", ARRAY[]::text[]) || ARRAY(
      SELECT requested."tag"
      FROM unnest(requested_tags."tags") AS requested("tag")
      WHERE NOT requested."tag" = ANY(COALESCE(c."tags", ARRAY[]::text[]))
    ),
    "updatedAt" = CURRENT_TIMESTAMP,
    "updatedBy" = 'add-ai-tags-to-challenges'
  FROM "_challenge_ai_tag_input" input
  CROSS JOIN requested_tags
  WHERE c."id" = input."challengeId"
    AND NOT COALESCE(c."tags", ARRAY[]::text[]) @> requested_tags."tags"
  RETURNING
    c."id",
    c."tags"
)
SELECT
  COUNT(*) AS "challengesUpdated"
FROM updated;

-- Spot-check all input challenges after the update.
SELECT
  c."id" AS "challengeId",
  c."tags"
FROM "challenges"."Challenge" c
INNER JOIN "_challenge_ai_tag_input" input
  ON input."challengeId" = c."id"
ORDER BY c."id";

COMMIT;
