import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Extracts the PostgreSQL schema selected by a Prisma-style connection URL.
 *
 * The `pg` driver does not apply Prisma's `schema` query parameter itself, so
 * callers pass this result to the Prisma PostgreSQL adapter explicitly.
 *
 * @param connectionString PostgreSQL connection URL used to create the adapter.
 * @returns The decoded `schema` query parameter, or `undefined` when it is not
 * present, empty, or the connection string is not a valid URL.
 * @throws This function does not throw; malformed URLs are treated as having no
 * explicit schema so the PostgreSQL driver's normal validation remains intact.
 */
export const getPostgresSchema = (
  connectionString: string,
): string | undefined => {
  try {
    return new URL(connectionString).searchParams.get('schema') || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Creates the Prisma 7 PostgreSQL driver adapter used by challenge API clients.
 *
 * Both the primary challenge client and the lazy review client use this helper
 * so their existing connection URLs retain Prisma's `schema` query-parameter
 * behavior after moving from the native query engine to `@prisma/adapter-pg`.
 *
 * @param connectionString PostgreSQL connection URL from the existing service
 * environment configuration.
 * @param environmentVariable Name of the environment variable that supplies the
 * URL, used to produce an actionable configuration error.
 * @returns A configured PostgreSQL adapter for a Prisma client.
 * @throws Error when the required connection URL is not configured.
 */
export const createPostgresAdapter = (
  connectionString: string | undefined,
  environmentVariable: 'DATABASE_URL' | 'REVIEW_DB_URL',
): PrismaPg => {
  if (!connectionString) {
    throw new Error(`${environmentVariable} is not configured`);
  }

  const schema = getPostgresSchema(connectionString);

  return new PrismaPg(
    { connectionString },
    schema ? { schema } : undefined,
  );
};
