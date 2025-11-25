/**
 * Column Enrichment Service
 *
 * Clean abstraction for progressive column metadata enrichment.
 * Tools call this service after receiving BC responses that may contain column metadata.
 *
 * Architecture:
 * - Protocol layer: Parses BC messages, detects RCC structures
 * - This service: Bridges protocol detection → PageContext caching
 * - Tools: Know pageContextId, call this service
 *
 * Future: Can be refactored to subscribe to protocol-level events without changing tools.
 *
 * @see COLUMN_METADATA_DISCOVERY.md for background
 * @see COLUMN_ENRICHMENT_IMPLEMENTATION.md for implementation strategy
 */

import { createToolLogger } from '../core/logger.js';
import { PageContextCache } from './page-context-cache.js';
import { extractColumnsFromResponse } from '../protocol/rcc-extractor.js';

const logger = createToolLogger('ColumnEnrichmentService');

/**
 * Enrichment result for observability
 */
export interface EnrichmentResult {
  enriched: boolean;
  repeaterCount: number;
  totalColumns: number;
  repeaters: Array<{
    formId: string;
    caption: string;
    columnCount: number;
  }>;
}

/**
 * Column Enrichment Service
 *
 * Provides a clean, testable abstraction for enriching page contexts with column metadata.
 *
 * Usage in tools:
 * ```typescript
 * const service = ColumnEnrichmentService.getInstance();
 * const result = await service.enrichFromResponse(pageContextId, response);
 * if (result.enriched) {
 *   logger.info(`Enriched ${result.repeaterCount} repeaters with columns`);
 * }
 * ```
 */
export class ColumnEnrichmentService {
  private static instance: ColumnEnrichmentService | null = null;
  private readonly cache: PageContextCache;

  private constructor() {
    this.cache = PageContextCache.getInstance();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ColumnEnrichmentService {
    if (!ColumnEnrichmentService.instance) {
      ColumnEnrichmentService.instance = new ColumnEnrichmentService();
    }
    return ColumnEnrichmentService.instance;
  }

  /**
   * Enrich page context with columns discovered in a BC response.
   *
   * This method:
   * 1. Extracts RCC (Repeater Column Control) messages from response
   * 2. Updates PageContext cache with discovered columns
   * 3. Returns enrichment results for observability
   *
   * Safe to call on every response - no-op if no columns found.
   *
   * @param pageContextId - Page context to enrich
   * @param response - BC WebSocket response (from invoke/LoadForm/etc.)
   * @returns Enrichment result
   *
   * @example
   * ```typescript
   * const response = await connection.invoke('LoadForm', params);
   * const result = await service.enrichFromResponse(pageContextId, response);
   * // result.enriched === true if columns were discovered
   * ```
   */
  public async enrichFromResponse(
    pageContextId: string,
    response: any
  ): Promise<EnrichmentResult> {
    // Extract columns from response
    const discovered = extractColumnsFromResponse(response);

    if (discovered.length === 0) {
      return {
        enriched: false,
        repeaterCount: 0,
        totalColumns: 0,
        repeaters: []
      };
    }

    // Enrich each discovered repeater
    let successCount = 0;
    const results: Array<{ formId: string; caption: string; columnCount: number }> = [];

    for (const repeater of discovered) {
      const success = await this.cache.enrichRepeaterColumns(
        pageContextId,
        repeater.formId,
        repeater.columns
      );

      if (success) {
        successCount++;
        results.push({
          formId: repeater.formId,
          caption: repeater.caption,
          columnCount: repeater.columns.length
        });
      }
    }

    const totalColumns = results.reduce((sum, r) => sum + r.columnCount, 0);

    if (successCount > 0) {
      const summary = results.map(r => `${r.caption} (${r.columnCount})`).join(', ');
      logger.info(`Enriched ${successCount} repeater(s) in ${pageContextId}: ${summary}`);
    }

    return {
      enriched: successCount > 0,
      repeaterCount: successCount,
      totalColumns,
      repeaters: results
    };
  }

  /**
   * Check if a response contains column metadata (without enriching).
   *
   * Useful for testing or conditional logic.
   *
   * @param response - BC WebSocket response
   * @returns true if response contains RCC messages
   */
  public hasColumns(response: any): boolean {
    const discovered = extractColumnsFromResponse(response);
    return discovered.length > 0;
  }
}
