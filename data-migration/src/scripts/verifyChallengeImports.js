#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const config = require('../config');
const { loadData } = require('../utils/dataLoader');

const prisma = new PrismaClient();

const DEFAULT_FILE_NAME = (config.migrator?.Challenge && config.migrator.Challenge.filename)
  || process.env.CHALLENGE_FILE
  || 'challenge-api.challenge.json';

const DEFAULT_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.VERIFY_CHALLENGE_BATCH_SIZE || '500', 10)
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    fileName: DEFAULT_FILE_NAME,
    dataDir: config.DATA_DIRECTORY,
    batchSize: DEFAULT_BATCH_SIZE,
    skipLog: null,
    maxReport: parseInt(process.env.VERIFY_CHALLENGE_MAX_REPORT || '50', 10)
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--file' || arg === '--fileName') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.fileName = next;
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--data-dir') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.dataDir = next;
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--batch-size') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.batchSize = Math.max(1, parseInt(next, 10));
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--skip-log') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.skipLog = next;
        i += 1;
      } else {
        options.skipLog = config.LOG_FILE;
      }
    } else if (arg === '--max-report') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.maxReport = Math.max(1, parseInt(next, 10));
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const normalizeLegacyId = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized || normalized.toLowerCase() === 'null') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const loadSkippedIdsFromLog = (logPath) => {
  if (!logPath) {
    return new Set();
  }

  try {
    const fullPath = path.isAbsolute(logPath)
      ? logPath
      : path.join(process.cwd(), logPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const skipSet = new Set();

    const regex = /Skipping\s+Challenge\s+\[id:\s*([a-f0-9-]+)\]/gi;
    let match = regex.exec(content);
    while (match) {
      skipSet.add(match[1]);
      match = regex.exec(content);
    }

    console.log(`[verify] Loaded ${skipSet.size} challenge IDs from ${fullPath} to skip.`);
    return skipSet;
  } catch (error) {
    console.warn(`[verify] Could not read skip log at ${logPath}: ${error.message}`);
    return new Set();
  }
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const formatChallenge = (challenge) => {
  const readableId = challenge.id ? challenge.id : '<missing>';
  const legacyId = challenge.legacyId !== null && challenge.legacyId !== undefined
    ? `legacyId=${challenge.legacyId}`
    : null;
  const name = challenge.name ? `name="${challenge.name}"` : null;
  const status = challenge.status ? `status="${challenge.status}"` : null;

  return [`id=${readableId}`, legacyId, name, status]
    .filter(Boolean)
    .join(', ');
};

const main = async () => {
  const options = parseArgs();
  const filePath = path.isAbsolute(options.fileName)
    ? options.fileName
    : path.join(options.dataDir || '', options.fileName);

  console.log(`[verify] Reading challenge data from ${filePath}`);

  let challenges = await loadData(
    options.dataDir,
    path.basename(filePath),
    true
  );

  if (!Array.isArray(challenges)) {
    throw new Error('Challenge data did not resolve to an array');
  }

  const skipSet = loadSkippedIdsFromLog(options.skipLog);
  if (skipSet.size) {
    challenges = challenges.filter(challenge => !skipSet.has(challenge.id));
    console.log(`[verify] After skip filtering there are ${challenges.length} challenges to verify.`);
  }

  const total = challenges.length;
  if (!total) {
    console.log('[verify] No challenges loaded; nothing to verify.');
    return;
  }

  const chunks = chunkArray(challenges, options.batchSize);
  const missingMeta = [];
  let foundById = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const batch = chunks[i];
    const ids = batch
      .map(challenge => challenge.id)
      .filter(Boolean);

    if (!ids.length) {
      continue;
    }

    const dbChallenges = await prisma.challenge.findMany({
      where: { id: { in: ids } },
      select: { id: true }
    });

    const foundSet = new Set(dbChallenges.map(challenge => challenge.id));
    foundById += foundSet.size;

    batch.forEach((challenge) => {
      if (!challenge.id) {
        missingMeta.push({
          id: undefined,
          legacyId: normalizeLegacyId(challenge.legacyId),
          name: challenge.name || null,
          status: challenge.status || null,
          reason: 'missing-id'
        });
        return;
      }

      if (!foundSet.has(challenge.id)) {
        const legacyId = normalizeLegacyId(challenge.legacyId);
        missingMeta.push({
          id: challenge.id,
          legacyId,
          name: challenge.name || null,
          status: challenge.status || null,
          reason: 'not-found-by-id'
        });
      }
    });
  }

  let legacyMatches = [];
  let stillMissing = missingMeta;

  const legacyCandidates = Array.from(
    new Set(
      missingMeta
        .map(challenge => challenge.legacyId)
        .filter(value => value !== null)
    )
  );

  if (legacyCandidates.length) {
    const legacyMatchesRaw = await prisma.challenge.findMany({
      where: { legacyId: { in: legacyCandidates } },
      select: { id: true, legacyId: true }
    });
    const matchByLegacy = new Map(
      legacyMatchesRaw.map(challenge => [challenge.legacyId, challenge.id])
    );

    legacyMatches = stillMissing
      .filter(challenge => challenge.legacyId !== null && matchByLegacy.has(challenge.legacyId))
      .map(challenge => ({
        sourceId: challenge.id,
        legacyId: challenge.legacyId,
        dbId: matchByLegacy.get(challenge.legacyId),
        name: challenge.name,
        status: challenge.status
      }));

    const matchedLegacyIds = new Set(legacyMatches.map(entry => entry.legacyId));
    stillMissing = stillMissing.filter(challenge => {
      if (challenge.legacyId === null) {
        return true;
      }
      return !matchedLegacyIds.has(challenge.legacyId);
    });
  }

  console.log(`[verify] Checked ${total} challenges from ${path.basename(filePath)}.`);
  console.log(`[verify] Found ${foundById} challenge records by id.`);

  if (legacyMatches.length) {
    console.log(`[verify] ${legacyMatches.length} challenges were located by legacyId but have mismatched ids:`);
    legacyMatches.slice(0, options.maxReport).forEach((entry, index) => {
      console.log(
        `  ${index + 1}. legacyId=${entry.legacyId}, sourceId=${entry.sourceId || 'unknown'}, dbId=${entry.dbId}, name="${entry.name || ''}", status="${entry.status || ''}"`
      );
    });
    if (legacyMatches.length > options.maxReport) {
      console.log(`  ... ${legacyMatches.length - options.maxReport} more legacyId matches omitted.`);
    }
  }

  if (stillMissing.length) {
    console.log(`[verify] ${stillMissing.length} challenges were not found in the database:`);
    stillMissing.slice(0, options.maxReport).forEach((challenge, index) => {
      console.log(`  ${index + 1}. ${formatChallenge(challenge)}`);
    });
    if (stillMissing.length > options.maxReport) {
      console.log(`  ... ${stillMissing.length - options.maxReport} more missing challenges omitted.`);
    }

    process.exitCode = 1;
  } else if (!legacyMatches.length) {
    console.log('[verify] All challenges were located in the database.');
  }
};

main()
  .catch((error) => {
    console.error('[verify] Challenge verification failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
