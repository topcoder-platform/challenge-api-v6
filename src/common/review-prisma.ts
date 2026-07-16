import { Prisma, PrismaClient } from '@prisma/client';
import { createPostgresAdapter } from './prisma-adapter';

const config = require('config');
const logger = require('./logger');

/**
 * Creates a Prisma client for the review database using the existing review URL.
 *
 * This remains separate from the challenge database client because review data
 * can be hosted in another database or schema.
 *
 * The event listeners are attached before the client is returned so the public
 * client type can stay compact without losing typed Prisma log events.
 *
 * @returns A configured, not-yet-connected review Prisma client with log
 * forwarding registered.
 * @throws Error when `REVIEW_DB_URL` is missing or Prisma cannot initialize the
 * PostgreSQL adapter.
 */
const createClient = (): ReviewPrismaClient => {
  const client = new PrismaClient<
    Prisma.PrismaClientOptions,
    Prisma.LogLevel
  >({
    adapter: createPostgresAdapter(config.REVIEW_DB_URL, 'REVIEW_DB_URL'),
    log: [
      { level: 'query', emit: 'event' },
      { level: 'info', emit: 'event' },
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
    transactionOptions: {
      maxWait: Number(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS || 10000),
      timeout: config.CHALLENGE_SERVICE_PRISMA_TIMEOUT,
    },
  });

  // Forward Prisma engine logs for the review DB.
  client.$on('error', (e) => {
    try {
      logger.error(`[prisma:review:error] ${e.message || e}`);
    } catch {
      // Application logging must not interfere with Prisma error handling.
    }
  });
  client.$on('warn', (e) => {
    try {
      logger.warn(`[prisma:review:warn] ${e.message || e}`);
    } catch {
      // Application logging must not interfere with Prisma warning handling.
    }
  });
  client.$on('info', (e) => {
    try {
      logger.info(`[prisma:review:info] ${e.message || e}`);
    } catch {
      // Application logging must not interfere with Prisma information handling.
    }
  });
  if (process.env.PRISMA_LOG_QUERIES === 'true') {
    client.$on('query', (e) => {
      try {
        logger.info(
          `[prisma:review:query] ${e.query} params=${e.params} duration=${e.duration}ms`,
        );
      } catch {
        // Application logging must not interfere with query execution.
      }
    });
  }

  return client;
};

type ReviewPrismaClient = PrismaClient<
  Prisma.PrismaClientOptions,
  Prisma.LogLevel
>;

let reviewPrismaClient: ReviewPrismaClient | undefined;

/**
 * Returns the lazily initialized Prisma client for review data.
 *
 * The first caller creates the adapter and registers the legacy Prisma event
 * forwarding; later callers reuse the same client and connection pool.
 *
 * @returns The process-wide review Prisma client.
 * @throws Error when `REVIEW_DB_URL` is not configured or Prisma initialization
 * fails.
 */
export const getReviewClient = (): ReviewPrismaClient => {
  if (!config.REVIEW_DB_URL) {
    throw new Error('REVIEW_DB_URL is not configured');
  }
  if (!reviewPrismaClient) {
    reviewPrismaClient = createClient();
  }
  return reviewPrismaClient;
};

/**
 * Connects the lazy review Prisma client during application startup.
 *
 * @returns A promise that resolves when the review database connection is ready.
 * @throws Error when `REVIEW_DB_URL` is missing or the database connection fails.
 */
export const reviewPrismaConnect = (): Promise<void> => {
  const client = getReviewClient();
  return client.$connect();
};
