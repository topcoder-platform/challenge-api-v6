const fs = require('fs');
const path = require('path');
const JSONStream = require('JSONStream');
const es = require('event-stream');
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

  let missingDateFieldCount = 0;
  let invalidDateFieldCount = 0;
  let parseErrorCount = 0;

  const shouldIncludeRecord = (record, sinceDateValue) => {
    if (!sinceDateValue || sinceDateTimestamp === null) {
      return true;
    }

    if (!record || typeof record !== 'object') {
      missingDateFieldCount += 1;
      return false;
    }

    let recordDateValue = null;
    if (record.updatedAt !== undefined && record.updatedAt !== null) {
      recordDateValue = record.updatedAt;
    } else if (record.updated !== undefined && record.updated !== null) {
      recordDateValue = record.updated;
    }

    if (recordDateValue === null || recordDateValue === undefined) {
      missingDateFieldCount += 1;
      return false;
    }

    const parsedRecordDate = new Date(recordDateValue);
    if (Number.isNaN(parsedRecordDate.getTime())) {
      invalidDateFieldCount += 1;
      return false;
    }

    return parsedRecordDate.getTime() >= sinceDateTimestamp;
  };

  try {
    let totalRecordsEncountered = 0;
    let recordsAfterFilter = 0;

    const logFilteringSummary = () => {
      const filteredOut = totalRecordsEncountered - recordsAfterFilter;

      if (hasSinceDate && sinceDateTimestamp !== null) {
        console.info(`Filtered ${fileName}: ${recordsAfterFilter}/${totalRecordsEncountered} records (${filteredOut} filtered out) since ${sinceDate}`);
        if (missingDateFieldCount > 0) {
          console.warn(`${fileName}: ${missingDateFieldCount} records skipped due to missing updatedAt/updated fields while applying sinceDate ${sinceDate}`);
        }
        if (invalidDateFieldCount > 0) {
          console.warn(`${fileName}: ${invalidDateFieldCount} records skipped due to invalid date values while applying sinceDate ${sinceDate}`);
        }
      } else if (hasSinceDate && sinceDateTimestamp === null) {
        console.info(`Loaded ${fileName}: ${recordsAfterFilter}/${totalRecordsEncountered} records (invalid sinceDate provided, no filtering applied)`);
      } else {
        console.info(`Loaded ${fileName}: ${totalRecordsEncountered} records (no date filter)`);
      }

      if (parseErrorCount > 0) {
        console.warn(`${fileName}: ${parseErrorCount} lines skipped due to JSON parse errors.`);
      }
    };

    if (isElasticsearch) {
      // For Elasticsearch format (line-delimited JSON)
      const results = [];
      const fileStream = fs.createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 1024 * 1024 // 1MB chunks
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
          // Keep the last line in the buffer as it might be incomplete
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

            const record = parsedLine._source;
            totalRecordsEncountered += 1;

            if (shouldIncludeRecord(record, sinceDate)) {
              results.push(record);
              recordsAfterFilter += 1;
            }
          }
        });

        fileStream.on('end', () => {
          // Process the last line if needed
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
                const record = parsedLine._source;
                totalRecordsEncountered += 1;

                if (shouldIncludeRecord(record, sinceDate)) {
                  results.push(record);
                  recordsAfterFilter += 1;
                }
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

    // For regular JSON files, use JSONStream
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(JSONStream.parse('*')) // Parse all items in the array
        .pipe(es.through(function(data) {
          totalRecordsEncountered += 1;

          if (shouldIncludeRecord(data, sinceDate)) {
            results.push(data);
            recordsAfterFilter += 1;
          }
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
