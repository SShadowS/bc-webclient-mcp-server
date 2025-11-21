/**
 * Connection Pool for Business Central WebSocket Clients
 *
 * Manages a pool of authenticated, ready-to-use BCRawWebSocketClient connections
 * to eliminate expensive connection setup overhead on every request.
 *
 * Features:
 * - Lazy initialization (creates connections on demand)
 * - Health checks (validates connections before returning from pool)
 * - Automatic cleanup (removes stale/unhealthy connections)
 * - Concurrency control (max pool size, request queuing)
 * - Idle timeout (closes connections after inactivity)
 */

import { BCRawWebSocketClient } from '../connection/clients/BCRawWebSocketClient.js';
import type { BCConfig } from '../types.js';
import { logger } from '../core/logger.js';
import { ConnectionError, TimeoutError } from '../core/errors.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a pooled connection with metadata
 */
interface PooledConnection {
  /** Unique identifier for this pooled connection */
  id: string;

  /** The underlying BC WebSocket client */
  client: BCRawWebSocketClient;

  /** When this connection was created */
  createdAt: Date;

  /** Last time this connection was used */
  lastUsedAt: Date;

  /** Whether this connection passed recent health check */
  isHealthy: boolean;

  /** Whether this connection is currently in use */
  inUse: boolean;
}

/**
 * Request waiting in queue for an available connection
 */
interface QueuedRequest {
  /** Resolve promise with connection */
  resolve: (connection: PooledConnection) => void;

  /** Reject promise with error */
  reject: (error: Error) => void;

  /** Timeout handle for this request */
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Configuration for the connection pool
 */
export interface ConnectionPoolConfig {
  /** Minimum number of connections to keep warm (default: 2) */
  minConnections?: number;

  /** Maximum number of connections allowed (default: 10) */
  maxConnections?: number;

  /** Idle timeout in milliseconds (default: 300000 = 5 minutes) */
  idleTimeoutMs?: number;

  /** Health check interval in milliseconds (default: 60000 = 1 minute) */
  healthCheckIntervalMs?: number;

  /** Timeout for acquiring a connection in milliseconds (default: 30000 = 30 seconds) */
  acquireTimeoutMs?: number;
}

/**
 * Connection pool for BC WebSocket clients
 *
 * Usage:
 * ```typescript
 * const pool = new BCConnectionPool(config, username, password, tenantId);
 * await pool.initialize();
 *
 * const connection = await pool.acquire();
 * try {
 *   await connection.client.invoke(...);
 * } finally {
 *   await pool.release(connection);
 * }
 *
 * await pool.shutdown();
 * ```
 */
export class BCConnectionPool {
  private readonly config: BCConfig;
  private readonly username: string;
  private readonly password: string;
  private readonly tenantId: string;

  private readonly minConnections: number;
  private readonly maxConnections: number;
  private readonly idleTimeoutMs: number;
  private readonly healthCheckIntervalMs: number;
  private readonly acquireTimeoutMs: number;

  /** Pool of available (idle) connections */
  private availableConnections: PooledConnection[] = [];

  /** Set of currently active (in-use) connections */
  private activeConnections = new Set<PooledConnection>();

  /** Queue of requests waiting for connections */
  private waitQueue: QueuedRequest[] = [];

  /** Health check interval handle */
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /** Idle cleanup interval handle */
  private idleCleanupInterval: NodeJS.Timeout | null = null;

  /** Whether the pool has been initialized */
  private initialized = false;

  /** Whether the pool is shutting down */
  private shuttingDown = false;

  constructor(
    config: BCConfig,
    username: string,
    password: string,
    tenantId: string = '',
    poolConfig?: ConnectionPoolConfig
  ) {
    this.config = config;
    this.username = username;
    this.password = password;
    this.tenantId = tenantId;

    // Pool configuration with defaults
    this.minConnections = poolConfig?.minConnections ?? 1; // Default 1 to avoid BC rate limiting
    this.maxConnections = poolConfig?.maxConnections ?? 10;
    this.idleTimeoutMs = poolConfig?.idleTimeoutMs ?? 300000; // 5 minutes
    this.healthCheckIntervalMs = poolConfig?.healthCheckIntervalMs ?? 60000; // 1 minute
    this.acquireTimeoutMs = poolConfig?.acquireTimeoutMs ?? 30000; // 30 seconds

    // Validate configuration
    if (this.minConnections < 0) {
      throw new Error('minConnections must be >= 0');
    }
    if (this.maxConnections < 1) {
      throw new Error('maxConnections must be >= 1');
    }
    if (this.minConnections > this.maxConnections) {
      throw new Error('minConnections cannot exceed maxConnections');
    }
  }

  /**
   * Initialize the connection pool
   * Creates minimum number of connections and starts background tasks
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Connection pool already initialized');
      return;
    }

    logger.info(`Initializing connection pool (min: ${this.minConnections}, max: ${this.maxConnections})...`);

    // Create minimum connections SEQUENTIALLY with delay to avoid BC rate limiting
    // BC server rejects rapid successive connections, so we space them out
    for (let i = 0; i < this.minConnections; i++) {
      try {
        const conn = await this.createConnection();
        this.availableConnections.push(conn);
        logger.info(`  Created warm connection ${conn.id}`);

        // Add 500ms delay between connections to avoid BC rate limiting
        if (i < this.minConnections - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        logger.warn({ error }, `  Failed to create warm connection: ${error instanceof Error ? error.message : String(error)}`);
        // Don't fail initialization if we can't create min connections
        // Pool will create on demand
      }
    }

    // Start background tasks
    this.startHealthChecks();
    this.startIdleCleanup();

    this.initialized = true;
    logger.info(`Connection pool initialized (${this.availableConnections.length} connections ready)`);
  }

  /**
   * Acquire a connection from the pool
   *
   * @param attempt Current retry attempt (internal parameter for recursion limit)
   * @returns Promise that resolves with a pooled connection
   * @throws TimeoutError if no connection available within timeout
   * @throws ConnectionError if pool is shutting down or max retries exceeded
   */
  async acquire(attempt: number = 0): Promise<PooledConnection> {
    if (this.shuttingDown) {
      throw new ConnectionError('Connection pool is shutting down');
    }

    if (!this.initialized) {
      throw new ConnectionError('Connection pool not initialized. Call initialize() first.');
    }

    // Prevent infinite recursion - fail after 5 attempts
    if (attempt > 5) {
      throw new ConnectionError(
        'Failed to acquire a healthy connection after 5 attempts. ' +
        'This indicates a systemic issue with connection health checks.'
      );
    }

    // Try to get an available connection
    let connection = this.availableConnections.pop();

    // If no available connection, try to create a new one
    if (!connection) {
      const totalConnections = this.availableConnections.length + this.activeConnections.size;

      if (totalConnections < this.maxConnections) {
        // Create new connection
        logger.info(`No available connections, creating new one (${totalConnections + 1}/${this.maxConnections})...`);
        connection = await this.createConnection();
      } else {
        // Pool exhausted, wait for a connection to be released
        logger.info(`Pool exhausted (${this.maxConnections} active), queuing request...`);
        connection = await this.waitForConnection();
      }
    }

    // Health check the connection before returning
    const isHealthy = await this.checkHealth(connection);

    if (!isHealthy) {
      logger.warn(`Connection ${connection.id} failed health check (attempt ${attempt + 1}/5), creating replacement...`);
      await this.destroyConnection(connection);

      // Recursively try to get another connection (with attempt counter)
      return this.acquire(attempt + 1);
    }

    // Mark as in use
    connection.inUse = true;
    connection.lastUsedAt = new Date();
    this.activeConnections.add(connection);

    logger.info(`Acquired connection ${connection.id} (${this.activeConnections.size} active, ${this.availableConnections.length} available)`);

    return connection;
  }

  /**
   * Release a connection back to the pool
   *
   * @param connection The connection to release
   */
  async release(connection: PooledConnection): Promise<void> {
    if (!connection.inUse) {
      logger.warn(`Connection ${connection.id} was not in use`);
      return;
    }

    // Mark as available
    connection.inUse = false;
    connection.lastUsedAt = new Date();
    this.activeConnections.delete(connection);

    // Check if there are queued requests waiting
    const queuedRequest = this.waitQueue.shift();

    if (queuedRequest) {
      // Give connection directly to waiting request
      clearTimeout(queuedRequest.timeoutHandle);
      connection.inUse = true;
      this.activeConnections.add(connection);
      queuedRequest.resolve(connection);

      logger.info(`Released connection ${connection.id} to queued request (${this.waitQueue.length} still waiting)`);
    } else {
      // Return to available pool
      this.availableConnections.push(connection);

      logger.info(`Released connection ${connection.id} (${this.activeConnections.size} active, ${this.availableConnections.length} available)`);
    }
  }

  /**
   * Shutdown the connection pool
   * Closes all connections and stops background tasks
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    logger.info('Shutting down connection pool...');
    this.shuttingDown = true;

    // Stop background tasks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.idleCleanupInterval) {
      clearInterval(this.idleCleanupInterval);
      this.idleCleanupInterval = null;
    }

    // Reject all queued requests
    for (const request of this.waitQueue) {
      clearTimeout(request.timeoutHandle);
      request.reject(new ConnectionError('Connection pool shutting down'));
    }
    this.waitQueue = [];

    // Close all connections
    const closePromises: Promise<void>[] = [];

    for (const connection of this.activeConnections) {
      closePromises.push(this.destroyConnection(connection));
    }
    for (const connection of this.availableConnections) {
      closePromises.push(this.destroyConnection(connection));
    }

    await Promise.allSettled(closePromises);

    this.activeConnections.clear();
    this.availableConnections = [];
    this.initialized = false;

    logger.info('Connection pool shutdown complete');
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    available: number;
    active: number;
    total: number;
    queued: number;
    maxConnections: number;
  } {
    return {
      available: this.availableConnections.length,
      active: this.activeConnections.size,
      total: this.availableConnections.length + this.activeConnections.size,
      queued: this.waitQueue.length,
      maxConnections: this.maxConnections,
    };
  }

  /**
   * Create a new connection
   * @private
   */
  private async createConnection(): Promise<PooledConnection> {
    const id = uuidv4().substring(0, 8);

    logger.info(`Creating new connection ${id}...`);

    const client = new BCRawWebSocketClient(
      this.config,
      this.username,
      this.password,
      this.tenantId
    );

    try {
      // Full connection lifecycle
      await client.authenticateWeb();
      await client.connect();
      await client.openSession({
        clientType: 'WebClient',
        clientVersion: '27.0.0.0',
        clientCulture: 'en-US',
        clientTimeZone: 'UTC',
      });

      const connection: PooledConnection = {
        id,
        client,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        isHealthy: true,
        inUse: false,
      };

      logger.info(`Created connection ${id}`);

      return connection;
    } catch (error) {
      logger.warn({ error }, `Failed to create connection ${id}: ${error instanceof Error ? error.message : String(error)}`);

      // Try to disconnect if partially created
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      throw new ConnectionError(
        `Failed to create pooled connection: ${error instanceof Error ? error.message : String(error)}`,
        { error }
      );
    }
  }

  /**
   * Destroy a connection
   * @private
   */
  private async destroyConnection(connection: PooledConnection): Promise<void> {
    logger.info(`Destroying connection ${connection.id}...`);

    try {
      await connection.client.disconnect();
    } catch (error) {
      logger.warn({ error }, `Error disconnecting ${connection.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Remove from tracking
    this.activeConnections.delete(connection);
    const index = this.availableConnections.indexOf(connection);
    if (index !== -1) {
      this.availableConnections.splice(index, 1);
    }
  }

  /**
   * Wait for a connection to become available
   * @private
   */
  private waitForConnection(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from queue
        const index = this.waitQueue.findIndex(r => r.resolve === resolve);
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }

        reject(new TimeoutError(
          `Timeout waiting for connection after ${this.acquireTimeoutMs}ms (pool exhausted)`,
          { timeoutMs: this.acquireTimeoutMs }
        ));
      }, this.acquireTimeoutMs);

      this.waitQueue.push({ resolve, reject, timeoutHandle });
    });
  }

  /**
   * Check if a connection is healthy
   * @private
   */
  private async checkHealth(connection: PooledConnection): Promise<boolean> {
    try {
      // Check basic ready state
      if (!connection.client.isReady()) {
        logger.warn(`Connection ${connection.id} not ready`);
        return false;
      }

      // Ping test: Try to get server session ID
      const sessionId = connection.client.getServerSessionId();
      if (!sessionId) {
        logger.warn(`Connection ${connection.id} has no server session ID`);
        return false;
      }

      connection.isHealthy = true;
      return true;
    } catch (error) {
      logger.warn({ error }, `Health check failed for connection ${connection.id}: ${error instanceof Error ? error.message : String(error)}`);
      connection.isHealthy = false;
      return false;
    }
  }

  /**
   * Start periodic health checks
   * @private
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      logger.info('Running health checks on available connections...');

      const unhealthyConnections: PooledConnection[] = [];

      for (const connection of this.availableConnections) {
        const isHealthy = await this.checkHealth(connection);
        if (!isHealthy) {
          unhealthyConnections.push(connection);
        }
      }

      // Remove unhealthy connections
      for (const connection of unhealthyConnections) {
        logger.warn(`Removing unhealthy connection ${connection.id} from pool`);
        await this.destroyConnection(connection);
      }

      if (unhealthyConnections.length > 0) {
        logger.info(`  Removed ${unhealthyConnections.length} unhealthy connection(s)`);
      }
    }, this.healthCheckIntervalMs);
  }

  /**
   * Start periodic idle connection cleanup
   * @private
   */
  private startIdleCleanup(): void {
    this.idleCleanupInterval = setInterval(async () => {
      const now = new Date();
      const idleConnections: PooledConnection[] = [];

      for (const connection of this.availableConnections) {
        const idleTime = now.getTime() - connection.lastUsedAt.getTime();
        if (idleTime > this.idleTimeoutMs) {
          idleConnections.push(connection);
        }
      }

      // Keep at least minConnections
      const totalAfterCleanup = this.availableConnections.length - idleConnections.length + this.activeConnections.size;
      const canRemove = Math.max(0, totalAfterCleanup - this.minConnections);
      const toRemove = idleConnections.slice(0, canRemove);

      for (const connection of toRemove) {
        logger.info(`Removing idle connection ${connection.id} (idle for ${Math.round((now.getTime() - connection.lastUsedAt.getTime()) / 1000)}s)`);
        await this.destroyConnection(connection);
      }

      if (toRemove.length > 0) {
        logger.info(`  Removed ${toRemove.length} idle connection(s)`);
      }
    }, this.healthCheckIntervalMs); // Run cleanup at same interval as health checks
  }
}
