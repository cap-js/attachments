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

  info(message, context = {}) {
    try {
      this.LOG.info(this._formatMessage('INFO', message, context))
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

  warn(message, context = {}) {
    try {
      this.LOG.warn(this._formatMessage('WARN', message, context))
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

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
      this.LOG.error(this._formatMessage('ERROR', message, fullContext))
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      // Silently fail in test environments
    }
  }

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

  logConfigValidation(configPath, value, isValid, suggestion = null) {
    const context = { configPath, value: this._sanitizeValue(value), isValid }
    if (suggestion) context.suggestion = suggestion

    if (isValid) {
      this.debug('Configuration validation passed', context)
    } else {
      this.error('Configuration validation failed', null, context)
    }
  }

  logProcessStep(step, details = {}) {
    this.verbose(`Process step: ${step}`, details)
  }

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

  _formatMessage(level, message, context) {
    const timestamp = new Date().toISOString()
    let formattedMessage = `[${timestamp}] [${level}] ${message}`

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