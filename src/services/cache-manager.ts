/**
 * Cache Manager for Business Central MCP Server
 *
 * Provides time-based LRU caching with:
 * - TTL (Time To Live) expiration
 * - LRU eviction when cache full
 * - Cache stampede protection (coalescing)
 * - Hit/miss statistics
 * - Background cleanup
 *
 * Usage:
 * ```typescript
 * const cache = new CacheManager({ maxEntries: 1000 });
 *
 * // Check cache
 * const cached = cache.get<SearchResult>('search:customer:Card:10');
 * if (cached) return cached;
 *
 * // Fetch and cache
 * const result = await fetchData();
 * cache.set('search:customer:Card:10', result, 300000); // 5 min TTL
 * ```
 */

import { logger } from '../core/logger.js';

/**
 * Cache entry with metadata
 */
interface CacheEntry<T = any> {
  /** The cache key */
  key: string;

  /** The cached value */
  value: T;

  /** When this entry expires (timestamp) */
  expiresAt: number;

  /** Last time this entry was accessed (timestamp) */
  accessedAt: number;

  /** When this entry was created (timestamp) */
  createdAt: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total number of cache lookups */
  totalRequests: number;

  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Cache hit rate (0-1) */
  hitRate: number;

  /** Current number of entries */
  size: number;

  /** Maximum number of entries allowed */
  maxEntries: number;

  /** Number of entries evicted due to size limit */
  evictions: number;

  /** Number of entries expired */
  expirations: number;
}

/**
 * Pending cache operation (for stampede protection)
 */
interface PendingOperation<T> {
  /** Promise that will resolve with the value */
  promise: Promise<T>;

  /** Resolve function */
  resolve: (value: T) => void;

  /** Reject function */
  reject: (error: Error) => void;
}

/**
 * Configuration for cache manager
 */
export interface CacheManagerConfig {
  /** Maximum number of entries (default: 1000) */
  maxEntries?: number;

  /** Cleanup interval in milliseconds (default: 60000 = 1 minute) */
  cleanupIntervalMs?: number;

  /** Default TTL if not specified in set() (default: 300000 = 5 minutes) */
  defaultTtlMs?: number;

  /** Enable cache stampede protection (default: true) */
  enableCoalescing?: boolean;
}

/**
 * Cache manager with TTL and LRU eviction
 *
 * Features:
 * - Time-based expiration (TTL)
 * - LRU eviction when cache full
 * - Cache stampede protection via coalescing
 * - Hit/miss statistics
 * - Background cleanup
 */
export class CacheManager {
  private readonly maxEntries: number;
  private readonly cleanupIntervalMs: number;
  private readonly defaultTtlMs: number;
  private readonly enableCoalescing: boolean;

  /** Cache storage */
  private cache = new Map<string, CacheEntry>();

  /** Pending operations (for stampede protection) */
  private pendingOperations = new Map<string, PendingOperation<any>>();

  /** Cleanup interval handle */
  private cleanupInterval: NodeJS.Timeout | null = null;

  /** Statistics */
  private stats = {
    totalRequests: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  constructor(config?: CacheManagerConfig) {
    this.maxEntries = config?.maxEntries ?? 1000;
    this.cleanupIntervalMs = config?.cleanupIntervalMs ?? 60000; // 1 minute
    this.defaultTtlMs = config?.defaultTtlMs ?? 300000; // 5 minutes
    this.enableCoalescing = config?.enableCoalescing ?? true;

    // Validate configuration
    if (this.maxEntries < 1) {
      throw new Error('maxEntries must be >= 1');
    }

    // Start background cleanup
    this.startCleanup();
  }

  /**
   * Get a value from the cache
   *
   * @param key The cache key
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): T | null {
    this.stats.totalRequests++;

    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.stats.misses++;
      this.cache.delete(key);
      this.stats.expirations++;
      return null;
    }

    // Update access time (for LRU)
    entry.accessedAt = Date.now();

    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * Set a value in the cache
   *
   * @param key The cache key
   * @param value The value to cache
   * @param ttlMs Time to live in milliseconds (default: config.defaultTtlMs)
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      key,
      value,
      expiresAt: now + ttl,
      accessedAt: now,
      createdAt: now,
    };

    // Check if we need to evict entries
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, entry);

    logger.debug(`Cache set: ${key} (TTL: ${ttl}ms, size: ${this.cache.size}/${this.maxEntries})`);
  }

  /**
   * Delete a value from the cache
   *
   * @param key The cache key
   * @returns True if the entry was deleted
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries matching a pattern
   *
   * @param pattern Glob-style pattern (e.g., "search:*")
   */
  invalidate(pattern: string): number {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*') // Convert * to .*
      .replace(/\?/g, '.'); // Convert ? to .

    const regex = new RegExp(`^${regexPattern}$`);

    let count = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.info(`Invalidated ${count} cache entries matching pattern: ${pattern}`);
    }

    return count;
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.pendingOperations.clear();

    logger.info(`Cache cleared (${size} entries removed)`);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      totalRequests: this.stats.totalRequests,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.stats.totalRequests > 0
        ? this.stats.hits / this.stats.totalRequests
        : 0,
      size: this.cache.size,
      maxEntries: this.maxEntries,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };

    logger.debug('Cache statistics reset');
  }

  /**
   * Execute an operation with cache stampede protection
   *
   * If multiple requests for the same key arrive simultaneously,
   * only the first one executes the operation. Others wait for
   * the result and receive the same value.
   *
   * @param key The cache key
   * @param operation The operation to execute if not cached
   * @param ttlMs TTL for the cached result
   * @returns The cached or computed value
   */
  async getOrCompute<T>(
    key: string,
    operation: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // If coalescing disabled, just execute
    if (!this.enableCoalescing) {
      const result = await operation();
      this.set(key, result, ttlMs);
      return result;
    }

    // Check if operation already pending for this key
    const pending = this.pendingOperations.get(key);
    if (pending) {
      logger.debug(`Cache coalescing: waiting for pending operation ${key}`);
      return pending.promise;
    }

    // Create pending operation
    let resolve: (value: T) => void;
    let reject: (error: Error) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.pendingOperations.set(key, { promise, resolve: resolve!, reject: reject! });

    try {
      logger.debug(`Cache miss: executing operation for ${key}`);

      const result = await operation();

      // Cache the result
      this.set(key, result, ttlMs);

      // Resolve pending operation
      resolve!(result);

      return result;
    } catch (error) {
      // Reject pending operation
      reject!(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      // Clean up pending operation
      this.pendingOperations.delete(key);
    }
  }

  /**
   * Shutdown the cache manager
   * Stops background cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    logger.info('Cache manager shutdown');
  }

  /**
   * Evict the least recently used entry
   * @private
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    // Find the entry with the oldest access time
    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      logger.debug(`Cache LRU eviction: ${oldestKey}`);
    }
  }

  /**
   * Start background cleanup of expired entries
   * @private
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupIntervalMs);
  }

  /**
   * Remove expired entries from cache
   * @private
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.stats.expirations++;
    }

    if (expiredKeys.length > 0) {
      logger.debug(`Cache cleanup: removed ${expiredKeys.length} expired entries`);
    }
  }
}
