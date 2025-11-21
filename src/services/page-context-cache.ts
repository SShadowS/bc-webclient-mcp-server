/**
 * Page Context Cache Service
 *
 * Persists pageContexts to disk to survive MCP server restarts.
 * Allows Claude to reuse previously opened pages across conversations.
 *
 * Storage Format:
 * - Directory: .cache/pageContexts/
 * - Files: {pageContextId}.json
 * - TTL: 1 hour (configurable)
 *
 * Example:
 * ```typescript
 * const cache = PageContextCache.getInstance();
 *
 * // Save context
 * await cache.save(pageContextId, {
 *   sessionId,
 *   pageId,
 *   pageType,
 *   logicalForm,
 *   handlers,
 *   ...
 * });
 *
 * // Load context (auto-cleans expired)
 * const context = await cache.load(pageContextId);
 * if (context) {
 *   // Reuse existing page!
 * }
 * ```
 */

import fs from 'fs/promises';
import path from 'path';
import { createToolLogger } from '../core/logger.js';

const logger = createToolLogger('PageContextCache');

export interface CachedPageContext {
  sessionId: string;
  pageId: string;
  formIds: string[];
  openedAt: number;
  pageType: 'List' | 'Card' | 'Document' | 'Worksheet' | 'Report';
  logicalForm: any;
  handlers: any[];
  // Metadata
  expiresAt: number;
  savedAt: number;
}

export interface PageContextCacheConfig {
  cacheDir?: string;
  ttlMs?: number;  // Time-to-live in milliseconds
  cleanupOnStartup?: boolean;
}

/**
 * Singleton cache manager for pageContexts.
 * Persists to JSON files for durability across restarts.
 */
export class PageContextCache {
  private static instance: PageContextCache | null = null;

  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  private constructor(config: PageContextCacheConfig = {}) {
    this.cacheDir = config.cacheDir || path.join(process.cwd(), '.cache', 'pageContexts');
    this.ttlMs = config.ttlMs || 60 * 60 * 1000; // Default: 1 hour
  }

  /**
   * Gets singleton instance.
   */
  public static getInstance(config?: PageContextCacheConfig): PageContextCache {
    if (!PageContextCache.instance) {
      PageContextCache.instance = new PageContextCache(config);
    }
    return PageContextCache.instance;
  }

  /**
   * Initializes cache directory and cleans up expired entries.
   * Uses Promise-based lock to prevent concurrent initializations.
   */
  public async initialize(): Promise<void> {
    // Already initialized - return immediately
    if (this.initialized) {
      return;
    }

    // Initialization in progress - wait for it to complete
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start new initialization
    this.initializationPromise = (async () => {
      logger.info(`Initializing PageContextCache at: ${this.cacheDir}`);

      // Create cache directory if it doesn't exist
      try {
        await fs.mkdir(this.cacheDir, { recursive: true });
        logger.info(`Cache directory ready`);
      } catch (error) {
        logger.error(`Failed to create cache directory: ${error}`);
        throw error;
      }

      // Clean up expired entries
      await this.cleanup();

      this.initialized = true;
      logger.info(`PageContextCache initialized`);
    })();

    return this.initializationPromise;
  }

  /**
   * Saves a pageContext to disk.
   *
   * @param pageContextId - Unique identifier for this page context
   * @param context - Page context data (without expiresAt/savedAt, will be added)
   */
  public async save(
    pageContextId: string,
    context: Omit<CachedPageContext, 'expiresAt' | 'savedAt'>
  ): Promise<void> {
    await this.ensureInitialized();

    const now = Date.now();
    const cachedContext: CachedPageContext = {
      ...context,
      savedAt: now,
      expiresAt: now + this.ttlMs,
    };

    const filePath = this.getFilePath(pageContextId);

    try {
      await fs.writeFile(filePath, JSON.stringify(cachedContext, null, 2), 'utf8');
      logger.info(`Saved pageContext: ${pageContextId} (expires in ${this.ttlMs / 1000}s)`);
    } catch (error) {
      logger.error(`Failed to save pageContext ${pageContextId}: ${error}`);
      throw error;
    }
  }

  /**
   * Loads a pageContext from disk.
   * Returns null if not found or expired.
   *
   * @param pageContextId - Unique identifier for this page context
   * @returns Cached context or null
   */
  public async load(pageContextId: string): Promise<CachedPageContext | null> {
    await this.ensureInitialized();

    const filePath = this.getFilePath(pageContextId);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const context: CachedPageContext = JSON.parse(content);

      // Check if expired
      if (Date.now() > context.expiresAt) {
        logger.info(`PageContext expired: ${pageContextId}`);
        await this.delete(pageContextId);
        return null;
      }

      const age = Math.round((Date.now() - context.savedAt) / 1000);
      logger.info(`Loaded pageContext: ${pageContextId} (age: ${age}s)`);
      return context;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - not an error
        logger.info(`PageContext not found in cache: ${pageContextId}`);
        return null;
      }
      logger.error(`Failed to load pageContext ${pageContextId}: ${error}`);
      return null;
    }
  }

  /**
   * Deletes a pageContext from disk.
   */
  public async delete(pageContextId: string): Promise<void> {
    const filePath = this.getFilePath(pageContextId);

    try {
      await fs.unlink(filePath);
      logger.info(`Deleted pageContext: ${pageContextId}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error(`Failed to delete pageContext ${pageContextId}: ${error}`);
      }
    }
  }

  /**
   * Cleans up expired pageContexts.
   * Returns number of deleted entries.
   * NOTE: This method is called during initialization, so it should NOT call ensureInitialized()
   */
  public async cleanup(): Promise<number> {
    // Don't call ensureInitialized() here - this is called FROM initialize()

    const now = Date.now();
    let deletedCount = 0;

    try {
      const files = await fs.readdir(this.cacheDir);
      logger.info(`Cleaning up cache: ${files.length} entries found`);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(this.cacheDir, file);

        try {
          const content = await fs.readFile(filePath, 'utf8');
          const context: CachedPageContext = JSON.parse(content);

          if (now > context.expiresAt) {
            await fs.unlink(filePath);
            deletedCount++;
            logger.info(`  Deleted expired: ${file}`);
          }
        } catch (error) {
          // Corrupted file - delete it
          logger.warn(`  Deleting corrupted file: ${file}`);
          await fs.unlink(filePath);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleanup complete: removed ${deletedCount} expired entries`);
      } else {
        logger.info(`Cleanup complete: no expired entries`);
      }

      return deletedCount;
    } catch (error) {
      logger.error(`Cleanup failed: ${error}`);
      return 0;
    }
  }

  /**
   * Lists all cached pageContexts (for debugging).
   * Returns map of pageContextId → metadata.
   */
  public async list(): Promise<Map<string, { pageId: string; pageType: string; age: number; ttl: number }>> {
    await this.ensureInitialized();

    const result = new Map();
    const now = Date.now();

    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(this.cacheDir, file);

        try {
          const content = await fs.readFile(filePath, 'utf8');
          const context: CachedPageContext = JSON.parse(content);

          const pageContextId = file.replace('.json', '');
          const age = Math.round((now - context.savedAt) / 1000);
          const ttl = Math.round((context.expiresAt - now) / 1000);

          result.set(pageContextId, {
            pageId: context.pageId,
            pageType: context.pageType,
            age,
            ttl,
          });
        } catch (error) {
          // Skip corrupted files
        }
      }
    } catch (error) {
      logger.error(`Failed to list cache: ${error}`);
    }

    return result;
  }

  /**
   * Clears all cached pageContexts (for testing/debugging).
   */
  public async clear(): Promise<void> {
    await this.ensureInitialized();

    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(this.cacheDir, file));
        }
      }

      logger.info(`Cache cleared`);
    } catch (error) {
      logger.error(`Failed to clear cache: ${error}`);
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private getFilePath(pageContextId: string): string {
    // Sanitize pageContextId to prevent directory traversal and invalid filename characters
    // Replace colons (invalid on Windows) and other special chars with underscores
    const safeName = pageContextId.replace(/[^a-zA-Z0-9-]/g, '_');
    return path.join(this.cacheDir, `${safeName}.json`);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
