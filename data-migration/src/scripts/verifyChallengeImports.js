#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const config = require('../config');
const { loadData } = require('../utils/dataLoader');
const { MigrationManager } = require('../migrationManager');
const { ChallengeMigrator } = require('../migrators/challengeMigrator');
const { ChallengeConstraintMigrator } = require('../migrators/challengeConstraintMigrator');
const { ChallengeDiscussionMigrator } = require('../migrators/challengeDiscussionMigrator');
const { ChallengeDiscussionOptionMigrator } = require('../migrators/challengeDiscussionOptionMigrator');
const { ChallengeEventMigrator } = require('../migrators/challengeEventMigrator');
const { ChallengeSkillMigrator } = require('../migrators/challengeSkillMigrator');
const { ChallengeTermMigrator } = require('../migrators/challengeTermMigrator');
const { ChallengeWinnerMigrator } = require('../migrators/challengeWinnerMigrator');
const { ChallengePrizeSetMigrator } = require('../migrators/challengePrizeSetMigrator');
const { PrizeMigrator } = require('../migrators/prizeMigrator');
const { ChallengeMetadataMigrator } = require('../migrators/challengeMetadataMigrator');
const { ChallengePhaseMigrator } = require('../migrators/challengePhaseMigrator');
const { ChallengePhaseConstraintMigrator } = require('../migrators/challengePhaseConstraintMigrator');
const { ChallengeBillingMigrator } = require('../migrators/challengeBillingMigrator');
const { ChallengeLegacyMigrator } = require('../migrators/challengeLegacyMigrator');

const prisma = new PrismaClient();

const DEFAULT_FILE_NAME = (config.migrator?.Challenge && config.migrator.Challenge.filename)
  || process.env.CHALLENGE_FILE
  || 'challenge-api.challenge.json';
const DEFAULT_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.VERIFY_CHALLENGE_BATCH_SIZE || '500', 10)
);
const DEFAULT_STATUS_FILTER = process.env.VERIFY_CHALLENGE_STATUS || 'Completed';
const DEFAULT_UPDATED_BEFORE = process.env.VERIFY_CHALLENGE_UPDATED_BEFORE || '2025-10-01';
const DEFAULT_CREATED_BEFORE = process.env.VERIFY_CHALLENGE_CREATED_BEFORE || '2025-10-01';

const DEPENDENT_MIGRATORS = [
  ChallengeConstraintMigrator,
  ChallengeDiscussionMigrator,
  ChallengeDiscussionOptionMigrator,
  ChallengeEventMigrator,
  ChallengeSkillMigrator,
  ChallengeTermMigrator,
  ChallengeWinnerMigrator,
  ChallengePrizeSetMigrator,
  PrizeMigrator,
  ChallengeMetadataMigrator,
  ChallengePhaseMigrator,
  ChallengePhaseConstraintMigrator,
  ChallengeBillingMigrator,
  ChallengeLegacyMigrator
];

const DEPENDENCY_SOURCES = [
  { modelName: 'ChallengeType', prismaProperty: 'challengeType' },
  { modelName: 'ChallengeTrack', prismaProperty: 'challengeTrack' },
  { modelName: 'TimelineTemplate', prismaProperty: 'timelineTemplate' },
  { modelName: 'Phase', prismaProperty: 'phase' }
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    fileName: DEFAULT_FILE_NAME,
    dataDir: config.DATA_DIRECTORY,
    batchSize: DEFAULT_BATCH_SIZE,
    skipLog: null,
    maxReport: parseInt(process.env.VERIFY_CHALLENGE_MAX_REPORT || '50', 10),
    statusFilter: DEFAULT_STATUS_FILTER,
    updatedBefore: DEFAULT_UPDATED_BEFORE,
    createdBefore: DEFAULT_CREATED_BEFORE,
    apply: process.env.VERIFY_CHALLENGE_APPLY === 'true',
    logLevel: process.env.VERIFY_CHALLENGE_LOG_LEVEL || config.LOG_LEVEL,
    logFile: process.env.VERIFY_CHALLENGE_LOG_FILE || config.LOG_FILE
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
    } else if (arg === '--status') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.statusFilter = next;
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--no-status-filter') {
      options.statusFilter = null;
    } else if (arg === '--updated-before') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.updatedBefore = next;
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--created-before') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.createdBefore = next;
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--dry-run') {
      options.apply = false;
    } else if (arg === '--log-level') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.logLevel = next;
        i += 1;
      } else {
        throw new Error(`${arg} expects a value`);
      }
    } else if (arg === '--log-file') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options.logFile = next;
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

const parseStatusSet = (value) => {
  if (!value) {
    return null;
  }

  const entries = value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => entry.toLowerCase());

  return entries.length ? new Set(entries) : null;
};

const parseCutoffDate = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDateValue = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

    console.log(`[backfill] Loaded ${skipSet.size} challenge IDs from ${fullPath} to skip.`);
    return skipSet;
  } catch (error) {
    console.warn(`[backfill] Could not read skip log at ${logPath}: ${error.message}`);
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

const buildFilter = (options) => {
  const statusSet = parseStatusSet(options.statusFilter);
  const updatedBeforeDate = parseCutoffDate(options.updatedBefore);
  const createdBeforeDate = parseCutoffDate(options.createdBefore);

  const filterStats = {
    statusFiltered: 0,
    dateFiltered: 0
  };

  const predicate = (record) => {
    if (!record || typeof record !== 'object') {
      return false;
    }

    if (statusSet && statusSet.size) {
      const recordStatus = (record.status || '').trim().toLowerCase();
      if (!statusSet.has(recordStatus)) {
        filterStats.statusFiltered += 1;
        return false;
      }
    }

    const updatedDate = parseDateValue(record.updated || record.updatedAt);
    const createdDate = parseDateValue(
      record.created ||
      record.createdAt ||
      record.startDate ||
      record.registrationStartDate
    );

    let passesUpdated = true;
    if (updatedBeforeDate) {
      passesUpdated = updatedDate ? updatedDate < updatedBeforeDate : false;
    }

    let passesCreated = true;
    if (createdBeforeDate) {
      passesCreated = createdDate ? createdDate < createdBeforeDate : false;
    }

    let passes;
    if (updatedBeforeDate && createdBeforeDate) {
      passes = passesUpdated || passesCreated;
    } else if (updatedBeforeDate) {
      passes = passesUpdated;
    } else if (createdBeforeDate) {
      passes = passesCreated;
    } else {
      passes = true;
    }

    if (!passes) {
      filterStats.dateFiltered += 1;
    }
    return passes;
  };

  return { predicate, stats: filterStats, statusSet, updatedBeforeDate, createdBeforeDate };
};

const findMissingChallenges = async (records, options) => {
  const chunks = chunkArray(records, options.batchSize);
  const missingRecords = [];
  const missingWithoutId = [];
  let foundById = 0;

  for (const batch of chunks) {
    const ids = batch
      .map(challenge => challenge.id)
      .filter(Boolean);

    if (!ids.length) {
      batch
        .filter(challenge => !challenge.id)
        .forEach(challenge => missingWithoutId.push(challenge));
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
        missingWithoutId.push(challenge);
        return;
      }

      if (!foundSet.has(challenge.id)) {
        missingRecords.push(challenge);
      }
    });
  }

  const conflicts = [];
  const normalizedConflicts = new Set();

  const legacyCandidates = Array.from(
    new Set(
      missingRecords
        .map(challenge => normalizeLegacyId(challenge.legacyId))
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

    missingRecords.forEach((challenge) => {
      const legacyId = normalizeLegacyId(challenge.legacyId);
      if (legacyId !== null && matchByLegacy.has(legacyId)) {
        conflicts.push({
          sourceId: challenge.id,
          legacyId,
          dbId: matchByLegacy.get(legacyId),
          name: challenge.name || null,
          status: challenge.status || null
        });
        normalizedConflicts.add(legacyId);
      }
    });
  }

  const readyForInsert = missingRecords.filter((challenge) => {
    if (!challenge.id) {
      return false;
    }
    const legacyId = normalizeLegacyId(challenge.legacyId);
    if (legacyId !== null && normalizedConflicts.has(legacyId)) {
      return false;
    }
    return true;
  });

  return {
    readyForInsert,
    missingWithoutId,
    conflicts,
    foundById
  };
};

const executeMigrator = async (manager, migrator, dataOverride = null) => {
  migrator.setManager(manager);
  const rawData = dataOverride !== null ? dataOverride : await migrator.loadData();

  if (!Array.isArray(rawData) || rawData.length === 0) {
    return { processed: 0, skipped: 0, empty: true };
  }

  const prepared = await migrator.beforeMigration(rawData);
  const dataToProcess = Array.isArray(prepared) ? prepared : rawData;

  if (!Array.isArray(dataToProcess) || dataToProcess.length === 0) {
    return { processed: 0, skipped: 0, empty: true };
  }

  const processFn = migrator.createProcessFunction();
  const stats = await manager.processBatch(dataToProcess, processFn);
  await migrator.afterMigration(stats);
  return { ...stats, empty: false };
};

const insertMissingChallenges = async (records, options) => {
  if (!records.length) {
    return {};
  }

  const manager = new MigrationManager({
    DATA_DIRECTORY: options.dataDir,
    BATCH_SIZE: options.batchSize,
    LOG_LEVEL: options.logLevel,
    LOG_FILE: options.logFile,
    MIGRATION_MODE: 'full',
    COLLECT_UPSERT_STATS: false,
    prismaClient: prisma
  });

  const stats = {};

  try {
    for (const { modelName, prismaProperty } of DEPENDENCY_SOURCES) {
      const client = prisma[prismaProperty];
      if (!client || typeof client.findMany !== 'function') {
        continue;
      }
      const existing = await client.findMany({ select: { id: true } });
      const idSet = new Set(existing.map(entry => entry.id));
      manager.registerDependency(modelName, idSet);
      console.log(`[backfill] Primed ${idSet.size} existing IDs for ${modelName} dependency checks.`);
    }

    const challengeMigrator = new ChallengeMigrator();
    const challengeStats = await executeMigrator(manager, challengeMigrator, records);
    stats.Challenge = challengeStats;

    for (const MigratorClass of DEPENDENT_MIGRATORS) {
      const migrator = new MigratorClass();
      const result = await executeMigrator(manager, migrator);
      stats[migrator.modelName] = result;
    }
  } finally {
    if (manager.logger && typeof manager.logger.close === 'function') {
      manager.logger.close();
    }
  }

  return stats;
};

const summarizeStats = (stats) => {
  const entries = Object.entries(stats);
  if (!entries.length) {
    console.log('[backfill] No migrators executed.');
    return;
  }

  entries.forEach(([modelName, result]) => {
    if (!result || result.empty) {
      return;
    }
    console.log(`[backfill] ${modelName}: processed=${result.processed || 0}, skipped=${result.skipped || 0}`);
  });
};

const main = async () => {
  const options = parseArgs();
  const filePath = path.isAbsolute(options.fileName)
    ? options.fileName
    : path.join(options.dataDir || '', options.fileName);

  console.log(`[backfill] Reading challenge data from ${filePath}`);

  let challenges = await loadData(
    options.dataDir,
    path.basename(filePath),
    true
  );

  if (!Array.isArray(challenges)) {
    throw new Error('Challenge data did not resolve to an array');
  }

  console.log(`[backfill] Loaded ${challenges.length} challenge records from source data.`);

  const skipSet = loadSkippedIdsFromLog(options.skipLog);
  if (skipSet.size) {
    challenges = challenges.filter(challenge => !skipSet.has(challenge.id));
    console.log(`[backfill] After skip filtering there are ${challenges.length} challenges to consider.`);
  }

  const { predicate, stats: filterStats, statusSet, updatedBeforeDate, createdBeforeDate } = buildFilter(options);
  const filteredChallenges = challenges.filter(predicate);

  console.log(`[backfill] Status filter: ${statusSet ? Array.from(statusSet).join(', ') : 'disabled'}`);
  if (updatedBeforeDate) {
    console.log(`[backfill] Updated before: ${updatedBeforeDate.toISOString()}`);
  }
  if (createdBeforeDate) {
    console.log(`[backfill] Created before: ${createdBeforeDate.toISOString()}`);
  }
  console.log(`[backfill] After applying filters, ${filteredChallenges.length} challenges remain (status filtered ${filterStats.statusFiltered}, date filtered ${filterStats.dateFiltered}).`);

  if (!filteredChallenges.length) {
    console.log('[backfill] No challenges matched the provided filters.');
    return;
  }

  const { readyForInsert, missingWithoutId, conflicts, foundById } =
    await findMissingChallenges(filteredChallenges, options);

  console.log(`[backfill] Found ${foundById} challenges already present in the database by id.`);

  if (missingWithoutId.length) {
    console.warn(`[backfill] ${missingWithoutId.length} records are missing an id and cannot be inserted.`);
  }

  if (conflicts.length) {
    console.warn(`[backfill] ${conflicts.length} records match existing rows by legacyId but have different ids; they will be skipped.`);
    conflicts.slice(0, options.maxReport).forEach((entry, index) => {
      console.warn(
        `  ${index + 1}. legacyId=${entry.legacyId}, sourceId=${entry.sourceId || 'unknown'}, dbId=${entry.dbId}, name="${entry.name || ''}", status="${entry.status || ''}"`
      );
    });
    if (conflicts.length > options.maxReport) {
      console.warn(`  ... ${conflicts.length - options.maxReport} additional legacy conflicts omitted.`);
    }
  }

  if (!readyForInsert.length) {
    console.log('[backfill] No missing challenges qualify for insertion.');
    return;
  }

  console.log(`[backfill] ${readyForInsert.length} challenges will be processed${options.apply ? '' : ' (dry run).'}`);

  readyForInsert.slice(0, options.maxReport).forEach((challenge, index) => {
    console.log(`  ${index + 1}. ${formatChallenge(challenge)}`);
  });

  if (readyForInsert.length > options.maxReport) {
    console.log(`  ... ${readyForInsert.length - options.maxReport} additional challenges omitted.`);
  }

  if (!options.apply) {
    console.log('[backfill] Dry run complete. Re-run with --apply to insert missing challenges.');
    return;
  }

  const stats = await insertMissingChallenges(readyForInsert, options);
  summarizeStats(stats);
};

main()
  .catch((error) => {
    console.error('[backfill] Challenge backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
