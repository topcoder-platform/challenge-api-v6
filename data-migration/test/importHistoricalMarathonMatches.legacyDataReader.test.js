"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  listFilesByPattern,
} = require("../src/scripts/importHistoricalMarathonMatches/legacyDataReader");

describe("legacyDataReader", () => {
  let dataDir;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "challenge-import-reader-"));
    ["user_1.json", "user_42.json", "user_admin.json", "user_42xjson"].forEach(
      (fileName) => fs.writeFileSync(path.join(dataDir, fileName), "{}")
    );
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("matches only numbered files and treats escaped punctuation literally", () => {
    expect(listFilesByPattern(dataDir, "^user_\\d+\\.json$", "user")).toEqual([
      path.join(dataDir, "user_1.json"),
      path.join(dataDir, "user_42.json"),
    ]);
  });

  test.each([".*", "^(a+)+$", "^user_.*\\.json$", "^user_\\d+\\d+\\.json$"])(
    "rejects unsupported dynamic-regex pattern %s",
    (pattern) => {
      expect(() => listFilesByPattern(dataDir, pattern, "user")).toThrow(
        /numbered-file pattern|Unsupported regex operator/
      );
    }
  );
});
