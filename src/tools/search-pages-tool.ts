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
  SearchPagesInput,
  SearchPagesOutput,
  PageSearchResult,
} from '../types/mcp-types.js';
import { BCRawWebSocketClient } from '../connection/clients/BCRawWebSocketClient.js';
import { decompressIfNeeded } from '../protocol/decompression.js';
import {
  extractTellMeResults,
  extractTellMeResultsFromChangeHandler,
  convertToPageSearchResults,
} from '../protocol/logical-form-parser.js';
import { bcConfig } from '../core/config.js';

/**
 * MCP Tool: search_pages
 *
 * Searches for BC pages by name, caption, or type.
 */
export class SearchPagesTool extends BaseMCPTool {
  public readonly name = 'search_pages';

  public readonly description =
    'Searches for Business Central pages by name or type. ' +
    'Type parameter accepts: List, Card, Document, Worksheet, or Report (enum values only). ' +
    'Returns array of pages with: pageId, pageName, type, and description. ' +
    'Use returned pageIds with get_page_metadata to open and interact with the page.';

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

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<SearchPagesInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract query
    const queryResult = this.getRequiredString(input, 'query');
    if (!isOk(queryResult)) {
      return queryResult as Result<never, BCError>;
    }

    // Extract optional limit
    const limitResult = this.getOptionalNumber(input, 'limit');
    if (!isOk(limitResult)) {
      return limitResult as Result<never, BCError>;
    }

    // Extract optional type
    const typeResult = this.getOptionalString(input, 'type');
    if (!isOk(typeResult)) {
      return typeResult as Result<never, BCError>;
    }

    return ok({
      query: queryResult.value,
      limit: limitResult.value,
      type: typeResult.value as 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report' | undefined,
    });
  }

  /**
   * Executes the tool to search for pages using BC Tell Me protocol.
   *
   * Uses the BC27+ Tell Me search via LogicalClientChangeHandler format.
   * Requires BC credentials from environment or config.
   */
  protected async executeInternal(input: unknown): Promise<Result<SearchPagesOutput, BCError>> {
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { query, limit = 10, type } = validatedInput.value;

    // Get BC credentials from centralized config
    const { baseUrl, username, password, tenantId } = bcConfig;

    try {
      // Create client
      const client = new BCRawWebSocketClient(
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

      // Extract role center form from OpenSession
      const fs = await import('fs/promises');
      const openSessionData = JSON.parse(
        await fs.readFile('opensession-response.json', 'utf-8')
      );

      const formHandler = openSessionData.find((h: any) =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow'
      );

      if (!formHandler) {
        await client.disconnect();
        return err(
          new ProtocolError('No role center form found in session', {})
        );
      }

      const ownerFormId = formHandler.parameters[1].ServerId;

      // Define predicate to detect Tell Me dialog (handles both BC27+ and legacy formats)
      const isTellMeDialogOpen = (handlers: any[]) => {
        // Try legacy FormToShow format first
        const legacy = handlers.find((h: any) =>
          h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          h.parameters?.[0] === 'FormToShow' &&
          h.parameters?.[1]?.ServerId
        );
        if (legacy) {
          return { matched: true, data: legacy.parameters[1].ServerId };
        }

        // Try BC27+ DataRefreshChange format
        const change = handlers.find((h: any) =>
          h.handlerType === 'DN.LogicalClientChangeHandler' &&
          h.parameters?.[0]?.Type === 'DataRefreshChange'
        );
        if (change) {
          // Try to extract form ID from DataRefreshChange
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

      // Close connection
      await client.disconnect();

      // Convert to page results
      let pages = convertToPageSearchResults(searchResults);

      // Apply type filter if specified
      if (type) {
        pages = pages.filter(p => p.type === type);
      }

      // Apply limit
      pages = pages.slice(0, limit);

      return ok({
        pages,
        totalCount: pages.length,
      });
    } catch (error) {
      return err(
        new ConnectionError(
          `Tell Me search failed: ${error instanceof Error ? error.message : String(error)}`,
          { query, error }
        )
      );
    }
  }

}
