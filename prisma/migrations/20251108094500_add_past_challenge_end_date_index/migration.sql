-- Improve `/v6/my-reviews` past challenge pagination and ordering.

CREATE INDEX IF NOT EXISTS "challenge_past_status_end_date_idx"
  ON "Challenge" (
    "endDate" DESC NULLS LAST,
    "createdAt" DESC NULLS LAST,
    "name" ASC
  )
  WHERE "status" IN (
    'COMPLETED',
    'CANCELLED',
    'CANCELLED_FAILED_REVIEW',
    'CANCELLED_FAILED_SCREENING',
    'CANCELLED_ZERO_SUBMISSIONS',
    'CANCELLED_CLIENT_REQUEST'
  );
