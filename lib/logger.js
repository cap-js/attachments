const cds = require('@sap/cds')

class AttachmentsLogger {
  constructor() {
    try {
      this.LOG = cds.log('attachments')
      this.DEBUG = this.LOG._debug ? this.LOG.debug : undefined
      this.isVerboseEnabled = cds.env.requires?.attachments?.logging?.verbose || false
      this.isDebugEnabled = cds.env.log?.levels?.attachments === 'debug' || process.env.DEBUG?.includes('attachments')
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      // Fallback for test environments or early initialization
      this.LOG = {
        info: () => { },
        warn: () => { },
        error: () => { },
        debug: () => { }
      }
      this.DEBUG = undefined
      this.isVerboseEnabled = false
      this.isDebugEnabled = false
    }
  }

  /**
   * Logs an informational message with optional context
   * @param {string} message - The message to log
   * @param {*} context - Additional context to include in the log
   */
  info(message, context = {}) {
    try {
      this.LOG.info(this._formatMessage(message, context))
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

  /**
   * Logs a warning message with optional context
   * @param {string} message - The message to log
   * @param {*} context - Additional context to include in the log
   */
  warn(message, context = {}) {
    try {
      this.LOG.warn(this._formatMessage(message, context))
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

  /**
   * Logs an error message with optional context and error details
   * @param {string} message - The message to log
   * @param {Error} error - The error object to log
   * @param {*} context - Additional context to include in the log
   */
  error(message, error = null, context = {}) {
    try {
      const fullContext = { ...context }
      if (error) {
        fullContext.error = {
          message: error.message,
          stack: error.stack,
          code: error.code
        }
      }
      this.LOG.error(this._formatMessage(message, fullContext))
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

  /**
   * Logs a debug message with optional context
   * @param {string} message - The message to log
   * @param {*} context - Additional context to include in the log
   */
  debug(message, context = {}) {
    try {
      if (this.DEBUG) {
        this.DEBUG(this._formatMessage('DEBUG', message, context))
      }
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

  /**
   * Logs a verbose message with optional context if verbose logging is enabled
   * @param {string} message - The message to log
   * @param {*} context - Additional context to include in the log
   */
  verbose(message, context = {}) {
    try {
      if (this.isVerboseEnabled && this.DEBUG) {
        this.DEBUG(this._formatMessage('VERBOSE', message, context))
      }
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

  /**
   * Logs the result of a configuration validation
   * @param {string} configPath - The path of the configuration being validated
   * @param {string} value - The value being validated
   * @param {boolean} isValid - Whether the value is valid
   * @param {string} suggestion - Suggestion for correction if invalid
   */
  logConfigValidation(configPath, value, isValid, suggestion = null) {
    const context = { configPath, value: this._sanitizeValue(value), isValid }
    if (suggestion) context.suggestion = suggestion

    if (isValid) {
      this.debug('Configuration validation passed', context)
    } else {
      this.error('Configuration validation failed', null, context)
    }
  }

  /**
   * Logs a specific process step with details
   * @param {string} step - The process step being logged
   * @param {*} details - Additional details about the step
   */
  logProcessStep(step, details = {}) {
    this.verbose(`Process step: ${step}`, details)
  }

  /**
   * Logs a message with a suggestion for improvement
   * @param {('info'|'warn'|'error'|'debug')} level - The log level
   * @param {string} message - The message to log
   * @param {Error} error - The error object (if any)
   * @param {string} suggestion - Suggestion for improvement
   * @param {*} context - Additional context to include in the log
   */
  logWithSuggestion(level, message, error = null, suggestion = null, context = {}) {
    const fullContext = { ...context }
    if (suggestion) fullContext.suggestion = suggestion

    switch (level) {
      case 'error':
        this.error(message, error, fullContext)
        break
      case 'warn':
        this.warn(message, fullContext)
        break
      case 'info':
        this.info(message, fullContext)
        break
      default:
        this.debug(message, fullContext)
    }
  }

  /**
   * Formats the log message with timestamp, level, and context
   * @param {string} message - The main log message
   * @param {*} context - Additional context to include
   * @returns 
   */
  _formatMessage(message, context) {
    let formattedMessage = message

    if (Object.keys(context).length > 0) {
      formattedMessage += ` | Context: ${JSON.stringify(context)}`
    }

    return formattedMessage
  }

  _sanitizeValue(value) {
    if (typeof value === 'string') {
      // Mask sensitive information
      if (value.includes('password') || value.includes('secret') || value.includes('key')) {
        return '***MASKED***'
      }
    }
    return value
  }
}

const attachmentsLogger = new AttachmentsLogger()

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
    processStep: (step, details) =>
      attachmentsLogger.logProcessStep(step, details),
    withSuggestion: (level, message, error, suggestion, context) =>
      attachmentsLogger.logWithSuggestion(level, message, error, suggestion, context)
  }
}