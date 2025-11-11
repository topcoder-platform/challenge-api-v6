-- Add indexes to support faster `/v6/my-reviews` queries.

CREATE SCHEMA IF NOT EXISTS skills;
CREATE SCHEMA IF NOT EXISTS reviews;

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA skills;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA reviews;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA skills;

CREATE INDEX IF NOT EXISTS "challenge_status_type_track_created_at_idx"
  ON "Challenge" ("status", "typeId", "trackId", "createdAt" DESC);

DROP INDEX IF EXISTS "challenge_name_idx";

CREATE INDEX IF NOT EXISTS "challenge_name_trgm_idx"
  ON "Challenge" USING gin ("name" pg_catalog.gin_trgm_ops);

DO
$$
DECLARE
  challenge_phase_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO challenge_phase_schema
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'ChallengePhase'
     AND c.relkind = 'r'
   LIMIT 1;

  IF challenge_phase_schema IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
        SELECT 1
          FROM pg_class idx
          JOIN pg_namespace ns ON ns.oid = idx.relnamespace
         WHERE idx.relname = 'challenge_phase_order_idx'
           AND ns.nspname = challenge_phase_schema
     )
     AND EXISTS (
        SELECT 1
          FROM pg_class idx
          JOIN pg_namespace ns ON ns.oid = idx.relnamespace
         WHERE idx.relname = 'challenge_phase_challenge_open_end_idx'
           AND ns.nspname = challenge_phase_schema
           AND pg_get_indexdef(idx.oid) LIKE '%("challengeId", "isOpen", "scheduledEndDate", "actualEndDate", name)%'
     )
  THEN
    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      challenge_phase_schema,
      'challenge_phase_challenge_open_end_idx',
      'challenge_phase_order_idx'
    );
  END IF;
END
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS "challenge_phase_challenge_open_end_idx"
  ON "ChallengePhase" ("challengeId", "isOpen", "scheduledEndDate", "actualEndDate");

CREATE INDEX IF NOT EXISTS "challenge_phase_order_idx"
  ON "ChallengePhase" ("challengeId", "isOpen", "scheduledEndDate", "actualEndDate", "name");
