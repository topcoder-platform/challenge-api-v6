#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { PrismaClient, PrizeSetTypeEnum } = require('@prisma/client');
const config = require('../config');
const { loadData } = require('../utils/dataLoader');

const prisma = new PrismaClient();
const PrizeSetEnum = PrizeSetTypeEnum || {
  PLACEMENT: 'PLACEMENT',
  COPILOT: 'COPILOT',
  REVIEWER: 'REVIEWER',
  CHECKPOINT: 'CHECKPOINT'
};
const DEFAULT_CREATED_BY = toStringOrNull(config.CREATED_BY) || 'migration';
const DEFAULT_UPDATED_BY = toStringOrNull(config.UPDATED_BY) || DEFAULT_CREATED_BY;

const DEFAULT_SINCE_ENV_KEYS = [
  'PRIZESET_COMPARE_SINCE',
  'INCREMENTAL_SINCE_DATE'
];

const CHALLENGE_ELASTICSEARCH_SOURCE = true;
const SELECT_FIELDS = {
  challengeId: true,
  type: true,
  description: true,
  prizes: {
    select: {
      type: true,
      value: true,
      description: true
    }
  }
};

function parseArguments(argv) {
  const args = argv.slice(2);
  const options = {
    since: null,
    verbose: false,
    apply: false
  };

  const argIterator = args[Symbol.iterator]();
  let current = argIterator.next();

  while (!current.done) {
    const raw = current.value;
    if (raw === '--since' || raw === '-s') {
      const nextValue = argIterator.next();
      if (nextValue.done) {
        throw new Error('Missing value after --since');
      }
      options.since = nextValue.value;
    } else if (raw.startsWith('--since=')) {
      options.since = raw.split('=').slice(1).join('=');
    } else if (raw === '--verbose' || raw === '-v') {
      options.verbose = true;
    } else if (raw === '--apply') {
      options.apply = true;
    } else if (raw.startsWith('--apply=')) {
      const value = raw.split('=').slice(1).join('=').toLowerCase();
      options.apply = ['1', 'true', 'yes'].includes(value);
    } else if (raw === '--help' || raw === '-h') {
      printUsageAndExit(0);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
    current = argIterator.next();
  }

  if (!options.since) {
    options.since = DEFAULT_SINCE_ENV_KEYS
      .map(key => process.env[key])
      .find(value => Boolean(value));
  }

  if (!options.since) {
    throw new Error('A cutoff date is required. Provide --since <ISO date> or set PRIZESET_COMPARE_SINCE.');
  }

  const sinceDate = new Date(options.since);
  if (Number.isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid cutoff date "${options.since}". Use an ISO-8601 timestamp, e.g. 2025-01-01T00:00:00Z.`);
  }

  options.sinceDate = sinceDate;
  return options;
}

function printUsageAndExit(code) {
  const message = [
    'Usage: node src/scripts/comparePrizeSets.js --since <ISO date> [--verbose] [--apply]',
    '',
    'Options:',
    '  --since, -s   ISO-8601 timestamp to filter challenges created or updated on/after the date',
    '  --verbose, -v Enable additional logging',
    '  --apply       When present, overwrite v6 prize sets with legacy values for any mismatches',
    '  --help, -h    Show this help message'
  ].join('\n');
  console.log(message);
  process.exit(code);
}

function resolveDataDirectory() {
  const configuredDirectory = config.DATA_DIRECTORY;
  if (!configuredDirectory) {
    throw new Error('DATA_DIRECTORY is not configured. Set it in the environment or .env file.');
  }
  return path.resolve(configuredDirectory);
}

function resolveChallengeFileName() {
  const fileName = config.migrator?.Challenge?.filename;
  if (!fileName) {
    throw new Error('Challenge migrator filename is not configured.');
  }
  return fileName;
}

async function loadSourceChallenges(dataDirectory, fileName, verbose) {
  const fullPath = path.join(dataDirectory, fileName);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Source data file not found: ${fullPath}`);
  }

  const primary = await loadData(dataDirectory, fileName, CHALLENGE_ELASTICSEARCH_SOURCE);
  if (Array.isArray(primary) && primary.length > 0) {
    if (verbose) {
      console.log(`Loaded ${primary.length} challenge records using Elasticsearch format parser.`);
    }
    return primary;
  }

  const fallback = await loadData(dataDirectory, fileName, false);
  if (verbose) {
    console.log(`Loaded ${fallback.length} challenge records using JSON array parser (fallback).`);
  }
  return fallback;
}

function extractCandidateDates(record) {
  if (!record || typeof record !== 'object') {
    return [];
  }

  const candidates = [
    record.updatedAt,
    record.updated,
    record.createdAt,
    record.created
  ];

  const timestamps = [];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') {
      continue;
    }

    const value = candidate instanceof Date ? candidate : new Date(candidate);
    if (!Number.isNaN(value.getTime())) {
      timestamps.push(value);
    }
  }

  return timestamps;
}

function isRecordInWindow(record, sinceDate) {
  const candidates = extractCandidateDates(record);
  return candidates.some(candidate => candidate >= sinceDate);
}

function toStringOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
}

function toLowerCaseOrNull(value) {
  const stringValue = toStringOrNull(value);
  return stringValue ? stringValue.toLowerCase() : null;
}

function toUpperCaseOrNull(value) {
  const stringValue = toStringOrNull(value);
  return stringValue ? stringValue.toUpperCase() : null;
}

function toNumericOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value);
  }
  const cleaned = String(value).trim().replace(/[^0-9.+-]/g, '');
  if (!cleaned) {
    return null;
  }
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? Number(numeric) : null;
}

function compareNullableStrings(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareNullableNumbers(a, b) {
  const left = Number.isFinite(a) ? a : Number.POSITIVE_INFINITY;
  const right = Number.isFinite(b) ? b : Number.POSITIVE_INFINITY;
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

const PRIZE_SET_TYPE_LOOKUP = new Map([
  ['placement', PrizeSetEnum.PLACEMENT],
  ['copilot', PrizeSetEnum.COPILOT],
  ['reviewer', PrizeSetEnum.REVIEWER],
  ['checkpoint', PrizeSetEnum.CHECKPOINT]
]);

const VALID_PRIZE_SET_TYPES = new Set(Object.values(PrizeSetEnum || {}));

function mapPrizeSetTypeForWrite(value) {
  const lowered = toLowerCaseOrNull(value);
  if (lowered && PRIZE_SET_TYPE_LOOKUP.has(lowered)) {
    return PRIZE_SET_TYPE_LOOKUP.get(lowered);
  }

  const upper = toUpperCaseOrNull(value);
  if (upper && VALID_PRIZE_SET_TYPES.has(upper)) {
    return upper;
  }

  return null;
}

function transformLegacyPrizeSetForWrite(challengeId, prizeSet, verbose) {
  const type = mapPrizeSetTypeForWrite(prizeSet?.type);
  if (!type) {
    console.warn(`Skipping prize set for challenge ${challengeId}; unrecognized type "${prizeSet?.type}".`);
    return null;
  }

  const description = toStringOrNull(prizeSet?.description) ?? undefined;
  const createdBy = toStringOrNull(prizeSet?.createdBy) || DEFAULT_CREATED_BY;
  const updatedBy = toStringOrNull(prizeSet?.updatedBy) || DEFAULT_UPDATED_BY;

  const prizes = [];
  const sourcePrizes = Array.isArray(prizeSet?.prizes) ? prizeSet.prizes : [];
  sourcePrizes.forEach((prize, index) => {
    const prizeType = toUpperCaseOrNull(prize?.type);
    const prizeValue = toNumericOrNull(prize?.value);

    if (!prizeType) {
      console.warn(`Skipping prize ${index} for challenge ${challengeId}; invalid prize type "${prize?.type}".`);
      return;
    }

    if (prizeValue === null || prizeValue === undefined) {
      console.warn(`Skipping prize ${index} for challenge ${challengeId}; invalid prize value "${prize?.value}".`);
      return;
    }

    prizes.push({
      type: prizeType,
      value: prizeValue,
      description: toStringOrNull(prize?.description) ?? undefined,
      createdBy: toStringOrNull(prize?.createdBy) || createdBy,
      updatedBy: toStringOrNull(prize?.updatedBy) || updatedBy
    });
  });

  if (!prizes.length && verbose) {
    console.warn(`Legacy prize set for challenge ${challengeId} (type ${type}) contains no valid prizes.`);
  }

  const result = {
    challengeId,
    type,
    description,
    createdBy,
    updatedBy
  };

  if (prizes.length) {
    result.prizes = { create: prizes };
  }

  return result;
}

function normalizePrizeSets(prizeSets) {
  if (!Array.isArray(prizeSets)) {
    return [];
  }

  const normalized = prizeSets.map(prizeSet => {
    const normalizedPrizes = Array.isArray(prizeSet?.prizes)
      ? prizeSet.prizes
          .map(prize => ({
            type: toUpperCaseOrNull(prize?.type),
            value: toNumericOrNull(prize?.value),
            description: toStringOrNull(prize?.description)
          }))
          .sort((a, b) =>
            compareNullableNumbers(a.value, b.value) ||
            compareNullableStrings(a.type, b.type) ||
            compareNullableStrings(a.description, b.description)
          )
      : [];

    return {
      type: toLowerCaseOrNull(prizeSet?.type),
      description: toStringOrNull(prizeSet?.description),
      prizes: normalizedPrizes
    };
  });

  return normalized.sort((a, b) =>
    compareNullableStrings(a.type, b.type) ||
    compareNullableStrings(a.description, b.description)
  );
}

function deepEqualPrizeSets(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueChallengeIds(challenges) {
  const seen = new Set();
  const ids = [];

  for (const challenge of challenges) {
    const id = challenge?.id || challenge?.challengeId;
    if (!id) {
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function fetchCurrentPrizeSets(challengeIds, verbose) {
  const results = new Map();
  if (!challengeIds.length) {
    return results;
  }

  const CHUNK_SIZE = 500;
  const chunks = chunkArray(challengeIds, CHUNK_SIZE);

  for (const chunk of chunks) {
    const dbRows = await prisma.challengePrizeSet.findMany({
      where: { challengeId: { in: chunk } },
      select: SELECT_FIELDS
    });

    for (const row of dbRows) {
      const accumulator = results.get(row.challengeId) || [];
      accumulator.push({
        type: row.type,
        description: row.description,
        prizes: row.prizes.map(prize => ({
          type: prize.type,
          value: prize.value,
          description: prize.description
        }))
      });
      results.set(row.challengeId, accumulator);
    }
  }

  if (verbose) {
    console.log(`Fetched prize sets for ${results.size} challenges from v6 database.`);
  }

  return results;
}

function cloneForOutput(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

async function applyPrizeSetsToChallenge(challengeId, legacyPrizeSets, verbose) {
  const sourcePrizeSets = Array.isArray(legacyPrizeSets) ? legacyPrizeSets : [];
  const payloads = sourcePrizeSets
    .map(prizeSet => transformLegacyPrizeSetForWrite(challengeId, prizeSet, verbose))
    .filter(Boolean);

  if (!payloads.length) {
    console.warn(`No valid legacy prize sets to apply for challenge ${challengeId}; skipping update.`);
    return { updated: false, appliedPrizeSets: 0 };
  }

  await prisma.$transaction(async (tx) => {
    await tx.challengePrizeSet.deleteMany({ where: { challengeId } });
    for (const data of payloads) {
      await tx.challengePrizeSet.create({ data });
    }
  });

  if (verbose) {
    console.log(`Applied ${payloads.length} legacy prize set(s) to challenge ${challengeId}.`);
  }

  return { updated: true, appliedPrizeSets: payloads.length };
}

async function main() {
  const options = parseArguments(process.argv);
  const dataDirectory = resolveDataDirectory();
  const challengeFileName = resolveChallengeFileName();

  if (options.verbose) {
    console.log(`Comparing prize sets for challenges updated since ${options.sinceDate.toISOString()}`);
    console.log(`Using data directory: ${dataDirectory}`);
    console.log(`Challenge file: ${challengeFileName}`);
  }

  const allChallenges = await loadSourceChallenges(dataDirectory, challengeFileName, options.verbose);
  const relevantChallenges = allChallenges.filter(challenge => isRecordInWindow(challenge, options.sinceDate));

  if (options.verbose) {
    console.log(`Filtered ${relevantChallenges.length} challenge records that meet the cutoff date.`);
  }

  if (!relevantChallenges.length) {
    console.log('No challenge records matched the specified cutoff window.');
    return;
  }

  const challengeIds = uniqueChallengeIds(relevantChallenges);
  if (!challengeIds.length) {
    console.log('No valid challenge IDs were found in the filtered data.');
    return;
  }

  const currentPrizeSetsMap = await fetchCurrentPrizeSets(challengeIds, options.verbose);

  const mismatches = [];
  for (const challenge of relevantChallenges) {
    const challengeId = challenge?.id || challenge?.challengeId;
    if (!challengeId) {
      if (options.verbose) {
        console.warn('Skipping challenge without id property.');
      }
      continue;
    }

    const oldPrizeSets = challenge.prizeSets || [];
    const newPrizeSets = currentPrizeSetsMap.get(challengeId) || [];

    const oldNormalized = normalizePrizeSets(oldPrizeSets);
    const newNormalized = normalizePrizeSets(newPrizeSets);

    if (!deepEqualPrizeSets(oldNormalized, newNormalized)) {
      mismatches.push({
        challengeId,
        oldPrizeSets: cloneForOutput(oldPrizeSets),
        newPrizeSets: cloneForOutput(newPrizeSets)
      });
    }
  }

  if (!mismatches.length) {
    console.log('No prize set mismatches detected for the specified window.');
    return;
  }

  if (!options.apply || options.verbose) {
    console.log(`Detected ${mismatches.length} challenge(s) with prize set mismatches:\n`);
    for (const entry of mismatches) {
      console.log(`challengeId: ${entry.challengeId}`);
      console.log('old prizeSets:');
      console.log(JSON.stringify(entry.oldPrizeSets, null, 2));
      console.log('v6 prizeSets:');
      console.log(JSON.stringify(entry.newPrizeSets, null, 2));
      console.log('---');
    }
  } else {
    console.log(`Detected ${mismatches.length} challenge(s) with prize set mismatches.`);
  }

  if (!options.apply) {
    console.log('Run with --apply to overwrite v6 prize sets with the legacy values.');
    return;
  }

  console.log(`Applying legacy prize sets to ${mismatches.length} challenge(s)...`);

  let appliedCount = 0;
  let skippedCount = 0;
  let failureCount = 0;

  for (const entry of mismatches) {
    try {
      const result = await applyPrizeSetsToChallenge(entry.challengeId, entry.oldPrizeSets, options.verbose);
      if (result.updated) {
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      failureCount += 1;
      console.error(`Failed to apply prize sets for challenge ${entry.challengeId}: ${error.message}`);
      if (options.verbose) {
        console.error(error);
      }
    }
  }

  console.log(`Applied legacy prize sets to ${appliedCount} challenge(s).`);
  if (skippedCount) {
    console.log(`Skipped ${skippedCount} challenge(s) because no valid legacy prize sets were available.`);
  }
  if (failureCount) {
    console.log(`Encountered errors updating ${failureCount} challenge(s); check logs above and rerun if needed.`);
  }
}

main()
  .catch(error => {
    console.error('Failed to compare prize sets:', error.message);
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.error(error);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
