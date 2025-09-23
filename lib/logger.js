const cds = require('@sap/cds');

class AttachmentsLogger {
  constructor() {
    this.LOG = cds.log('attachments');
    this.DEBUG = this.LOG._debug ? this.LOG.debug : undefined;
    this.isVerboseEnabled = cds.env.requires?.attachments?.logging?.verbose || false;
    this.isDebugEnabled = cds.env.log?.levels?.attachments === 'debug' || process.env.DEBUG?.includes('attachments');
  }

  info(message, context = {}) {
    this.LOG.info(this._formatMessage('INFO', message, context));
  }

  warn(message, context = {}) {
    this.LOG.warn(this._formatMessage('WARN', message, context));
  }

  error(message, error = null, context = {}) {
    const fullContext = { ...context };
    if (error) {
      fullContext.error = {
        message: error.message,
        stack: error.stack,
        code: error.code
      };
    }
    this.LOG.error(this._formatMessage('ERROR', message, fullContext));
  }

  debug(message, context = {}) {
    if (this.DEBUG) {
      this.DEBUG(this._formatMessage('DEBUG', message, context));
    }
  }

  verbose(message, context = {}) {
    if (this.isVerboseEnabled && this.DEBUG) {
      this.DEBUG(this._formatMessage('VERBOSE', message, context));
    }
  }

  logConfigValidation(configPath, value, isValid, suggestion = null) {
    const context = { configPath, value: this._sanitizeValue(value), isValid };
    if (suggestion) context.suggestion = suggestion;

    if (isValid) {
      this.debug('Configuration validation passed', context);
    } else {
      this.error('Configuration validation failed', null, context);
    }
  }

  logTokenFetch(method, success, context = {}) {
    const logContext = {
      method,
      success,
      ...context
    };

    if (success) {
      this.info('Token fetched successfully', logContext);
    } else {
      this.error('Token fetch failed', null, logContext);
    }
  }

  logS3Operation(operation, tenantId, success, context = {}) {
    const logContext = {
      operation,
      tenantId,
      success,
      ...context
    };

    if (success) {
      this.info(`S3 ${operation} completed`, logContext);
    } else {
      this.error(`S3 ${operation} failed`, null, logContext);
    }
  }

  logFileOperation(operation, filename, fileId, success, context = {}) {
    const logContext = {
      operation,
      filename,
      fileId,
      success,
      ...context
    };

    if (success) {
      this.info(`File ${operation} completed`, logContext);
    } else {
      this.error(`File ${operation} failed`, null, logContext);
    }
  }

  logMalwareScan(fileId, status, context = {}) {
    const logContext = {
      fileId,
      scanStatus: status,
      ...context
    };

    switch (status) {
      case 'Clean':
        this.info('Malware scan completed - file is clean', logContext);
        break;
      case 'Infected':
        this.warn('Malware scan detected threat - file removed', logContext);
        break;
      case 'Failed':
        this.error('Malware scan failed', null, logContext);
        break;
      case 'Scanning':
        this.debug('Malware scan initiated', logContext);
        break;
      default:
        this.debug('Malware scan status update', logContext);
    }
  }

  logProcessStep(step, details = {}) {
    this.verbose(`Process step: ${step}`, details);
  }

  logWithSuggestion(level, message, error = null, suggestion = null, context = {}) {
    const fullContext = { ...context };
    if (suggestion) fullContext.suggestion = suggestion;

    switch (level) {
      case 'error':
        this.error(message, error, fullContext);
        break;
      case 'warn':
        this.warn(message, fullContext);
        break;
      case 'info':
        this.info(message, fullContext);
        break;
      default:
        this.debug(message, fullContext);
    }
  }

  _formatMessage(level, message, context) {
    const timestamp = new Date().toISOString();
    let formattedMessage = `[${timestamp}] [${level}] ${message}`;

    if (Object.keys(context).length > 0) {
      formattedMessage += ` | Context: ${JSON.stringify(context)}`;
    }

    return formattedMessage;
  }

  _sanitizeValue(value) {
    if (typeof value === 'string') {
      // Mask sensitive information
      if (value.includes('password') || value.includes('secret') || value.includes('key')) {
        return '***MASKED***';
      }
    }
    return value;
  }
}

const attachmentsLogger = new AttachmentsLogger();

module.exports = {
  attachmentsLogger,
  logConfig: {
    info: (message, context) => attachmentsLogger.info(message, context),
    warn: (message, context) => attachmentsLogger.warn(message, context),
    error: (message, error, context) => attachmentsLogger.error(message, error, context),
    debug: (message, context) => attachmentsLogger.debug(message, context),
    verbose: (message, context) => attachmentsLogger.verbose(message, context),

    // Specialized logging methods
    configValidation: (configPath, value, isValid, suggestion) =>
      attachmentsLogger.logConfigValidation(configPath, value, isValid, suggestion),
    tokenFetch: (method, success, context) =>
      attachmentsLogger.logTokenFetch(method, success, context),
    s3Operation: (operation, tenantId, success, context) =>
      attachmentsLogger.logS3Operation(operation, tenantId, success, context),
    fileOperation: (operation, filename, fileId, success, context) =>
      attachmentsLogger.logFileOperation(operation, filename, fileId, success, context),
    malwareScan: (fileId, status, context) =>
      attachmentsLogger.logMalwareScan(fileId, status, context),
    processStep: (step, details) =>
      attachmentsLogger.logProcessStep(step, details),
    withSuggestion: (level, message, error, suggestion, context) =>
      attachmentsLogger.logWithSuggestion(level, message, error, suggestion, context)
  }
};