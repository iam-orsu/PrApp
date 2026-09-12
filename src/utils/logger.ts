type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[((process.env.LOG_LEVEL || 'info') as LogLevel)];

function formatTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevel;
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data !== undefined) {
    // Avoid logging sensitive data
    const sanitized = sanitizeForLogging(data);
    return `${prefix} ${message} ${JSON.stringify(sanitized)}`;
  }
  return `${prefix} ${message}`;
}

function sanitizeForLogging(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeForLogging);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Don't log secrets
    if (
      key.toLowerCase().includes('token') ||
      key.toLowerCase().includes('secret') ||
      key.toLowerCase().includes('key') ||
      key.toLowerCase().includes('password')
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (key === 'payload' || key === 'data') {
      // Don't dump entire payloads
      sanitized[key] = '[PAYLOAD_OMITTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const logger = {
  debug(message: string, data?: unknown) {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: unknown) {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message, data));
    }
  },

  warn(message: string, data?: unknown) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, data));
    }
  },

  error(message: string, error?: unknown) {
    if (shouldLog('error')) {
      if (error instanceof Error) {
        console.error(
          formatMessage('error', message, {
            message: error.message,
            stack: error.stack,
          })
        );
      } else {
        console.error(formatMessage('error', message, error));
      }
    }
  },
};
