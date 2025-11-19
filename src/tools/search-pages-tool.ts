/**
 * Search Pages MCP Tool
 *
 * Searches for BC pages using the Tell Me search protocol.
 * Connects to BC WebSocket, sends search query, and parses results.
 *
 * Protocol:
 * 1. Open Tell Me dialog: InvokeSessionAction(systemAction: 220)
 * 2. Submit query: SaveValue with search text
 * 3. Parse results: Extract from LogicalForm repeater control
 *
 * See docs/tell-me-search-protocol.md for full protocol documentation.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, isOk, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ConnectionError, ProtocolError } from '../core/errors.js';
import type {
  SearchPagesOutput,
  PageSearchResult,
} from '../types/mcp-types.js';
import { SearchPagesInputSchema, type SearchPagesInput } from '../validation/schemas.js';
import { BCRawWebSocketClient } from '../connection/clients/BCRawWebSocketClient.js';
import { decompressIfNeeded } from '../protocol/decompression.js';
import {
  extractTellMeResults,
  extractTellMeResultsFromChangeHandler,
  convertToPageSearchResults,
} from '../protocol/logical-form-parser.js';
import { bcConfig } from '../core/config.js';
import type { BCConnectionPool } from '../services/connection-pool.js';
import type { CacheManager } from '../services/cache-manager.js';

/**
 * MCP Tool: search_pages
 *
 * Searches for BC pages by name, caption, or type.
 *
 * NOTE: Unlike other tools, this creates its own BCRawWebSocketClient per invocation
 * because it requires low-level Tell Me protocol access not available through BCPageConnection.
 * Each search creates a new session, performs the search, and closes.
 */
export class SearchPagesTool extends BaseMCPTool {
  public readonly name = 'search_pages';

  public readonly description =
    'Searches for Business Central pages by name or type. ' +
    'Type parameter accepts: List, Card, Document, Worksheet, or Report (enum values only). ' +
    'Returns array of pages with: pageId, pageName, type, and description. ' +
    'Use returned pageIds with get_page_metadata to open and interact with the page.';

  /**
   * Constructor.
   * SearchPagesTool can optionally use a connection pool and cache for improved performance.
   * If no pool is provided, falls back to creating a new connection per search.
   * If no cache is provided, skips caching (direct execution).
   */
  public constructor(
    private readonly config?: {
      readonly baseUrl?: string;
      readonly username?: string;
      readonly password?: string;
      readonly tenantId?: string;
    },
    private readonly connectionPool?: BCConnectionPool,
    private readonly cache?: CacheManager
  ) {
    super({ inputZod: SearchPagesInputSchema });
  }

  public readonly inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (searches page captions)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 10)',
        minimum: 1,
        maximum: 100,
      },
      type: {
        type: 'string',
        description: 'Filter by page type',
        enum: ['Card', 'List', 'Document', 'Worksheet', 'Report'],
      },
    },
    required: ['query'],
  };

  // Consent configuration - Read-only operation, no consent needed
  public readonly requiresConsent = false;
  public readonly sensitivityLevel = 'low' as const;

  /**
   * Executes the tool to search for pages using BC Tell Me protocol.
   * Input is pre-validated by BaseMCPTool using Zod schema.
   *
   * Uses the BC27+ Tell Me search via LogicalClientChangeHandler format.
   * Requires BC credentials from environment or config.
   */
  protected async executeInternal(input: unknown): Promise<Result<SearchPagesOutput, BCError>> {
    // Input is already validated by BaseMCPTool with Zod
    const { query, limit = 10, type } = input as SearchPagesInput;

    // Build cache key
    const cacheKey = `search:${query}:${type || 'all'}:${limit}`;

    // Use cache if available
    if (this.cache) {
      try {
        return await this.cache.getOrCompute(
          cacheKey,
          async () => {
            return await this.performSearch(query, limit, type);
          },
          300000 // 5 minute TTL for search results
        );
      } catch (error) {
        // If cache operation fails, fall back to direct execution
        return await this.performSearch(query, limit, type);
      }
    }

    // No cache - execute directly
    return await this.performSearch(query, limit, type);
  }

  /**
   * Perform the actual Tell Me search (called by executeInternal)
   * @private
   */
  private async performSearch(
    query: string,
    limit: number,
    type?: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report'
  ): Promise<Result<SearchPagesOutput, BCError>> {

    // Get BC credentials from passed config or fall back to centralized config
    const baseUrl = this.config?.baseUrl || bcConfig.baseUrl;
    const username = this.config?.username || bcConfig.username;
    const password = this.config?.password || bcConfig.password;
    const tenantId = this.config?.tenantId || bcConfig.tenantId;

    // Connection tracking (declared outside try block for error cleanup)
    let client: BCRawWebSocketClient | null = null;
    let pooledConnection: any = null;
    let shouldDisconnect = true;

    try {
      // Use connection pool if available, otherwise create new connection
      if (this.connectionPool) {
        // Acquire connection from pool
        pooledConnection = await this.connectionPool.acquire();
        client = pooledConnection.client;
        shouldDisconnect = false; // Pool manages disconnection
      } else {
        // Legacy path: Create new client
        client = new BCRawWebSocketClient(
          { baseUrl } as any,
          username,
          password,
          tenantId
        );

        // Authenticate
        await client.authenticateWeb();

        // Connect WebSocket
        await client.connect();

        // Open session
        await client.openSession({
          clientType: 'WebClient',
          clientVersion: '27.0.0.0',
          clientCulture: 'en-US',
          clientTimeZone: 'UTC',
        });
      }

      // Client should always be set at this point
      if (!client) {
        throw new ConnectionError('Failed to initialize BC client');
      }

      // Get role center form ID from the connection (not from file - avoids race condition with pool)
      const ownerFormId = client.getRoleCenterFormId();

      if (!ownerFormId) {
        await client.disconnect();
        return err(
          new ProtocolError('No role center form found in session', {})
        );
      }

      // Define predicate to detect Tell Me dialog (handles both BC27+ and legacy formats)
      const isTellMeDialogOpen = (handlers: any[]) => {
        // Log all handlers for debugging
        console.error(`[Tell Me Debug] Received ${handlers.length} handlers:`);
        handlers.forEach((h, i) => {
          console.error(`  [${i}] ${h.handlerType}`, h.parameters?.[0] || '');
        });

        // Try legacy FormToShow format first
        // TODO: Find language-independent way to identify Tell Me dialog
        const legacy = handlers.find((h: any) =>
          h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          h.parameters?.[0] === 'FormToShow' &&
          h.parameters?.[1]?.ServerId
        );
        if (legacy) {
          console.error(`[Tell Me Debug] Found FormToShow dialog: ServerId=${legacy.parameters[1].ServerId}, Caption="${legacy.parameters[1].Caption}"`);
          return { matched: true, data: legacy.parameters[1].ServerId };
        }

        // Try BC27+ ChangeHandler format (DataRefreshChange or InitializeChange)
        const change = handlers.find((h: any) =>
          h.handlerType === 'DN.LogicalClientChangeHandler' &&
          (h.parameters?.[0]?.Type === 'DataRefreshChange' || h.parameters?.[0]?.Type === 'InitializeChange')
        );
        if (change) {
          // Try to extract form ID from change handler
          const updates = change.parameters?.[0]?.Updates;
          if (Array.isArray(updates)) {
            for (const update of updates) {
              if (update.NewValue?.ServerId) {
                return { matched: true, data: update.NewValue.ServerId };
              }
            }
          }
        }

        return { matched: false };
      };

      // Trigger Tell Me dialog and wait for it to appear
      // Use pre-subscribe pattern to avoid race condition
      let formId: string;
      try {
        // Set up listener first
        const waitDialogPromise = client.waitForHandlers(isTellMeDialogOpen, {
          timeoutMs: Math.max(5000, bcConfig.searchTimingWindowMs),
        });

        // Fire invoke without awaiting
        void client.invoke({
          interactionName: 'InvokeSessionAction',
          namedParameters: {
            systemAction: 220,
            ownerForm: ownerFormId,
            data: { SearchValue: '' },
          },
          openFormIds: [ownerFormId],
        }).catch(() => {
          // Swallow invoke errors - waitDialogPromise will timeout if invoke fails
        });

        // Wait for dialog to appear
        formId = await waitDialogPromise;
      } catch (error) {
        await client.disconnect();
        return err(
          new ProtocolError(
            `Tell Me dialog did not open: ${error instanceof Error ? error.message : String(error)}`,
            { error }
          )
        );
      }

      // Initialize search with empty value (required!)
      await client.invoke({
        interactionName: 'SaveValue',
        namedParameters: {
          newValue: '',
          isFilterAsYouType: true,
          alwaysCommitChange: true,
          isFilterOptimized: false,
          isSemanticSearch: false,
        },
        controlPath: 'server:c[0]/c[0]',
        formId: formId,
        openFormIds: [ownerFormId, formId],
      });

      // Define predicate to detect search results
      const isSearchResults = (handlers: any[]) => {
        // Try BC27+ format first
        const bc27Results = extractTellMeResultsFromChangeHandler(handlers);
        if (isOk(bc27Results) && bc27Results.value.length > 0) {
          return { matched: true, data: bc27Results.value };
        }

        // Try legacy format
        const searchFormHandler = Array.isArray(handlers)
          ? handlers.find((h: any) =>
              h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
              h.parameters?.[0] === 'FormToShow'
            )
          : null;

        const logicalForm = searchFormHandler?.parameters?.[1];
        if (logicalForm) {
          const legacyResults = extractTellMeResults({ LogicalForm: logicalForm });
          if (isOk(legacyResults) && legacyResults.value.length > 0) {
            return { matched: true, data: legacyResults.value };
          }
        }

        return { matched: false };
      };

      // Submit actual search query and wait for results
      // CRITICAL: Pre-subscribe to handlers BEFORE invoking to avoid race condition
      // BC emits handlers asynchronously - if we await invoke first, we might miss them
      let searchResults: any[];
      try {
        // Set up listener first (pre-subscribe pattern)
        const waitPromise = client.waitForHandlers(isSearchResults, {
          timeoutMs: Math.max(5000, bcConfig.searchTimingWindowMs),
        });

        // Fire invoke without awaiting (fire-and-forget to avoid delaying listener setup)
        void client.invoke({
          interactionName: 'SaveValue',
          namedParameters: {
            newValue: query,
            isFilterAsYouType: true,
            alwaysCommitChange: true,
            isFilterOptimized: false,
            isSemanticSearch: false,
          },
          controlPath: 'server:c[0]/c[0]',
          formId: formId,
          openFormIds: [ownerFormId, formId],
        }).catch(() => {
          // Swallow invoke errors - waitPromise will timeout if invoke fails
        });

        // Wait for results to arrive via event listener
        searchResults = await waitPromise;
      } catch (error) {
        await client.disconnect();
        return err(
          new ProtocolError(
            `Tell Me search results did not arrive: ${error instanceof Error ? error.message : String(error)}`,
            { query, error }
          )
        );
      }

      // Convert to page results
      let pages = convertToPageSearchResults(searchResults);

      // Apply type filter if specified
      if (type) {
        pages = pages.filter(p => p.type === type);
      }

      // Apply limit
      pages = pages.slice(0, limit);

      // Clean up connection
      if (pooledConnection) {
        // Release back to pool
        await this.connectionPool!.release(pooledConnection);
      } else if (shouldDisconnect) {
        // Close new connection
        await client.disconnect();
      }

      return ok({
        pages,
        totalCount: pages.length,
      });
    } catch (error) {
      // Ensure connection cleanup on error
      if (pooledConnection && this.connectionPool) {
        try {
          await this.connectionPool.release(pooledConnection);
        } catch (releaseError) {
          // Log but don't throw - original error is more important
        }
      } else if (client && shouldDisconnect) {
        // Clean up non-pooled connection
        try {
          await client.disconnect();
        } catch (disconnectError) {
          // Log but don't throw - original error is more important
        }
      }

      return err(
        new ConnectionError(
          `Tell Me search failed: ${error instanceof Error ? error.message : String(error)}`,
          { query, error }
        )
      );
    }
  }

}
