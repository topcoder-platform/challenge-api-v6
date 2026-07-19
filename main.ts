import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './src/app.module';

const config = require('config');
const expressApplication = require('./app');
const logger = require('./src/common/logger');
const { getClient } = require('./src/common/prisma');

let shutdownStarted = false;

/**
 * Writes a Node.js diagnostic report when the runtime supports reports.
 *
 * Fatal process handlers use this helper to retain the existing crash
 * diagnostics without allowing report-generation failures to mask the
 * original error.
 *
 * @returns Nothing.
 */
function writeDiagnosticReport(): void {
  try {
    if (process.report && typeof process.report.writeReport === 'function') {
      const reportPath = process.report.writeReport();
      if (reportPath) {
        logger.error(`Diagnostic report written: ${reportPath}`);
      }
    }
  } catch (error) {
    logger.error('Unable to write diagnostic report:', error);
  }
}

/**
 * Registers process-level fatal error reporting used by the production entrypoint.
 *
 * Uncaught exceptions are logged and terminate the process because execution
 * cannot safely continue. Unhandled rejections retain the service's historical
 * log-and-report behavior and do not force an immediate exit.
 *
 * @returns Nothing.
 */
function installFatalErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    try {
      logger.error('Uncaught exception:', error);
      writeDiagnosticReport();
    } finally {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection:', { reason, promise });
    writeDiagnosticReport();
  });
}

/**
 * Gracefully closes Nest's HTTP server and the shared Prisma client.
 *
 * Signal handlers call this once for SIGTERM or SIGINT. A ten-second fallback
 * preserves the previous forced-shutdown bound if either close operation stalls.
 *
 * @param app The initialized Nest application that owns the HTTP listener.
 * @param signal The operating-system signal that initiated shutdown.
 * @returns A promise that settles only after shutdown work has completed.
 */
async function gracefulShutdown(app: INestApplication, signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;

  logger.info(`[${signal}] Received. Starting graceful shutdown...`);
  const timeout = setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10_000);
  timeout.unref();

  try {
    await app.close();
    logger.info('HTTP server closed. Disconnecting Prisma...');
    await getClient().$disconnect();
    logger.info('Prisma disconnected. Exiting.');
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    clearTimeout(timeout);
    process.exit(1);
  }
}

/**
 * Registers operating-system signal handlers for the initialized application.
 *
 * @param app The Nest application to close when the process receives a signal.
 * @returns Nothing.
 */
function installShutdownHandlers(app: INestApplication): void {
  process.on('SIGTERM', () => void gracefulShutdown(app, 'SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown(app, 'SIGINT'));
}

/**
 * Bootstraps Challenge API v6 through NestJS using the existing Express app.
 *
 * Nest's automatic body parser is disabled because the compatibility app
 * already registers body and file-upload middleware in the established order.
 * The configured PORT environment variable and every HTTP route remain unchanged.
 *
 * @returns A promise that resolves after the HTTP server begins listening.
 * @throws Propagates Nest application creation or listener startup failures.
 */
export async function bootstrap(): Promise<void> {
  installFatalErrorHandlers();

  const adapter = new ExpressAdapter(expressApplication);
  const app = await NestFactory.create(AppModule, adapter, {
    bodyParser: false,
    logger: false,
  });

  await app.listen(Number(config.PORT));
  logger.info(`NestJS server listening on port ${config.PORT}`);
  installShutdownHandlers(app);
}

if (require.main === module) {
  void bootstrap();
}
