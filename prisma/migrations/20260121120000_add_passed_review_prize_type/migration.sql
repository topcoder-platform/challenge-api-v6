-- Add new prize set type for passed review rewards
ALTER TYPE "PrizeSetTypeEnum" ADD VALUE IF NOT EXISTS 'PASSED_REVIEW';
