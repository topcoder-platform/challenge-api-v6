ALTER TABLE "ChallengeReviewer" DROP COLUMN "isAIReviewer";

ALTER TABLE "ChallengeReviewer" ADD COLUMN "aiWorkflowId" VARCHAR(14);
