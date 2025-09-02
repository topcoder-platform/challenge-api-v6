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
