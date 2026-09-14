import {
  Prisma,
  PrismaClient,
} from '@topcoder/forums-api-v6/packages/forums-prisma-client';
import { createPostgresAdapter } from './prisma-adapter';

const config = require('config');
const logger = require('./logger');

type ForumsPrismaClient = PrismaClient<
  Prisma.PrismaClientOptions,
  Prisma.LogLevel
>;

let forumsPrismaClient: ForumsPrismaClient | undefined;

/**
 * Creates a Prisma client for forum data using the Forums API's exported
 * schema client.
 *
 * The client stays separate from the Challenge database client because forum
 * data can be hosted in another database. Prisma log events are forwarded to
 * the Challenge API logger using a `forums` label.
 *
 * @returns A configured, lazily connected Forums Prisma client.
 * @throws Error when `FORUMS_DB_URL` is missing or Prisma cannot initialize
 * the PostgreSQL adapter.
 */
const createClient = (): ForumsPrismaClient => {
  const client = new PrismaClient<
    Prisma.PrismaClientOptions,
    Prisma.LogLevel
  >({
    adapter: createPostgresAdapter(config.FORUMS_DB_URL, 'FORUMS_DB_URL'),
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

  client.$on('error', (event) => {
    try {
      logger.error(`[prisma:forums:error] ${event.message || event}`);
    } catch {
      // Application logging must not interfere with Prisma error handling.
    }
  });
  client.$on('warn', (event) => {
    try {
      logger.warn(`[prisma:forums:warn] ${event.message || event}`);
    } catch {
      // Application logging must not interfere with Prisma warning handling.
    }
  });
  client.$on('info', (event) => {
    try {
      logger.info(`[prisma:forums:info] ${event.message || event}`);
    } catch {
      // Application logging must not interfere with Prisma information handling.
    }
  });
  if (process.env.PRISMA_LOG_QUERIES === 'true') {
    client.$on('query', (event) => {
      try {
        logger.info(
          `[prisma:forums:query] ${event.query} params=${event.params} duration=${event.duration}ms`,
        );
      } catch {
        // Application logging must not interfere with query execution.
      }
    });
  }

  return client;
};

/**
 * Returns the lazily initialized Prisma client for forum data.
 *
 * @returns The process-wide Forums Prisma client.
 * @throws Error when `FORUMS_DB_URL` is not configured or client
 * initialization fails.
 */
export const getForumsClient = (): ForumsPrismaClient => {
  if (!config.FORUMS_DB_URL) {
    throw new Error('FORUMS_DB_URL is not configured');
  }
  if (!forumsPrismaClient) {
    forumsPrismaClient = createClient();
  }
  return forumsPrismaClient;
};

/**
 * Disconnects the lazy Forums Prisma client when it has been initialized.
 *
 * Graceful shutdown uses this helper without forcing a Forums connection in
 * processes that never requested forum counts.
 *
 * @returns A promise that resolves after the client disconnects, or immediately
 * when no Forums client was created.
 * @throws Prisma disconnection errors from the Forums client.
 */
export const disconnectForumsClient = async (): Promise<void> => {
  if (!forumsPrismaClient) {
    return;
  }

  const client = forumsPrismaClient;
  forumsPrismaClient = undefined;
  await client.$disconnect();
};
