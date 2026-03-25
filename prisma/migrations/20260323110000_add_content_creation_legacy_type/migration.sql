INSERT INTO "ChallengeType" (
  "id",
  "name",
  "description",
  "isActive",
  "isTask",
  "abbreviation",
  "legacyId",
  "isLegacy",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
)
SELECT
  seed."id",
  seed."name",
  seed."description",
  true,
  false,
  seed."abbreviation",
  seed."legacyId",
  true,
  CURRENT_TIMESTAMP,
  'migration',
  CURRENT_TIMESTAMP,
  'migration'
FROM (
  VALUES
    ('f9570d73-4f26-4d3a-b804-7f6f2f4b85e9', 'BUG_HUNT', 'Legacy develop subtype retained for historical stats references.', 'LBGH', 120),
    ('65d2d4d4-a0e2-4f5d-94df-570f0b084439', 'CONTENT_CREATION', 'Legacy develop subtype retained for historical stats references.', 'LCTC', 146)
) AS seed("id", "name", "description", "abbreviation", "legacyId")
WHERE NOT EXISTS (
  SELECT 1
  FROM "ChallengeType"
  WHERE "name" = seed."name"
     OR "legacyId" = seed."legacyId"
);
