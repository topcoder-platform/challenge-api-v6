const { PrismaClient } = require("@prisma/client");
const config = require("config");

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
      timeout: Number(process.env.PRISMA_TRANSACTION_TIMEOUT_MS || 10000),
    },
  });

const getReviewClient = () => {
  if (!config.REVIEW_DB_URL) {
    throw new Error("REVIEW_DB_URL is not configured");
  }
  if (!reviewPrismaClient) {
    reviewPrismaClient = createClient();
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
