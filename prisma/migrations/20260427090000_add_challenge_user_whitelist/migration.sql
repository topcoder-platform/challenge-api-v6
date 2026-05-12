-- CreateTable
CREATE TABLE "ChallengeUserWhitelist" (
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ChallengeUserWhitelist_pkey" PRIMARY KEY ("challengeId", "userId")
);

-- CreateIndex
CREATE INDEX "ChallengeUserWhitelist_challengeId_idx" ON "ChallengeUserWhitelist"("challengeId");

-- CreateIndex
CREATE INDEX "ChallengeUserWhitelist_userId_idx" ON "ChallengeUserWhitelist"("userId");

-- AddForeignKey
ALTER TABLE "ChallengeUserWhitelist" ADD CONSTRAINT "ChallengeUserWhitelist_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
