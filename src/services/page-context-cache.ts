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
import type { RepeaterColumnDescription } from '../types/mcp-types.js';
import { mergeColumns } from '../protocol/rcc-extractor.js';
import type { PageState } from '../state/page-state.js';

const logger = createToolLogger('PageContextCache');

export interface CachedPageContext {
  sessionId: string;
  pageId: string;
  formIds: string[];
  openedAt: number;
  pageType: 'List' | 'Card' | 'Document' | 'Worksheet' | 'Report';
  logicalForm: any;
  handlers: any[];
  // PageState (Phase 1: Dual-state approach)
  pageState?: PageState;
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
      const jsonStr = JSON.stringify(cachedContext, this.jsonReplacer, 2);
      await fs.writeFile(filePath, jsonStr, 'utf8');
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
      const context: CachedPageContext = JSON.parse(content, this.jsonReviver);

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
          const context: CachedPageContext = JSON.parse(content, this.jsonReviver);

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
          const context: CachedPageContext = JSON.parse(content, this.jsonReviver);

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

  /**
   * Enriches repeater columns in a cached page context.
   *
   * This method progressively enriches column metadata as BC sends 'rcc' messages
   * during normal operations (read_page_data, execute_action, etc.).
   *
   * @param pageContextId - Unique identifier for the page context
   * @param formId - FormId of the repeater to enrich
   * @param columns - Column metadata discovered from 'rcc' messages
   * @returns true if enrichment successful, false if context not found
   */
  public async enrichRepeaterColumns(
    pageContextId: string,
    formId: string,
    columns: RepeaterColumnDescription[]
  ): Promise<boolean> {
    await this.ensureInitialized();

    // Load existing context
    const context = await this.load(pageContextId);
    if (!context) {
      logger.warn(`Cannot enrich: pageContext not found: ${pageContextId}`);
      return false;
    }

    // Find repeater in LogicalForm by formId
    const repeater = this.findRepeaterByFormId(context.logicalForm, formId);
    if (!repeater) {
      logger.warn(`Cannot enrich: repeater not found for formId ${formId} in ${pageContextId}`);
      return false;
    }

    // Merge new columns with existing
    const existingColumns = repeater.Columns || [];
    const mergedColumns = mergeColumns(existingColumns, columns);

    // Update repeater
    repeater.Columns = mergedColumns;

    // Save enriched context
    await this.save(pageContextId, context);

    logger.info(`Enriched repeater columns in ${pageContextId}: formId=${formId}, ${existingColumns.length} -> ${mergedColumns.length} columns`);

    return true;
  }

  /**
   * Find a repeater control by formId in LogicalForm tree
   */
  private findRepeaterByFormId(obj: any, targetFormId: string): any {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    // Check if this object is a repeater with matching FormId
    if ((obj.t === 'rc' || obj.t === 'BindablePagePartControl') && obj.FormId === targetFormId) {
      return obj;
    }

    // Recurse into arrays
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = this.findRepeaterByFormId(item, targetFormId);
        if (found) return found;
      }
      return null;
    }

    // Recurse into object properties
    for (const key in obj) {
      const found = this.findRepeaterByFormId(obj[key], targetFormId);
      if (found) return found;
    }

    return null;
  }

  // ============================================================================
  // PageState Methods (Phase 1: Dual-State Approach)
  // ============================================================================

  /**
   * Get PageState for a cached page context
   *
   * Phase 1: Returns undefined if not yet initialized
   * Tools should check if PageState exists before using it
   *
   * @param pageContextId - Page context identifier
   * @returns PageState or undefined
   */
  public async getPageState(pageContextId: string): Promise<PageState | undefined> {
    await this.ensureInitialized();

    const context = await this.load(pageContextId);
    if (!context) {
      logger.debug(`getPageState: Context not found for "${pageContextId}"`);
      return undefined;
    }

    return context.pageState;
  }

  /**
   * Set PageState for a cached page context
   *
   * Phase 1: Updates existing context with PageState
   * Context must already exist (created by save())
   *
   * @param pageContextId - Page context identifier
   * @param pageState - PageState to save
   */
  public async setPageState(pageContextId: string, pageState: PageState): Promise<void> {
    await this.ensureInitialized();

    const context = await this.load(pageContextId);
    if (!context) {
      logger.warn(`setPageState: Context not found for "${pageContextId}", cannot set PageState`);
      return;
    }

    // Update context with PageState
    context.pageState = pageState;
    context.savedAt = Date.now();

    // CRITICAL FIX: Save with jsonReplacer to preserve PageState Maps
    // The jsonReplacer only affects Maps (PageState), not LogicalForm or handlers
    const filePath = this.getFilePath(pageContextId);
    const jsonStr = JSON.stringify(context, this.jsonReplacer, 2);
    await fs.writeFile(filePath, jsonStr, 'utf8');

    logger.debug(`PageState saved for "${pageContextId}"`);
  }

  /**
   * Check if PageState exists for a page context
   *
   * @param pageContextId - Page context identifier
   * @returns true if PageState exists
   */
  public async hasPageState(pageContextId: string): Promise<boolean> {
    const pageState = await this.getPageState(pageContextId);
    return pageState !== undefined;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * JSON replacer for serializing PageState Maps
   * Converts Maps to objects for JSON storage
   */
  private jsonReplacer = (key: string, value: any): any => {
    if (value instanceof Map) {
      return {
        _type: 'Map',
        _entries: Array.from(value.entries()),
      };
    }
    return value;
  };

  /**
   * JSON reviver for deserializing PageState Maps
   * Converts stored objects back to Maps
   */
  private jsonReviver = (key: string, value: any): any => {
    if (value && value._type === 'Map') {
      return new Map(value._entries);
    }
    return value;
  };

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
