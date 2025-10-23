-- CreateIndex
CREATE INDEX "Challenge_status_startDate_idx" ON "Challenge"("status", "startDate");

-- CreateIndex
CREATE INDEX "Challenge_trackId_typeId_status_idx" ON "Challenge"("trackId", "typeId", "status");

-- CreateIndex
CREATE INDEX "Challenge_legacyId_idx" ON "Challenge"("legacyId");

-- CreateIndex
CREATE INDEX "Challenge_projectId_status_idx" ON "Challenge"("projectId", "status");

-- CreateIndex
CREATE INDEX "ChallengePhase_challengeId_isOpen_idx" ON "ChallengePhase"("challengeId", "isOpen");

-- CreateIndex
CREATE INDEX "ChallengePhase_challengeId_name_idx" ON "ChallengePhase"("challengeId", "name");

-- CreateIndex
CREATE INDEX "ChallengePrizeSet_challengeId_type_idx" ON "ChallengePrizeSet"("challengeId", "type");

-- CreateIndex
CREATE INDEX "ChallengeReviewer_challengeId_phaseId_idx" ON "ChallengeReviewer"("challengeId", "phaseId");

-- CreateIndex
CREATE INDEX "ChallengeWinner_challengeId_type_placement_idx" ON "ChallengeWinner"("challengeId", "type", "placement");

-- CreateIndex
CREATE INDEX "TimelineTemplatePhase_timelineTemplateId_phaseId_idx" ON "TimelineTemplatePhase"("timelineTemplateId", "phaseId");
