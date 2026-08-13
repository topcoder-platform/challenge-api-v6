export * from './generated';

import { Prisma, PrismaClient } from './generated';
import type { PoolConfig } from 'pg';

/** Options accepted by the Challenge API external-client factory. */
export type ChallengePrismaClientOptions = Omit<
  Prisma.PrismaClientOptions,
  'adapter' | 'accelerateUrl'
> & {
  /** PostgreSQL driver pool settings such as connection/query timeouts. */
  driverOptions?: Omit<PoolConfig, 'connectionString'>;
};

/**
 * Creates a lazily connected Prisma client for the Challenge API database.
 *
 * @param connectionString PostgreSQL URL, including an optional Prisma
 * `schema` query parameter.
 * @param options Optional Prisma settings and PostgreSQL driver pool settings.
 * @returns A challenge-schema Prisma client. The caller owns its lifecycle and
 * must call `$disconnect()` during shutdown.
 * @throws TypeError when `connectionString` is not a non-empty string. Prisma
 * may throw its standard configuration or database errors when the client is
 * created or used.
 */
export declare function createChallengePrismaClient(
  connectionString: string,
  options?: ChallengePrismaClientOptions,
): PrismaClient;
