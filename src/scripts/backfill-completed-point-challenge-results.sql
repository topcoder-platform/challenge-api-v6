/*
 * Backfill member profile point awards for completed point-prize challenges.
 *
 * Run this against the PostgreSQL database that contains both the `challenges`
 * and `members` schemas. The source mapping matches Autopilot's completion flow:
 *
 *   - placement prizes are ordered by value descending;
 *   - a placement winner receives the prize at the same ordinal;
 *   - only prizes whose normalized type is POINT are copied;
 *   - fractional point values are truncated; and
 *   - duplicate winner rows retain the member's lowest placement.
 *
 * The script is safe to rerun. It inserts missing memberChallengePoints rows,
 * updates differing rows, leaves matching rows unchanged, and never deletes
 * rows. Challenges with ambiguous source data are reported and skipped.
 *
 * Usage:
 *   psql "$DATABASE_URL" \
 *     -f src/scripts/backfill-completed-point-challenge-results.sql
 *
 * To preview without retaining changes, replace the final COMMIT with ROLLBACK.
 */

BEGIN;

CREATE TEMP TABLE "_point_challenge_ranked_prizes" ON COMMIT DROP AS
WITH placement_sets AS (
  SELECT
    cps."id" AS "prizeSetId",
    cps."challengeId",
    COUNT(*) OVER (PARTITION BY cps."challengeId") AS "placementSetCount"
  FROM "challenges"."ChallengePrizeSet" cps
  WHERE cps."type"::text = 'PLACEMENT'
),
prize_value_groups AS (
  SELECT
    p."prizeSetId",
    p."value",
    COUNT(DISTINCT UPPER(BTRIM(p."type"))) AS "currencyTypeCount"
  FROM "challenges"."Prize" p
  INNER JOIN placement_sets ps
    ON ps."prizeSetId" = p."prizeSetId"
  GROUP BY p."prizeSetId", p."value"
)
SELECT
  ps."challengeId",
  ps."prizeSetId",
  ps."placementSetCount",
  p."id" AS "prizeId",
  UPPER(BTRIM(p."type")) AS "prizeType",
  p."value" AS "prizeValue",
  ROW_NUMBER() OVER (
    PARTITION BY ps."prizeSetId"
    ORDER BY p."value" DESC, p."id" ASC
  )::integer AS "prizePlacement",
  value_groups."currencyTypeCount" > 1 AS "hasMixedCurrencyTie"
FROM placement_sets ps
INNER JOIN "challenges"."Prize" p
  ON p."prizeSetId" = ps."prizeSetId"
INNER JOIN prize_value_groups value_groups
  ON value_groups."prizeSetId" = p."prizeSetId"
 AND value_groups."value" = p."value";

CREATE TEMP TABLE "_point_challenge_ranked_winners" ON COMMIT DROP AS
SELECT
  cw."id" AS "winnerId",
  cw."challengeId",
  cw."userId"::bigint AS "userId",
  cw."placement",
  ROW_NUMBER() OVER (
    PARTITION BY cw."challengeId", cw."userId"
    ORDER BY cw."placement" ASC, cw."createdAt" ASC, cw."id" ASC
  )::integer AS "winnerRank"
FROM "challenges"."ChallengeWinner" cw
WHERE cw."type"::text = 'PLACEMENT';

CREATE TEMP TABLE "_point_challenge_award_candidates" ON COMMIT DROP AS
WITH matched_awards AS (
  SELECT
    c."id" AS "challengeId",
    c."name" AS "challengeName",
    winners."userId",
    winners."placement",
    prizes."prizeId",
    prizes."prizeValue",
    prizes."hasMixedCurrencyTie",
    member_row."userId" IS NOT NULL AS "memberExists",
    ROW_NUMBER() OVER (
      PARTITION BY c."id", winners."userId"
      ORDER BY winners."placement" ASC, winners."winnerId" ASC
    )::integer AS "awardRank"
  FROM "challenges"."Challenge" c
  INNER JOIN "_point_challenge_ranked_prizes" prizes
    ON prizes."challengeId" = c."id"
   AND prizes."placementSetCount" = 1
   AND prizes."prizeType" = 'POINT'
  INNER JOIN "_point_challenge_ranked_winners" winners
    ON winners."challengeId" = c."id"
   AND winners."placement" = prizes."prizePlacement"
  LEFT JOIN "members"."member" member_row
    ON member_row."userId" = winners."userId"
  WHERE c."status"::text = 'COMPLETED'
)
SELECT
  matched."challengeId",
  matched."challengeName",
  matched."userId",
  matched."placement",
  matched."prizeId",
  matched."prizeValue",
  CASE
    WHEN matched."prizeValue" > 0
      AND matched."prizeValue" <= 2147483647
    THEN TRUNC(matched."prizeValue")::integer
    ELSE NULL
  END AS "points",
  matched."hasMixedCurrencyTie",
  matched."memberExists"
FROM matched_awards matched
WHERE matched."awardRank" = 1;

-- Preflight summary. `eligibleRows` is the maximum number of rows this run can
-- insert or update after excluding source ambiguities and missing members.
SELECT
  COUNT(DISTINCT candidates."challengeId") AS "challengesWithMappedPointAwards",
  COUNT(*) AS "mappedPointAwards",
  COUNT(*) FILTER (
    WHERE candidates."points" IS NOT NULL
      AND candidates."points" > 0
      AND NOT candidates."hasMixedCurrencyTie"
      AND candidates."memberExists"
  ) AS "eligibleRows",
  COUNT(*) FILTER (WHERE NOT candidates."memberExists") AS "missingMemberRows",
  COUNT(*) FILTER (WHERE candidates."points" IS NULL OR candidates."points" <= 0)
    AS "invalidPointValueRows",
  COUNT(*) FILTER (WHERE candidates."hasMixedCurrencyTie") AS "ambiguousPrizeRows",
  COUNT(*) FILTER (
    WHERE existing."id" IS NULL
      AND candidates."points" > 0
      AND NOT candidates."hasMixedCurrencyTie"
      AND candidates."memberExists"
  ) AS "rowsToInsert",
  COUNT(*) FILTER (
    WHERE existing."id" IS NOT NULL
      AND candidates."points" > 0
      AND NOT candidates."hasMixedCurrencyTie"
      AND candidates."memberExists"
      AND (
        existing."challengeName" IS DISTINCT FROM candidates."challengeName"
        OR existing."placement" IS DISTINCT FROM candidates."placement"
        OR existing."points" IS DISTINCT FROM candidates."points"
      )
  ) AS "rowsToUpdate"
FROM "_point_challenge_award_candidates" candidates
LEFT JOIN "members"."memberChallengePoints" existing
  ON existing."challengeId" = candidates."challengeId"
 AND existing."userId" = candidates."userId";

-- Completed point challenges with more than one placement prize set are
-- ambiguous because the application expects one placement set. They are not
-- included in the backfill.
SELECT DISTINCT
  c."id" AS "challengeId",
  c."name" AS "challengeName",
  prizes."placementSetCount"
FROM "challenges"."Challenge" c
INNER JOIN "_point_challenge_ranked_prizes" prizes
  ON prizes."challengeId" = c."id"
WHERE c."status"::text = 'COMPLETED'
  AND prizes."prizeType" = 'POINT'
  AND prizes."placementSetCount" > 1
ORDER BY c."id";

-- A completed point challenge without placement winners has no authoritative
-- member result to copy and requires separate winner-data investigation.
SELECT DISTINCT
  c."id" AS "challengeId",
  c."name" AS "challengeName"
FROM "challenges"."Challenge" c
INNER JOIN "_point_challenge_ranked_prizes" prizes
  ON prizes."challengeId" = c."id"
WHERE c."status"::text = 'COMPLETED'
  AND prizes."prizeType" = 'POINT'
  AND NOT EXISTS (
    SELECT 1
    FROM "_point_challenge_ranked_winners" winners
    WHERE winners."challengeId" = c."id"
  )
ORDER BY c."id";

-- Equal-valued prizes with different currencies have no reliable placement
-- ordering. These mapped awards are reported and skipped.
SELECT
  candidates."challengeId",
  candidates."challengeName",
  candidates."userId",
  candidates."placement",
  candidates."prizeValue"
FROM "_point_challenge_award_candidates" candidates
WHERE candidates."hasMixedCurrencyTie"
ORDER BY candidates."challengeId", candidates."placement", candidates."userId";

-- Invalid or non-positive point amounts are not accepted by the member API and
-- are omitted from the write.
SELECT
  candidates."challengeId",
  candidates."challengeName",
  candidates."userId",
  candidates."placement",
  candidates."prizeValue"
FROM "_point_challenge_award_candidates" candidates
WHERE candidates."points" IS NULL OR candidates."points" <= 0
ORDER BY candidates."challengeId", candidates."placement", candidates."userId";

-- Missing member rows would violate the memberChallengePoints foreign key.
SELECT
  candidates."challengeId",
  candidates."challengeName",
  candidates."userId",
  candidates."placement",
  candidates."points"
FROM "_point_challenge_award_candidates" candidates
WHERE NOT candidates."memberExists"
ORDER BY candidates."challengeId", candidates."placement", candidates."userId";

-- Duplicate placement-winner rows are reduced to the member's lowest
-- placement, matching the completion flow. They are shown for investigation.
SELECT
  winners."challengeId",
  winners."userId",
  winners."placement",
  winners."winnerId"
FROM "_point_challenge_ranked_winners" winners
INNER JOIN "challenges"."Challenge" c
  ON c."id" = winners."challengeId"
WHERE c."status"::text = 'COMPLETED'
  AND winners."winnerRank" > 1
  AND EXISTS (
    SELECT 1
    FROM "_point_challenge_ranked_prizes" prizes
    WHERE prizes."challengeId" = winners."challengeId"
      AND prizes."prizeType" = 'POINT'
  )
ORDER BY winners."challengeId", winners."userId", winners."placement";

WITH eligible_awards AS (
  SELECT
    candidates."challengeId",
    candidates."challengeName",
    candidates."userId",
    candidates."placement",
    candidates."points"
  FROM "_point_challenge_award_candidates" candidates
  WHERE candidates."points" > 0
    AND NOT candidates."hasMixedCurrencyTie"
    AND candidates."memberExists"
),
upserted AS (
  INSERT INTO "members"."memberChallengePoints" AS stored_points (
    "challengeId",
    "challengeName",
    "userId",
    "placement",
    "points",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy"
  )
  SELECT
    awards."challengeId",
    awards."challengeName",
    awards."userId",
    awards."placement",
    awards."points",
    CURRENT_TIMESTAMP,
    'challenge-points-backfill',
    CURRENT_TIMESTAMP,
    'challenge-points-backfill'
  FROM eligible_awards awards
  ON CONFLICT ("challengeId", "userId") DO UPDATE
  SET
    "challengeName" = EXCLUDED."challengeName",
    "placement" = EXCLUDED."placement",
    "points" = EXCLUDED."points",
    "updatedAt" = CURRENT_TIMESTAMP,
    "updatedBy" = 'challenge-points-backfill'
  WHERE stored_points."challengeName" IS DISTINCT FROM EXCLUDED."challengeName"
     OR stored_points."placement" IS DISTINCT FROM EXCLUDED."placement"
     OR stored_points."points" IS DISTINCT FROM EXCLUDED."points"
  RETURNING "challengeId", "userId"
)
SELECT
  COUNT(*) AS "rowsInsertedOrUpdated",
  COUNT(DISTINCT "challengeId") AS "challengesAffected"
FROM upserted;

-- Post-check: both counts should be zero.
SELECT
  COUNT(*) FILTER (WHERE stored."id" IS NULL) AS "eligibleRowsStillMissing",
  COUNT(*) FILTER (
    WHERE stored."id" IS NOT NULL
      AND (
        stored."challengeName" IS DISTINCT FROM candidates."challengeName"
        OR stored."placement" IS DISTINCT FROM candidates."placement"
        OR stored."points" IS DISTINCT FROM candidates."points"
      )
  ) AS "eligibleRowsStillDifferent"
FROM "_point_challenge_award_candidates" candidates
LEFT JOIN "members"."memberChallengePoints" stored
  ON stored."challengeId" = candidates."challengeId"
 AND stored."userId" = candidates."userId"
WHERE candidates."points" > 0
  AND NOT candidates."hasMixedCurrencyTie"
  AND candidates."memberExists";

COMMIT;
