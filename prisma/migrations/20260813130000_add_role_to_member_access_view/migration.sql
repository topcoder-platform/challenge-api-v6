-- Expose the resource role so member-scoped challenge searches can narrow the
-- candidate challenge set before applying challenge filters and pagination.
DROP VIEW IF EXISTS "challenges"."MemberChallengeAccess";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'resources'
      AND table_name = 'Resource'
  ) THEN
    EXECUTE format(
      'CREATE VIEW %I.%I AS
          SELECT DISTINCT r."challengeId", r."memberId", r."roleId"
          FROM resources."Resource" r
          WHERE r."challengeId" IS NOT NULL
            AND r."memberId" IS NOT NULL
            AND r."roleId" IS NOT NULL',
      current_schema(), 'MemberChallengeAccess'
    );
  ELSE
    EXECUTE format(
      'CREATE VIEW %I.%I AS
          SELECT CAST(NULL AS TEXT) AS "challengeId",
                 CAST(NULL AS TEXT) AS "memberId",
                 CAST(NULL AS TEXT) AS "roleId"
          WHERE FALSE',
      current_schema(), 'MemberChallengeAccess'
    );
  END IF;
END;
$$;
