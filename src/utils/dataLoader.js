const fs = require('fs');
const path = require('path');
const JSONStream = require('JSONStream');
const es = require('event-stream');
/**
 * Load and parse JSON data from a file
 * @param {string} dataDir Directory containing data files
 * @param {string} fileName Name of the file to load
 * @param {boolean} isElasticsearch Whether the file is in Elasticsearch format
 * @returns {Array} Parsed JSON data
 */
async function loadData(dataDir, fileName, isElasticsearch = false) {
  const filePath = path.join(dataDir, fileName);
  
  try {
    if (isElasticsearch) {
      // For Elasticsearch format (line-delimited JSON)
      const results = [];
      const fileStream = fs.createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 1024 * 1024 // 1MB chunks
      });
      
      return new Promise((resolve, reject) => {
        let buffer = '';
        
        fileStream.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          // Keep the last line in the buffer as it might be incomplete
          buffer = lines.pop();
          
          for (const line of lines) {
            if (line.trim()) {
              results.push(JSON.parse(line)._source);
            }
          }
        });
        
        fileStream.on('end', () => {
          // Process the last line if needed
          if (buffer.trim()) {
            results.push(JSON.parse(buffer)._source);
          }
          resolve(results);
        });
        
        fileStream.on('error', (error) => {
          reject(error);
        });
      });
    } else {
      // For regular JSON files, use JSONStream
      return new Promise((resolve, reject) => {
        const results = [];
        const stream = fs.createReadStream(filePath, {encoding: 'utf8'})
          .pipe(JSONStream.parse('*')) // Parse all items in the array
          .pipe(es.through(function(data) {
            results.push(data);
          }));
        
        stream.on('end', () => resolve(results));
        stream.on('error', (err) => reject(err));
      });
    }
  } catch (error) {
    console.error(`Error loading data from ${filePath}:`, error.message);
    return [];
  }
}
module.exports = { loadData };