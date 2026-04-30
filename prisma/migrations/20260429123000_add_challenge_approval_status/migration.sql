-- Add budget approval workflow fields for challenge launch gating.
CREATE TYPE "ChallengeApprovalStatusEnum" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

ALTER TABLE "Challenge"
ADD COLUMN "approvalStatus" "ChallengeApprovalStatusEnum" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN "approvalRejectionReason" TEXT,
ADD COLUMN "approvalApprovedBy" TEXT;
