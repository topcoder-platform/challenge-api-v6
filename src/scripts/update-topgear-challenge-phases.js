/**
 * Update challenge phases for active Topgear Task challenges.
 *
 * 1. Replace Submission phase entries with the Topgear Submission phase definition.
 * 2. Point Iterative Review predecessors to the Topgear Submission phase definition.
 */
const _ = require("lodash");
const logger = require("../common/logger");
const { getClient, ChallengeStatusEnum } = require("../common/prisma");

const prisma = getClient();

const SCRIPT_ACTOR = "scripts/update-topgear-challenge-phases";
const TOPGEAR_TYPE_NAME = "Topgear Task";
const STANDARD_SUBMISSION_PHASE_NAME = "Submission";
const TOPGEAR_SUBMISSION_PHASE_NAME = "Topgear Submission";
const ITERATIVE_REVIEW_PHASE_NAME = "Iterative Review";

async function resolvePhaseByName(phaseName) {
  const phase = await prisma.phase.findUnique({ where: { name: phaseName } });
  if (!phase) {
    throw new Error(`Phase "${phaseName}" was not found.`);
  }
  return phase;
}

async function main() {
  logger.info("Starting Topgear challenge phase update script...");

  const topgearType = await prisma.challengeType.findFirst({
    where: { name: TOPGEAR_TYPE_NAME },
    select: { id: true, name: true },
  });

  if (!topgearType) {
    throw new Error(`Challenge type "${TOPGEAR_TYPE_NAME}" was not found.`);
  }

  const [submissionPhaseDef, topgearSubmissionPhaseDef, iterativeReviewPhaseDef] = await Promise.all([
    resolvePhaseByName(STANDARD_SUBMISSION_PHASE_NAME),
    resolvePhaseByName(TOPGEAR_SUBMISSION_PHASE_NAME),
    resolvePhaseByName(ITERATIVE_REVIEW_PHASE_NAME),
  ]);

  logger.info(
    `Resolved phase definitions: submission=${submissionPhaseDef.id}, ` +
      `topgearSubmission=${topgearSubmissionPhaseDef.id}, iterativeReview=${iterativeReviewPhaseDef.id}`
  );

  const challenges = await prisma.challenge.findMany({
    where: {
      status: ChallengeStatusEnum.ACTIVE,
      typeId: topgearType.id,
    },
    select: {
      id: true,
      name: true,
      phases: {
        select: {
          id: true,
          phaseId: true,
          name: true,
          predecessor: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (_.isEmpty(challenges)) {
    logger.info("No active Topgear Task challenges found. Nothing to update.");
    return;
  }

  logger.info(`Found ${challenges.length} active Topgear Task challenges to inspect.`);

  let challengesUpdated = 0;
  let submissionUpdates = 0;
  let predecessorUpdates = 0;

  for (const challenge of challenges) {
    const submissionPhaseInstance = challenge.phases.find(
      (phase) => phase.phaseId === submissionPhaseDef.id
    );
    const topgearSubmissionPhaseInstance = challenge.phases.find(
      (phase) => phase.phaseId === topgearSubmissionPhaseDef.id
    );
    const iterativeReviewPhaseInstance = challenge.phases.find(
      (phase) => phase.phaseId === iterativeReviewPhaseDef.id
    );

    const updates = [];
    let challengeSubmissionUpdated = false;
    let challengePredecessorUpdated = false;

    if (submissionPhaseInstance) {
      updates.push(
        prisma.challengePhase.update({
          where: { id: submissionPhaseInstance.id },
          data: {
            phaseId: topgearSubmissionPhaseDef.id,
            name: topgearSubmissionPhaseDef.name,
            updatedBy: SCRIPT_ACTOR,
          },
        })
      );
      challengeSubmissionUpdated = true;
    } else if (!topgearSubmissionPhaseInstance) {
      logger.warn(
        `Challenge ${challenge.id} (${challenge.name}) does not have a Submission or Topgear Submission phase. Skipping phaseId update.`
      );
    }

    if (
      iterativeReviewPhaseInstance &&
      iterativeReviewPhaseInstance.predecessor === submissionPhaseDef.id
    ) {
      updates.push(
        prisma.challengePhase.update({
          where: { id: iterativeReviewPhaseInstance.id },
          data: {
            predecessor: topgearSubmissionPhaseDef.id,
            updatedBy: SCRIPT_ACTOR,
          },
        })
      );
      challengePredecessorUpdated = true;
    }

    if (updates.length === 0) {
      continue;
    }

    await prisma.$transaction(updates);
    challengesUpdated += 1;
    submissionUpdates += challengeSubmissionUpdated ? 1 : 0;
    predecessorUpdates += challengePredecessorUpdated ? 1 : 0;

    logger.info(
      `Updated challenge ${challenge.id} (${challenge.name}) – ` +
        `submissionPhaseUpdated=${challengeSubmissionUpdated}, iterativePredecessorUpdated=${challengePredecessorUpdated}`
    );
  }

  logger.info(
    `Finished processing ${challenges.length} challenges. ` +
      `${challengesUpdated} had updates (${submissionUpdates} submission phase changes, ${predecessorUpdates} predecessor updates).`
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    logger.info("Phase update script completed successfully.");
    process.exit(0);
  })
  .catch(async (err) => {
    logger.logFullError(err);
    await prisma.$disconnect();
    process.exit(1);
  });
