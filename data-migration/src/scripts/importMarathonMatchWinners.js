#!/usr/bin/env node
"use strict";

/**
 * Import marathon match winners from Informix JSON exports.
 *
 * Required environment:
 * - DATABASE_URL: Challenge DB connection string.
 *
 * Optional environment:
 * - DATA_DIRECTORY: Base directory for JSON files (default: cwd).
 * - LONG_COMP_RESULT_FILE: Filename or path for the long comp result JSON.
 * - ROUND_FILE: Filename or path for the round JSON.
 * - MEMBER_DB_URL: Connection string for the members DB (defaults to DATABASE_URL).
 * - MEMBER_DB_SCHEMA: Schema for members tables (default: members).
 * - CREATED_BY / UPDATED_BY: Attribution fields.
 *
 * Usage:
 *   node data-migration/src/scripts/importMarathonMatchWinners.js \
 *     --long-comp-file informixoltp_long_comp_result.json \
 *     --round-file round.json
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { createRequire } = require("module");

require("dotenv").config();

const appRoot = path.resolve(__dirname, "..", "..", "..");
const requireFromRoot = createRequire(path.join(appRoot, "package.json"));
const { PrismaClient, Prisma, PrizeSetTypeEnum } = requireFromRoot("@prisma/client");

const DEFAULT_ACTOR =
  process.env.UPDATED_BY || process.env.CREATED_BY || "informix-mm-winner-import";
const CREATED_BY = process.env.CREATED_BY || DEFAULT_ACTOR;
const UPDATED_BY = process.env.UPDATED_BY || DEFAULT_ACTOR;

const DEFAULT_LONG_COMP_FILE =
  process.env.LONG_COMP_RESULT_FILE || "informixoltp_long_comp_result.json";
const DEFAULT_ROUND_FILE = process.env.ROUND_FILE || "round.json";
const DEFAULT_MEMBER_SCHEMA = process.env.MEMBER_DB_SCHEMA || "members";

const parseArgs = (argv) => {
  const options = {
    dataDir: process.env.DATA_DIRECTORY || process.cwd(),
    longCompFile: DEFAULT_LONG_COMP_FILE,
    roundFile: DEFAULT_ROUND_FILE,
    memberDbUrl: process.env.MEMBER_DB_URL || process.env.DATABASE_URL,
    memberSchema: DEFAULT_MEMBER_SCHEMA,
    dryRun: false,
    roundIds: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--data-dir") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--data-dir requires a value");
      }
      options.dataDir = next;
      i += 1;
      continue;
    }
    if (arg === "--long-comp-file") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--long-comp-file requires a value");
      }
      options.longCompFile = next;
      i += 1;
      continue;
    }
    if (arg === "--round-file") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--round-file requires a value");
      }
      options.roundFile = next;
      i += 1;
      continue;
    }
    if (arg === "--member-db-url") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--member-db-url requires a value");
      }
      options.memberDbUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--member-schema") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--member-schema requires a value");
      }
      options.memberSchema = next;
      i += 1;
      continue;
    }
    if (arg === "--round-id") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--round-id requires a value");
      }
      options.roundIds.push(next);
      i += 1;
      continue;
    }
    if (arg === "--round-ids") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--round-ids requires a comma-separated list");
      }
      const ids = next
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      options.roundIds.push(...ids);
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  options.roundIds = Array.from(new Set(options.roundIds.map((id) => String(id).trim()))).filter(
    Boolean
  );

  return options;
};

const printUsage = () => {
  console.log(`
Usage:
  node data-migration/src/scripts/importMarathonMatchWinners.js [options]

Options:
  --data-dir <path>         Base directory for JSON files (default: DATA_DIRECTORY or cwd)
  --long-comp-file <path>   Path or filename for long comp result JSON
  --round-file <path>       Path or filename for round JSON
  --member-db-url <url>     Override members DB connection (default: DATABASE_URL)
  --member-schema <schema>  Override members schema (default: members)
  --round-id <id>           Limit to a single round id (repeatable)
  --round-ids <ids>         Comma-separated round ids
  --dry-run                 Preview inserts without writing to DB
  --help                    Show this help
`);
};

const resolveDataFile = (dataDir, filePath) => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(dataDir, filePath);
};

const loadJson = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
};

const extractArray = (payload, key, filePath) => {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload[key])) {
    return payload[key];
  }
  throw new Error(`Expected ${key} array in ${filePath}`);
};

const normalizeName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const stripRoundSuffix = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const stripped = text.replace(/\s+round\b.*$/i, "").trim();
  return stripped || text;
};

const extractMarathonMatchToken = (value) => {
  const match = /marathon match\s+\d+/i.exec(String(value || ""));
  return match ? match[0].trim() : "";
};

const buildSchemaTable = (schemaName, tableName) => {
  const trimmed = String(schemaName || "").trim();
  if (!trimmed) {
    return Prisma.raw(`"${tableName}"`);
  }
  const safeSchema = trimmed.replace(/"/g, '""');
  return Prisma.raw(`"${safeSchema}"."${tableName}"`);
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const parseNumericString = (value) => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null") {
    return null;
  }
  const num = Number(text);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Number.isInteger(num) ? num : null;
};

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const aLen = a.length;
  const bLen = b.length;
  const v0 = new Array(bLen + 1).fill(0);
  const v1 = new Array(bLen + 1).fill(0);

  for (let i = 0; i <= bLen; i += 1) {
    v0[i] = i;
  }

  for (let i = 0; i < aLen; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < bLen; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= bLen; j += 1) {
      v0[j] = v1[j];
    }
  }
  return v1[bLen];
};

const similarityScore = (a, b) => {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) {
    return 0;
  }
  const distance = levenshtein(left, right);
  const maxLen = Math.max(left.length, right.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
};

const fetchHandles = async (memberClient, memberSchema, userIds) => {
  const handles = new Map();
  const memberTable = buildSchemaTable(memberSchema, "member");
  const uniqueIds = Array.from(new Set(userIds.map((id) => String(id))));
  const batches = chunkArray(uniqueIds, 1000);

  for (const batch of batches) {
    const idParams = batch.map((id) => BigInt(id));
    const rows = await memberClient.$queryRaw`
      SELECT "userId", "handle"
      FROM ${memberTable}
      WHERE "userId" IN (${Prisma.join(idParams)})
    `;
    (rows || []).forEach((row) => {
      const userId = row.userId !== null && row.userId !== undefined ? String(row.userId) : null;
      if (userId) {
        handles.set(userId, row.handle || "");
      }
    });
  }

  return handles;
};

const buildCandidateNames = (roundName) => {
  const names = new Set();
  const raw = String(roundName || "").trim();
  if (raw) {
    names.add(raw);
  }
  const stripped = stripRoundSuffix(raw);
  if (stripped && stripped !== raw) {
    names.add(stripped);
  }
  const marathonToken = extractMarathonMatchToken(raw);
  if (marathonToken) {
    names.add(marathonToken);
  }
  return Array.from(names);
};

const findExactMatches = async (prisma, candidateNames) => {
  const matches = new Map();
  for (const name of candidateNames) {
    const rows = await prisma.challenge.findMany({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true, status: true },
    });
    rows.forEach((row) => matches.set(row.id, row));
  }
  return matches;
};

const findContainsMatches = async (prisma, candidateNames) => {
  if (!candidateNames.length) {
    return [];
  }
  const orConditions = candidateNames.map((name) => ({
    name: { contains: name, mode: "insensitive" },
  }));
  return prisma.challenge.findMany({
    where: { OR: orConditions },
    select: { id: true, name: true, status: true },
  });
};

const scoreCandidates = (roundName, candidates) => {
  const compareName = stripRoundSuffix(roundName || "");
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: similarityScore(compareName || roundName || "", candidate.name || ""),
    }))
    .sort((a, b) => b.score - a.score);
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const promptForChallengeId = async (rl, round, candidates) => {
  console.log("");
  console.log(`Round ${round.round_id}: "${round.name || round.short_name || ""}"`);
  if (candidates.length) {
    console.log("Possible challenge matches:");
    candidates.slice(0, 5).forEach((candidate, index) => {
      const scorePct = Math.round(candidate.score * 1000) / 10;
      console.log(
        `  ${index + 1}) ${candidate.id} | ${candidate.name} | status=${candidate.status} | match=${scorePct}%`
      );
    });
  } else {
    console.log("No challenge matches found by name.");
  }
  console.log('Enter a number, a challenge UUID, or "skip".');

  while (true) {
    const answer = String(await rl.question("> ")).trim();
    if (!answer) {
      continue;
    }
    if (answer.toLowerCase() === "skip") {
      return null;
    }
    const asNumber = Number.parseInt(answer, 10);
    if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= candidates.length) {
      return candidates[asNumber - 1].id;
    }
    if (isUuid(answer)) {
      return answer;
    }
    console.log("Invalid input. Enter a listed number, a UUID, or skip.");
  }
};

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set for the challenge database.");
  }

  if (!options.memberDbUrl) {
    throw new Error("MEMBER_DB_URL must be set or DATABASE_URL must include members schema.");
  }

  const longCompPath = resolveDataFile(options.dataDir, options.longCompFile);
  const roundPath = resolveDataFile(options.dataDir, options.roundFile);

  if (!fs.existsSync(longCompPath)) {
    throw new Error(`Long comp result file not found: ${longCompPath}`);
  }
  if (!fs.existsSync(roundPath)) {
    throw new Error(`Round file not found: ${roundPath}`);
  }

  const longCompData = loadJson(longCompPath);
  const longCompResults = extractArray(longCompData, "long_comp_result", longCompPath);
  const roundData = loadJson(roundPath);
  const rounds = extractArray(roundData, "round", roundPath);

  const roundById = new Map();
  rounds.forEach((round) => {
    const roundId = round ? String(round.round_id || round.id || "").trim() : "";
    if (roundId) {
      roundById.set(roundId, round);
    }
  });

  const resultsByRound = new Map();
  const userIds = new Set();
  const skipped = {
    missingRoundId: 0,
    invalidUserId: 0,
    missingPlacement: 0,
    invalidPlacement: 0,
  };

  longCompResults.forEach((row) => {
    if (!row) {
      return;
    }
    const roundId = String(row.round_id || "").trim();
    if (!roundId) {
      skipped.missingRoundId += 1;
      return;
    }
    if (options.roundIds.length && !options.roundIds.includes(roundId)) {
      return;
    }

    const placement = parseNumericString(row.placed);
    if (placement === null) {
      skipped.missingPlacement += 1;
      return;
    }
    if (!Number.isFinite(placement) || placement <= 0) {
      skipped.invalidPlacement += 1;
      return;
    }

    const userId = parseNumericString(row.coder_id);
    if (!Number.isFinite(userId) || userId <= 0) {
      skipped.invalidUserId += 1;
      return;
    }

    const entry = { roundId, placement, userId };
    if (!resultsByRound.has(roundId)) {
      resultsByRound.set(roundId, []);
    }
    resultsByRound.get(roundId).push(entry);
    userIds.add(userId);
  });

  if (!resultsByRound.size) {
    console.log("No placement rows found to import.");
    return;
  }

  const prisma = new PrismaClient();
  const memberClient =
    options.memberDbUrl === process.env.DATABASE_URL
      ? prisma
      : new PrismaClient({ datasources: { db: { url: options.memberDbUrl } } });

  let rl = null;
  const getReadline = () => {
    if (!rl) {
      if (!process.stdin.isTTY) {
        throw new Error("Interactive input required but stdin is not a TTY.");
      }
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    return rl;
  };

  try {
    await prisma.$connect();
    if (memberClient !== prisma) {
      await memberClient.$connect();
    }

    const handleMap = await fetchHandles(memberClient, options.memberSchema, Array.from(userIds));
    const missingHandles = Array.from(userIds).filter(
      (userId) => !handleMap.has(String(userId))
    );

    if (missingHandles.length) {
      console.warn(
        `Handles missing for ${missingHandles.length} userIds (first 10: ${missingHandles
          .slice(0, 10)
          .join(", ")})`
      );
    }

    const roundIdList = Array.from(resultsByRound.keys());
    const challengeIdByRound = new Map();
    const challengeIdByName = new Map();
    const summary = {
      roundsProcessed: 0,
      roundsSkipped: 0,
      winnersFound: 0,
      winnersInserted: 0,
      winnersSkippedExisting: 0,
      winnersSkippedMissingHandle: 0,
    };

    for (const roundId of roundIdList) {
      const round = roundById.get(roundId);
      if (!round) {
        console.warn(`Round ${roundId} not found in round file; skipping.`);
        summary.roundsSkipped += 1;
        continue;
      }

      const roundName = round.name || round.short_name || "";
      if (!roundName) {
        console.warn(`Round ${roundId} has no name; skipping.`);
        summary.roundsSkipped += 1;
        continue;
      }

      const normalizedRoundName = normalizeName(stripRoundSuffix(roundName));
      if (challengeIdByName.has(normalizedRoundName)) {
        challengeIdByRound.set(roundId, challengeIdByName.get(normalizedRoundName));
      }

      if (!challengeIdByRound.has(roundId)) {
        const candidateNames = buildCandidateNames(roundName);
        const exactMatches = await findExactMatches(prisma, candidateNames);

        if (exactMatches.size === 1) {
          const match = Array.from(exactMatches.values())[0];
          challengeIdByRound.set(roundId, match.id);
          challengeIdByName.set(normalizedRoundName, match.id);
          console.log(`Round ${roundId}: matched challenge "${match.name}" (${match.id}).`);
        } else {
          const containsMatches = await findContainsMatches(prisma, candidateNames);
          const scoredCandidates = scoreCandidates(roundName, containsMatches);
          const chosenId = await promptForChallengeId(
            getReadline(),
            round,
            scoredCandidates
          );
          if (!chosenId) {
            summary.roundsSkipped += 1;
            continue;
          }
          challengeIdByRound.set(roundId, chosenId);
          challengeIdByName.set(normalizedRoundName, chosenId);
        }
      }

      const challengeId = challengeIdByRound.get(roundId);
      if (!challengeId) {
        summary.roundsSkipped += 1;
        continue;
      }

      const entries = resultsByRound.get(roundId) || [];
      summary.winnersFound += entries.length;

      const winners = [];
      const winnerKeySet = new Set();
      let missingHandleCount = 0;
      entries.forEach((entry) => {
        const handle = handleMap.get(String(entry.userId));
        if (!handle) {
          missingHandleCount += 1;
          return;
        }
        const key = `${entry.userId}:${entry.placement}`;
        if (winnerKeySet.has(key)) {
          return;
        }
        winnerKeySet.add(key);
        winners.push({
          challengeId,
          userId: entry.userId,
          handle,
          placement: entry.placement,
          type: PrizeSetTypeEnum.PLACEMENT,
          createdBy: CREATED_BY,
          updatedBy: UPDATED_BY,
        });
      });

      summary.winnersSkippedMissingHandle += missingHandleCount;

      if (!winners.length) {
        summary.roundsProcessed += 1;
        continue;
      }

      const existing = await prisma.challengeWinner.findMany({
        where: { challengeId, type: PrizeSetTypeEnum.PLACEMENT },
        select: { userId: true, placement: true },
      });
      const existingSet = new Set(
        existing.map((row) => `${row.userId}:${row.placement}`)
      );

      const toInsert = winners.filter(
        (winner) => !existingSet.has(`${winner.userId}:${winner.placement}`)
      );
      summary.winnersSkippedExisting += winners.length - toInsert.length;

      if (options.dryRun) {
        console.log(
          `[dry-run] Round ${roundId} -> challenge ${challengeId}: ${toInsert.length} winners to insert`
        );
      } else if (toInsert.length) {
        await prisma.challengeWinner.createMany({ data: toInsert });
        summary.winnersInserted += toInsert.length;
        console.log(
          `Round ${roundId} -> challenge ${challengeId}: inserted ${toInsert.length} winners`
        );
      }

      summary.roundsProcessed += 1;
    }

    console.log("");
    console.log("Summary:");
    console.log(`  Rounds processed: ${summary.roundsProcessed}`);
    console.log(`  Rounds skipped: ${summary.roundsSkipped}`);
    console.log(`  Winners found: ${summary.winnersFound}`);
    console.log(`  Winners inserted: ${summary.winnersInserted}`);
    console.log(`  Winners skipped (existing): ${summary.winnersSkippedExisting}`);
    console.log(`  Winners skipped (missing handle): ${summary.winnersSkippedMissingHandle}`);
    console.log(
      `  Skipped rows: missingRoundId=${skipped.missingRoundId}, missingPlacement=${skipped.missingPlacement}, invalidPlacement=${skipped.invalidPlacement}, invalidUserId=${skipped.invalidUserId}`
    );
  } finally {
    if (rl) {
      await rl.close();
    }
    await prisma.$disconnect();
    if (memberClient !== prisma) {
      await memberClient.$disconnect();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
