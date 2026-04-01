const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadNormalizedIdentityByCoderId,
  buildEligibleMemberIdentities,
} = require("../src/scripts/importHistoricalMarathonMatches/participants");

const writeJson = (baseDir, fileName, rootKey, rows) => {
  fs.writeFileSync(
    path.join(baseDir, fileName),
    `${JSON.stringify({ [rootKey]: rows }, null, 2)}\n`,
    "utf8"
  );
};

describe("importHistoricalMarathonMatches participant identity normalization", () => {
  let fixtureDir;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-participants-fixture-"));

    writeJson(fixtureDir, "user_1.json", "user", [
      { user_id: "1", handle: "alpha" },
      { user_id: "2", handle: "bravo" },
      { user_id: "77", handle: "delta" },
    ]);
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("loads known user handles and falls back to coder id member mapping", async () => {
    const identities = await loadNormalizedIdentityByCoderId({
      dataDir: fixtureDir,
      coderIds: new Set(["1", "2", "3"]),
    });

    expect(identities.get("1")).toEqual({
      coderId: "1",
      memberId: 1,
      memberHandle: "alpha",
    });
    expect(identities.get("2")).toEqual({
      coderId: "2",
      memberId: 2,
      memberHandle: "bravo",
    });
    expect(identities.get("3")).toEqual({
      coderId: "3",
      memberId: 3,
      memberHandle: null,
    });
  });

  test("eligible identity derivation deduplicates by normalized memberId", () => {
    const identities = buildEligibleMemberIdentities({
      eligibleCoderIds: new Set(["1", "2", "88", "89"]),
      normalizedIdentityByCoderId: new Map([
        ["1", { coderId: "1", memberId: 1, memberHandle: "alpha" }],
        ["2", { coderId: "2", memberId: 2, memberHandle: "bravo" }],
        ["88", { coderId: "88", memberId: 77, memberHandle: "delta" }],
        ["89", { coderId: "89", memberId: 77, memberHandle: null }],
      ]),
    });

    expect(identities).toEqual([
      {
        memberId: 1,
        memberHandle: "alpha",
        coderIds: ["1"],
      },
      {
        memberId: 2,
        memberHandle: "bravo",
        coderIds: ["2"],
      },
      {
        memberId: 77,
        memberHandle: "delta",
        coderIds: ["88", "89"],
      },
    ]);
  });
});
