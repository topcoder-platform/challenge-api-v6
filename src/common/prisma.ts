import {
  Prisma,
  PrismaClient,
  ChallengeTrackEnum,
  ReviewTypeEnum,
  DiscussionTypeEnum,
  ChallengeStatusEnum,
  PrizeSetTypeEnum,
  ReviewOpportunityTypeEnum,
} from '@prisma/client';
import { createPostgresAdapter } from './prisma-adapter';

const logger = require('./logger');
const config = require('config');

type ChallengePrismaClient = PrismaClient<
  Prisma.PrismaClientOptions,
  Prisma.LogLevel
>;

const prismaClient: ChallengePrismaClient = new PrismaClient<
  Prisma.PrismaClientOptions,
  Prisma.LogLevel
>({
  adapter: createPostgresAdapter(process.env.DATABASE_URL, 'DATABASE_URL'),
  log: [
    { level: 'query', emit: 'event' },
    { level: 'info', emit: 'event' },
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
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
prismaClient.$on('error', (e) => {
  try {
    logger.error(`[prisma:error] ${e.message || e}`);
  } catch {
    // Application logging must not interfere with Prisma error handling.
  }
});
prismaClient.$on('warn', (e) => {
  try {
    logger.warn(`[prisma:warn] ${e.message || e}`);
  } catch {
    // Application logging must not interfere with Prisma warning handling.
  }
});
prismaClient.$on('info', (e) => {
  try {
    logger.info(`[prisma:info] ${e.message || e}`);
  } catch {
    // Application logging must not interfere with Prisma information handling.
  }
});

// Optional verbose query logging: enable by setting PRISMA_LOG_QUERIES=true
if (process.env.PRISMA_LOG_QUERIES === 'true') {
  prismaClient.$on('query', (e) => {
    try {
      logger.info(
        `[prisma:query] ${e.query} params=${e.params} duration=${e.duration}ms`,
      );
    } catch {
      // Application logging must not interfere with query execution.
    }
  });
}

/**
 * Starts the primary challenge database connection.
 *
 * Maintenance callers may invoke this compatibility export when they want to
 * establish the pool eagerly; normal service queries connect lazily through
 * Prisma.
 *
 * @returns Nothing. Connection establishment continues asynchronously to match
 * the legacy bootstrap contract.
 * @throws Prisma may report connection failures through the returned internal
 * promise and configured logging callbacks.
 */
export const prismaConnect = (): void => {
  void prismaClient.$connect();
};

/**
 * Returns the singleton Prisma client for the challenge database.
 *
 * Services use this compatibility export to share one connection pool and one
 * set of transaction and logging options.
 *
 * @returns The process-wide challenge Prisma client.
 * @throws This function does not throw after module initialization.
 */
export const getClient = (): ChallengePrismaClient => {
  return prismaClient;
};

export {
  ChallengeTrackEnum,
  ReviewTypeEnum,
  DiscussionTypeEnum,
  ChallengeStatusEnum,
  PrizeSetTypeEnum,
  ReviewOpportunityTypeEnum,
};
