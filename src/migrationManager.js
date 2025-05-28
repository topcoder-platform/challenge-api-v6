const { PrismaClient, Prisma } = require('@prisma/client');
const config = require('./config');
const fs = require('fs');
const path = require('path');

/**
 * Core migration manager that orchestrates the migration process
 */
class MigrationManager {
  constructor(userConfig = {}) {
    // Merge default config with user-provided config
    this.config = {
      ...config,
      ...userConfig,
      defaultValues: {
        ...config.defaultValues,
        ...(userConfig.defaultValues || {})
      }
    };
    
    this.prisma = userConfig.prismaClient || new PrismaClient({
      datasources: {
        db: {
          url: this.config.DATABASE_URL
        }
      }
    });
    
    this.dependencies = {};
    // this.logger = this.createLogger(this.config.LOG_LEVEL);
    this.logger = this.createLogger(this.config.LOG_LEVEL, this.config.LOG_FILE || 'migration.log');
    this.migrators = [];
  }
  
  /**
   * Create a logger based on configured log level
   */
  createLogger(level, logFilePath) {
    const noop = () => {};
    const levels = ['error', 'warn', 'info', 'debug'];
    const logLevel = levels.indexOf(level);
    
    // Ensure log directory exists
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Create a write stream to the log file
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    
    // Helper to log to both console and file
    const logToConsoleAndFile = (consoleMethod, level) => (message, ...args) => {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [${level}] ${message}`;
      
      // Log to console
      consoleMethod(logMessage, ...args);
      
      // Format args for file logging
      let argsString = '';
      if (args.length) {
        argsString = args.map(arg => {
          if (arg instanceof Error) {
            return arg.stack || arg.message;
          }
          return typeof arg === 'object' ? JSON.stringify(arg) : arg;
        }).join(' ');
      }
      
      try {
        if (logStream && !logStream.writableStream) {
          logStream.write(`${logMessage} ${argsString}\n`);
        }
      } catch (err) {
        console.error('Error writing to log:', err);
      }
    };
    
    return {
      error: logLevel >= 0 ? logToConsoleAndFile(console.error, 'ERROR') : noop,
      warn: logLevel >= 1 ? logToConsoleAndFile(console.warn, 'WARN') : noop,
      info: logLevel >= 2 ? logToConsoleAndFile(console.log, 'INFO') : noop,
      debug: logLevel >= 3 ? logToConsoleAndFile(console.log, 'DEBUG') : noop,
      // Close the file stream
      close: () => logStream.end()
    };
  }
  
  /**
   * Register a migrator
   * @param {Object} migrator The migrator to register
   */
  registerMigrator(migrator) {
    migrator.setManager(this);
    this.migrators.push(migrator);
    return this;
  }
  
  /**
   * Register valid IDs for a specific model to track dependencies
   */
  registerDependency(modelName, validIds) {
    this.dependencies[modelName] = validIds;
    this.logger.debug(`Registered ${validIds.size} valid IDs for ${modelName}`);
  }
  
  /**
   * Check if a dependency relationship is valid
   */
  isValidDependency(dependencyModel, id) {
    return this.dependencies[dependencyModel]?.has(id) || false;
  }

  /**
   * Stores nested data for a specific model
   * @param {String} modelName 
   * @param {Object} data 
   */
  storeNestedData(modelName, data) {
    this.nestedData = this.nestedData || {};
    this.nestedData[modelName] = this.nestedData[modelName] || [];
    
    if (Array.isArray(data)) {
      this.nestedData[modelName].push(...data);
    } else {
      this.nestedData[modelName].push(data);
    }
  }

  /**
   * Retrieves nested data for a specific model
   * @param {String} modelName
   * @returns {Array} Nested data for the model
   */
  getNestedData(modelName) {
    return (this.nestedData && this.nestedData[modelName]) || [];
  }
  
  /**
   * Handle missing field based on configuration
   * @param {string} modelName The model name
   * @param {string} fieldName The field name
   * @param {Object} record The record being processed
   * @returns {any} The default value or Prisma.skip
   */
  handleMissing(modelName, fieldName, record) {
    const idField = this.config.migrator?.[modelName]?.idField || 'id';
    const recordId = record[idField] || 'unknown';
    
    // Check if field is required
    const isRequired = this.config.migrator?.[modelName]?.requiredFields?.includes(fieldName);
    
    // For required fields, check if global skip flag is set
    if (this.config.SKIP_MISSING_REQUIRED && isRequired) {
      this.logger.warn(`[id: ${recordId}] Global skip flag set, skipping missing required field ${modelName}.${fieldName}`);
      return Prisma.skip;
    }
    
    // Check if field has a schema default (from Prisma schema)
    const hasSchemaDefault = this.config.migrator?.[modelName]?.hasDefaults?.includes(fieldName);
    
    // If field has a schema default, use Prisma.skip to trigger Prisma's default
    if (hasSchemaDefault) {
      this.logger.debug(`[id: ${recordId}] Field ${modelName}.${fieldName} has schema default, using Prisma.skip to trigger default`);
      return Prisma.skip; // For PostgreSQL, this will trigger the schema default
    }
    
    // Check if there's a default value configured for this field
    if (this.config.migrator?.[modelName]?.defaultValues?.[fieldName] !== undefined) {
      const defaultValue = this.config.migrator?.[modelName]?.defaultValues?.[fieldName];
      this.logger.debug(`[id: ${recordId}] Using configured default value for ${modelName}.${fieldName}: ${defaultValue}`);
      return defaultValue;
    }
    
    // For optional fields (not required), use Prisma.skip to omit from query
    if (!isRequired) {
      this.logger.debug(`[id: ${recordId}] Field ${modelName}.${fieldName} is optional, using Prisma.skip`);
      return Prisma.skip; // For PostgreSQL, this will omit the field from the query
    }
    
    // No default and not configured to skip, log error and return Prisma.skip
    this.logger.error(`[id: ${recordId}] Missing required field ${modelName}.${fieldName} with no default value, skipping record`);
    return Prisma.skip;
  }
  
  /**
  * Process records in batches
  */
  async processBatch(records, processFn) {
    const batchSize = this.config.BATCH_SIZE;
    let processed = 0;
    let skipped = 0;

    // Create batches
    const batches = [];
    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }

    // Process batches in parallel with a concurrency limit
    const concurrencyLimit = this.config.CONCURRENCY_LIMIT || 10;
    const results = [];

    for (let i = 0; i < batches.length; i += concurrencyLimit) {
      const batchGroup = batches.slice(i, i + concurrencyLimit);
      const batchPromises = batchGroup.map(batch => {
      const uniqueTracker = new Map();
      
      if (this.config.USE_TRANSACTIONS) {
        return this.prisma.$transaction(tx => processFn(batch, tx, uniqueTracker));
      } else {
        return processFn(batch, this.prisma, uniqueTracker);
      }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    // Aggregate results
    for (const result of results) {
      processed += result.processed || 0;
      skipped += result.skipped || 0;
    }

    return { processed, skipped };
  }
  
  /**
  * Run the complete migration process
  */
  async migrate() {
      const startTime = Date.now();
      const stats = {
        totalProcessed: 0,
        totalSkipped: 0,
        modelStats: {},
        startTime: new Date(),
        endTime: null,
        duration: 0
      };
  
    try {
      this.logger.info('Starting migration process...');
      
      // Sort migrators by priority
      this.migrators.sort((a, b) => a.priority - b.priority);
      
      // Execute migrations in order
      for (const migrator of this.migrators) {
        const migratorStats = await migrator.migrate();
        
        // Collect statistics
        stats.totalProcessed += migratorStats.processed || 0;
        stats.totalSkipped += migratorStats.skipped || 0;
        stats.modelStats[migrator.modelName] = migratorStats;
      }
      
      stats.endTime = new Date();
      stats.duration = Date.now() - startTime;
      
      // Display migration statistics
      this.displayMigrationStats(stats);
      
      this.logger.info('Migration completed successfully!');
      return stats;
    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw error;
    } finally {
      // Close the logger
      this.logger.close();
      
      // Only disconnect if we created the client
      if (!this.config.prismaClient) {
        await this.prisma.$disconnect();
      }
    }
  }
  
  /**
   * Display migration statistics
   * @param {Object} stats Migration statistics
   */
  displayMigrationStats(stats) {
    this.logger.info('\n=== Migration Statistics ===');
    this.logger.info(`Total records processed: ${stats.totalProcessed}`);
    this.logger.info(`Total records skipped: ${stats.totalSkipped}`);
    this.logger.info(`Total duration: ${stats.duration}ms`);
    
    this.logger.info('\nModel-specific statistics:');
    for (const [modelName, modelStats] of Object.entries(stats.modelStats)) {
      this.logger.info(`  ${modelName}:`);
      this.logger.info(`    Processed: ${modelStats.processed || 0}`);
      this.logger.info(`    Skipped: ${modelStats.skipped || 0}`);
      
      if (modelStats.errors && modelStats.errors.length > 0) {
        this.logger.info(`    Errors: ${modelStats.errors.length}`);
      }
    }
    this.logger.info('===========================\n');
  }
}

module.exports = { MigrationManager };