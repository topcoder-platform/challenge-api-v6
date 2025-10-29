const {
  PrismaClient,
  ChallengeTrackEnum,
  ReviewTypeEnum,
  DiscussionTypeEnum,
  ChallengeStatusEnum,
  PrizeSetTypeEnum,
  ReviewOpportunityTypeEnum,
} = require("@prisma/client");
const logger = require("./logger");
const config = require("config");

const prismaClient = new PrismaClient({
  log: [
    { level: "query", emit: "event" },
    { level: "info", emit: "event" },
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" },
  ],
  // Increase default interactive transaction limits to avoid 5s timeouts on
  // heavy multi-write operations (e.g., challenge updates with cascading deletes).
  // Allow overriding via environment variables if needed.
  transactionOptions: {
    maxWait: Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS || 10000), // wait up to 10s to start
    timeout: config.CHALLENGE_SERVICE_PRISMA_TIMEOUT, // allow up to 30s per transaction
  },
});

// Forward Prisma engine logs to the application logger. This helps diagnose
// native engine panics or crashes that may lead to exit code 139.
prismaClient.$on("error", (e) => {
  try {
    logger.error(`[prisma:error] ${e.message || e}`);
  } catch (_) {}
});
prismaClient.$on("warn", (e) => {
  try {
    logger.warn(`[prisma:warn] ${e.message || e}`);
  } catch (_) {}
});
prismaClient.$on("info", (e) => {
  try {
    logger.info(`[prisma:info] ${e.message || e}`);
  } catch (_) {}
});

// Optional verbose query logging: enable by setting PRISMA_LOG_QUERIES=true
if (process.env.PRISMA_LOG_QUERIES === "true") {
  prismaClient.$on("query", (e) => {
    try {
      logger.info(
        `[prisma:query] ${e.query} params=${e.params} duration=${e.duration}ms`
      );
    } catch (_) {}
  });
}

// By running the first query, prisma calls $connect() under the hood
module.exports.prismaConnect = () => {
  prismaClient.$connect();
};

module.exports.getClient = () => {
  return prismaClient;
};

module.exports.ChallengeTrackEnum = ChallengeTrackEnum;
module.exports.ReviewTypeEnum = ReviewTypeEnum;
module.exports.DiscussionTypeEnum = DiscussionTypeEnum;
module.exports.ChallengeStatusEnum = ChallengeStatusEnum;
module.exports.PrizeSetTypeEnum = PrizeSetTypeEnum;
module.exports.ReviewOpportunityTypeEnum = ReviewOpportunityTypeEnum;
