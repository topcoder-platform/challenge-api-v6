"use strict";

const fs = require("fs");
const path = require("path");
const JSONStream = require("JSONStream");

const ensureFileExists = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
};

const resolveFilePath = (baseDir, maybeRelativePath) => {
  if (path.isAbsolute(maybeRelativePath)) {
    return maybeRelativePath;
  }
  return path.resolve(baseDir, maybeRelativePath);
};

/**
 * Compiles the importer's bounded numbered-file pattern without dynamic regular expressions.
 *
 * The supported form is an anchored literal name containing exactly one `\\d+`
 * token, for example `^user_\\d+\\.json$`. Literal punctuation must be escaped.
 *
 * @param {string} pattern anchored numbered-file pattern supplied by importer configuration
 * @param {string} label human-readable file category used in validation errors
 * @returns {(fileName: string) => boolean} deterministic filename predicate used by listFilesByPattern
 * @throws {Error} when the pattern is unanchored, contains multiple number tokens, or uses regex operators
 */
const compileNumberedFilePattern = (pattern, label) => {
  const normalized = String(pattern || "");
  const numberToken = "\\d+";
  if (!normalized.startsWith("^") || !normalized.endsWith("$") || normalized.length > 256) {
    throw new Error(`Invalid numbered-file pattern for ${label}: ${pattern}`);
  }

  const body = normalized.slice(1, -1);
  const tokenIndex = body.indexOf(numberToken);
  if (tokenIndex < 0 || body.indexOf(numberToken, tokenIndex + numberToken.length) >= 0) {
    throw new Error(`Invalid numbered-file pattern for ${label}: ${pattern}`);
  }

  /**
   * Decodes a literal filename segment from the restricted pattern syntax.
   *
   * @param {string} segment pattern text before or after the numbered token
   * @returns {string} literal filename prefix or suffix used by the matcher
   * @throws {Error} when the segment contains a regex operator or unsupported escape
   */
  const decodeLiteral = (segment) => {
    let literal = "";
    for (let index = 0; index < segment.length; index += 1) {
      const character = segment[index];
      if (character === "\\") {
        const escaped = segment[index + 1];
        if (!escaped || !"._-".includes(escaped)) {
          throw new Error(`Unsupported regex operator in ${label} pattern: ${pattern}`);
        }
        literal += escaped;
        index += 1;
        continue;
      }
      const isLiteralCharacter =
        (character >= "a" && character <= "z") ||
        (character >= "A" && character <= "Z") ||
        (character >= "0" && character <= "9") ||
        "_-".includes(character);
      if (!isLiteralCharacter) {
        throw new Error(`Unsupported regex operator in ${label} pattern: ${pattern}`);
      }
      literal += character;
    }
    return literal;
  };

  const prefix = decodeLiteral(body.slice(0, tokenIndex));
  const suffix = decodeLiteral(body.slice(tokenIndex + numberToken.length));

  return (fileName) => {
    if (
      !fileName.startsWith(prefix) ||
      !fileName.endsWith(suffix) ||
      fileName.length <= prefix.length + suffix.length
    ) {
      return false;
    }
    const numericPart = fileName.slice(prefix.length, fileName.length - suffix.length);
    return Array.from(numericPart).every(
      (character) => character >= "0" && character <= "9"
    );
  };
};

/**
 * Lists files matching the importer's safe anchored numbered-file pattern.
 *
 * @param {string} baseDir directory containing the legacy export shards
 * @param {string} pattern anchored literal pattern with one `\\d+` token
 * @param {string} label human-readable file category used in errors
 * @returns {string[]} sorted absolute paths for matching export files
 * @throws {Error} when the pattern is unsafe or when no files match it
 */
const listFilesByPattern = (baseDir, pattern, label) => {
  const matchesPattern = compileNumberedFilePattern(pattern, label);

  const matched = fs
    .readdirSync(baseDir)
    .filter((entry) => matchesPattern(entry))
    .sort()
    .map((entry) => path.join(baseDir, entry));

  if (matched.length === 0) {
    throw new Error(`No files matched ${label} pattern ${pattern} in ${baseDir}`);
  }

  return matched;
};

const streamJsonArray = async (filePath, rootKey, onRow) =>
  new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const parser = JSONStream.parse(`${rootKey}.*`);
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`Failed while parsing ${filePath}: ${error.message}`));
    };

    stream.on("error", fail);
    parser.on("error", fail);
    parser.on("data", (row) => {
      try {
        onRow(row);
      } catch (error) {
        fail(error);
      }
    });
    parser.on("end", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });

    stream.pipe(parser);
  });

module.exports = {
  ensureFileExists,
  resolveFilePath,
  listFilesByPattern,
  streamJsonArray,
};
