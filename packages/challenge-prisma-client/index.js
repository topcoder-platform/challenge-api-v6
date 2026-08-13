'use strict';

const generated = require('./generated');
const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * Reads the PostgreSQL schema selected by a Prisma-style connection URL.
 *
 * @param {string} connectionString PostgreSQL connection URL supplied to the
 * driver adapter.
 * @returns {string | undefined} The decoded non-empty `schema` query value, or
 * `undefined` when no schema is selected or the URL is malformed.
 * @throws This helper does not throw; Prisma's adapter performs final URL
 * validation when the client is used.
 */
function getPostgresSchema(connectionString) {
  try {
    return new URL(connectionString).searchParams.get('schema') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates an external Challenge API Prisma client backed by PostgreSQL.
 *
 * Aggregating services use this factory instead of constructing the generated
 * Prisma client directly, which keeps the required Prisma 7 driver-adapter
 * setup and connection-string schema handling inside this package.
 *
 * @param {string} connectionString PostgreSQL URL for the challenge database.
 * @param {import('./generated').Prisma.PrismaClientOptions} [options] Optional
 * Prisma logging, transaction, and omit settings. The factory owns `adapter`
 * and `accelerateUrl`, so any JavaScript values supplied for them are ignored.
 * @returns {import('./generated').PrismaClient} A lazily connected challenge
 * Prisma client. The caller must invoke `$disconnect()` during shutdown.
 * @throws {TypeError} When `connectionString` is not a non-empty string.
 * Prisma can throw its normal client or database errors when the returned
 * client is created or used.
 */
function createChallengePrismaClient(connectionString, options = {}) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new TypeError('Challenge database connection string is required');
  }

  const clientOptions = { ...options };
  delete clientOptions.adapter;
  delete clientOptions.accelerateUrl;

  const schema = getPostgresSchema(connectionString);
  const adapter = new PrismaPg(
    { connectionString },
    schema ? { schema } : undefined,
  );

  return new generated.PrismaClient({ ...clientOptions, adapter });
}

module.exports = {
  ...generated,
  createChallengePrismaClient,
};
