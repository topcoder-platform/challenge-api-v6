const { PrismaClient } = require("@prisma/client");
const config = require("config");
const logger = require("./logger");

let reviewPrismaClient;

const createClient = () =>
  new PrismaClient({
    datasources: {
      db: {
        url: config.REVIEW_DB_URL,
      },
    },
    log: [
      { level: "query", emit: "event" },
      { level: "info", emit: "event" },
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
    ],
    transactionOptions: {
      maxWait: Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS || 10000),
      timeout: config.CHALLENGE_SERVICE_PRISMA_TIMEOUT,
    },
  });

const getReviewClient = () => {
  if (!config.REVIEW_DB_URL) {
    throw new Error("REVIEW_DB_URL is not configured");
  }
  if (!reviewPrismaClient) {
    reviewPrismaClient = createClient();
    // Forward Prisma engine logs for the review DB
    reviewPrismaClient.$on("error", (e) => {
      try {
        logger.error(`[prisma:review:error] ${e.message || e}`);
      } catch (_) {}
    });
    reviewPrismaClient.$on("warn", (e) => {
      try {
        logger.warn(`[prisma:review:warn] ${e.message || e}`);
      } catch (_) {}
    });
    reviewPrismaClient.$on("info", (e) => {
      try {
        logger.info(`[prisma:review:info] ${e.message || e}`);
      } catch (_) {}
    });
    if (process.env.PRISMA_LOG_QUERIES === "true") {
      reviewPrismaClient.$on("query", (e) => {
        try {
          logger.info(
            `[prisma:review:query] ${e.query} params=${e.params} duration=${e.duration}ms`
          );
        } catch (_) {}
      });
    }
  }
  return reviewPrismaClient;
};

const reviewPrismaConnect = () => {
  const client = getReviewClient();
  return client.$connect();
};

module.exports = {
  getReviewClient,
  reviewPrismaConnect,
};
