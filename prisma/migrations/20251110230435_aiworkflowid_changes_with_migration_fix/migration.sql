-- DropIndex
DROP INDEX "challenges"."challenge_name_trgm_idx";

-- DropIndex
DROP INDEX "challenges"."challenge_phase_order_idx";

-- CreateIndex
CREATE INDEX "challenge_name_trgm_idx" ON "Challenge" USING GIN ("name" pg_catalog.gin_trgm_ops);
