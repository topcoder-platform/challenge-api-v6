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

const listFilesByPattern = (baseDir, pattern, label) => {
  let regex;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new Error(`Invalid regex for ${label}: ${pattern}`);
  }

  const matched = fs
    .readdirSync(baseDir)
    .filter((entry) => regex.test(entry))
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
