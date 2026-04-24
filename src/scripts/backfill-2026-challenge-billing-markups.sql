-- Backfill challenge billing markup from the billing-accounts schema.
--
-- Scope:
--   - Challenges created on or after 2026-01-01 00:00:00.
--   - Challenges created before 2027-01-01 00:00:00.
--   - Existing challenge billing records with a billingAccountId.
--   - Rows where the stored challenge markup differs from the billing account
--     markup.
--
-- Run this against the PostgreSQL database that contains both schemas:
--   - "challenges"
--   - "billing-accounts"

BEGIN;

WITH candidates AS (
  SELECT
    cb."id" AS "challengeBillingId",
    cb."challengeId",
    cb."billingAccountId",
    cb."markup" AS "currentMarkup",
    ba."markup"::double precision AS "billingAccountMarkup"
  FROM "challenges"."ChallengeBilling" cb
  INNER JOIN "challenges"."Challenge" c
    ON c."id" = cb."challengeId"
  INNER JOIN "billing-accounts"."BillingAccount" ba
    ON ba."id"::text = cb."billingAccountId"
  WHERE c."createdAt" >= TIMESTAMP '2026-01-01 00:00:00'
    AND c."createdAt" < TIMESTAMP '2027-01-01 00:00:00'
    AND cb."billingAccountId" IS NOT NULL
    AND cb."markup" IS DISTINCT FROM ba."markup"::double precision
)
SELECT
  COUNT(*) AS "rowsToUpdate",
  COUNT(DISTINCT "billingAccountId") AS "billingAccountsAffected"
FROM candidates;

WITH candidates AS (
  SELECT
    cb."id" AS "challengeBillingId",
    ba."markup"::double precision AS "billingAccountMarkup"
  FROM "challenges"."ChallengeBilling" cb
  INNER JOIN "challenges"."Challenge" c
    ON c."id" = cb."challengeId"
  INNER JOIN "billing-accounts"."BillingAccount" ba
    ON ba."id"::text = cb."billingAccountId"
  WHERE c."createdAt" >= TIMESTAMP '2026-01-01 00:00:00'
    AND c."createdAt" < TIMESTAMP '2027-01-01 00:00:00'
    AND cb."billingAccountId" IS NOT NULL
    AND cb."markup" IS DISTINCT FROM ba."markup"::double precision
),
updated AS (
  UPDATE "challenges"."ChallengeBilling" cb
  SET
    "markup" = candidates."billingAccountMarkup",
    "updatedAt" = CURRENT_TIMESTAMP,
    "updatedBy" = 'billing-markup-backfill-2026'
  FROM candidates
  WHERE cb."id" = candidates."challengeBillingId"
  RETURNING
    cb."challengeId",
    cb."billingAccountId",
    cb."markup"
)
SELECT
  COUNT(*) AS "rowsUpdated",
  COUNT(DISTINCT "billingAccountId") AS "billingAccountsAffected"
FROM updated;

-- Example spot-check for the challenge from the incident:
SELECT
  c."id" AS "challengeId",
  cb."billingAccountId",
  cb."markup" AS "challengeMarkup",
  ba."markup" AS "billingAccountMarkup"
FROM "challenges"."Challenge" c
INNER JOIN "challenges"."ChallengeBilling" cb
  ON cb."challengeId" = c."id"
INNER JOIN "billing-accounts"."BillingAccount" ba
  ON ba."id"::text = cb."billingAccountId"
WHERE c."id" = '57a1d424-1931-49a8-a180-d0b0f6cdf293';

COMMIT;
