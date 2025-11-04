#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { PrismaClient, PrizeSetTypeEnum } = require('@prisma/client');
const config = require('../config');
const { loadData } = require('../utils/dataLoader');

const prisma = new PrismaClient();
const WinnerTypeEnum = PrizeSetTypeEnum || {
  PLACEMENT: 'PLACEMENT',
  COPILOT: 'COPILOT',
  REVIEWER: 'REVIEWER',
  CHECKPOINT: 'CHECKPOINT'
};
const DEFAULT_CREATED_BY = toStringOrNull(config.CREATED_BY) || 'migration';
const DEFAULT_UPDATED_BY = toStringOrNull(config.UPDATED_BY) || DEFAULT_CREATED_BY;

const DEFAULT_SINCE_ENV_KEYS = [
  'WINNER_PHASE_COMPARE_SINCE',
  'INCREMENTAL_SINCE_DATE'
];

const CHALLENGE_ELASTICSEARCH_SOURCE = true;
const DEFAULT_TARGETS = ['winners', 'phases'];
const VALID_TARGETS = new Set(DEFAULT_TARGETS);

function parseArguments(argv) {
  const args = argv.slice(2);
  const options = {
    since: null,
    verbose: false,
    apply: false,
    targets: new Set(DEFAULT_TARGETS)
  };

  const iterator = args[Symbol.iterator]();
  let current = iterator.next();
  while (!current.done) {
    const raw = current.value;
    if (raw === '--since' || raw === '-s') {
      const next = iterator.next();
      if (next.done) {
        throw new Error('Missing value after --since');
      }
      options.since = next.value;
    } else if (raw.startsWith('--since=')) {
      options.since = raw.split('=').slice(1).join('=');
    } else if (raw === '--verbose' || raw === '-v') {
      options.verbose = true;
    } else if (raw === '--apply') {
      options.apply = true;
    } else if (raw.startsWith('--apply=')) {
      const value = raw.split('=').slice(1).join('=').toLowerCase();
      options.apply = ['1', 'true', 'yes'].includes(value);
    } else if (raw === '--targets' || raw === '--target') {
      const next = iterator.next();
      if (next.done) {
        throw new Error('Missing value after --targets');
      }
      setTargets(options.targets, next.value);
    } else if (raw.startsWith('--targets=') || raw.startsWith('--target=')) {
      const value = raw.split('=').slice(1).join('=');
      setTargets(options.targets, value);
    } else if (raw === '--winners-only') {
      options.targets = new Set(['winners']);
    } else if (raw === '--phases-only') {
      options.targets = new Set(['phases']);
    } else if (raw === '--help' || raw === '-h') {
      printUsageAndExit(0);
    } else {
      throw new Error(`Unknown argument: ${raw}`);
    }
    current = iterator.next();
  }

  if (!options.since) {
    options.since = DEFAULT_SINCE_ENV_KEYS
      .map(key => process.env[key])
      .find(value => Boolean(value));
  }

  if (!options.since) {
    throw new Error('A cutoff date is required. Provide --since <ISO date> or set WINNER_PHASE_COMPARE_SINCE.');
  }

  const sinceDate = new Date(options.since);
  if (Number.isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid cutoff date "${options.since}". Use an ISO-8601 timestamp, e.g. 2025-01-01T00:00:00Z.`);
  }

  if (!options.targets.size) {
    options.targets = new Set(DEFAULT_TARGETS);
  }

  const invalidTargets = Array.from(options.targets).filter(target => !VALID_TARGETS.has(target));
  if (invalidTargets.length) {
    throw new Error(`Unknown target(s): ${invalidTargets.join(', ')}. Supported targets: ${DEFAULT_TARGETS.join(', ')}.`);
  }

  options.sinceDate = sinceDate;
  options.targetList = Array.from(options.targets);
  return options;
}

function setTargets(targetSet, rawValue) {
  const entries = String(rawValue)
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

  targetSet.clear();
  entries.forEach(entry => {
    if (entry === 'all') {
      DEFAULT_TARGETS.forEach(defaultTarget => targetSet.add(defaultTarget));
    } else if (VALID_TARGETS.has(entry)) {
      targetSet.add(entry);
    }
  });
}

function printUsageAndExit(code) {
  const message = [
    'Usage: node src/scripts/compareWinnersAndPhases.js --since <ISO date> [--verbose] [--apply] [--targets winners,phases]',
    '',
    'Options:',
    '  --since, -s        ISO-8601 timestamp to filter challenges created or updated on/after the date',
    '  --verbose, -v      Enable additional logging and full mismatch output',
    '  --apply            Overwrite v6 data with legacy values for mismatched winners/phases',
    '  --targets=<list>   Comma-separated subset of winners,phases (default: both)',
    '  --winners-only     Shortcut for --targets=winners',
    '  --phases-only      Shortcut for --targets=phases',
    '  --help, -h         Show this help message'
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

function toIntegerOrNull(value) {
  const numeric = toNumericOrNull(value);
  if (numeric === null || numeric === undefined) {
    return null;
  }
  const integer = Math.trunc(numeric);
  return Number.isFinite(integer) ? integer : null;
}

function toBooleanOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function toDateOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const dateFromNumber = new Date(value);
    return Number.isNaN(dateFromNumber.getTime()) ? null : dateFromNumber;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function toIsoStringOrNull(value) {
  const date = toDateOrNull(value);
  return date ? date.toISOString() : null;
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

function compareNullableDates(a, b) {
  if (a === b) {
    return 0;
  }
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  return a.localeCompare(b);
}

const WINNER_TYPE_LOOKUP = new Map([
  ['placement', WinnerTypeEnum.PLACEMENT],
  ['copilot', WinnerTypeEnum.COPILOT],
  ['reviewer', WinnerTypeEnum.REVIEWER],
  ['checkpoint', WinnerTypeEnum.CHECKPOINT]
]);

const VALID_WINNER_TYPES = new Set(Object.values(WinnerTypeEnum || {}));

function mapWinnerTypeForWrite(value) {
  const lowered = toLowerCaseOrNull(value);
  if (lowered && WINNER_TYPE_LOOKUP.has(lowered)) {
    return WINNER_TYPE_LOOKUP.get(lowered);
  }

  const upper = toUpperCaseOrNull(value);
  if (upper && VALID_WINNER_TYPES.has(upper)) {
    return upper;
  }

  return null;
}

function normalizeWinners(winners) {
  if (!Array.isArray(winners)) {
    return [];
  }

  const normalized = winners
    .map(winner => ({
      type: toLowerCaseOrNull(winner?.type),
      placement: toIntegerOrNull(winner?.placement),
      userId: toIntegerOrNull(winner?.userId),
      handle: toStringOrNull(winner?.handle)
    }))
    .map(entry => ({
      ...entry,
      placement: entry.placement,
      userId: entry.userId,
      type: entry.type,
      handle: entry.handle
    }));

  return normalized
    .sort((a, b) =>
      compareNullableNumbers(a.placement, b.placement) ||
      compareNullableNumbers(a.userId, b.userId) ||
      compareNullableStrings(a.handle, b.handle) ||
      compareNullableStrings(a.type, b.type)
    );
}

function normalizeConstraints(constraints) {
  if (!Array.isArray(constraints)) {
    return [];
  }

  const normalized = constraints
    .map(constraint => ({
      name: toStringOrNull(constraint?.name),
      value: toIntegerOrNull(constraint?.value)
    }))
    .filter(constraint => constraint.name !== null && constraint.value !== null);

  return normalized.sort((a, b) =>
    compareNullableStrings(a.name, b.name) ||
    compareNullableNumbers(a.value, b.value)
  );
}

function normalizePhases(phases) {
  if (!Array.isArray(phases)) {
    return [];
  }

  const normalized = phases.map(phase => ({
    phaseId: toStringOrNull(phase?.phaseId ?? phase?.id),
    name: toStringOrNull(phase?.name),
    description: toStringOrNull(phase?.description),
    isOpen: toBooleanOrNull(phase?.isOpen),
    predecessor: toStringOrNull(phase?.predecessor),
    duration: toIntegerOrNull(phase?.duration),
    scheduledStartDate: toIsoStringOrNull(phase?.scheduledStartDate),
    scheduledEndDate: toIsoStringOrNull(phase?.scheduledEndDate),
    actualStartDate: toIsoStringOrNull(phase?.actualStartDate),
    actualEndDate: toIsoStringOrNull(phase?.actualEndDate),
    constraints: normalizeConstraints(phase?.constraints)
  }));

  return normalized.sort((a, b) =>
    compareNullableDates(a.scheduledStartDate, b.scheduledStartDate) ||
    compareNullableDates(a.actualStartDate, b.actualStartDate) ||
    compareNullableStrings(a.name, b.name) ||
    compareNullableStrings(a.phaseId, b.phaseId)
  );
}

function deepEqual(left, right) {
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

async function fetchCurrentWinners(challengeIds, verbose) {
  const results = new Map();
  if (!challengeIds.length) {
    return results;
  }

  const CHUNK_SIZE = 500;
  const chunks = chunkArray(challengeIds, CHUNK_SIZE);

  for (const chunk of chunks) {
    const dbRows = await prisma.challengeWinner.findMany({
      where: { challengeId: { in: chunk } },
      select: {
        challengeId: true,
        type: true,
        placement: true,
        userId: true,
        handle: true
      }
    });

    for (const row of dbRows) {
      const accumulator = results.get(row.challengeId) || [];
      accumulator.push({
        type: row.type,
        placement: row.placement,
        userId: row.userId,
        handle: row.handle
      });
      results.set(row.challengeId, accumulator);
    }
  }

  if (verbose) {
    console.log(`Fetched winners for ${results.size} challenges from v6 database.`);
  }

  return results;
}

async function fetchCurrentPhases(challengeIds, verbose) {
  const results = new Map();
  if (!challengeIds.length) {
    return results;
  }

  const CHUNK_SIZE = 250;
  const chunks = chunkArray(challengeIds, CHUNK_SIZE);

  for (const chunk of chunks) {
    const dbRows = await prisma.challengePhase.findMany({
      where: { challengeId: { in: chunk } },
      select: {
        challengeId: true,
        phaseId: true,
        name: true,
        description: true,
        isOpen: true,
        predecessor: true,
        duration: true,
        scheduledStartDate: true,
        scheduledEndDate: true,
        actualStartDate: true,
        actualEndDate: true,
        constraints: {
          select: {
            name: true,
            value: true
          }
        }
      }
    });

    for (const row of dbRows) {
      const accumulator = results.get(row.challengeId) || [];
      accumulator.push({
        phaseId: row.phaseId,
        name: row.name,
        description: row.description,
        isOpen: row.isOpen,
        predecessor: row.predecessor,
        duration: row.duration,
        scheduledStartDate: row.scheduledStartDate,
        scheduledEndDate: row.scheduledEndDate,
        actualStartDate: row.actualStartDate,
        actualEndDate: row.actualEndDate,
        constraints: row.constraints
      });
      results.set(row.challengeId, accumulator);
    }
  }

  if (verbose) {
    console.log(`Fetched phases for ${results.size} challenges from v6 database.`);
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

function transformLegacyWinnerForWrite(challengeId, winner, verbose) {
  const type = mapWinnerTypeForWrite(winner?.type);
  if (!type) {
    console.warn(`Skipping winner for challenge ${challengeId}; unrecognized type "${winner?.type}".`);
    return null;
  }

  const userId = toIntegerOrNull(winner?.userId);
  if (userId === null) {
    console.warn(`Skipping winner for challenge ${challengeId}; invalid userId "${winner?.userId}".`);
    return null;
  }

  const handle = toStringOrNull(winner?.handle);
  if (!handle) {
    console.warn(`Skipping winner for challenge ${challengeId}; missing handle.`);
    return null;
  }

  const placement = toIntegerOrNull(winner?.placement);
  if (placement === null) {
    console.warn(`Skipping winner for challenge ${challengeId}; invalid placement "${winner?.placement}".`);
    return null;
  }

  const createdAt = toDateOrNull(winner?.createdAt) || toDateOrNull(winner?.created) || new Date();
  const updatedAt = toDateOrNull(winner?.updatedAt) || toDateOrNull(winner?.updated) || createdAt;
  const createdBy = toStringOrNull(winner?.createdBy) || DEFAULT_CREATED_BY;
  const updatedBy = toStringOrNull(winner?.updatedBy) || DEFAULT_UPDATED_BY;

  return {
    challengeId,
    type,
    placement,
    userId,
    handle,
    createdAt,
    updatedAt,
    createdBy,
    updatedBy
  };
}

function transformLegacyConstraintForWrite(constraint, verbose, challengeId) {
  const name = toStringOrNull(constraint?.name);
  if (!name) {
    if (verbose) {
      console.warn(`Skipping phase constraint for challenge ${challengeId}; missing name.`);
    }
    return null;
  }

  const value = toIntegerOrNull(constraint?.value);
  if (value === null) {
    if (verbose) {
      console.warn(`Skipping phase constraint "${name}" for challenge ${challengeId}; invalid value "${constraint?.value}".`);
    }
    return null;
  }

  const createdAt = toDateOrNull(constraint?.createdAt) || toDateOrNull(constraint?.created) || new Date();
  const updatedAt = toDateOrNull(constraint?.updatedAt) || toDateOrNull(constraint?.updated) || createdAt;
  const createdBy = toStringOrNull(constraint?.createdBy) || DEFAULT_CREATED_BY;
  const updatedBy = toStringOrNull(constraint?.updatedBy) || DEFAULT_UPDATED_BY;

  return {
    name,
    value,
    createdAt,
    updatedAt,
    createdBy,
    updatedBy
  };
}

function transformLegacyPhaseForWrite(challengeId, phase, verbose) {
  const phaseId = toStringOrNull(phase?.phaseId ?? phase?.id);
  if (!phaseId) {
    console.warn(`Skipping phase for challenge ${challengeId}; missing phaseId.`);
    return null;
  }

  const name = toStringOrNull(phase?.name);
  if (!name) {
    console.warn(`Skipping phase for challenge ${challengeId}; missing name.`);
    return null;
  }

  const description = toStringOrNull(phase?.description);
  const isOpen = toBooleanOrNull(phase?.isOpen);
  const predecessor = toStringOrNull(phase?.predecessor);
  const duration = toIntegerOrNull(phase?.duration);
  const scheduledStartDate = toDateOrNull(phase?.scheduledStartDate);
  const scheduledEndDate = toDateOrNull(phase?.scheduledEndDate);
  const actualStartDate = toDateOrNull(phase?.actualStartDate);
  const actualEndDate = toDateOrNull(phase?.actualEndDate);

  const createdAt = toDateOrNull(phase?.createdAt) || toDateOrNull(phase?.created) || new Date();
  const updatedAt = toDateOrNull(phase?.updatedAt) || toDateOrNull(phase?.updated) || createdAt;
  const createdBy = toStringOrNull(phase?.createdBy) || DEFAULT_CREATED_BY;
  const updatedBy = toStringOrNull(phase?.updatedBy) || DEFAULT_UPDATED_BY;

  const rawConstraints = Array.isArray(phase?.constraints) ? phase.constraints : [];
  const constraints = rawConstraints
    .map(constraint => transformLegacyConstraintForWrite(constraint, verbose, challengeId))
    .filter(Boolean);

  const data = {
    challengeId,
    phaseId,
    name,
    description: description ?? null,
    predecessor: predecessor ?? null,
    createdAt,
    updatedAt,
    createdBy,
    updatedBy
  };

  data.isOpen = isOpen === null ? null : isOpen;
  if (duration !== null) {
    data.duration = duration;
  }
  if (scheduledStartDate) {
    data.scheduledStartDate = scheduledStartDate;
  }
  if (scheduledEndDate) {
    data.scheduledEndDate = scheduledEndDate;
  }
  if (actualStartDate) {
    data.actualStartDate = actualStartDate;
  }
  if (actualEndDate) {
    data.actualEndDate = actualEndDate;
  }

  if (constraints.length) {
    data.constraints = {
      create: constraints
    };
  }

  return data;
}

async function replaceChallengeWinners(prismaClient, challengeId, legacyWinners, verbose) {
  const payloads = (Array.isArray(legacyWinners) ? legacyWinners : [])
    .map(winner => transformLegacyWinnerForWrite(challengeId, winner, verbose))
    .filter(Boolean);

  if (!payloads.length) {
    console.warn(`No valid legacy winners to apply for challenge ${challengeId}; skipping update.`);
    return { updated: false, appliedCount: 0 };
  }

  await prismaClient.challengeWinner.deleteMany({ where: { challengeId } });
  for (const data of payloads) {
    await prismaClient.challengeWinner.create({ data });
  }

  if (verbose) {
    console.log(`Applied ${payloads.length} legacy winner(s) to challenge ${challengeId}.`);
  }

  return { updated: true, appliedCount: payloads.length };
}

async function replaceChallengePhases(prismaClient, challengeId, legacyPhases, verbose) {
  const payloads = (Array.isArray(legacyPhases) ? legacyPhases : [])
    .map(phase => transformLegacyPhaseForWrite(challengeId, phase, verbose))
    .filter(Boolean);

  if (!payloads.length) {
    console.warn(`No valid legacy phases to apply for challenge ${challengeId}; skipping update.`);
    return { updated: false, appliedCount: 0 };
  }

  await prismaClient.challengePhase.deleteMany({ where: { challengeId } });
  for (const data of payloads) {
    if (data.constraints && data.constraints.create && !data.constraints.create.length) {
      delete data.constraints;
    }
    await prismaClient.challengePhase.create({ data });
  }

  if (verbose) {
    console.log(`Applied ${payloads.length} legacy phase(s) to challenge ${challengeId}.`);
  }

  return { updated: true, appliedCount: payloads.length };
}

async function main() {
  const options = parseArguments(process.argv);
  const dataDirectory = resolveDataDirectory();
  const challengeFileName = resolveChallengeFileName();

  if (options.verbose) {
    console.log(`Comparing winners and phases for challenges updated since ${options.sinceDate.toISOString()}`);
    console.log(`Targets: ${options.targetList.join(', ')}`);
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

  const needWinners = options.targets.has('winners');
  const needPhases = options.targets.has('phases');

  const currentWinnersMap = needWinners ? await fetchCurrentWinners(challengeIds, options.verbose) : new Map();
  const currentPhasesMap = needPhases ? await fetchCurrentPhases(challengeIds, options.verbose) : new Map();

  const mismatchMap = new Map();

  for (const challenge of relevantChallenges) {
    const challengeId = challenge?.id || challenge?.challengeId;
    if (!challengeId) {
      if (options.verbose) {
        console.warn('Skipping challenge without id property.');
      }
      continue;
    }

    const entry = mismatchMap.get(challengeId) || { challengeId };
    let foundDifference = false;

    if (needWinners) {
      const legacyWinners = Array.isArray(challenge.winners) ? challenge.winners : [];
      const currentWinners = currentWinnersMap.get(challengeId) || [];

      const legacyNormalized = normalizeWinners(legacyWinners);
      const currentNormalized = normalizeWinners(currentWinners);

      if (!deepEqual(legacyNormalized, currentNormalized)) {
        entry.winners = {
          legacy: cloneForOutput(legacyWinners),
          current: cloneForOutput(currentWinners)
        };
        foundDifference = true;
      }
    }

    if (needPhases) {
      const legacyPhases = Array.isArray(challenge.phases) ? challenge.phases : [];
      const currentPhases = currentPhasesMap.get(challengeId) || [];

      const legacyNormalized = normalizePhases(legacyPhases);
      const currentNormalized = normalizePhases(currentPhases);

      if (!deepEqual(legacyNormalized, currentNormalized)) {
        entry.phases = {
          legacy: cloneForOutput(legacyPhases),
          current: cloneForOutput(currentPhases)
        };
        foundDifference = true;
      }
    }

    if (foundDifference) {
      mismatchMap.set(challengeId, entry);
    }
  }

  if (!mismatchMap.size) {
    console.log('No winner or phase mismatches detected for the specified window.');
    return;
  }

  const winnerMismatches = [];
  const phaseMismatches = [];

  for (const item of mismatchMap.values()) {
    if (item.winners) {
      winnerMismatches.push(item);
    }
    if (item.phases) {
      phaseMismatches.push(item);
    }
  }

  if (!options.apply || options.verbose) {
    if (winnerMismatches.length) {
      console.log(`Detected ${winnerMismatches.length} challenge(s) with winner mismatches:\n`);
      for (const mismatch of winnerMismatches) {
        console.log(`challengeId: ${mismatch.challengeId}`);
        console.log('legacy winners:');
        console.log(JSON.stringify(mismatch.winners.legacy, null, 2));
        console.log('v6 winners:');
        console.log(JSON.stringify(mismatch.winners.current, null, 2));
        console.log('---');
      }
    } else if (options.verbose) {
      console.log('No winner mismatches detected.');
    }

    if (phaseMismatches.length) {
      console.log(`Detected ${phaseMismatches.length} challenge(s) with phase mismatches:\n`);
      for (const mismatch of phaseMismatches) {
        console.log(`challengeId: ${mismatch.challengeId}`);
        console.log('legacy phases:');
        console.log(JSON.stringify(mismatch.phases.legacy, null, 2));
        console.log('v6 phases:');
        console.log(JSON.stringify(mismatch.phases.current, null, 2));
        console.log('---');
      }
    } else if (options.verbose) {
      console.log('No phase mismatches detected.');
    }
  } else {
    if (winnerMismatches.length) {
      console.log(`Detected ${winnerMismatches.length} challenge(s) with winner mismatches.`);
    }
    if (phaseMismatches.length) {
      console.log(`Detected ${phaseMismatches.length} challenge(s) with phase mismatches.`);
    }
  }

  if (!options.apply) {
    console.log('Run with --apply to overwrite v6 winners/phases with the legacy values.');
    return;
  }

  console.log(`Applying legacy data to ${mismatchMap.size} challenge(s)...`);

  let winnerApplied = 0;
  let winnerSkipped = 0;
  let winnerFailed = 0;

  let phaseApplied = 0;
  let phaseSkipped = 0;
  let phaseFailed = 0;

  for (const mismatch of mismatchMap.values()) {
    try {
      await prisma.$transaction(async (tx) => {
        if (mismatch.winners) {
          const result = await replaceChallengeWinners(tx, mismatch.challengeId, mismatch.winners.legacy, options.verbose);
          if (result.updated) {
            winnerApplied += 1;
          } else {
            winnerSkipped += 1;
          }
        }
        if (mismatch.phases) {
          const result = await replaceChallengePhases(tx, mismatch.challengeId, mismatch.phases.legacy, options.verbose);
          if (result.updated) {
            phaseApplied += 1;
          } else {
            phaseSkipped += 1;
          }
        }
      });
    } catch (error) {
      if (mismatch.winners) {
        winnerFailed += 1;
      }
      if (mismatch.phases) {
        phaseFailed += 1;
      }
      console.error(`Failed to apply legacy data for challenge ${mismatch.challengeId}: ${error.message}`);
      if (options.verbose) {
        console.error(error);
      }
    }
  }

  if (needWinners) {
    console.log(`Winner updates -> applied: ${winnerApplied}, skipped: ${winnerSkipped}, failed: ${winnerFailed}.`);
  }
  if (needPhases) {
    console.log(`Phase updates -> applied: ${phaseApplied}, skipped: ${phaseSkipped}, failed: ${phaseFailed}.`);
  }
}

main()
  .catch(error => {
    console.error('Failed to compare winners and phases:', error.message);
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.error(error);
    }
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
