"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_SUBMISSION_ARCHIVE_URL_PREFIX =
  "https://s3.amazonaws.com/topcoder-submissions";
const ZIP_EPOCH_DATE = 0x0021;
const ZIP_EPOCH_TIME = 0x0000;

const sanitizeArchiveSegment = (value, fallback) => {
  const normalized = String(value || "").trim();
  const sanitized = normalized
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
};

const buildSubmissionArchiveBaseName = ({ challengeId, legacySubmissionId }) => {
  const normalizedChallengeId = String(challengeId || "").trim();
  const normalizedLegacySubmissionId = String(legacySubmissionId || "").trim();
  if (!normalizedChallengeId) {
    throw new Error("Cannot build submission archive name without challengeId.");
  }
  if (!normalizedLegacySubmissionId) {
    throw new Error("Cannot build submission archive name without legacySubmissionId.");
  }

  const safeLegacySubmissionId = sanitizeArchiveSegment(
    normalizedLegacySubmissionId,
    "legacy-submission"
  );
  const stableHash = crypto
    .createHash("sha1")
    .update(`${normalizedChallengeId}:${normalizedLegacySubmissionId}`)
    .digest("hex")
    .slice(0, 12);

  return `${safeLegacySubmissionId}-${stableHash}`;
};

const buildSubmissionArchiveFileName = ({ challengeId, legacySubmissionId }) =>
  `${buildSubmissionArchiveBaseName({ challengeId, legacySubmissionId })}.zip`;

const buildSubmissionArchiveEntryName = ({ legacySubmissionId }) => {
  const normalizedLegacySubmissionId = String(legacySubmissionId || "").trim();
  if (!normalizedLegacySubmissionId) {
    throw new Error("Cannot build submission archive entry name without legacySubmissionId.");
  }
  const safeLegacySubmissionId = sanitizeArchiveSegment(
    normalizedLegacySubmissionId,
    "legacy-submission"
  );
  return `${safeLegacySubmissionId}.txt`;
};

const buildSubmissionArchiveUrl = ({ archiveFileName, urlPrefix = DEFAULT_SUBMISSION_ARCHIVE_URL_PREFIX }) => {
  const normalizedArchiveFileName = String(archiveFileName || "").trim();
  if (!normalizedArchiveFileName) {
    throw new Error("Cannot build submission archive URL without archive file name.");
  }
  const normalizedPrefix = String(urlPrefix || DEFAULT_SUBMISSION_ARCHIVE_URL_PREFIX)
    .trim()
    .replace(/\/+$/, "");
  return `${normalizedPrefix}/${normalizedArchiveFileName}`;
};

const resolveSubmissionArchiveDirectory = (archiveDirectory) => {
  const normalizedArchiveDirectory = String(archiveDirectory || "").trim();
  if (!normalizedArchiveDirectory) {
    throw new Error("SUBMISSION_ARCHIVE_DIR must be set for submission archive generation.");
  }
  return path.resolve(normalizedArchiveDirectory);
};

const buildCrc32Table = () => {
  const table = new Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      if ((value & 1) !== 0) {
        value = (value >>> 1) ^ 0xedb88320;
      } else {
        value >>>= 1;
      }
    }
    table[i] = value >>> 0;
  }
  return table;
};

const CRC32_TABLE = buildCrc32Table();

const computeCrc32 = (buffer) => {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    const lookupIndex = (crc ^ buffer[index]) & 0xff;
    crc = (crc >>> 8) ^ CRC32_TABLE[lookupIndex];
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const buildSingleEntryZipBuffer = ({ entryName, textContent }) => {
  const normalizedEntryName = String(entryName || "").trim();
  if (!normalizedEntryName) {
    throw new Error("Cannot create submission archive without an entry name.");
  }

  const entryNameBuffer = Buffer.from(normalizedEntryName, "utf8");
  const fileDataBuffer = Buffer.from(String(textContent || ""), "utf8");
  const crc32 = computeCrc32(fileDataBuffer);
  const compressedSize = fileDataBuffer.length;
  const uncompressedSize = fileDataBuffer.length;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(ZIP_EPOCH_TIME, 10);
  localHeader.writeUInt16LE(ZIP_EPOCH_DATE, 12);
  localHeader.writeUInt32LE(crc32, 14);
  localHeader.writeUInt32LE(compressedSize, 18);
  localHeader.writeUInt32LE(uncompressedSize, 22);
  localHeader.writeUInt16LE(entryNameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralDirectoryHeader = Buffer.alloc(46);
  centralDirectoryHeader.writeUInt32LE(0x02014b50, 0);
  centralDirectoryHeader.writeUInt16LE(20, 4);
  centralDirectoryHeader.writeUInt16LE(20, 6);
  centralDirectoryHeader.writeUInt16LE(0, 8);
  centralDirectoryHeader.writeUInt16LE(0, 10);
  centralDirectoryHeader.writeUInt16LE(ZIP_EPOCH_TIME, 12);
  centralDirectoryHeader.writeUInt16LE(ZIP_EPOCH_DATE, 14);
  centralDirectoryHeader.writeUInt32LE(crc32, 16);
  centralDirectoryHeader.writeUInt32LE(compressedSize, 20);
  centralDirectoryHeader.writeUInt32LE(uncompressedSize, 24);
  centralDirectoryHeader.writeUInt16LE(entryNameBuffer.length, 28);
  centralDirectoryHeader.writeUInt16LE(0, 30);
  centralDirectoryHeader.writeUInt16LE(0, 32);
  centralDirectoryHeader.writeUInt16LE(0, 34);
  centralDirectoryHeader.writeUInt16LE(0, 36);
  centralDirectoryHeader.writeUInt32LE(0, 38);
  centralDirectoryHeader.writeUInt32LE(0, 42);

  const centralDirectorySize = centralDirectoryHeader.length + entryNameBuffer.length;
  const centralDirectoryOffset = localHeader.length + entryNameBuffer.length + fileDataBuffer.length;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([
    localHeader,
    entryNameBuffer,
    fileDataBuffer,
    centralDirectoryHeader,
    entryNameBuffer,
    endOfCentralDirectory,
  ]);
};

const writeSubmissionArchiveZip = ({
  archiveDirectory,
  archiveFileName,
  archiveEntryName,
  submissionText,
}) => {
  const resolvedArchiveDirectory = resolveSubmissionArchiveDirectory(archiveDirectory);
  const normalizedArchiveFileName = String(archiveFileName || "").trim();
  const normalizedArchiveEntryName = String(archiveEntryName || "").trim();
  if (!normalizedArchiveFileName) {
    throw new Error("Cannot write submission archive without archive file name.");
  }
  if (!normalizedArchiveEntryName) {
    throw new Error("Cannot write submission archive without archive entry name.");
  }

  fs.mkdirSync(resolvedArchiveDirectory, { recursive: true });
  const archivePath = path.join(resolvedArchiveDirectory, normalizedArchiveFileName);
  const archiveBuffer = buildSingleEntryZipBuffer({
    entryName: normalizedArchiveEntryName,
    textContent: submissionText,
  });
  fs.writeFileSync(archivePath, archiveBuffer);
  return archivePath;
};

module.exports = {
  DEFAULT_SUBMISSION_ARCHIVE_URL_PREFIX,
  buildSubmissionArchiveBaseName,
  buildSubmissionArchiveFileName,
  buildSubmissionArchiveEntryName,
  buildSubmissionArchiveUrl,
  resolveSubmissionArchiveDirectory,
  writeSubmissionArchiveZip,
};
