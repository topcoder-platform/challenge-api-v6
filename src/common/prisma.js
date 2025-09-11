const {
  PrismaClient,
  ChallengeTrackEnum,
  ReviewTypeEnum,
  DiscussionTypeEnum,
  ChallengeStatusEnum,
  PrizeSetTypeEnum,
  ReviewOpportunityTypeEnum,
} = require("@prisma/client");

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
    timeout: Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS || 10000), // allow up to 30s per transaction
  },
});

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
