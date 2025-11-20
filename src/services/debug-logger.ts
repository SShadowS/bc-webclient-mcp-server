/**
 * Debug Logger Service
 *
 * Provides channel-specific debug logging with automatic rotation.
 * Only active when DEBUG_MODE=true in .env
 *
 * Features:
 * - Channel-based file separation (tools.log, websocket.log, etc.)
 * - Automatic log rotation (size-based)
 * - Timestamped entries with correlation IDs
 * - Performance metrics (durations, sizes)
 * - Structured JSON output (NDJSON format)
 */

import fs from 'fs/promises';
import path from 'path';
import { config, type DebugChannel } from '../core/config.js';
import { logger } from '../core/logger.js';

/**
 * Debug log entry structure
 */
export interface DebugLogEntry {
  timestamp: string; // ISO 8601
  channel: DebugChannel; // Which subsystem
  level: 'debug' | 'trace'; // Severity
  message: string; // Human-readable summary
  correlationId?: string; // Link related events (sessionId, requestId, etc.)
  data?: unknown; // Structured data
  duration?: number; // Operation duration in ms
  size?: number; // Data size in bytes
}

/**
 * Debug logger singleton
 */
class DebugLogger {
  private static instance: DebugLogger | null = null;
  private logStreams: Map<DebugChannel, fs.FileHandle> = new Map();
  private logSizes: Map<DebugChannel, number> = new Map();
  private initialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DebugLogger {
    if (!DebugLogger.instance) {
      DebugLogger.instance = new DebugLogger();
    }
    return DebugLogger.instance;
  }

  /**
   * Initialize debug logger (create log files)
   */
  async initialize(): Promise<void> {
    // 🐛 VERBOSE: Log debug mode check to stderr (bypasses pino)
    console.error(`[DebugLogger] Debug mode enabled: ${config.debug.enabled}`);

    if (!config.debug.enabled) {
      console.error('[DebugLogger] Debug mode is disabled, skipping initialization');
      return;
    }

    if (this.initialized) {
      console.error('[DebugLogger] Already initialized, skipping');
      return;
    }

    try {
      // 🐛 VERBOSE: Log current working directory and resolved paths
      const cwd = process.cwd();
      const resolvedLogDir = path.isAbsolute(config.debug.logDir)
        ? config.debug.logDir
        : path.join(cwd, config.debug.logDir);

      console.error('[DebugLogger] Initialization starting...');
      console.error(`[DebugLogger]   Current working directory: ${cwd}`);
      console.error(`[DebugLogger]   Config log dir: ${config.debug.logDir}`);
      console.error(`[DebugLogger]   Resolved log dir: ${resolvedLogDir}`);
      console.error(`[DebugLogger]   Channels: ${Array.from(config.debug.channels).join(', ')}`);

      // Create log directory
      console.error(`[DebugLogger] Creating log directory: ${resolvedLogDir}`);
      await fs.mkdir(resolvedLogDir, { recursive: true });
      console.error(`[DebugLogger] ✓ Log directory created/verified`);

      // Open log files for each enabled channel
      for (const channel of config.debug.channels) {
        if (channel === 'all') continue; // Not a real channel

        const logPath = path.join(resolvedLogDir, `${channel}.log`);
        console.error(`[DebugLogger] Opening log file: ${logPath}`);

        const handle = await fs.open(logPath, 'a');
        this.logStreams.set(channel, handle);
        console.error(`[DebugLogger] ✓ File handle opened for ${channel}`);

        // Get current file size
        const stats = await handle.stat();
        this.logSizes.set(channel, stats.size);
        console.error(`[DebugLogger] ✓ Current size for ${channel}: ${stats.size} bytes`);

        // Write session header immediately (creates placeholder)
        await this.writeHeader(channel, handle);
        console.error(`[DebugLogger] ✓ Session header written for ${channel}`);
      }

      this.initialized = true;

      console.error(`[DebugLogger] ✓✓✓ Debug logging fully initialized ✓✓✓`);
      console.error(`[DebugLogger] Files created in: ${resolvedLogDir}`);

      logger.info({
        logDir: resolvedLogDir,
        channels: Array.from(config.debug.channels),
      }, 'Debug logging initialized');
    } catch (error) {
      // 🐛 VERBOSE: Log error details to stderr
      console.error('[DebugLogger] ✗✗✗ INITIALIZATION FAILED ✗✗✗');
      console.error('[DebugLogger] Error details:', error);
      logger.error({ error }, 'Failed to initialize debug logging');
      throw error;
    }
  }

  /**
   * Write session header to log file
   */
  private async writeHeader(channel: DebugChannel, handle: fs.FileHandle): Promise<void> {
    const header = `\n${'='.repeat(80)}\nDebug Session Started: ${new Date().toISOString()}\nChannel: ${channel}\n${'='.repeat(80)}\n\n`;
    await handle.write(header);
  }

  /**
   * Log a debug entry to the appropriate channel
   */
  async log(entry: DebugLogEntry): Promise<void> {
    if (!config.debug.enabled) {
      return;
    }

    if (!config.debug.channels.has(entry.channel)) {
      return;
    }

    const handle = this.logStreams.get(entry.channel);
    if (!handle) {
      logger.warn({ channel: entry.channel }, 'Debug log stream not initialized');
      return;
    }

    try {
      // Format entry as JSON line (NDJSON format)
      const line = JSON.stringify(entry) + '\n';
      const size = Buffer.byteLength(line);

      // Check if rotation is needed
      const currentSize = this.logSizes.get(entry.channel) || 0;
      if (currentSize + size > config.debug.maxSizeMB * 1024 * 1024) {
        await this.rotateLog(entry.channel);
      }

      // Write entry
      await handle.write(line);
      this.logSizes.set(entry.channel, currentSize + size);
    } catch (error) {
      // Don't throw - debug logging should never break the app
      logger.error({
        channel: entry.channel,
        error,
      }, 'Failed to write debug log entry');
    }
  }

  /**
   * Rotate log file when it exceeds max size
   */
  private async rotateLog(channel: DebugChannel): Promise<void> {
    try {
      const handle = this.logStreams.get(channel);
      if (!handle) {
        return;
      }

      // Close current file
      await handle.close();

      // Rename old logs (.1 -> .2, .2 -> .3, etc.)
      const basePath = path.join(config.debug.logDir, `${channel}.log`);
      for (let i = config.debug.maxFiles - 1; i >= 1; i--) {
        const oldPath = `${basePath}.${i}`;
        const newPath = `${basePath}.${i + 1}`;
        try {
          await fs.rename(oldPath, newPath);
        } catch (err) {
          // File doesn't exist, skip
        }
      }

      // Rotate current to .1
      await fs.rename(basePath, `${basePath}.1`);

      // Open new file
      const newHandle = await fs.open(basePath, 'a');
      this.logStreams.set(channel, newHandle);
      this.logSizes.set(channel, 0);

      await this.writeHeader(channel, newHandle);

      logger.info({ channel }, 'Debug log rotated');
    } catch (error) {
      logger.error({ channel, error }, 'Failed to rotate debug log');
    }
  }

  /**
   * Shutdown debug logger (close all files)
   */
  async shutdown(): Promise<void> {
    console.error('[DebugLogger] Shutdown called');

    if (!this.initialized) {
      console.error('[DebugLogger] Not initialized, skipping shutdown');
      return;
    }

    try {
      console.error(`[DebugLogger] Closing ${this.logStreams.size} log files...`);

      for (const [channel, handle] of this.logStreams.entries()) {
        console.error(`[DebugLogger] Closing ${channel}.log`);
        const footer = `\n${'='.repeat(80)}\nDebug Session Ended: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`;
        await handle.write(footer);
        await handle.close();
        console.error(`[DebugLogger] ✓ Closed ${channel}.log`);
      }

      this.logStreams.clear();
      this.logSizes.clear();
      this.initialized = false;

      console.error('[DebugLogger] ✓ Debug logging shut down successfully');
      logger.info('Debug logging shut down');
    } catch (error) {
      console.error('[DebugLogger] ✗ Shutdown error:', error);
      logger.error({ error }, 'Failed to shutdown debug logging');
    }
  }
}

// Export singleton instance
export const debugLogger = DebugLogger.getInstance();

// ============================================================
// Convenience functions for each channel
// ============================================================

/**
 * Log to tools channel (tool execution lifecycle)
 */
export const debugTools = (
  message: string,
  data?: unknown,
  correlationId?: string,
  duration?: number,
): void => {
  void debugLogger.log({
    timestamp: new Date().toISOString(),
    channel: 'tools',
    level: 'debug',
    message,
    data,
    correlationId,
    duration,
  });
};

/**
 * Log to websocket channel (BC WebSocket protocol)
 */
export const debugWebSocket = (
  message: string,
  data?: unknown,
  correlationId?: string,
  size?: number,
): void => {
  void debugLogger.log({
    timestamp: new Date().toISOString(),
    channel: 'websocket',
    level: 'debug',
    message,
    data,
    correlationId,
    size,
  });
};

/**
 * Log to handlers channel (handler event emission & accumulation)
 */
export const debugHandlers = (
  message: string,
  data?: unknown,
  correlationId?: string,
): void => {
  void debugLogger.log({
    timestamp: new Date().toISOString(),
    channel: 'handlers',
    level: 'debug',
    message,
    data,
    correlationId,
  });
};

/**
 * Log to session channel (session management)
 */
export const debugSession = (
  message: string,
  data?: unknown,
  correlationId?: string,
): void => {
  void debugLogger.log({
    timestamp: new Date().toISOString(),
    channel: 'session',
    level: 'debug',
    message,
    data,
    correlationId,
  });
};

/**
 * Log to cache channel (cache operations)
 */
export const debugCache = (
  message: string,
  data?: unknown,
  correlationId?: string,
): void => {
  void debugLogger.log({
    timestamp: new Date().toISOString(),
    channel: 'cache',
    level: 'debug',
    message,
    data,
    correlationId,
  });
};
