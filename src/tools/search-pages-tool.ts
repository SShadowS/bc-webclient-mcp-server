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
  type BcHandler,
} from '../protocol/logical-form-parser.js';
import { bcConfig } from '../core/config.js';
import type { BCConnectionPool, PooledConnection } from '../services/connection-pool.js';
import type { CacheManager } from '../services/cache-manager.js';
import { createWorkflowIntegration } from '../services/workflow-integration.js';
import type { TellMeSearchResultRow } from '../protocol/logical-form-parser.js';

/** Handler with parameters for search predicates */
interface SearchToolHandler {
  handlerType: string;
  parameters?: readonly unknown[];
}

/** FormToShow parameters for Tell Me */
interface FormToShowData {
  ServerId?: string;
}

/** Change handler update entry */
interface ChangeUpdate {
  NewValue?: { ServerId?: string };
}

/** Change handler parameters */
interface ChangeParams {
  Type?: string;
  Updates?: ChangeUpdate[];
}

/** Connection state for search operation */
interface ConnectionState {
  client: BCRawWebSocketClient;
  pooledConnection: PooledConnection | null;
  shouldDisconnect: boolean;
}

/** Predicate result type */
interface PredicateResult<T> {
  matched: boolean;
  data?: T;
}

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
    'Searches for Business Central pages by caption (page title), optionally filtered by page type. ' +
    'query (required): Search term matched against page captions (case-insensitive substring match). ' +
    'type (optional): Filter results by page type - must be one of: "List", "Card", "Document", "Worksheet", "Report". ' +
    'limit (optional): Maximum results to return (default: 10, maximum: 100). ' +
    'Returns array of matching pages: {pageId, pageName, type, description}. Returns empty array if no matches. ' +
    'Typical workflow: Use returned pageId with get_page_metadata to open and interact with the specific page.';

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
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID to track this operation. Records page searches for workflow audit trail.',
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
    const { query, limit = 10, type, workflowId } = input as SearchPagesInput & { workflowId?: string };

    // Create workflow integration if workflowId provided
    const workflow = createWorkflowIntegration(workflowId);

    // Build cache key
    const cacheKey = `search:${query}:${type || 'all'}:${limit}`;

    // Use cache if available
    if (this.cache) {
      try {
        return await this.cache.getOrCompute(
          cacheKey,
          async () => {
            return await this.performSearch(query, limit, type, workflow);
          },
          300000 // 5 minute TTL for search results
        );
      } catch (error) {
        // If cache operation fails, fall back to direct execution
        return await this.performSearch(query, limit, type, workflow);
      }
    }

    // No cache - execute directly
    return await this.performSearch(query, limit, type, workflow);
  }

  /**
   * Perform the actual Tell Me search (called by executeInternal)
   * @private
   */
  private async performSearch(
    query: string,
    limit: number,
    type?: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report',
    workflow?: ReturnType<typeof createWorkflowIntegration>
  ): Promise<Result<SearchPagesOutput, BCError>> {
    let connState: ConnectionState | null = null;

    try {
      // Step 1: Initialize connection
      connState = await this.initializeConnection();

      // Step 2: Validate and get role center form ID
      const ownerFormId = connState.client.getRoleCenterFormId();
      if (!ownerFormId) {
        await this.cleanupConnection(connState);
        return err(new ProtocolError('No role center form found in session', {}));
      }

      // Step 3: Open Tell Me dialog
      const dialogResult = await this.openTellMeDialog(connState.client, ownerFormId);
      if (!isOk(dialogResult)) {
        await this.cleanupConnection(connState);
        return dialogResult;
      }
      const formId = dialogResult.value;

      // Step 4: Initialize search with empty value
      await this.initializeSearchField(connState.client, formId, ownerFormId);

      // Step 5: Submit search query and get results
      const searchResult = await this.submitSearchQuery(connState.client, query, formId, ownerFormId);
      if (!isOk(searchResult)) {
        await this.cleanupConnection(connState);
        return searchResult;
      }

      // Step 6: Filter and limit results
      const pages = this.filterAndLimitResults(searchResult.value, type, limit);

      // Step 7: Cleanup connection
      await this.cleanupConnection(connState);

      // Step 8: Record workflow operation
      this.recordWorkflowOperation(workflow, query, limit, type, pages.length);

      return ok({ pages, totalCount: pages.length });
    } catch (error) {
      if (connState) await this.cleanupConnection(connState);
      return err(new ConnectionError(
        `Tell Me search failed: ${error instanceof Error ? error.message : String(error)}`,
        { query, error }
      ));
    }
  }

  // ============================================================================
  // Helper Methods - Extracted from performSearch for reduced complexity
  // ============================================================================

  /** Get BC credentials from config or defaults */
  private getCredentials(): { baseUrl: string; username: string; password: string; tenantId: string } {
    return {
      baseUrl: this.config?.baseUrl || bcConfig.baseUrl,
      username: this.config?.username || bcConfig.username,
      password: this.config?.password || bcConfig.password,
      tenantId: this.config?.tenantId || bcConfig.tenantId,
    };
  }

  /** Initialize connection from pool or create new */
  private async initializeConnection(): Promise<ConnectionState> {
    if (this.connectionPool) {
      const pooledConnection = await this.connectionPool.acquire();
      return {
        client: pooledConnection.client,
        pooledConnection,
        shouldDisconnect: false,
      };
    }

    const { baseUrl, username, password, tenantId } = this.getCredentials();
    // BCRawWebSocketClient expects types.ts BCConfig which has different fields
    // We provide the essential fields and use type assertion for compatibility
    const config = {
      baseUrl,
      tenantId,
      environment: 'production',
      azureClientId: '',
      azureTenantId: '',
      azureAuthority: '',
      roleCenterPageId: 0,
    };
    const client = new BCRawWebSocketClient(config, username, password, tenantId);

    await client.authenticateWeb();
    await client.connect();
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });

    return { client, pooledConnection: null, shouldDisconnect: true };
  }

  /** Create predicate for Tell Me dialog detection */
  private createTellMeDialogPredicate(): (handlers: unknown[]) => PredicateResult<string> {
    return (handlers: unknown[]) => {
      // Try legacy FormToShow format first
      const legacy = handlers.find((h) => {
        const handler = h as SearchToolHandler;
        if (handler.handlerType !== 'DN.LogicalClientEventRaisingHandler') return false;
        if (handler.parameters?.[0] !== 'FormToShow') return false;
        const formData = handler.parameters?.[1] as FormToShowData | undefined;
        return !!formData?.ServerId;
      }) as SearchToolHandler | undefined;
      if (legacy) {
        const formData = legacy.parameters?.[1] as FormToShowData;
        return { matched: true, data: formData.ServerId! };
      }

      // Try BC27+ ChangeHandler format
      const change = handlers.find((h) => {
        const handler = h as SearchToolHandler;
        if (handler.handlerType !== 'DN.LogicalClientChangeHandler') return false;
        const params = handler.parameters?.[0] as ChangeParams | undefined;
        return params?.Type === 'DataRefreshChange' || params?.Type === 'InitializeChange';
      }) as SearchToolHandler | undefined;
      if (change) {
        const params = change.parameters?.[0] as ChangeParams | undefined;
        const updates = params?.Updates;
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
  }

  /** Open Tell Me dialog and return form ID */
  private async openTellMeDialog(client: BCRawWebSocketClient, ownerFormId: string): Promise<Result<string, BCError>> {
    try {
      const waitDialogPromise = client.waitForHandlers(this.createTellMeDialogPredicate(), {
        timeoutMs: Math.max(5000, bcConfig.searchTimingWindowMs),
      });

      void client.invoke({
        interactionName: 'InvokeSessionAction',
        namedParameters: { systemAction: 220, ownerForm: ownerFormId, data: { SearchValue: '' } },
        openFormIds: [ownerFormId],
      }).catch(() => { /* Swallow - waitDialogPromise will timeout if invoke fails */ });

      const formId = await waitDialogPromise;
      return ok(formId);
    } catch (error) {
      return err(new ProtocolError(
        `Tell Me dialog did not open: ${error instanceof Error ? error.message : String(error)}`,
        { error }
      ));
    }
  }

  /** Initialize search field with empty value */
  private async initializeSearchField(client: BCRawWebSocketClient, formId: string, ownerFormId: string): Promise<void> {
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
      formId,
      openFormIds: [ownerFormId, formId],
    });
  }

  /** Create predicate for search results detection */
  private createSearchResultsPredicate(): (handlers: unknown[]) => PredicateResult<TellMeSearchResultRow[]> {
    return (handlers: unknown[]) => {
      // Try BC27+ format first (cast to BcHandler[] for type compatibility)
      const bc27Results = extractTellMeResultsFromChangeHandler(handlers as BcHandler[]);
      if (isOk(bc27Results) && bc27Results.value.length > 0) {
        return { matched: true, data: bc27Results.value };
      }

      // Try legacy format
      const searchFormHandler = Array.isArray(handlers)
        ? handlers.find((h) => {
            const handler = h as SearchToolHandler;
            return handler.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
                   handler.parameters?.[0] === 'FormToShow';
          }) as SearchToolHandler | undefined
        : undefined;

      const logicalForm = searchFormHandler?.parameters?.[1];
      if (logicalForm) {
        const legacyResults = extractTellMeResults({ LogicalForm: logicalForm });
        if (isOk(legacyResults) && legacyResults.value.length > 0) {
          return { matched: true, data: legacyResults.value };
        }
      }

      return { matched: false };
    };
  }

  /** Submit search query and wait for results */
  private async submitSearchQuery(
    client: BCRawWebSocketClient,
    query: string,
    formId: string,
    ownerFormId: string
  ): Promise<Result<TellMeSearchResultRow[], BCError>> {
    try {
      const waitPromise = client.waitForHandlers(this.createSearchResultsPredicate(), {
        timeoutMs: Math.max(5000, bcConfig.searchTimingWindowMs),
      });

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
        formId,
        openFormIds: [ownerFormId, formId],
      }).catch(() => { /* Swallow - waitPromise will timeout if invoke fails */ });

      const searchResults = await waitPromise;
      return ok(searchResults);
    } catch (error) {
      return err(new ProtocolError(
        `Tell Me search results did not arrive: ${error instanceof Error ? error.message : String(error)}`,
        { query, error }
      ));
    }
  }

  /** Filter by type and apply limit */
  private filterAndLimitResults(
    rawResults: TellMeSearchResultRow[],
    type: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report' | undefined,
    limit: number
  ): PageSearchResult[] {
    let pages = convertToPageSearchResults(rawResults);
    if (type) {
      pages = pages.filter(p => p.type === type);
    }
    return pages.slice(0, limit);
  }

  /** Cleanup connection (release to pool or disconnect) */
  private async cleanupConnection(connState: ConnectionState): Promise<void> {
    try {
      if (connState.pooledConnection && this.connectionPool) {
        await this.connectionPool.release(connState.pooledConnection);
      } else if (connState.shouldDisconnect) {
        await connState.client.disconnect();
      }
    } catch {
      // Swallow cleanup errors - they're not critical
    }
  }

  /** Record operation in workflow */
  private recordWorkflowOperation(
    workflow: ReturnType<typeof createWorkflowIntegration> | undefined,
    query: string,
    limit: number,
    type: string | undefined,
    resultCount: number
  ): void {
    if (!workflow) return;
    workflow.recordOperation(
      'search_pages',
      { query, limit, type },
      { success: true, data: { resultCount } }
    );
  }
}
