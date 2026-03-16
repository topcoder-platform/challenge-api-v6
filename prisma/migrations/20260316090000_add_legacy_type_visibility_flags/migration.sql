ALTER TABLE "ChallengeType"
ADD COLUMN "legacyId" INTEGER,
ADD COLUMN "isLegacy" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ChallengeTrack"
ADD COLUMN "isLegacy" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ChallengeType_legacyId_idx" ON "ChallengeType"("legacyId");
CREATE INDEX "ChallengeType_isLegacy_idx" ON "ChallengeType"("isLegacy");
CREATE INDEX "ChallengeTrack_isLegacy_idx" ON "ChallengeTrack"("isLegacy");

UPDATE "ChallengeType"
SET "legacyId" = 149
WHERE "name" = 'First2Finish'
  AND "legacyId" IS NULL;

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
    ('ac043fcf-fe36-46c6-8480-2e12bd5300cd', 'SRM', 'Legacy SRM subtype retained for historical stats references.', 'SRM', NULL),
    ('b02fdb46-8fad-4e91-aa81-14453f647ac9', 'CODE', 'Legacy develop subtype retained for historical stats references.', 'COD', 150),
    ('7e361ed7-4846-4e8e-8cfe-d747590d2611', 'DESIGN', 'Legacy develop subtype retained for historical stats references.', 'LDES', NULL),
    ('0984ef6a-e1f9-46de-8425-43b8d29f55f5', 'DEVELOPMENT', 'Legacy develop subtype retained for historical stats references.', 'LDEV', NULL),
    ('ca4681e8-a4be-44f5-9ada-0b8b43428233', 'SPECIFICATION', 'Legacy develop subtype retained for historical stats references.', 'LSPC', NULL),
    ('2e3a9589-21c5-42fc-bc91-27077e171c45', 'ARCHITECTURE', 'Legacy develop subtype retained for historical stats references.', 'LARC', NULL),
    ('c2e6b73d-26e8-46c6-9a86-9c22144e98f2', 'TEST_SUITES', 'Legacy develop subtype retained for historical stats references.', 'LTST', NULL),
    ('78253687-cc08-4aa8-b897-7a4f0c0b362d', 'ASSEMBLY_COMPETITION', 'Legacy develop subtype retained for historical stats references.', 'LASM', 125),
    ('7d68e306-bc13-4c59-8481-d2b7f5d1c344', 'UI_PROTOTYPE_COMPETITION', 'Legacy develop subtype retained for historical stats references.', 'LUIP', NULL),
    ('ce7fe807-fb83-4f9c-ac12-919adb89b411', 'CONCEPTUALIZATION', 'Legacy develop subtype retained for historical stats references.', 'LCON', 134),
    ('dfd9b687-b1c8-4ec2-8fd2-bfbf07fe2802', 'RIA_BUILD_COMPETITION', 'Legacy develop subtype retained for historical stats references.', 'LRIA', NULL),
    ('9bd8bf24-b4e9-4231-8fbf-ab1474906a5a', 'TEST_SCENARIOS', 'Legacy develop subtype retained for historical stats references.', 'LSCN', NULL),
    ('cf86f84c-c601-42c5-b55b-36d82a17818b', 'COPILOT_POSTING', 'Legacy develop subtype retained for historical stats references.', 'LCOP', NULL)
) AS seed("id", "name", "description", "abbreviation", "legacyId")
WHERE NOT EXISTS (
  SELECT 1
  FROM "ChallengeType" existing
  WHERE existing."name" = seed."name"
);
