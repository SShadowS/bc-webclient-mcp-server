/**
 * Centralized Configuration Module
 *
 * Type-safe environment variable management for the BC MCP Server.
 * All environment variables should be accessed through this module.
 */

import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Log levels supported by the application
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Node environments
 */
export type NodeEnv = 'development' | 'production' | 'test';

/**
 * Debug logging channels
 */
export type DebugChannel =
  | 'stdio' // MCP protocol (already exists via MCP_STDIO_LOG_FILE)
  | 'tools' // Tool execution lifecycle
  | 'websocket' // BC WebSocket protocol
  | 'handlers' // Handler event emission & accumulation
  | 'session' // Session management
  | 'cache' // Cache operations
  | 'all'; // All channels

/**
 * Debug logging configuration
 */
export interface DebugConfig {
  readonly enabled: boolean;
  readonly logDir: string;
  readonly maxSizeMB: number;
  readonly maxFiles: number;
  readonly channels: Set<DebugChannel>;
  readonly logFullHandlers: boolean;
  readonly logFullWsMessages: boolean;
}

/**
 * Business Central configuration
 */
export interface BCConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly tenantId: string;
  readonly timeout: number;
  readonly searchTimingWindowMs: number;
}

/**
 * Application configuration
 */
export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly bc: BCConfig;
  readonly debug: DebugConfig;
}

/**
 * Parse and validate environment variables
 */
class Config {
  private readonly config: AppConfig;

  constructor() {
    this.config = this.parseEnvironment();
    this.validateConfig();
  }

  /**
   * Parse environment variables with defaults
   */
  private parseEnvironment(): AppConfig {
    return {
      nodeEnv: this.getNodeEnv(),
      logLevel: this.getLogLevel(),
      bc: {
        baseUrl: process.env.BC_BASE_URL || 'http://Cronus27/BC',
        username: process.env.BC_USERNAME || 'sshadows',
        password: process.env.BC_PASSWORD || '1234',
        tenantId: process.env.BC_TENANT_ID || 'default',
        timeout: this.getNumberEnv('BC_TIMEOUT', 120000),
        searchTimingWindowMs: this.getNumberEnv('BC_SEARCH_TIMING_WINDOW_MS', 15000),
      },
      debug: this.parseDebugConfig(),
    };
  }

  /**
   * Parse debug logging configuration
   */
  private parseDebugConfig(): DebugConfig {
    const enabled = this.getBooleanEnv('DEBUG_MODE', false);
    const channelsStr = process.env.DEBUG_CHANNELS || 'all';
    const channelsList = channelsStr.split(',').map((c) => c.trim() as DebugChannel);

    // If 'all' is specified, enable all channels (except 'all' itself)
    const channels = new Set<DebugChannel>(channelsList);
    if (channels.has('all')) {
      return {
        enabled,
        logDir: process.env.DEBUG_LOG_DIR || '.debug-logs',
        maxSizeMB: this.getNumberEnv('DEBUG_LOG_MAX_SIZE_MB', 50),
        maxFiles: this.getNumberEnv('DEBUG_LOG_MAX_FILES', 10),
        channels: new Set(['stdio', 'tools', 'websocket', 'handlers', 'session', 'cache']),
        logFullHandlers: this.getBooleanEnv('DEBUG_LOG_FULL_HANDLERS', false),
        logFullWsMessages: this.getBooleanEnv('DEBUG_LOG_FULL_WS_MESSAGES', true),
      };
    }

    return {
      enabled,
      logDir: process.env.DEBUG_LOG_DIR || '.debug-logs',
      maxSizeMB: this.getNumberEnv('DEBUG_LOG_MAX_SIZE_MB', 50),
      maxFiles: this.getNumberEnv('DEBUG_LOG_MAX_FILES', 10),
      channels,
      logFullHandlers: this.getBooleanEnv('DEBUG_LOG_FULL_HANDLERS', false),
      logFullWsMessages: this.getBooleanEnv('DEBUG_LOG_FULL_WS_MESSAGES', true),
    };
  }

  /**
   * Get Node environment with validation
   */
  private getNodeEnv(): NodeEnv {
    const env = process.env.NODE_ENV?.toLowerCase();
    if (env === 'production' || env === 'test') {
      return env;
    }
    return 'development';
  }

  /**
   * Get log level with validation
   */
  private getLogLevel(): LogLevel {
    const level = process.env.LOG_LEVEL?.toLowerCase();
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      return level;
    }
    return 'info';
  }

  /**
   * Get numeric environment variable with default
   */
  private getNumberEnv(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      console.error(`Invalid number for ${key}="${value}", using default: ${defaultValue}`);
      return defaultValue;
    }
    return parsed;
  }

  /**
   * Get boolean environment variable with default
   */
  private getBooleanEnv(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) {
      return defaultValue;
    }
    return value.toLowerCase() === 'true' || value === '1';
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    // Validate BC configuration
    if (!this.config.bc.baseUrl) {
      throw new Error('BC_BASE_URL is required');
    }

    if (!this.config.bc.username) {
      throw new Error('BC_USERNAME is required');
    }

    // Password can be empty for some environments
    if (this.config.bc.password === '') {
      console.error('BC_PASSWORD is empty - authentication may fail');
    }

    // Validate URL format
    try {
      new URL(this.config.bc.baseUrl);
    } catch (error) {
      throw new Error(`Invalid BC_BASE_URL: ${this.config.bc.baseUrl}`);
    }

    // Log configuration (without sensitive data) - use console.error to write to stderr for MCP stdio compatibility
    if (process.env.NODE_ENV !== 'test') {
      console.error('Configuration loaded:', {
        nodeEnv: this.config.nodeEnv,
        logLevel: this.config.logLevel,
        bcBaseUrl: this.config.bc.baseUrl,
        bcUsername: this.config.bc.username,
        bcTenantId: this.config.bc.tenantId,
        bcTimeout: this.config.bc.timeout,
      });
    }
  }

  /**
   * Get the full configuration
   */
  public getConfig(): Readonly<AppConfig> {
    return this.config;
  }

  /**
   * Get Node environment
   */
  public get nodeEnv(): NodeEnv {
    return this.config.nodeEnv;
  }

  /**
   * Get log level
   */
  public get logLevel(): LogLevel {
    return this.config.logLevel;
  }

  /**
   * Get BC configuration
   */
  public get bc(): Readonly<BCConfig> {
    return this.config.bc;
  }

  /**
   * Get debug configuration
   */
  public get debug(): Readonly<DebugConfig> {
    return this.config.debug;
  }

  /**
   * Check if running in development mode
   */
  public get isDevelopment(): boolean {
    return this.config.nodeEnv === 'development';
  }

  /**
   * Check if running in production mode
   */
  public get isProduction(): boolean {
    return this.config.nodeEnv === 'production';
  }

  /**
   * Check if running in test mode
   */
  public get isTest(): boolean {
    return this.config.nodeEnv === 'test';
  }
}

// Create singleton instance
const configInstance = new Config();

// Export the singleton
export const config = configInstance;

// Export convenience accessors
export const bcConfig = configInstance.bc;
export const isDevelopment = configInstance.isDevelopment;
export const isProduction = configInstance.isProduction;
export const isTest = configInstance.isTest;
export const nodeEnv = configInstance.nodeEnv;
export const logLevel = configInstance.logLevel;