"use strict";

const DEFAULT_MEMBER_SCHEMA = "members";
const TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON = "target-member-resolution-unavailable";

const normalizeMemberSchema = (value) => {
  const normalized = String(value || DEFAULT_MEMBER_SCHEMA).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid MEMBER_DB_SCHEMA "${normalized}"`);
  }
  return normalized;
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const normalizeMemberId = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return String(parsed);
};

const normalizeMemberHandle = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

/**
 * Creates a resolver that loads target-environment member identities by user id.
 * The historical marathon importer uses this to backfill handles when an Informix
 * user export shard is missing or incomplete, while still keeping the target DB as
 * the source of truth for current member handles.
 *
 * @param {Object} params resolver dependencies
 * @param {Object} params.prisma Prisma client with `$queryRawUnsafe`
 * @param {string} [params.memberSchema] schema containing the `member` table
 * @returns {Function} resolver returning a Map keyed by normalized member id
 * @throws {Error} when a query-capable Prisma client is not supplied
 */
const createMemberIdentityResolver = ({ prisma, memberSchema = DEFAULT_MEMBER_SCHEMA }) => {
  if (!prisma || typeof prisma.$queryRawUnsafe !== "function") {
    throw new Error("A Prisma client with $queryRawUnsafe is required for member identity resolution.");
  }

  const normalizedSchema = normalizeMemberSchema(memberSchema);

  return async ({ memberIds = [] }) => {
    const normalizedMemberIds = Array.from(
      new Set(memberIds.map((memberId) => normalizeMemberId(memberId)).filter(Boolean))
    );
    const identityByMemberId = new Map();
    if (normalizedMemberIds.length === 0) {
      return identityByMemberId;
    }

    const batches = chunkArray(normalizedMemberIds, 1000);
    for (const batch of batches) {
      const placeholders = batch.map((_, index) => `$${index + 1}::bigint`).join(", ");
      const query = `SELECT "userId", "handle" FROM "${normalizedSchema}"."member" WHERE "userId" IN (${placeholders})`;
      const rows = await prisma.$queryRawUnsafe(query, ...batch);
      (rows || []).forEach((row) => {
        const memberId = normalizeMemberId(row && row.userId);
        if (!memberId) {
          return;
        }
        identityByMemberId.set(memberId, {
          memberId,
          memberHandle: normalizeMemberHandle(row && row.handle),
        });
      });
    }

    return identityByMemberId;
  };
};

const createMemberPresenceResolver = ({ prisma, memberSchema = DEFAULT_MEMBER_SCHEMA }) => {
  if (!prisma || typeof prisma.$queryRawUnsafe !== "function") {
    throw new Error("A Prisma client with $queryRawUnsafe is required for member resolution.");
  }

  const normalizedSchema = normalizeMemberSchema(memberSchema);

  return async ({ memberIds = [] }) => {
    const normalizedMemberIds = Array.from(
      new Set(memberIds.map((memberId) => normalizeMemberId(memberId)).filter(Boolean))
    );
    if (normalizedMemberIds.length === 0) {
      return new Set();
    }

    const resolvedMemberIds = new Set();
    const batches = chunkArray(normalizedMemberIds, 1000);
    for (const batch of batches) {
      const placeholders = batch.map((_, index) => `$${index + 1}::bigint`).join(", ");
      const query = `SELECT "userId" FROM "${normalizedSchema}"."member" WHERE "userId" IN (${placeholders})`;
      const rows = await prisma.$queryRawUnsafe(query, ...batch);
      (rows || []).forEach((row) => {
        const memberId = normalizeMemberId(row && row.userId);
        if (memberId) {
          resolvedMemberIds.add(memberId);
        }
      });
    }

    return resolvedMemberIds;
  };
};

module.exports = {
  DEFAULT_MEMBER_SCHEMA,
  TARGET_MEMBER_RESOLUTION_UNAVAILABLE_REASON,
  createMemberIdentityResolver,
  createMemberPresenceResolver,
};
