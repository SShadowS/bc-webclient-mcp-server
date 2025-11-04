/**
 * Centralized logging utilities with structured logging support
 *
 * Uses pino for high-performance, structured JSON logging.
 * Provides context-aware child loggers for tracing operations.
 */

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import { logLevel, isDevelopment } from './config.js';

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/**
 * Logger configuration options
 */
interface LoggerConfig {
  level?: LogLevel;
  pretty?: boolean;
  name?: string;
}

/**
 * Get logger configuration from centralized config
 */
function getConfig(): LoggerConfig {
  return {
    level: logLevel as LogLevel,
    pretty: isDevelopment,
    name: 'bc-mcp-server',
  };
}

/**
 * Create the base logger instance
 */
function createLogger(): PinoLogger {
  const config = getConfig();

  const pinoConfig: pino.LoggerOptions = {
    name: config.name,
    level: config.level || 'info',
    // Add timestamp in ISO format
    timestamp: pino.stdTimeFunctions.isoTime,
    // Format messages consistently
    messageKey: 'msg',
    // Add error serializer for proper error logging
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  };

  // Use pretty print in development
  if (config.pretty) {
    return pino({
      ...pinoConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    });
  }

  return pino(pinoConfig);
}

/**
 * Global logger instance
 */
export const logger = createLogger();

/**
 * Create a child logger with additional context
 *
 * @param context - Additional fields to include in all log messages
 * @returns A child logger instance
 *
 * @example
 * ```typescript
 * const toolLogger = createChildLogger({ tool: 'GetPageMetadata', pageId: '21' });
 * toolLogger.info('Opening page'); // Includes tool and pageId in output
 * ```
 */
export function createChildLogger(context: Record<string, unknown>): PinoLogger {
  return logger.child(context);
}

/**
 * Create a logger for a specific tool
 *
 * @param toolName - Name of the tool
 * @param pageContextId - Optional page context for the operation
 * @returns A child logger with tool context
 */
export function createToolLogger(
  toolName: string,
  pageContextId?: string
): PinoLogger {
  const context: Record<string, unknown> = { tool: toolName };
  if (pageContextId) {
    // Extract sessionId from pageContextId for cleaner logs
    const [sessionId] = pageContextId.split(':');
    context.pageContextId = pageContextId;
    context.sessionId = sessionId;
  }
  return createChildLogger(context);
}

/**
 * Create a logger for connection operations
 *
 * @param sessionId - Session identifier
 * @param operation - Operation being performed
 * @returns A child logger with connection context
 */
export function createConnectionLogger(
  sessionId: string,
  operation?: string
): PinoLogger {
  const context: Record<string, unknown> = { sessionId };
  if (operation) {
    context.operation = operation;
  }
  return createChildLogger(context);
}

/**
 * Log level utilities
 */
export const LogLevels = {
  /**
   * Check if debug logging is enabled
   */
  isDebugEnabled(): boolean {
    return logger.level === 'debug' || logger.level === 'trace';
  },

  /**
   * Check if trace logging is enabled
   */
  isTraceEnabled(): boolean {
    return logger.level === 'trace';
  },

  /**
   * Set the log level dynamically
   */
  setLevel(level: LogLevel): void {
    logger.level = level;
  },

  /**
   * Get current log level
   */
  getLevel(): string {
    return logger.level;
  },
};

/**
 * Track if shutdown is in progress
 */
let isShuttingDown = false;

/**
 * Gracefully shutdown the logger, allowing pending messages to be written
 *
 * @returns Promise that resolves after brief delay for log writes
 */
export async function shutdownLogger(): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  // Give transport threads a brief moment to finish writing
  // Pino's transport threads write asynchronously, so we just need a small delay
  await new Promise(resolve => setTimeout(resolve, 50));
}

/**
 * Check if logger is shutting down
 */
export function isLoggerShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Export pino types for consumers
 */
export type { Logger } from 'pino';

/**
 * Default export for convenience
 */
export default logger;