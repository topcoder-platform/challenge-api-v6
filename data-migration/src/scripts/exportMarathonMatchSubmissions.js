#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const dotenv = require("dotenv");

dotenv.config({
  path: path.resolve(__dirname, "..", "..", "..", ".env.importer.local"),
  override: false,
  quiet: true,
});
dotenv.config({ quiet: true });

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_REVIEW_API_URL = String(
  process.env.REVIEW_API_URL || process.env.V6_API_URL || "https://api.topcoder.com/v6"
).trim();
const DEFAULT_CHALLENGE_API_URL = String(
  process.env.CHALLENGE_API_URL || `${DEFAULT_REVIEW_API_URL.replace(/\/+$/, "")}/challenges`
).trim();
const TOKEN_ENV_NAMES = ["M2M_TOKEN", "M2M_FULL_ACCESS_TOKEN", "TOPCODER_M2M_TOKEN"];

/**
 * Ensure a URL base ends with exactly one trailing slash so relative resource
 * paths can be appended safely with the WHATWG URL constructor.
 *
 * @param {string} value URL base to normalize.
 * @returns {string} URL base with one trailing slash.
 */
function ensureTrailingSlash(value) {
  return `${String(value || "").replace(/\/+$/, "")}/`;
}

/**
 * Join a relative resource path onto a base URL.
 *
 * @param {string} baseUrl Base URL for a collection or API root.
 * @param {string} resourcePath Relative path to append.
 * @returns {string} Fully-qualified URL string.
 */
function joinUrl(baseUrl, resourcePath) {
  return new URL(resourcePath, ensureTrailingSlash(baseUrl)).toString();
}

/**
 * Validate and normalize a positive integer CLI value.
 *
 * @param {string|number} value Raw CLI value.
 * @param {string} optionName Flag name used for error messages.
 * @returns {number} Normalized positive integer.
 */
function parsePositiveInteger(value, optionName) {
  const normalized = String(value || "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return Number.parseInt(normalized, 10);
}

/**
 * Read the next CLI token for an option that requires a value.
 *
 * @param {string[]} argv Raw argv entries.
 * @param {number} index Current option index.
 * @param {string} optionName Flag name used for error messages.
 * @returns {string} Raw option value.
 */
function requireNextValue(argv, index, optionName) {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return next;
}

/**
 * Parse the exporter CLI arguments.
 *
 * @param {string[]} argv CLI arguments excluding node/script names.
 * @returns {{
 *   challengeId: string | null,
 *   outputDir: string | null,
 *   challengeApiUrl: string,
 *   reviewApiUrl: string,
 *   pageSize: number,
 *   concurrency: number,
 *   help: boolean
 * }} Parsed options.
 */
function parseArgs(argv) {
  const options = {
    challengeId: null,
    outputDir: null,
    challengeApiUrl: DEFAULT_CHALLENGE_API_URL,
    reviewApiUrl: DEFAULT_REVIEW_API_URL,
    pageSize: DEFAULT_PAGE_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--challenge-id") {
      const value = String(requireNextValue(argv, index, "--challenge-id")).trim();
      if (!value) {
        throw new Error("--challenge-id requires a value");
      }
      options.challengeId = value;
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      const value = String(requireNextValue(argv, index, "--output-dir")).trim();
      if (!value) {
        throw new Error("--output-dir requires a value");
      }
      options.outputDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--challenge-api-url") {
      const value = String(requireNextValue(argv, index, "--challenge-api-url")).trim();
      if (!value) {
        throw new Error("--challenge-api-url requires a value");
      }
      options.challengeApiUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--review-api-url") {
      const value = String(requireNextValue(argv, index, "--review-api-url")).trim();
      if (!value) {
        throw new Error("--review-api-url requires a value");
      }
      options.reviewApiUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--page-size") {
      options.pageSize = parsePositiveInteger(
        requireNextValue(argv, index, "--page-size"),
        "--page-size"
      );
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      options.concurrency = parsePositiveInteger(
        requireNextValue(argv, index, "--concurrency"),
        "--concurrency"
      );
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help && !options.challengeId) {
    throw new Error("--challenge-id is required.");
  }
  if (!options.help && !options.outputDir) {
    throw new Error("--output-dir is required.");
  }

  return options;
}

const usage = `Usage:
  node data-migration/src/scripts/exportMarathonMatchSubmissions.js \\
    --challenge-id <challengeId> \\
    --output-dir <directory> [options]

Required options:
  --challenge-id <id>               Marathon Match challenge id to export
  --output-dir <dir>                Destination directory for metadata.json and submissions/

Optional overrides:
  --challenge-api-url <url>         Challenge API challenge-collection URL
                                    (default: CHALLENGE_API_URL or ${DEFAULT_CHALLENGE_API_URL})
  --review-api-url <url>            Review API root URL
                                    (default: REVIEW_API_URL/V6_API_URL or ${DEFAULT_REVIEW_API_URL})
  --page-size <n>                   Page size for submissions/review summations (default: ${DEFAULT_PAGE_SIZE})
  --concurrency <n>                 Concurrent submission downloads (default: ${DEFAULT_CONCURRENCY})
  --help                            Show this help

Authentication:
  The script reads a bearer token from the first populated env var in:
  ${TOKEN_ENV_NAMES.join(", ")}
`;

/**
 * Resolve the bearer token used for challenge and review API requests.
 *
 * @returns {string} Bearer token from the environment.
 */
function resolveAccessToken() {
  for (const envName of TOKEN_ENV_NAMES) {
    const value = String(process.env[envName] || "").trim();
    if (value) {
      return value;
    }
  }

  throw new Error(
    `A bearer token is required. Set one of these environment variables: ${TOKEN_ENV_NAMES.join(", ")}.`
  );
}

/**
 * Read a response body as diagnostic text without assuming JSON.
 *
 * @param {Response} response Fetch response object.
 * @returns {Promise<string>} Best-effort response payload for error reporting.
 */
async function readErrorBody(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();

  try {
    if (contentType.includes("application/json")) {
      return JSON.stringify(await response.json());
    }
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * Execute an authenticated HTTP request and fail with contextual details when
 * the API does not return a success response.
 *
 * @param {string} url Fully-qualified request URL.
 * @param {string} token Bearer token for Authorization.
 * @param {RequestInit} [init] Additional fetch options.
 * @returns {Promise<Response>} Successful fetch response.
 */
async function fetchWithAuth(url, token, init = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(init.headers || {}),
  };

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await readErrorBody(response);
    const suffix = body ? `: ${body}` : "";
    throw new Error(
      `Request failed for ${url} with ${response.status} ${response.statusText}${suffix}`
    );
  }

  return response;
}

/**
 * Execute an authenticated JSON request.
 *
 * @param {string} url Fully-qualified request URL.
 * @param {string} token Bearer token for Authorization.
 * @returns {Promise<any>} Parsed JSON payload.
 */
async function fetchJson(url, token) {
  const response = await fetchWithAuth(url, token, {
    headers: {
      Accept: "application/json",
    },
  });
  return response.json();
}

/**
 * Load every page from a review API collection endpoint that follows the
 * `{ data, meta }` pagination contract.
 *
 * @param {{
 *   apiUrl: string,
 *   resourcePath: string,
 *   query: Record<string, string | number | boolean | null | undefined>,
 *   token: string,
 *   pageSize: number
 * }} options Pagination inputs.
 * @returns {Promise<any[]>} Concatenated `data` rows across all pages.
 */
async function fetchPaginatedCollection(options) {
  const results = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL(joinUrl(options.apiUrl, options.resourcePath));
    Object.entries(options.query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    url.searchParams.set("page", String(page));
    url.searchParams.set("perPage", String(options.pageSize));

    const payload = await fetchJson(url.toString(), options.token);
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error(
        `Unexpected paginated response shape from ${url.toString()}. Expected a { data, meta } payload.`
      );
    }

    results.push(...payload.data);

    const reportedTotalPages = Number.parseInt(String(payload?.meta?.totalPages || ""), 10);
    if (Number.isFinite(reportedTotalPages) && reportedTotalPages > 0) {
      totalPages = reportedTotalPages;
    } else if (payload.data.length < options.pageSize) {
      totalPages = page;
    } else {
      totalPages = page + 1;
    }

    page += 1;
  } while (page <= totalPages);

  return results;
}

/**
 * Group review summations by submission id so each exported submission can be
 * paired with every final/provisional/example summation row returned by the API.
 *
 * @param {any[]} reviewSummations Raw review summation rows from the API.
 * @returns {Map<string, any[]>} Submission id -> review summations.
 */
function buildReviewSummationsBySubmissionId(reviewSummations) {
  const grouped = new Map();

  reviewSummations.forEach((reviewSummation) => {
    const submissionId = String(reviewSummation?.submissionId || "").trim();
    if (!submissionId) {
      return;
    }
    const existing = grouped.get(submissionId) || [];
    existing.push(reviewSummation);
    grouped.set(submissionId, existing);
  });

  return grouped;
}

/**
 * Serialize a JSON payload to disk with stable pretty-printing.
 *
 * @param {string} filePath Destination file.
 * @param {any} payload Value to serialize.
 * @returns {Promise<void>} Completion promise.
 */
async function writeJsonFile(filePath, payload) {
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Ensure the submission has the fields required to place it in the requested
 * `coder_{user id}` directory structure.
 *
 * @param {any} submission Submission payload returned by the review API.
 * @returns {{ submissionId: string, memberId: string }} Normalized identifiers.
 */
function normalizeSubmissionIdentity(submission) {
  const submissionId = String(submission?.id || "").trim();
  const memberId = String(submission?.memberId || "").trim();

  if (!submissionId) {
    throw new Error("Encountered a submission without an id in the review API response.");
  }
  if (!memberId) {
    throw new Error(
      `Submission ${submissionId} is missing memberId; cannot place it into coder_{user id}.`
    );
  }

  return { submissionId, memberId };
}

/**
 * Convert a fetch response body into a Node.js readable stream for file output.
 *
 * @param {Response} response Fetch response with a binary body.
 * @returns {Readable} Node.js readable stream.
 */
function toNodeReadable(response) {
  if (!response.body) {
    throw new Error("Download response did not include a body.");
  }
  return Readable.fromWeb(response.body);
}

/**
 * Download one submission archive into the target export directory.
 *
 * @param {{
 *   reviewApiUrl: string,
 *   token: string,
 *   submissionId: string,
 *   filePath: string
 * }} options Download settings.
 * @returns {Promise<void>} Completion promise.
 */
async function downloadSubmissionArchive(options) {
  const downloadUrl = joinUrl(
    options.reviewApiUrl,
    `submissions/${encodeURIComponent(options.submissionId)}/download`
  );
  const response = await fetchWithAuth(downloadUrl, options.token);
  await pipeline(toNodeReadable(response), fs.createWriteStream(options.filePath));
}

/**
 * Execute an async mapper with a fixed concurrency limit so large Marathon
 * Matches can export faster without overwhelming the API.
 *
 * @template T
 * @param {T[]} items Items to process.
 * @param {number} concurrency Maximum concurrent workers.
 * @param {(item: T, index: number) => Promise<void>} worker Async item processor.
 * @returns {Promise<void>} Completion promise once all items succeed.
 */
async function mapWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) {
        return;
      }
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

/**
 * Export challenge metadata, submission archives, and per-submission review
 * summation JSON into the requested directory layout.
 *
 * @param {{
 *   challengeId: string,
 *   outputDir: string,
 *   challengeApiUrl?: string,
 *   reviewApiUrl?: string,
 *   token: string,
 *   pageSize?: number,
 *   concurrency?: number,
 *   stdout?: { write: (chunk: string) => void },
 *   stderr?: { write: (chunk: string) => void }
 * }} options Export settings.
 * @returns {Promise<{
 *   outputDir: string,
 *   metadataPath: string,
 *   submissionsDir: string,
 *   exportedSubmissionCount: number,
 *   exportedSubmitterCount: number,
 *   reviewSummationCount: number,
 *   skippedSubmissionCountWithoutReviewSummation: number,
 *   downloadedSubmissionCount: number,
 *   failedDownloadCount: number
 * }>} Export summary.
 */
async function runExport(options) {
  const challengeId = String(options.challengeId || "").trim();
  const outputDir = path.resolve(String(options.outputDir || "").trim());
  const challengeApiUrl = String(options.challengeApiUrl || DEFAULT_CHALLENGE_API_URL).trim();
  const reviewApiUrl = String(options.reviewApiUrl || DEFAULT_REVIEW_API_URL).trim();
  const token = String(options.token || "").trim();
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;

  if (!challengeId) {
    throw new Error("challengeId is required.");
  }
  if (!outputDir) {
    throw new Error("outputDir is required.");
  }
  if (!token) {
    throw new Error("token is required.");
  }

  stdout.write(`Exporting Marathon Match ${challengeId} to ${outputDir}\n`);

  const challengeUrl = joinUrl(challengeApiUrl, encodeURIComponent(challengeId));
  const [challenge, submissions, reviewSummations] = await Promise.all([
    fetchJson(challengeUrl, token),
    fetchPaginatedCollection({
      apiUrl: reviewApiUrl,
      resourcePath: "submissions",
      query: { challengeId },
      token,
      pageSize,
    }),
    fetchPaginatedCollection({
      apiUrl: reviewApiUrl,
      resourcePath: "reviewSummations",
      query: { challengeId, metadata: true },
      token,
      pageSize,
    }),
  ]);

  const reviewSummationsBySubmissionId = buildReviewSummationsBySubmissionId(reviewSummations);
  const exportableSubmissions = submissions.filter((submission) => {
    const submissionId = String(submission?.id || "").trim();
    return submissionId && reviewSummationsBySubmissionId.has(submissionId);
  });
  const skippedSubmissionCountWithoutReviewSummation =
    submissions.length - exportableSubmissions.length;
  const metadataPath = path.join(outputDir, "metadata.json");
  const submissionsDir = path.join(outputDir, "submissions");
  const submitterIds = new Set();
  let downloadedSubmissionCount = 0;
  let failedDownloadCount = 0;

  await fs.promises.mkdir(submissionsDir, { recursive: true });
  await writeJsonFile(metadataPath, challenge);

  await mapWithConcurrency(exportableSubmissions, concurrency, async (submission) => {
    const { submissionId, memberId } = normalizeSubmissionIdentity(submission);
    submitterIds.add(memberId);

    const submitterDir = path.join(submissionsDir, `coder_${memberId}`);
    await fs.promises.mkdir(submitterDir, { recursive: true });

    await writeJsonFile(
      path.join(submitterDir, `${submissionId}.json`),
      reviewSummationsBySubmissionId.get(submissionId) || []
    );

    try {
      await downloadSubmissionArchive({
        reviewApiUrl,
        token,
        submissionId,
        filePath: path.join(submitterDir, `${submissionId}.zip`),
      });
      downloadedSubmissionCount += 1;
    } catch (error) {
      failedDownloadCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(
        `Failed to download submission ${submissionId} for member ${memberId}. ${message}\n`
      );
    }
  });

  stdout.write(
    `Exported ${exportableSubmissions.length} submissions for ${submitterIds.size} submitters to ${outputDir} ` +
      `(${skippedSubmissionCountWithoutReviewSummation} skipped without review summations, ` +
      `${downloadedSubmissionCount} archive downloads succeeded, ` +
      `${failedDownloadCount} archive failures)\n`
  );

  return {
    outputDir,
    metadataPath,
    submissionsDir,
    exportedSubmissionCount: exportableSubmissions.length,
    exportedSubmitterCount: submitterIds.size,
    reviewSummationCount: reviewSummations.length,
    skippedSubmissionCountWithoutReviewSummation,
    downloadedSubmissionCount,
    failedDownloadCount,
  };
}

/**
 * CLI entrypoint for the Marathon Match submission exporter.
 *
 * @returns {Promise<void>} Completion promise.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  await runExport({
    ...options,
    token: resolveAccessToken(),
  });
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CHALLENGE_API_URL,
  DEFAULT_CONCURRENCY,
  DEFAULT_PAGE_SIZE,
  DEFAULT_REVIEW_API_URL,
  TOKEN_ENV_NAMES,
  buildReviewSummationsBySubmissionId,
  main,
  parseArgs,
  resolveAccessToken,
  runExport,
  usage,
};
