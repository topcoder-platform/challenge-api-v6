"use strict";

const {
  listFilesByPattern,
  streamJsonArray,
} = require("./legacyDataReader");

const DEFAULT_USER_PATTERN = "^user_\\d+\\.json$";

const normalizePositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const normalizeHandle = (value) => {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
};

const sortCoderIds = (coderIds) =>
  Array.from(coderIds).sort((left, right) => {
    const leftNum = normalizePositiveInteger(left);
    const rightNum = normalizePositiveInteger(right);
    if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
      return leftNum - rightNum;
    }
    return String(left).localeCompare(String(right));
  });

const normalizeIdentity = ({ coderId, memberId, memberHandle }) => ({
  coderId: String(coderId),
  memberId: normalizePositiveInteger(memberId),
  memberHandle: normalizeHandle(memberHandle),
});

const fallbackIdentityFromCoderId = (coderId) =>
  normalizeIdentity({
    coderId,
    memberId: coderId,
    memberHandle: null,
  });

const mergeIdentity = (existing, incoming) => {
  if (!existing) {
    return incoming;
  }
  if (!existing.memberId && incoming.memberId) {
    return {
      ...existing,
      memberId: incoming.memberId,
      memberHandle: existing.memberHandle || incoming.memberHandle,
    };
  }
  if (!existing.memberHandle && incoming.memberHandle) {
    return { ...existing, memberHandle: incoming.memberHandle };
  }
  return existing;
};

const resolveUserId = (row) => {
  if (!row || typeof row !== "object") {
    return null;
  }
  return (
    normalizePositiveInteger(row.user_id) ||
    normalizePositiveInteger(row.coder_id) ||
    normalizePositiveInteger(row.member_id) ||
    normalizePositiveInteger(row.id)
  );
};

const resolveMemberHandle = (row) => {
  if (!row || typeof row !== "object") {
    return null;
  }
  return (
    normalizeHandle(row.handle) ||
    normalizeHandle(row.handle_lower) ||
    normalizeHandle(row.member_handle) ||
    null
  );
};

const loadNormalizedIdentityByCoderId = async ({
  dataDir,
  userPattern = DEFAULT_USER_PATTERN,
  coderIds = new Set(),
}) => {
  const normalizedCoderIds = new Set(
    Array.from(coderIds)
      .map((coderId) => String(coderId || "").trim())
      .filter(Boolean)
  );
  const identityByCoderId = new Map();

  if (normalizedCoderIds.size > 0) {
    try {
      const userFiles = listFilesByPattern(dataDir, userPattern, "user");
      await Promise.all(
        userFiles.map((filePath) =>
          streamJsonArray(filePath, "user", (row) => {
            const userId = resolveUserId(row);
            if (!userId) {
              return;
            }
            const coderId = String(userId);
            if (!normalizedCoderIds.has(coderId)) {
              return;
            }
            const identity = normalizeIdentity({
              coderId,
              memberId: userId,
              memberHandle: resolveMemberHandle(row),
            });
            identityByCoderId.set(
              coderId,
              mergeIdentity(identityByCoderId.get(coderId), identity)
            );
          })
        )
      );
    } catch (error) {
      if (!String(error.message || "").includes("No files matched user pattern")) {
        throw error;
      }
    }
  }

  normalizedCoderIds.forEach((coderId) => {
    if (!identityByCoderId.has(coderId)) {
      identityByCoderId.set(coderId, fallbackIdentityFromCoderId(coderId));
      return;
    }
    const existing = identityByCoderId.get(coderId);
    if (!existing.memberId) {
      identityByCoderId.set(coderId, fallbackIdentityFromCoderId(coderId));
    }
  });

  return identityByCoderId;
};

const buildEligibleMemberIdentities = ({
  eligibleCoderIds = new Set(),
  normalizedIdentityByCoderId = new Map(),
}) => {
  const memberIdentityByMemberId = new Map();

  sortCoderIds(eligibleCoderIds).forEach((coderId) => {
    const normalizedCoderId = String(coderId || "").trim();
    if (!normalizedCoderId) {
      return;
    }
    const identity =
      normalizedIdentityByCoderId.get(normalizedCoderId) ||
      fallbackIdentityFromCoderId(normalizedCoderId);
    if (!identity || !identity.memberId) {
      return;
    }

    const existing = memberIdentityByMemberId.get(identity.memberId);
    if (!existing) {
      memberIdentityByMemberId.set(identity.memberId, {
        memberId: identity.memberId,
        memberHandle: identity.memberHandle,
        coderIds: [normalizedCoderId],
      });
      return;
    }

    existing.coderIds.push(normalizedCoderId);
    if (!existing.memberHandle && identity.memberHandle) {
      existing.memberHandle = identity.memberHandle;
    }
  });

  return Array.from(memberIdentityByMemberId.values()).sort(
    (left, right) => left.memberId - right.memberId
  );
};

module.exports = {
  DEFAULT_USER_PATTERN,
  loadNormalizedIdentityByCoderId,
  buildEligibleMemberIdentities,
};
