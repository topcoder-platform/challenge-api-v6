-- Remove deprecated ChallengePhase ordering index and allow AI reviewer flag to be nullable.

DO
$$
DECLARE
  idx_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO idx_schema
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'challenge_phase_order_idx'
     AND c.relkind = 'i'
   LIMIT 1;

  IF idx_schema IS NOT NULL THEN
    EXECUTE format('DROP INDEX %I.%I', idx_schema, 'challenge_phase_order_idx');
  END IF;
END
$$ LANGUAGE plpgsql;

DO
$$
DECLARE
  tbl_schema TEXT;
BEGIN
  SELECT n.nspname
    INTO tbl_schema
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relname = 'DefaultChallengeReviewer'
     AND c.relkind = 'r'
   LIMIT 1;

  IF tbl_schema IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
    tbl_schema,
    'DefaultChallengeReviewer',
    'isAIReviewer'
  );
END
$$ LANGUAGE plpgsql;
