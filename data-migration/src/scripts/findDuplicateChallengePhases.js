#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const UNIQUE_PHASE_NAMES = [
  'Registration',
  'Submission',
  'Checkpoint Submission',
  'Checkpoint Review',
  'Screening',
  'Review'
];

const DEFAULT_OUTPUT_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'logs',
  'duplicate-challenge-phase-deletes.sql'
);

function printHelpAndExit(code) {
  console.log(`Usage: node src/scripts/findDuplicateChallengePhases.js [options]

Options:
  --since <ISO date>   Only inspect challenges created on/after this date.
  --output <path>      File to write DELETE statements to (default: ${DEFAULT_OUTPUT_FILE}).
  --help               Show this message and exit.

Examples:
  node src/scripts/findDuplicateChallengePhases.js
  node src/scripts/findDuplicateChallengePhases.js --since 2025-01-01T00:00:00Z
  node src/scripts/findDuplicateChallengePhases.js --output ./logs/dedup.sql`);
  process.exit(code);
}

function parseArguments(argv) {
  const options = {
    since: null,
    output: DEFAULT_OUTPUT_FILE
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current === '--help' || current === '-h') {
      printHelpAndExit(0);
    } else if (current === '--since') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value after --since');
      }
      options.since = next;
      i += 1;
    } else if (current.startsWith('--since=')) {
      options.since = current.split('=').slice(1).join('=');
    } else if (current === '--output') {
      const next = args[i + 1];
      if (!next) {
        throw new Error('Missing value after --output');
      }
      options.output = path.resolve(next);
      i += 1;
    } else if (current.startsWith('--output=')) {
      options.output = path.resolve(current.split('=').slice(1).join('='));
    } else {
      throw new Error(`Unknown argument: ${current}`);
    }
  }

  if (options.since) {
    const parsedDate = new Date(options.since);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error(`Invalid --since value "${options.since}". Provide an ISO-8601 timestamp such as 2025-01-01T00:00:00Z.`);
    }
    options.sinceDate = parsedDate;
  }

  return options;
}

function groupByChallengeAndName(phases) {
  const map = new Map();
  for (const phase of phases) {
    const key = `${phase.challengeId}::${phase.name}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(phase);
  }
  return map;
}

function sortPhasesForDedup(phases) {
  return phases.slice().sort((a, b) => {
    const aActual = a.actualStartDate ? new Date(a.actualStartDate).getTime() : null;
    const bActual = b.actualStartDate ? new Date(b.actualStartDate).getTime() : null;
    if (aActual !== null && bActual !== null && aActual !== bActual) {
      return aActual - bActual;
    }
    if (aActual !== null && bActual === null) {
      return -1;
    }
    if (aActual === null && bActual !== null) {
      return 1;
    }

    const aScheduled = a.scheduledStartDate ? new Date(a.scheduledStartDate).getTime() : null;
    const bScheduled = b.scheduledStartDate ? new Date(b.scheduledStartDate).getTime() : null;
    if (aScheduled !== null && bScheduled !== null && aScheduled !== bScheduled) {
      return aScheduled - bScheduled;
    }
    if (aScheduled !== null && bScheduled === null) {
      return -1;
    }
    if (aScheduled === null && bScheduled !== null) {
      return 1;
    }

    const createdDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return a.id.localeCompare(b.id);
  });
}

function formatSqlOutput(duplicateGroups, filters) {
  const lines = [];
  const generatedAt = new Date().toISOString();

  lines.push(`-- Duplicate ChallengePhase delete statements generated ${generatedAt}`);
  lines.push(`-- Unique phase names enforced: ${UNIQUE_PHASE_NAMES.join(', ')}`);
  if (filters.since) {
    lines.push(`-- Filter: challenge.createdAt >= ${filters.since.toISOString()}`);
  }
  lines.push('-- Review carefully before executing.');
  lines.push('');

  for (const group of duplicateGroups) {
    const header = `-- Challenge ${group.challengeId}${group.challengeLegacyId ? ` (legacy ${group.challengeLegacyId})` : ''} | "${group.challengeName}" | Phase "${group.phaseName}"`;
    lines.push(header);
    lines.push(`-- Keeping phase ${group.keep.id} (createdAt ${group.keep.createdAt.toISOString()})`);

    const detailLines = group.toDelete
      .map(phase => {
        const scheduled = phase.scheduledStartDate ? new Date(phase.scheduledStartDate).toISOString() : 'null';
        const actual = phase.actualStartDate ? new Date(phase.actualStartDate).toISOString() : 'null';
        return `--   Deleting ${phase.id}: scheduled=${scheduled}, actual=${actual}, createdAt=${phase.createdAt.toISOString()}`;
      });
    lines.push(...detailLines);

    const ids = group.toDelete.map(phase => `'${phase.id}'`);
    lines.push(`DELETE FROM "ChallengePhase" WHERE "id" IN (${ids.join(', ')});`);
    lines.push('');
  }

  if (duplicateGroups.length === 0) {
    lines.push('-- No duplicate phases detected.');
  }

  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv);
  } catch (err) {
    console.error(`[error] ${err.message}`);
    process.exit(1);
  }

  const where = {
    name: {
      in: UNIQUE_PHASE_NAMES
    }
  };

  if (options.sinceDate) {
    where.challenge = {
      is: {
        createdAt: {
          gte: options.sinceDate
        }
      }
    };
  }

  try {
    const phases = await prisma.challengePhase.findMany({
      where,
      include: {
        challenge: {
          select: {
            id: true,
            name: true,
            legacyId: true,
            createdAt: true
          }
        }
      },
      orderBy: [
        { challengeId: 'asc' },
        { name: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    });

    const grouped = groupByChallengeAndName(phases);
    const duplicateGroups = [];

    for (const group of grouped.values()) {
      if (group.length <= 1) {
        continue;
      }
      const sorted = sortPhasesForDedup(group);
      const [keep, ...toDelete] = sorted;
      duplicateGroups.push({
        challengeId: keep.challengeId,
        challengeName: keep.challenge.name,
        challengeLegacyId: keep.challenge.legacyId,
        phaseName: keep.name,
        keep,
        toDelete
      });
    }

    const duplicatesCount = duplicateGroups.reduce((sum, group) => sum + group.toDelete.length, 0);
    const uniquePairs = duplicateGroups.length;

    if (duplicatesCount === 0) {
      console.log('No duplicate challenge phases detected.');
    } else {
      console.log(`Detected ${duplicatesCount} duplicate phases across ${uniquePairs} challenge/phase combinations.`);
    }

    const outputDir = path.dirname(options.output);
    fs.mkdirSync(outputDir, { recursive: true });

    const sqlContent = formatSqlOutput(duplicateGroups, {
      since: options.sinceDate || null
    });

    fs.writeFileSync(options.output, sqlContent, 'utf8');
    console.log(`SQL delete statements written to ${options.output}`);
  } catch (err) {
    console.error(`[error] Failed to detect duplicates: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error(`[error] Unexpected failure: ${err.message}`);
  process.exit(1);
});

