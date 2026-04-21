const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const {
  parseArgs,
  runExport,
} = require("../src/scripts/exportMarathonMatchSubmissions");

const createJsonResponse = (res, payload) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

const startFixtureServer = async () => {
  const requests = [];
  const challengePayload = {
    id: "challenge-123",
    name: "Example Marathon Match",
    type: "Marathon Match",
    track: "DATA_SCIENCE",
  };
  const submissionPayloads = [
    {
      id: "submission-001",
      memberId: "1001",
      challengeId: "challenge-123",
    },
    {
      id: "submission-002",
      memberId: "1002",
      challengeId: "challenge-123",
    },
    {
      id: "submission-003",
      memberId: "1003",
      challengeId: "challenge-123",
    },
  ];
  const reviewSummationPayloads = [
    {
      id: "review-summation-1",
      submissionId: "submission-001",
      aggregateScore: 99.1,
      isFinal: true,
      metadata: { testcase: "system" },
    },
    {
      id: "review-summation-2",
      submissionId: "submission-002",
      aggregateScore: 88.5,
      isFinal: false,
      isProvisional: true,
      metadata: { testcase: "provisional-a" },
    },
    {
      id: "review-summation-3",
      submissionId: "submission-002",
      aggregateScore: 91.3,
      isFinal: true,
      metadata: { testcase: "final" },
    },
  ];
  const downloadBodies = new Map([
    ["submission-001", Buffer.from("zip-one")],
    ["submission-002", Buffer.from("zip-two")],
    ["submission-003", Buffer.from("zip-three")],
  ]);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    requests.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      authorization: req.headers.authorization,
    });

    if (req.headers.authorization !== "Bearer test-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }

    if (url.pathname === "/challenge-api/challenges/challenge-123") {
      createJsonResponse(res, challengePayload);
      return;
    }

    if (url.pathname === "/review-api/submissions") {
      const page = Number.parseInt(url.searchParams.get("page"), 10);
      const perPage = Number.parseInt(url.searchParams.get("perPage"), 10);
      expect(url.searchParams.get("challengeId")).toBe("challenge-123");
      const startIndex = (page - 1) * perPage;
      const pagedData = submissionPayloads.slice(startIndex, startIndex + perPage);
      createJsonResponse(res, {
        data: pagedData,
        meta: {
          page,
          perPage,
          totalCount: submissionPayloads.length,
          totalPages: Math.ceil(submissionPayloads.length / perPage),
        },
      });
      return;
    }

    if (url.pathname === "/review-api/reviewSummations") {
      const page = Number.parseInt(url.searchParams.get("page"), 10);
      const perPage = Number.parseInt(url.searchParams.get("perPage"), 10);
      expect(url.searchParams.get("challengeId")).toBe("challenge-123");
      expect(url.searchParams.get("metadata")).toBe("true");
      const startIndex = (page - 1) * perPage;
      const pagedData = reviewSummationPayloads.slice(startIndex, startIndex + perPage);
      createJsonResponse(res, {
        data: pagedData,
        meta: {
          page,
          perPage,
          totalCount: reviewSummationPayloads.length,
          totalPages: Math.ceil(reviewSummationPayloads.length / perPage),
        },
      });
      return;
    }

    const downloadMatch = url.pathname.match(/^\/review-api\/submissions\/([^/]+)\/download$/);
    if (downloadMatch) {
      const body = downloadBodies.get(downloadMatch[1]);
      if (!body) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: "missing" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/zip" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "not found" }));
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    challengePayload,
    downloadBodies,
    reviewSummationPayloads,
    server,
    requests,
  };
};

describe("exportMarathonMatchSubmissions", () => {
  let fixtureServer;
  let outputDir;

  beforeEach(async () => {
    fixtureServer = await startFixtureServer();
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-export-output-"));
  });

  afterEach(async () => {
    if (fixtureServer?.server) {
      await new Promise((resolve, reject) => {
        fixtureServer.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test("exports challenge metadata, submission archives, and per-submission review summations", async () => {
    const stdout = { write: jest.fn() };
    const stderr = { write: jest.fn() };

    const result = await runExport({
      challengeId: "challenge-123",
      outputDir,
      challengeApiUrl: `${fixtureServer.baseUrl}/challenge-api/challenges`,
      reviewApiUrl: `${fixtureServer.baseUrl}/review-api`,
      token: "test-token",
      pageSize: 1,
      concurrency: 2,
      stdout,
      stderr,
    });

    expect(result).toEqual({
      outputDir,
      metadataPath: path.join(outputDir, "metadata.json"),
      submissionsDir: path.join(outputDir, "submissions"),
      exportedSubmissionCount: 2,
      exportedSubmitterCount: 2,
      reviewSummationCount: 3,
      skippedSubmissionCountWithoutReviewSummation: 1,
      downloadedSubmissionCount: 2,
      failedDownloadCount: 0,
    });

    expect(JSON.parse(fs.readFileSync(path.join(outputDir, "metadata.json"), "utf8"))).toEqual(
      fixtureServer.challengePayload
    );

    expect(
      fs.readFileSync(path.join(outputDir, "submissions", "coder_1001", "submission-001.zip"))
    ).toEqual(fixtureServer.downloadBodies.get("submission-001"));
    expect(
      fs.readFileSync(path.join(outputDir, "submissions", "coder_1002", "submission-002.zip"))
    ).toEqual(fixtureServer.downloadBodies.get("submission-002"));
    expect(
      fs.existsSync(path.join(outputDir, "submissions", "coder_1003"))
    ).toBe(false);

    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(outputDir, "submissions", "coder_1001", "submission-001.json"),
          "utf8"
        )
      )
    ).toEqual([
      fixtureServer.reviewSummationPayloads[0],
    ]);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(outputDir, "submissions", "coder_1002", "submission-002.json"),
          "utf8"
        )
      )
    ).toEqual([
      fixtureServer.reviewSummationPayloads[1],
      fixtureServer.reviewSummationPayloads[2],
    ]);

    expect(
      fixtureServer.requests.filter((entry) => entry.path === "/review-api/submissions")
    ).toHaveLength(3);
    expect(
      fixtureServer.requests.filter((entry) => entry.path === "/review-api/reviewSummations")
    ).toHaveLength(3);
    expect(
      fixtureServer.requests.filter(
        (entry) => entry.path === "/review-api/submissions/submission-003/download"
      )
    ).toHaveLength(0);
    expect(stdout.write).toHaveBeenCalledWith(
      `Exporting Marathon Match challenge-123 to ${outputDir}\n`
    );
    expect(stdout.write).toHaveBeenCalledWith(
      `Exported 2 submissions for 2 submitters to ${outputDir} ` +
        "(1 skipped without review summations, 2 archive downloads succeeded, 0 archive failures)\n"
    );
    expect(stderr.write).not.toHaveBeenCalled();
  });

  test("continues when a submission archive download fails and logs the error", async () => {
    fixtureServer.downloadBodies.delete("submission-002");

    const stdout = { write: jest.fn() };
    const stderr = { write: jest.fn() };

    const result = await runExport({
      challengeId: "challenge-123",
      outputDir,
      challengeApiUrl: `${fixtureServer.baseUrl}/challenge-api/challenges`,
      reviewApiUrl: `${fixtureServer.baseUrl}/review-api`,
      token: "test-token",
      pageSize: 10,
      concurrency: 1,
      stdout,
      stderr,
    });

    expect(result).toEqual({
      outputDir,
      metadataPath: path.join(outputDir, "metadata.json"),
      submissionsDir: path.join(outputDir, "submissions"),
      exportedSubmissionCount: 2,
      exportedSubmitterCount: 2,
      reviewSummationCount: 3,
      skippedSubmissionCountWithoutReviewSummation: 1,
      downloadedSubmissionCount: 1,
      failedDownloadCount: 1,
    });

    expect(
      fs.readFileSync(path.join(outputDir, "submissions", "coder_1001", "submission-001.zip"))
    ).toEqual(fixtureServer.downloadBodies.get("submission-001"));
    expect(
      fs.existsSync(path.join(outputDir, "submissions", "coder_1002", "submission-002.zip"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(outputDir, "submissions", "coder_1003"))
    ).toBe(false);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(outputDir, "submissions", "coder_1002", "submission-002.json"),
          "utf8"
        )
      )
    ).toEqual([
      fixtureServer.reviewSummationPayloads[1],
      fixtureServer.reviewSummationPayloads[2],
    ]);

    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Failed to download submission submission-002 for member 1002.")
    );
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("Request failed for")
    );
    expect(stdout.write).toHaveBeenCalledWith(
      `Exported 2 submissions for 2 submitters to ${outputDir} ` +
        "(1 skipped without review summations, 1 archive downloads succeeded, 1 archive failures)\n"
    );
  });

  test("parseArgs requires challenge id and output directory", () => {
    expect(() => parseArgs(["--challenge-id", "challenge-123"])).toThrow(
      "--output-dir is required."
    );
    expect(() => parseArgs(["--output-dir", "/tmp/export"])).toThrow(
      "--challenge-id is required."
    );
  });
});
