const { loadData } = require('../utils/dataLoader');
const { MigrationManager } = require('../migrationManager')
const { Prisma } = require('@prisma/client');

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/**
 * Base migrator class that all model migrators extend
 */
class BaseMigrator {
  constructor(modelName, priority = 2, isElasticsearch = false) {
    this.modelName = modelName;
    this.queryName = this.modelName.charAt(0).toLowerCase() + this.modelName.slice(1);
    this.manager = new MigrationManager();
    this.priority = this.getPriority() || priority;
    this.isElasticsearch = isElasticsearch;
    this.requiredFields = this.manager.config.migrator?.[this.modelName]?.requiredFields || [];
    this.optionalFields = this.manager.config.migrator?.[this.modelName]?.optionalFields || [];
    this.validIds = new Set();
  }
  
  /**
   * Set the migration manager
   * @param {MigrationManager} manager The migration manager
   */
  setManager(manager) {
    this.manager = manager;
  }

  /**
   * Get the file name of the data for this migrator
   * @returns {string} The file name
   */
  getFileName() {
    return this.manager.config.migrator?.[this.modelName]?.filename;
  }
  
  /**
   * Load data for this migrator
   * @returns {Array} The loaded data
  */
  async loadData() {
    const isIncremental = this.manager.isIncrementalMode();
    const sinceDate = this.manager.config.INCREMENTAL_SINCE_DATE ?? null;

    if (isIncremental) {
      this.manager.logger.debug(`Loading ${this.modelName} data with incremental filter since ${sinceDate || 'unspecified date'}`);
      return await loadData(
        this.manager.config.DATA_DIRECTORY,
        this.getFileName(),
        this.isElasticsearch,
        sinceDate
      );
    }

    this.manager.logger.debug(`Loading ${this.modelName} data without incremental filtering`);
    return await loadData(this.manager.config.DATA_DIRECTORY, this.getFileName(), this.isElasticsearch);
  }
  
  /**
   * Migrate data for this model
   * Default implementation that can be used by most migrators
   */
  async migrate() {
    this.manager.logger.info(`Migrating ${this.modelName} data...`);
    const isIncremental = this.manager.isIncrementalMode();
    const sinceDate = this.manager.config.INCREMENTAL_SINCE_DATE ?? 'unspecified date';
    const incrementalFields = Array.isArray(this.manager.config.INCREMENTAL_FIELDS)
      ? this.manager.config.INCREMENTAL_FIELDS
      : [];

    if (isIncremental) {
      this.manager.logger.info(`Running in INCREMENTAL mode since ${sinceDate}`);
      if (incrementalFields.length) {
        this.manager.logger.info(`Updating only fields: ${incrementalFields.join(', ')}`);
      }
    } else {
      this.manager.logger.info('Running in FULL migration mode');
    }

    const data = await this.loadData();

    // Allow subclasses to perform pre-processing
    const processedData = await this.beforeMigration(data);
    
    const processFn = this.createProcessFunction();
    const result = await this.manager.processBatch(processedData, processFn);

    const modeLabel = isIncremental ? 'incremental' : 'full';
    this.manager.logger.info(`Migrated ${result.processed} ${this.modelName} records (skipped ${result.skipped}) in ${modeLabel} mode`);
    
    // Allow subclasses to perform post-processing
    await this.afterMigration(result);
    
    // Return statistics for this migrator
    return {
      processed: result.processed,
      skipped: result.skipped,
      errors: []
    };
  }

   /**
   * Hook for pre-migration processing
   * @param {Array} data The loaded data
   * @returns {Array} The processed data
   */
   async beforeMigration(data) {
    return data// Default implementation does nothing
  }
  
  /**
   * Hook for post-migration processing
   * @param {Object} _result The migration result
   */
  async afterMigration(_result) {
    // Default implementation does nothing
  }
  
  /**
   * Create the process function for this migrator
   * Default implementation that can be used by most migrators
   */
  createProcessFunction() {
    return async (batch, prisma, uniqueTracker) => {
      let processed = 0;
      let skipped = 0;

      // Initialize unique trackers if needed
      this.initializeUniqueTrackers(uniqueTracker);

      if (this.manager.isIncrementalMode()) {
        this.manager.logger.debug(`Processing ${this.modelName} batch in incremental mode`);
      } else {
        this.manager.logger.debug(`Processing ${this.modelName} batch in full migration mode`);
      }

      for (const _record of batch) {

        const record = this.beforeValidation(_record);

        // Check for required fields and apply defaults if needed
        const { data: modelData, skip } = this.validateRequiredFields(
          record, 
          this.requiredFields
        );
        
        if (skip) {
          skipped++;
          continue;
        }
        
        // Apply defaults for optional fields
        this.applyOptionalFields(record, this.optionalFields, modelData);
        
        // Check for unique constraints
        if (!await this.checkUniqueConstraints(modelData, uniqueTracker, prisma)) {
          skipped++;
          continue;
        }
        
        // Check dependencies
        if (!this.checkDependencies(modelData)) {
          skipped++;
          continue;
        }
        
        // Perform custom validation
        if (!await this.validateRecord(modelData, prisma)) {
          skipped++;
          continue;
        }

        // Allow subclasses to modify record data if needed
        const finalModelData = this.customizeRecordData(modelData);
        
        // Create upsert data
        const upsertData = this.manager.isIncrementalMode()
          ? this.createIncrementalUpsertData(finalModelData, this.getIdField())
          : this.createUpsertData(finalModelData, this.getIdField());
        
        // Allow subclasses to modify upsert data if needed
        const finalUpsertData = this.customizeUpsertData(upsertData, record);
        
        // Perform the upsert operation with error handling
        const upsertResult = await this.performUpsert(prisma, finalUpsertData);

        if (upsertResult?.skip) {
          skipped++;
          continue;
        }

        const dbData = upsertResult?.data ?? upsertResult;
        
        // Allow subclasses to perform post-upsert operations
        if (dbData) {
          await this.afterUpsert(dbData, record, prisma);
        }
        
        processed++;
      }
      
      return { processed, skipped };
    };
  }

  /**
   * Modify record data before validation
   * @param {Object} record 
   */
  beforeValidation(record) {
    // Default implementation does nothing
    return record;
  }

   /**
   * Validate required fields for a record
   * @param {Object} record The record to validate
   * @returns {Object} Object with validated fields and skip flag
   */
   validateRequiredFields(record) {
    const result = {};
    let skip = false;
    
    const idField = this.getIdField();
    
    for (const field of this.requiredFields) {
      if (record[field] === undefined && this.manager.config.SKIP_MISSING_REQUIRED) {
        this.manager.logger.warn(`Skipping ${this.modelName} [id: ${record[idField]}] with missing required field ${field}`);
        skip = true;
        break;
      }
      
      result[field] = record[field] ?? this.manager.handleMissing(this.modelName, field, record);
      
      const hasSchemaDefault = this.manager.config.migrator?.[this.modelName]?.hasDefaults?.includes(field);
      if (result[field] === Prisma.skip && !hasSchemaDefault) {
        this.manager.logger.warn(`Skipping ${this.modelName} [id: ${record[idField]}] with missing required field ${field}`);
        skip = true;
        break;
      }
    }
    
    return { data: result, skip };
  }
  
  /**
   * Apply optional fields to a record
   * @param {Object} record The source record
   * @param {Array} optionalFields Array of optional field names
   * @param {Object} target The target object to apply fields to
   */
  applyOptionalFields(record, optionalFields, target) {
    for (const field of optionalFields) {
      target[field] = record[field] ?? this.manager.handleMissing(this.modelName, field, record);
    }
    return target;
  }
  
  /**
   * Get the ID field for a record
   * @param {string} [modelName] The model name (optional)
   * @returns {string} The ID field name
   */
  getIdField(modelName) {
    // If no modelName is provided, use this.modelName
    const model = modelName || this.modelName;
    
    // Safely access the configuration with optional chaining
    return this.manager.config.migrator?.[model]?.idField || 'id';
}
  
  /**
   * Create upsert data for a record
   * @param {Object} record The processed record data
   * @param {string} idField The ID field name
   * @returns {Object} Object with where, update, and create properties
   */
  createUpsertData(record, idField) {
    const updateData = { ...record };
    delete updateData[idField];
    updateData.updatedAt = record.updatedAt ? new Date(record.updatedAt) : new Date();
    updateData.updatedBy = record.updatedBy;
    
    const createData = { ...record };
    createData.createdAt = record.createdAt ? new Date(record.createdAt) : new Date();
    
    return {
      where: { [idField]: record[idField] },
      update: updateData,
      create: createData
    };
  }

  /**
   * Create upsert data when running in incremental mode. Only configured incremental fields
   * are updated while new records still receive the full dataset.
   * @param {Object} record The processed record data
   * @param {string} idField The ID field name
   * @returns {{ where: Object, update: Object, create: Object }} The incremental upsert payload
   */
  createIncrementalUpsertData(record, idField) {
    const incrementalFields = Array.isArray(this.manager.config.INCREMENTAL_FIELDS)
      ? this.manager.config.INCREMENTAL_FIELDS
      : [];

    if (!incrementalFields.length) {
      return this.createUpsertData(record, idField);
    }

    const updateData = {};
    const missingFields = [];

    for (const field of incrementalFields) {
      if (field === idField) {
        continue;
      }

      if (record[field] !== undefined) {
        updateData[field] = record[field];
      } else {
        updateData[field] = Prisma.skip;
        missingFields.push(field);
      }
    }

    updateData.updatedAt = record.updatedAt ? new Date(record.updatedAt) : new Date();
    updateData.updatedBy = record.updatedBy;

    if (missingFields.length) {
      this._missingIncrementalFieldWarnings = this._missingIncrementalFieldWarnings || new Set();
      for (const field of missingFields) {
        if (!this._missingIncrementalFieldWarnings.has(field)) {
          this._missingIncrementalFieldWarnings.add(field);
          this.manager.logger.warn(`Configured incremental field "${field}" is missing on some ${this.modelName} records; skipping updates for this field`);
        }
      }
    }

    const createData = { ...record };
    createData.createdAt = record.createdAt ? new Date(record.createdAt) : new Date();

    return {
      where: { [idField]: record[idField] },
      update: updateData,
      create: createData
    };
  }

  /**
   * Initialize unique trackers for this model
   */
  initializeUniqueTrackers(uniqueTracker) {
    // Get unique constraints from config
    const constraints = this.manager.config.migrator[this.modelName]?.uniqueConstraints || [];
    
    // Initialize a tracker for each constraint
    for (const constraint of constraints) {
      if (!uniqueTracker.has(constraint.name)) {
        uniqueTracker.set(constraint.name, new Set());
      }
    }
  }
  
  /**
   * Check unique constraints for this model
   */
  async checkUniqueConstraints(record, uniqueTracker, prisma) {
    // Get unique constraints from config
    const constraints = this.manager.config.migrator[this.modelName]?.uniqueConstraints || [];
    const idField = this.getIdField(record);
    
    for (const constraint of constraints) {
      // Skip if any field in the constraint is undefined
      if (constraint.fields.some(field => record[field] === Prisma.skip)) continue;
      
      // Create a composite key from all fields in the constraint
      const key = constraint.fields.map(field => String(record[field])).join('_');
      
      // Skip empty keys (all fields were empty/null)
      if (!key) continue;
      
      // Check in-memory tracker
      if (uniqueTracker.get(constraint.name)?.has(key)) {
        this.manager.logger.warn(`Skipping ${this.modelName} [id: ${record[idField]}]: Unique constraint violation on ${constraint.name}`);
        return false;
      }
      
      // Build where clause for database check
      const where = {
        AND: [
          // Include all constraint fields
          ...constraint.fields.map(field => ({ [field]: record[field] })),
          // Exclude current record
          { [idField]: { not: record[idField] } }
        ]
      };
      
      // Check database
      const modelName = this.modelName.charAt(0).toLowerCase() + this.modelName.slice(1);
      const existing = await prisma[modelName].findFirst({ where });
      
      if (existing) {
        this.manager.logger.warn(`Skipping ${this.modelName} [id: ${record[idField]}]: Unique constraint violation on ${constraint.name}`);
        return false;
      }
      
      // Add to tracker
      uniqueTracker.get(constraint.name).add(key);
    }
    
    return true;
  }
  
  /**
   * Check dependencies for this model
   */
  checkDependencies(modelData) {
    // Get dependencies from config
    const dependencies = this.manager.config.migrator?.[this.modelName]?.dependencies || [];
    const recordId = modelData[this.getIdField()];
    
    for (const dependency of dependencies) {
      if (!this.manager.isValidDependency(dependency.name, modelData[dependency.fkey])) {
        this.manager.logger.warn(`Skipping ${this.modelName} [id: ${recordId}]: references non-existent ${dependency.name} ${ modelData[dependency.fkey]}`);
        return false;
      }
    }
    return true; // Default implementation passes all records
  }
  
  /**
   * Perform additional validation on the record
   */
  async validateRecord(_modelData, _prisma) {
    return true; // Default implementation passes all records
  }

  /**
   * Customize record data before performing the operation
   */
  customizeRecordData(record) {
    return record; // Default implementation returns unmodified data
  }
  
  /**
   * Customize upsert data before performing the operation
   */
  customizeUpsertData(upsertData, _record) {
    return upsertData; // Default implementation returns unmodified data
  }
  
  /**
   * Perform the upsert operation
   * @param {PrismaClient} prisma The Prisma client instance
   * @param {Object} upsertData The upsert data
   * @returns {Promise<Object>} The result of the upsert operation
   */
  async performUpsert(prisma, upsertData) {
    try {
      const data = await prisma[this.queryName].upsert(upsertData);
      return { data };
    } catch (error) {
      const resolution = await this.handleUpsertError(error, upsertData);

      if (resolution?.retryData) {
        try {
          const data = await prisma[this.queryName].upsert(resolution.retryData);
          return { data };
        } catch (retryError) {
          this.manager.logger.error(`Retry upsert failed for ${this.modelName} ${this.describeRecord(upsertData)}:`, retryError);
          return { skip: true };
        }
      }

      if (resolution?.skip) {
        return { skip: true };
      }

      throw error;
    }
  }

  /**
   * Handle upsert errors and decide whether to retry or skip
   * @param {Error} error
   * @param {Object} upsertData
   * @returns {{retryData?: Object, skip?: boolean}|null}
   */
  async handleUpsertError(error, upsertData) {
    const recordLabel = this.describeRecord(upsertData);

    if (this.isIntOverflowError(error)) {
      this.manager.logger.warn(`Integer overflow detected while migrating ${this.modelName} ${recordLabel}: ${error.message}`);
      const sanitized = this.sanitizeOverflowingInts(upsertData);

      if (sanitized.skip) {
        this.manager.logger.warn(`Skipping ${this.modelName} ${recordLabel} due to integer overflow on required field.`);
        return { skip: true };
      }

      if (sanitized.modified) {
        this.manager.logger.warn(`Retrying ${this.modelName} ${recordLabel} after removing overflow values.`);
        return { retryData: sanitized.data };
      }

      this.manager.logger.warn(`Skipping ${this.modelName} ${recordLabel}; no safe way to correct integer overflow.`);
      return { skip: true };
    }

    if (this.isNumericStringTypeError(error)) {
      const fieldTypeMap = this.extractNumericFieldTypesFromError(error);
      const sanitized = this.convertNumericStringFields(upsertData, fieldTypeMap);

      if (sanitized.modified) {
        const fieldSummary = sanitized.convertedFields.join(', ') || 'numeric fields';
        this.manager.logger.warn(`${this.modelName} ${recordLabel}: converted string inputs for ${fieldSummary}; retrying upsert.`);
        return { retryData: sanitized.data };
      }
    }

    return null;
  }

  /**
   * Check if the error corresponds to an integer overflow from Prisma
   * @param {Error} error
   * @returns {boolean}
   */
  isIntOverflowError(error) {
    const message = error?.message || '';
    return message.includes('Unable to fit integer value');
  }

  /**
   * Determine if the Prisma error was triggered by passing string values to numeric fields
   * @param {Error} error
   * @returns {boolean}
   */
  isNumericStringTypeError(error) {
    if (!error) {
      return false;
    }

    const message = error.message || '';
    const numericTypeMismatchPattern = /Expected\s+(?:Float|Int|Decimal|BigInt|Double|Real|Numeric)[^,]*,\s*provided\s+String/i;

    if (numericTypeMismatchPattern.test(message)) {
      return true;
    }

    if (Prisma?.PrismaClientValidationError && error instanceof Prisma.PrismaClientValidationError) {
      return numericTypeMismatchPattern.test(message);
    }

    return false;
  }

  /**
   * Extract field names and expected numeric types from a Prisma validation error message
   * @param {Error} error
   * @returns {Map<string, string>}
   */
  extractNumericFieldTypesFromError(error) {
    const message = error?.message || '';
    const fieldTypeMap = new Map();
    const argumentPattern = /Argument\s+(?:["'`])?([A-Za-z0-9_.\[\]]+)(?:["'`])?\s*:\s*Invalid value provided\.?\s*Expected\s+([A-Za-z0-9]+)[^,]*,\s*provided\s+String/gi;
    let match;

    while ((match = argumentPattern.exec(message)) !== null) {
      const rawPath = match[1];
      const expectedType = (match[2] || '').toUpperCase();
      const field = this.normalizeErrorFieldPath(rawPath);

      if (field && !fieldTypeMap.has(field)) {
        fieldTypeMap.set(field, expectedType);
      }
    }

    return fieldTypeMap;
  }

  /**
   * Normalize a Prisma error argument path to the relevant field name
   * @param {string} rawPath
   * @returns {string|null}
   */
  normalizeErrorFieldPath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') {
      return null;
    }

    const segments = rawPath
      .replace(/\[\d+\]/g, '.') // Treat array indices as segment separators
      .split('.')
      .map(segment => segment.trim())
      .filter(Boolean);

    if (!segments.length) {
      return null;
    }

    return segments[segments.length - 1];
  }

  /**
   * Convert string representations of numeric values to their proper numeric types
   * @param {Object} upsertData
   * @param {Map<string, string>} fieldTypeMap
   * @returns {{data: Object, modified: boolean, convertedFields: string[]}}
   */
  convertNumericStringFields(upsertData, fieldTypeMap) {
    if (!upsertData || !(fieldTypeMap instanceof Map)) {
      return { data: upsertData, modified: false, convertedFields: [] };
    }

    if (!fieldTypeMap.size) {
      return { data: upsertData, modified: false, convertedFields: [] };
    }

    const targetMap = new Map();
    for (const [field, type] of fieldTypeMap.entries()) {
      if (typeof field === 'string' && field) {
        targetMap.set(field, (type || '').toUpperCase());
      }
    }

    if (!targetMap.size) {
      return { data: upsertData, modified: false, convertedFields: [] };
    }

    const convertedFields = new Set();
    const convertValue = (value) => {
      if (value === null || value === undefined) {
        return value;
      }

      if (value instanceof Date) {
        return value;
      }

      if (Prisma?.Decimal && value instanceof Prisma.Decimal) {
        return value;
      }

      if (Array.isArray(value)) {
        let changed = false;
        const result = value.map(item => {
          const converted = convertValue(item);
          if (converted !== item) {
            changed = true;
          }
          return converted;
        });

        return changed ? result : value;
      }

      if (typeof value === 'object') {
        let changed = false;
        const result = {};

        for (const [key, entry] of Object.entries(value)) {
          let newEntry = entry;
          const expectedType = targetMap.get(key);

          if (expectedType && typeof entry === 'string') {
            const converted = this.tryConvertNumericString(entry, expectedType);
            if (converted !== null) {
              newEntry = converted;
              changed = true;
              convertedFields.add(`${key} (${expectedType})`);
            }
          }

          const nested = convertValue(newEntry);
          if (nested !== newEntry) {
            newEntry = nested;
            changed = true;
          }

          result[key] = newEntry;
        }

        return changed ? result : value;
      }

      return value;
    };

    const transformedWhere = convertValue(upsertData.where);
    const transformedUpdate = convertValue(upsertData.update);
    const transformedCreate = convertValue(upsertData.create);

    const modified =
      transformedWhere !== upsertData.where ||
      transformedUpdate !== upsertData.update ||
      transformedCreate !== upsertData.create;

    if (!modified) {
      return { data: upsertData, modified: false, convertedFields: [] };
    }

    return {
      data: {
        ...upsertData,
        where: transformedWhere,
        update: transformedUpdate,
        create: transformedCreate
      },
      modified: true,
      convertedFields: Array.from(convertedFields)
    };
  }

  /**
   * Attempt to convert a numeric-looking string into the proper numeric type
   * @param {string} value
   * @param {string} expectedType
   * @returns {number|BigInt|Prisma.Decimal|null}
   */
  tryConvertNumericString(value, expectedType) {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
      return null;
    }

    const type = (expectedType || '').toUpperCase();
    const integerPattern = /^[+-]?\d+$/;
    const floatPattern = /^[+-]?(?:\d+(\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

    if (type === 'BIGINT') {
      if (!integerPattern.test(trimmed)) {
        return null;
      }
      try {
        return BigInt(trimmed);
      } catch (err) {
        return null;
      }
    }

    if (type === 'INT' || type === 'SMALLINT') {
      if (!integerPattern.test(trimmed)) {
        return null;
      }
      const intValue = Number(trimmed);
      if (!Number.isFinite(intValue) || !Number.isInteger(intValue)) {
        return null;
      }
      return intValue;
    }

    if (type === 'FLOAT' || type === 'DOUBLE' || type === 'REAL') {
      if (!floatPattern.test(trimmed)) {
        return null;
      }
      const floatValue = Number(trimmed);
      return Number.isFinite(floatValue) ? floatValue : null;
    }

    if (type === 'DECIMAL' || type === 'NUMERIC') {
      if (!floatPattern.test(trimmed)) {
        return null;
      }
      if (Prisma?.Decimal) {
        try {
          return new Prisma.Decimal(trimmed);
        } catch (err) {
          // Fallback to native number if Decimal instantiation fails
        }
      }
      const decimalValue = Number(trimmed);
      return Number.isFinite(decimalValue) ? decimalValue : null;
    }

    if (integerPattern.test(trimmed)) {
      const intValue = Number(trimmed);
      if (Number.isFinite(intValue) && Number.isInteger(intValue)) {
        return intValue;
      }
    }

    if (floatPattern.test(trimmed)) {
      const floatValue = Number(trimmed);
      return Number.isFinite(floatValue) ? floatValue : null;
    }

    return null;
  }

  /**
   * Sanitize integer overflow values from the upsert payload
   * @param {Object} upsertData
   * @returns {{data: Object, modified: boolean, skip: boolean}}
   */
  sanitizeOverflowingInts(upsertData) {
    const optionalFields = new Set(this.optionalFields || []);
    const requiredFields = new Set(this.requiredFields || []);
    let modified = false;
    let skip = false;
    const recordLabel = this.describeRecord(upsertData);

    const pruneOverflow = (section = {}, sectionName) => {
      if (!section || typeof section !== 'object') {
        return section;
      }

      const sanitized = { ...section };

      for (const [key, value] of Object.entries(sanitized)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue;
        }

        if (value > INT32_MAX || value < INT32_MIN) {
          if (optionalFields.has(key)) {
            delete sanitized[key];
            modified = true;
            this.manager.logger.warn(`${this.modelName} ${recordLabel}: dropped optional overflow field "${key}" (${value}) from ${sectionName}.`);
          } else if (requiredFields.has(key)) {
            skip = true;
            this.manager.logger.error(`${this.modelName} ${recordLabel}: required field "${key}" has overflow value (${value}); cannot migrate.`);
          } else {
            delete sanitized[key];
            modified = true;
            this.manager.logger.warn(`${this.modelName} ${recordLabel}: removed overflow field "${key}" (${value}) from ${sectionName}.`);
          }
        }
      }

      return sanitized;
    };

    return {
      data: {
        where: { ...(upsertData?.where || {}) },
        update: pruneOverflow(upsertData?.update, 'update payload'),
        create: pruneOverflow(upsertData?.create, 'create payload')
      },
      modified,
      skip
    };
  }

  /**
   * Describe the target record for logging
   * @param {Object} upsertData
   * @returns {string}
   */
  describeRecord(upsertData) {
    const idField = this.getIdField();
    const identifier = upsertData?.where?.[idField];

    if (identifier !== undefined) {
      return `[${idField}: ${identifier}]`;
    }

    if (upsertData?.where) {
      try {
        return `[where: ${JSON.stringify(upsertData.where)}]`;
      } catch (err) {
        return '[where: unable to serialize]';
      }
    }

    return '';
  }
  
  /**
   * Perform operations after successful upsert
   */
  async afterUpsert(_modelData, _record, _prisma) {
    // Default implementation does nothing
  }

  getPriority() {
    return this.manager.config.migrator?.[this.modelName]?.priority || 2;
  }

  /**
   * Get createdBy field from the config
   * @returns {string} The createdBy field
   */
  getCreatedBy() {
    return this.manager.config.CREATED_BY;
  }
  
  /**
   * Get updatedBy field from the config
   * @returns {string} The updatedBy field
   */
  getUpdatedBy() {
    return this.manager.config.UPDATED_BY;
  }
}

module.exports = { BaseMigrator };
