/**
 * Filter Metadata Service
 *
 * Provides caching for filter-related metadata to optimize repeated filter operations.
 *
 * Architecture (validated by GPT-5.1 high reasoning review):
 * - Wraps existing CacheManager for consistency
 * - Uses namespaced keys for different cache types
 * - Integrates with ConnectionManager for session lifecycle management
 *
 * Phase 1: Filter State Cache (HIGHEST VALUE)
 * - Tracks currently applied filters per session+page
 * - Prevents redundant Filter + SaveValue WebSocket calls
 * - Biggest performance win: avoids round-trip latency
 *
 * Phase 2: Repeater Path Cache (MEDIUM VALUE)
 * - Caches repeater control paths to avoid tree walks
 * - Reduces CPU cost of LogicalForm traversal
 *
 * Phase 3: Field Metadata Cache (LOWER VALUE)
 * - Caches filterable field metadata for pre-validation
 * - Enables helpful error messages for invalid filter requests
 */

import { CacheManager } from './cache-manager.js';
import { logger } from '../core/logger.js';
import type { FieldMetadata } from '../types/bc-types.js';

/**
 * Filter specification with operator and value.
 */
export interface FilterSpec {
  operator: string;
  value: unknown;
}

/**
 * Service for caching filter metadata and state.
 * Singleton pattern for global cache coordination.
 */
export class FilterMetadataService {
  private static instance: FilterMetadataService;
  private cache: CacheManager;

  private constructor() {
    // Use CacheManager for consistent caching behavior
    // TTL matches ConnectionManager.SESSION_TTL (15 minutes)
    this.cache = new CacheManager({
      maxEntries: 500, // Support many concurrent session+page combinations
      defaultTtlMs: 900000, // 15 min (900000 ms)
      cleanupIntervalMs: 60000, // 1 min cleanup
    });
  }

  /**
   * Gets the singleton instance.
   */
  public static getInstance(): FilterMetadataService {
    if (!FilterMetadataService.instance) {
      FilterMetadataService.instance = new FilterMetadataService();
    }
    return FilterMetadataService.instance;
  }

  // ==========================================
  // Phase 1: Filter State Cache
  // ==========================================

  /**
   * Gets cached filter state for a session+page combination.
   *
   * @param sessionId - BC session ID
   * @param pageId - BC page ID (e.g., "21", "22")
   * @returns Map of currently applied filters, or empty Map if none cached
   */
  public getFilterState(sessionId: string, pageId: string): Map<string, FilterSpec> {
    // Input validation
    if (!sessionId || typeof sessionId !== 'string') {
      logger.warn(`[FilterMetadataService] Invalid sessionId in getFilterState: ${sessionId}`);
      return new Map<string, FilterSpec>();
    }

    if (!pageId || typeof pageId !== 'string') {
      logger.warn(`[FilterMetadataService] Invalid pageId in getFilterState: ${pageId}`);
      return new Map<string, FilterSpec>();
    }

    const key = this.buildFilterStateKey(sessionId, pageId);
    const cached = this.cache.get<Map<string, FilterSpec>>(key);

    if (cached) {
      logger.debug(`[FilterMetadataService] Filter state cache HIT: ${key}`);
      return cached;
    }

    logger.debug(`[FilterMetadataService] Filter state cache MISS: ${key}`);
    return new Map<string, FilterSpec>();
  }

  /**
   * Sets filter state for a session+page combination.
   *
   * @param sessionId - BC session ID
   * @param pageId - BC page ID
   * @param state - Map of applied filters
   */
  public setFilterState(
    sessionId: string,
    pageId: string,
    state: Map<string, FilterSpec>
  ): void {
    // Input validation
    if (!sessionId || typeof sessionId !== 'string') {
      logger.warn(`[FilterMetadataService] Invalid sessionId in setFilterState: ${sessionId}`);
      return;
    }

    if (!pageId || typeof pageId !== 'string') {
      logger.warn(`[FilterMetadataService] Invalid pageId in setFilterState: ${pageId}`);
      return;
    }

    if (!state || !(state instanceof Map)) {
      logger.warn(`[FilterMetadataService] Invalid state in setFilterState for ${sessionId}:${pageId}`);
      return;
    }

    const key = this.buildFilterStateKey(sessionId, pageId);

    // Use 15-min TTL to match session lifetime
    this.cache.set(key, state, 900000);

    logger.debug(
      `[FilterMetadataService] Cached filter state: ${key} (${state.size} filters)`
    );
  }

  /**
   * Clears all filter state for a given session.
   * Called when session is closed to prevent stale cache entries.
   *
   * @param sessionId - BC session ID
   */
  public clearFilterStateForSession(sessionId: string): void {
    const pattern = `filterstate:${sessionId}:*`;
    const cleared = this.cache.invalidate(pattern);

    if (cleared > 0) {
      logger.info(
        `[FilterMetadataService] Cleared ${cleared} filter state entries for session ${sessionId}`
      );
    }
  }

  /**
   * Clears filter state for a specific session+page combination.
   * Useful when page is refreshed or filters are explicitly reset.
   *
   * @param sessionId - BC session ID
   * @param pageId - BC page ID
   */
  public clearFilterStateForPage(sessionId: string, pageId: string): void {
    const key = this.buildFilterStateKey(sessionId, pageId);
    const cleared = this.cache.invalidate(key);

    if (cleared > 0) {
      logger.debug(`[FilterMetadataService] Cleared filter state: ${key}`);
    }
  }

  /**
   * Builds cache key for filter state.
   * Format: filterstate:{sessionId}:{pageId}
   */
  private buildFilterStateKey(sessionId: string, pageId: string): string {
    return `filterstate:${sessionId}:${pageId}`;
  }

  // ==========================================
  // Phase 2: Repeater Path Cache
  // ==========================================

  /**
   * Gets or computes the repeater control path for a page.
   * Caches the result to avoid re-walking the LogicalForm tree on every filter operation.
   *
   * Uses CacheManager.getOrCompute() for stampede protection (concurrent requests
   * for the same pageId will coalesce to a single computation).
   *
   * @param pageId - BC page ID
   * @param logicalForm - LogicalForm structure to walk if not cached
   * @param findRepeaterFn - Function to find repeater path in LogicalForm
   * @returns Repeater control path (e.g., "server:c[1]") or null if not found
   */
  public async getOrComputeRepeaterPath(
    pageId: string,
    logicalForm: unknown,
    findRepeaterFn: (form: unknown) => string | null
  ): Promise<string | null> {
    // Input validation
    if (!pageId || typeof pageId !== 'string') {
      logger.warn(`[FilterMetadataService] Invalid pageId: ${pageId}`);
      return null;
    }

    if (!findRepeaterFn || typeof findRepeaterFn !== 'function') {
      logger.warn(`[FilterMetadataService] Invalid findRepeaterFn for page ${pageId}`);
      return null;
    }

    const key = this.buildRepeaterPathKey(pageId);

    // Use getOrCompute for stampede protection
    try {
      return await this.cache.getOrCompute(
        key,
        async () => {
          logger.debug(`[FilterMetadataService] Computing repeater path for page ${pageId}`);

          try {
            const path = findRepeaterFn(logicalForm);

            if (path) {
              logger.debug(`[FilterMetadataService] Found repeater path for page ${pageId}: ${path}`);
            } else {
              logger.debug(`[FilterMetadataService] No repeater found for page ${pageId}`);
            }

            return path;
          } catch (error) {
            logger.error(
              `[FilterMetadataService] Error in findRepeaterFn for page ${pageId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            return null;
          }
        },
        3600000 // 1 hour TTL (page structure is stable)
      );
    } catch (error) {
      logger.error(
        `[FilterMetadataService] Cache operation failed for repeater path (page ${pageId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * Invalidates cached repeater path for a page.
   * Call when page structure changes (rare - usually only after BC schema updates).
   *
   * @param pageId - BC page ID
   */
  public clearRepeaterPath(pageId: string): void {
    const key = this.buildRepeaterPathKey(pageId);
    const cleared = this.cache.invalidate(key);

    if (cleared > 0) {
      logger.debug(`[FilterMetadataService] Cleared repeater path for page ${pageId}`);
    }
  }

  /**
   * Builds cache key for repeater path.
   * Format: repeater:{pageId}
   */
  private buildRepeaterPathKey(pageId: string): string {
    return `repeater:${pageId}`;
  }

  // ==========================================
  // Phase 3: Field Metadata Cache
  // ==========================================

  /**
   * Gets or computes field metadata for a page.
   * Caches the result to enable pre-validation of filter requests.
   *
   * Uses CacheManager.getOrCompute() for stampede protection (concurrent requests
   * for the same pageId will coalesce to a single computation).
   *
   * @param pageId - BC page ID
   * @param logicalForm - LogicalForm structure to extract fields from if not cached
   * @param extractFieldsFn - Function to extract field metadata from LogicalForm
   * @returns Map of field name to FieldMetadata
   */
  public async getOrComputeFieldMetadata(
    pageId: string,
    logicalForm: unknown,
    extractFieldsFn: (form: unknown) => Map<string, FieldMetadata>
  ): Promise<Map<string, FieldMetadata>> {
    // Input validation
    if (!pageId || typeof pageId !== 'string') {
      logger.warn(`[FilterMetadataService] Invalid pageId: ${pageId}, returning empty field metadata`);
      return new Map<string, FieldMetadata>();
    }

    if (!extractFieldsFn || typeof extractFieldsFn !== 'function') {
      logger.warn(`[FilterMetadataService] Invalid extractFieldsFn for page ${pageId}, returning empty field metadata`);
      return new Map<string, FieldMetadata>();
    }

    const key = this.buildFieldMetadataKey(pageId);

    // Use getOrCompute for stampede protection
    try {
      return await this.cache.getOrCompute(
        key,
        async () => {
          logger.debug(`[FilterMetadataService] Computing field metadata for page ${pageId}`);

          try {
            const fields = extractFieldsFn(logicalForm);

            if (fields.size === 0) {
              logger.debug(`[FilterMetadataService] No filterable fields found for page ${pageId} (may be a card page)`);
            } else {
              logger.debug(
                `[FilterMetadataService] Extracted ${fields.size} fields for page ${pageId}: ${Array.from(
                  fields.keys()
                ).join(', ')}`
              );
            }

            return fields;
          } catch (error) {
            logger.error(
              `[FilterMetadataService] Error in extractFieldsFn for page ${pageId}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
            // Return empty map on error - allows graceful degradation
            return new Map<string, FieldMetadata>();
          }
        },
        3600000 // 1 hour TTL (page structure is stable)
      );
    } catch (error) {
      logger.error(
        `[FilterMetadataService] Cache operation failed for field metadata (page ${pageId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Return empty map on cache failure - allows graceful degradation
      return new Map<string, FieldMetadata>();
    }
  }

  /**
   * Invalidates cached field metadata for a page.
   * Call when page structure changes (rare - usually only after BC schema updates).
   *
   * @param pageId - BC page ID
   */
  public clearFieldMetadata(pageId: string): void {
    const key = this.buildFieldMetadataKey(pageId);
    const cleared = this.cache.invalidate(key);

    if (cleared > 0) {
      logger.debug(`[FilterMetadataService] Cleared field metadata for page ${pageId}`);
    }
  }

  /**
   * Builds cache key for field metadata.
   * Format: fieldmeta:{pageId}
   */
  private buildFieldMetadataKey(pageId: string): string {
    return `fieldmeta:${pageId}`;
  }

  // ==========================================
  // Cache Statistics
  // ==========================================

  /**
   * Gets cache statistics for monitoring.
   */
  public getStats() {
    return this.cache.getStats();
  }

  /**
   * Clears all cached data (for testing/debugging).
   */
  public clearAll(): void {
    this.cache.invalidate('*');
    logger.info('[FilterMetadataService] Cleared all cached data');
  }
}
