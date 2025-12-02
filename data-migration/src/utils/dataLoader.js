const fs = require('fs');
const path = require('path');
const JSONStream = require('JSONStream');
const es = require('event-stream');
const config = require('../config');
const isDebugLog = (config.LOG_VERBOSITY || '').toLowerCase() === 'debug';
const summaryLimit = Number.isFinite(config.SUMMARY_LOG_LIMIT)
  ? Math.max(0, config.SUMMARY_LOG_LIMIT)
  : 5;
const exampleLimit = summaryLimit || 5;

const BEHAVIOR_MAP = {
  skip: { warn: false, include: false, strategy: 'skip' },
  include: { warn: false, include: true, strategy: 'include' },
  'warn-and-skip': { warn: true, include: false, strategy: 'warn-and-skip' },
  'warn-and-include': { warn: true, include: true, strategy: 'warn-and-include' }
};

const parseBehavior = (behavior) => {
  const normalized = (behavior || '').toLowerCase().trim();
  return BEHAVIOR_MAP[normalized] || BEHAVIOR_MAP.skip;
};

const getRecordIdentifier = (record) => {
  if (!record || typeof record !== 'object') {
    return 'unknown';
  }
  const candidateKeys = ['id', 'challengeId', 'legacyId', 'name', 'slug', 'referenceId'];
  for (const key of candidateKeys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return 'unknown';
};
/**
 * Load and parse JSON data from a file
 * @param {string} dataDir Directory containing data files
 * @param {string} fileName Name of the file to load
 * @param {boolean} isElasticsearch Whether the file is in Elasticsearch format
 * @param {string|null} sinceDate Optional ISO date string to filter records updated after this date
 * @returns {Array} Parsed JSON data, filtered when sinceDate is provided
 */
async function loadData(dataDir, fileName, isElasticsearch = false, sinceDate = null) {
  const filePath = path.join(dataDir, fileName);

  const hasSinceDate = sinceDate !== null && sinceDate !== undefined;
  let sinceDateTimestamp = null;

  if (hasSinceDate) {
    const parsedSinceDate = new Date(sinceDate);
    if (Number.isNaN(parsedSinceDate.getTime())) {
      console.warn(`Invalid sinceDate provided to loadData for ${fileName}: ${sinceDate}`);
    } else {
      sinceDateTimestamp = parsedSinceDate.getTime();
    }
  }

  const dateFieldPriority = Array.isArray(config.INCREMENTAL_DATE_FIELDS) && config.INCREMENTAL_DATE_FIELDS.length
    ? config.INCREMENTAL_DATE_FIELDS
    : ['updatedAt', 'updated'];

  const missingDateBehavior = parseBehavior(config.MISSING_DATE_FIELD_BEHAVIOR);
  const invalidDateBehavior = parseBehavior(config.INVALID_DATE_FIELD_BEHAVIOR);
  const hasValidSinceDate = hasSinceDate && sinceDateTimestamp !== null;

  let missingDateFieldCount = 0;
  let missingDateIncludedCount = 0;
  let missingDateSkippedCount = 0;
  const missingDateExamples = [];

  let invalidDateFieldCount = 0;
  let invalidDateIncludedCount = 0;
  let invalidDateSkippedCount = 0;
  const invalidDateExamples = [];

  let futureDateCount = 0;
  let ancientDateCount = 0;
  const futureDateExamples = [];
  const ancientDateExamples = [];

  let parseErrorCount = 0;

  const dateFieldUsageAll = new Map();
  const dateFieldUsageIncluded = new Map();
  const dateHistogram = new Map();

  let minTimestamp = null;
  let maxTimestamp = null;

  let recordsWithAllDateFields = 0;
  let recordsWithSingleDateField = 0;
  let recordsWithNoDateFields = 0;

  const evaluateRecord = (record) => {
    const outcome = { include: true, usedField: null, parsedDate: null, reason: null };
    const recordIdentifier = getRecordIdentifier(record);

    const availableFields = [];
    if (record && typeof record === 'object') {
      for (const field of dateFieldPriority) {
        if (record[field] !== undefined && record[field] !== null) {
          availableFields.push(field);
        }
      }
    }

    if (availableFields.length === dateFieldPriority.length && availableFields.length > 0) {
      recordsWithAllDateFields += 1;
    } else if (availableFields.length > 0) {
      recordsWithSingleDateField += 1;
    } else {
      recordsWithNoDateFields += 1;
    }

    const usedField = availableFields[0] || null;
    if (!usedField) {
      missingDateFieldCount += 1;
      if (missingDateExamples.length < exampleLimit) {
        missingDateExamples.push(recordIdentifier);
      }
      if (missingDateBehavior.warn) {
        console.warn(`${fileName}: record ${recordIdentifier} missing date fields (${dateFieldPriority.join(', ')}); strategy=${missingDateBehavior.strategy}`);
      }
      if (missingDateBehavior.include) {
        missingDateIncludedCount += 1;
        return outcome;
      }
      missingDateSkippedCount += 1;
      outcome.include = false;
      outcome.reason = 'missing-date';
      return outcome;
    }

    outcome.usedField = usedField;
    const recordDateValue = record[usedField];
    const parsedDate = new Date(recordDateValue);
    if (Number.isNaN(parsedDate.getTime())) {
      invalidDateFieldCount += 1;
      if (invalidDateExamples.length < exampleLimit) {
        invalidDateExamples.push({ id: recordIdentifier, value: recordDateValue });
      }
      if (invalidDateBehavior.warn) {
        console.warn(`${fileName}: record ${recordIdentifier} has invalid date "${recordDateValue}" in field ${usedField}; strategy=${invalidDateBehavior.strategy}`);
      }
      if (invalidDateBehavior.include) {
        invalidDateIncludedCount += 1;
        return outcome;
      }
      invalidDateSkippedCount += 1;
      outcome.include = false;
      outcome.reason = 'invalid-date';
      return outcome;
    }

    outcome.parsedDate = parsedDate;
    const nowTimestamp = Date.now();
    let suspiciousReason = null;

    if (parsedDate.getTime() > nowTimestamp) {
      futureDateCount += 1;
      suspiciousReason = 'future-date';
      if (futureDateExamples.length < exampleLimit) {
        futureDateExamples.push({ id: recordIdentifier, value: parsedDate.toISOString() });
      }
    }

    if (parsedDate.getFullYear() < 2000) {
      ancientDateCount += 1;
      suspiciousReason = suspiciousReason ? `${suspiciousReason}|ancient-date` : 'ancient-date';
      if (ancientDateExamples.length < exampleLimit) {
        ancientDateExamples.push({ id: recordIdentifier, value: parsedDate.toISOString() });
      }
    }

    if (suspiciousReason) {
      if (invalidDateBehavior.warn) {
        console.warn(`${fileName}: record ${recordIdentifier} has ${suspiciousReason.replace(/\|/g, ' & ')} (${parsedDate.toISOString()}); strategy=${invalidDateBehavior.strategy}`);
      }
      if (!invalidDateBehavior.include) {
        invalidDateSkippedCount += 1;
        outcome.include = false;
        outcome.reason = suspiciousReason;
        return outcome;
      }
      invalidDateIncludedCount += 1;
    }

    if (hasValidSinceDate && parsedDate.getTime() < sinceDateTimestamp) {
      outcome.include = false;
      outcome.reason = 'out-of-window';
    }

    return outcome;
  };

  try {
    let totalRecordsEncountered = 0;
    let recordsAfterFilter = 0;

    const processRecord = (record, resultsArray) => {
      totalRecordsEncountered += 1;
      const evaluation = evaluateRecord(record);

      if (evaluation.usedField) {
        dateFieldUsageAll.set(evaluation.usedField, (dateFieldUsageAll.get(evaluation.usedField) || 0) + 1);
      }

      if (evaluation.include) {
        resultsArray.push(record);
        recordsAfterFilter += 1;

        if (evaluation.usedField) {
          dateFieldUsageIncluded.set(evaluation.usedField, (dateFieldUsageIncluded.get(evaluation.usedField) || 0) + 1);
        }

        if (evaluation.parsedDate) {
          const timestamp = evaluation.parsedDate.getTime();
          if (minTimestamp === null || timestamp < minTimestamp) {
            minTimestamp = timestamp;
          }
          if (maxTimestamp === null || timestamp > maxTimestamp) {
            maxTimestamp = timestamp;
          }
          const dayKey = evaluation.parsedDate.toISOString().slice(0, 10);
          dateHistogram.set(dayKey, (dateHistogram.get(dayKey) || 0) + 1);
        }
      }
    };

    const logFilteringSummary = () => {
      const filteredOut = totalRecordsEncountered - recordsAfterFilter;

      if (hasValidSinceDate) {
        console.info(`Filtered ${fileName}: ${recordsAfterFilter}/${totalRecordsEncountered} records (${filteredOut} filtered out) since ${sinceDate}`);
      } else if (hasSinceDate && !hasValidSinceDate) {
        console.info(`Loaded ${fileName}: ${recordsAfterFilter}/${totalRecordsEncountered} records (invalid sinceDate provided, no filtering applied)`);
      } else {
        console.info(`Loaded ${fileName}: ${totalRecordsEncountered} records (no date filter)`);
      }

      if (recordsAfterFilter === 0) {
        console.warn(`${fileName}: no records matched the provided date filter.`);
      } else if (hasValidSinceDate && filteredOut === 0) {
        console.warn(`${fileName}: 100% of records matched the incremental filter; validate INCREMENTAL_SINCE_DATE (${sinceDate}).`);
      }

      if (missingDateFieldCount > 0) {
        const examples = exampleLimit > 0 ? missingDateExamples.slice(0, exampleLimit).join(', ') : 'none';
        console.warn(`${fileName}: ${missingDateFieldCount} records missing date fields (${missingDateBehavior.strategy}); included=${missingDateIncludedCount}, skipped=${missingDateSkippedCount}. Examples: ${examples}`);
      }

      if (invalidDateFieldCount > 0 || invalidDateSkippedCount > 0) {
        const invalidExamples = exampleLimit > 0
          ? invalidDateExamples.slice(0, exampleLimit).map(example => `${example.id}:${example.value}`).join(', ')
          : 'none';
        console.warn(`${fileName}: ${invalidDateFieldCount} records with invalid date values; included=${invalidDateIncludedCount}, skipped=${invalidDateSkippedCount}. Examples: ${invalidExamples}`);
      }

      if (futureDateCount > 0) {
        const futureExamples = exampleLimit > 0
          ? futureDateExamples.slice(0, exampleLimit).map(example => `${example.id}:${example.value}`).join(', ')
          : 'none';
        console.warn(`${fileName}: ${futureDateCount} records have future timestamps. Examples: ${futureExamples}`);
      }
      if (ancientDateCount > 0) {
        const ancientExamples = exampleLimit > 0
          ? ancientDateExamples.slice(0, exampleLimit).map(example => `${example.id}:${example.value}`).join(', ')
          : 'none';
        console.warn(`${fileName}: ${ancientDateCount} records have timestamps before the year 2000. Examples: ${ancientExamples}`);
      }

      if (dateFieldUsageIncluded.size) {
        let includedSummaryEntries = Array.from(dateFieldUsageIncluded.entries())
          .map(([field, count]) => `${field}=${count}`);
        let includedSummaryNote = '';
        if (!isDebugLog && summaryLimit > 0 && includedSummaryEntries.length > summaryLimit) {
          includedSummaryEntries = includedSummaryEntries.slice(0, summaryLimit);
          includedSummaryNote = ' (truncated)';
        }
        if (isDebugLog || summaryLimit > 0) {
          console.info(`${fileName}: date fields used for included records -> ${includedSummaryEntries.join(', ') || 'none'}${includedSummaryNote}`);
        }
      }

      if (dateFieldUsageAll.size && isDebugLog) {
        const allSummary = Array.from(dateFieldUsageAll.entries())
          .map(([field, count]) => `${field}=${count}`)
          .join(', ');
        console.info(`${fileName}: date fields present in source data -> ${allSummary}`);
      }

      console.info(`${fileName}: records with all date fields=${recordsWithAllDateFields}, partial=${recordsWithSingleDateField}, none=${recordsWithNoDateFields}`);

      if (minTimestamp !== null && maxTimestamp !== null) {
        console.info(`${fileName}: processed date range ${new Date(minTimestamp).toISOString()} to ${new Date(maxTimestamp).toISOString()}`);
      }

      if (dateHistogram.size && (isDebugLog || summaryLimit > 0)) {
        const histogramSummary = Array.from(dateHistogram.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, summaryLimit || 7)
          .map(([day, count]) => `${day}=${count}`)
          .join(', ');
        const histogramNote = !isDebugLog && dateHistogram.size > summaryLimit ? ' (truncated)' : '';
        console.info(`${fileName}: daily distribution${summaryLimit ? ` (top ${summaryLimit})` : ''} -> ${histogramSummary}${histogramNote}`);
      }

      if (parseErrorCount > 0) {
        console.warn(`${fileName}: ${parseErrorCount} lines skipped due to JSON parse errors.`);
      }
    };

    if (isElasticsearch) {
      const results = [];
      const fileStream = fs.createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 1024 * 1024
      });

      return new Promise((resolve, reject) => {
        let buffer = '';
        let isFirstChunk = true;
        let lineNumber = 0;

        fileStream.on('data', (chunk) => {
          buffer += chunk;
          if (isFirstChunk) {
            buffer = buffer.replace(/^\uFEFF/, '');
            isFirstChunk = false;
          }
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            lineNumber += 1;
            const trimmed = line.trim();
            if (!trimmed) {
              continue;
            }

            let parsedLine;
            try {
              parsedLine = JSON.parse(trimmed);
            } catch (error) {
              parseErrorCount += 1;
              console.warn(`Skipping malformed JSON in ${fileName} at line ${lineNumber}: ${error.message}`);
              continue;
            }

            if (!parsedLine || parsedLine._source === undefined) {
              continue;
            }

            processRecord(parsedLine._source, results);
          }
        });

        fileStream.on('end', () => {
          if (buffer) {
            lineNumber += 1;
            const trimmed = buffer.trim();
            if (trimmed) {
              let parsedLine;
              try {
                parsedLine = JSON.parse(trimmed);
              } catch (error) {
                parseErrorCount += 1;
                console.warn(`Skipping malformed JSON in ${fileName} at line ${lineNumber}: ${error.message}`);
                parsedLine = null;
              }

              if (parsedLine && parsedLine._source !== undefined) {
                processRecord(parsedLine._source, results);
              }
            }
          }

          logFilteringSummary();
          resolve(results);
        });

        fileStream.on('error', (error) => {
          reject(error);
        });
      });
    }

    return new Promise((resolve, reject) => {
      const results = [];
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(JSONStream.parse('*'))
        .pipe(es.through(function(data) {
          processRecord(data, results);
        }));

      stream.on('end', () => {
        logFilteringSummary();
        resolve(results);
      });
      stream.on('error', (err) => reject(err));
    });
  } catch (error) {
    console.error(`Error loading data from ${filePath}:`, error.message);
    return [];
  }
}
module.exports = { loadData };
