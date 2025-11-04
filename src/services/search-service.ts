/**
 * Search Service
 *
 * Handles Business Central Tell Me search functionality (Alt+Q).
 * Uses event-driven architecture to reliably capture asynchronous search results.
 *
 * This service layer abstracts the business logic from the MCP tool adapters.
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError, TimeoutError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createConnectionLogger } from '../core/logger.js';
import { TellMeParser } from '../protocol/tellme-parser.js';
import type { BCRawWebSocketClient } from '../connection/clients/BCRawWebSocketClient.js';
import { retryWithBackoff } from '../core/retry.js';

export interface SearchResult {
  id: string;
  caption: string;
  type: 'Page' | 'Report' | 'Action' | 'Other';
  tooltip?: string;
  badges?: string[];
  navigable: boolean;
}

export interface SearchResults {
  query: string;
  results: SearchResult[];
  totalCount: number;
  sessionId: string;
}

/**
 * Service for Business Central search operations
 */
export class SearchService {
  private readonly parser: TellMeParser;

  constructor() {
    this.parser = new TellMeParser();
  }

  /**
   * Search Business Central pages using Tell Me (Alt+Q)
   */
  async searchPages(
    query: string,
    bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    }
  ): Promise<Result<SearchResults, BCError>> {
    const logger = createConnectionLogger('SearchService', 'searchPages');
    logger.info({ query }, 'Searching pages');

    // Validate query
    if (!query || query.trim().length === 0) {
      return err(
        new ProtocolError('Search query cannot be empty', { query })
      );
    }

    // Get or create connection
    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let sessionId: string;

    if (bcConfig) {
      const sessionResult = await manager.getOrCreateSession(bcConfig);
      if (!isOk(sessionResult)) {
        return err(sessionResult.error);
      }
      connection = sessionResult.value.connection;
      sessionId = sessionResult.value.sessionId;
    } else {
      return err(
        new ProtocolError('No BC configuration provided', { query })
      );
    }

    // Cast to BCRawWebSocketClient for event-driven features
    const rawClient = connection as unknown as BCRawWebSocketClient;
    if (!rawClient.onHandlers || !rawClient.waitForHandlers) {
      return err(
        new ProtocolError('Connection does not support event-driven operations', { query })
      );
    }

    // Step 1: Open Tell Me dialog (Alt+Q) with automatic retry
    logger.debug('Opening Tell Me dialog');

    const openDialogResult = await retryWithBackoff(
      async () => {
        // Invoke Tell Me action
        const openResult = await connection.invoke({
          interactionName: 'SystemAction',
          namedParameters: {
            Id: '{00000000-0000-0000-0300-0000836BD2D2}' // Tell Me system action ID
          },
          controlPath: 'server:',
          callbackId: '0',
        });

        if (!isOk(openResult)) {
          return openResult as Result<never, BCError>;
        }

        // Wait for dialog to open
        const dialogHandlers = await rawClient.waitForHandlers(
          (handlers: any[]) => {
            const found = handlers.some((h: any) =>
              h.handlerType === 'DN.FormToShow' &&
              h.parameters?.[0]?.Caption?.includes('Tell Me')
            );
            return { matched: found, data: found ? handlers : undefined };
          },
          { timeoutMs: 5000 }
        );

        logger.debug('Tell Me dialog opened successfully');
        return ok(dialogHandlers);
      },
      {
        maxAttempts: 1, // One retry after initial failure
        initialDelayMs: 500, // Short delay before retry
        onRetry: () => logger.debug('Dialog open timeout, retrying...'),
      }
    );

    if (!isOk(openDialogResult)) {
      return err(
        new TimeoutError('Tell Me dialog did not open after retries', {
          query,
          timeout: 5000,
          error: openDialogResult.error.message,
        })
      );
    }

    const dialogHandlers = openDialogResult.value;

    // Extract search control ID from dialog
    let searchControlId = 'Search';
    const formToShow = dialogHandlers.find((h: any) => h.handlerType === 'DN.FormToShow');
    if (formToShow?.parameters?.[0]?.Controls) {
      const searchControl = this.findSearchControl(formToShow.parameters[0].Controls);
      if (searchControl) {
        searchControlId = searchControl.ControlId || 'Search';
      }
    }

    // Step 2: Initialize search (required by BC protocol)
    logger.debug('Initializing search');

    const initResult = await connection.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        controlId: searchControlId,
        newValue: '',
      },
      controlPath: 'dialog:c[0]',
      callbackId: '0',
    });

    if (!isOk(initResult)) {
      logger.warn({ error: initResult.error }, 'Search initialization failed, continuing anyway');
    }

    // Step 3: Set up listener for search results
    const resultsPromise = rawClient.waitForHandlers(
      (handlers: any[]) => {
        const found = handlers.some((h: any) => {
          if (h.handlerType === 'DN.LogicalClientChangeHandler') {
            const changes = h.parameters?.[1];
            if (Array.isArray(changes)) {
              return changes.some((change: any) =>
                change.t === 'DataRefreshChange' &&
                change.RowChanges?.length > 0
              );
            }
          }
          return false;
        });
        return { matched: found, data: found ? handlers : undefined };
      },
      { timeoutMs: 10000 }
    );

    // Step 4: Execute search
    logger.debug({ query }, 'Executing search');

    const searchResult = await connection.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        controlId: searchControlId,
        newValue: query,
      },
      controlPath: 'dialog:c[0]',
      callbackId: '0',
    });

    if (!isOk(searchResult)) {
      return err(
        new ProtocolError('Failed to execute search', {
          query,
          error: searchResult.error.message,
        })
      );
    }

    // Step 5: Wait for and parse results
    let resultHandlers: any[];
    try {
      resultHandlers = await resultsPromise;
      logger.debug('Search results received');
    } catch (error) {
      return err(
        new TimeoutError('Search results did not arrive within timeout', {
          query,
          timeout: 10000,
        })
      );
    }

    // Parse the results
    const parseResult = this.parser.parseTellMeResults(resultHandlers);
    if (!isOk(parseResult)) {
      return err(parseResult.error);
    }

    const pages = parseResult.value;
    logger.info({ query, count: pages.length }, 'Search completed');

    // Convert to search results format
    const results: SearchResult[] = pages.map(page => ({
      id: page.id,
      caption: page.caption,
      type: this.determinePageType(page.caption, page.badges),
      tooltip: page.tooltip,
      badges: page.badges,
      navigable: true,
    }));

    // Close the dialog
    await connection.invoke({
      interactionName: 'DialogCancel',
      namedParameters: {},
      controlPath: 'dialog:c[0]',
      callbackId: '0',
    });

    return ok({
      query,
      results,
      totalCount: results.length,
      sessionId,
    });
  }

  /**
   * Find the search control in the dialog controls hierarchy
   */
  private findSearchControl(controls: any[]): any {
    if (!controls) return null;

    for (const control of controls) {
      if (control.Type === 'SearchControl' || control.Caption?.includes('Search')) {
        return control;
      }
      if (control.Controls) {
        const found = this.findSearchControl(control.Controls);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Determine the type of search result based on caption and badges
   */
  private determinePageType(
    caption: string,
    badges?: string[]
  ): SearchResult['type'] {
    const captionLower = caption.toLowerCase();

    // Check badges first
    if (badges?.some(b => b.toLowerCase().includes('report'))) {
      return 'Report';
    }
    if (badges?.some(b => b.toLowerCase().includes('action'))) {
      return 'Action';
    }

    // Check caption
    if (captionLower.includes('report')) return 'Report';
    if (captionLower.includes('list')) return 'Page';
    if (captionLower.includes('card')) return 'Page';
    if (captionLower.includes('worksheet')) return 'Page';
    if (captionLower.includes('journal')) return 'Page';

    // Default to Page for BC pages
    return 'Page';
  }
}