'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ChallengeStatusEnum,
  createChallengePrismaClient,
} = require('./index');

/**
 * Verifies the packaged factory exposes the generated challenge schema without
 * opening a database connection.
 *
 * @returns {Promise<void>} Resolves after the client pool is closed.
 * @throws AssertionError when the public package contract is incomplete.
 */
test('creates a Challenge Prisma client with generated exports', async () => {
  const client = createChallengePrismaClient(
    'postgresql://user:password@localhost:5432/challenges?schema=challenge',
  );

  assert.equal(typeof client.challenge.count, 'function');
  assert.equal(ChallengeStatusEnum.ACTIVE, 'ACTIVE');
  await client.$disconnect();
});

/**
 * Verifies invalid configuration fails before a driver or pool is created.
 *
 * @returns {void} This synchronous assertion has no return value.
 * @throws AssertionError when the factory accepts an empty connection URL.
 */
test('rejects an empty Challenge database connection string', () => {
  assert.throws(
    () => createChallengePrismaClient(''),
    /Challenge database connection string is required/,
  );
});
