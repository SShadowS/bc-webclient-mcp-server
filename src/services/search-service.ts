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

/** Tell Me system action UUID */
const TELL_ME_ACTION_ID = '{00000000-0000-0000-0300-0000836BD2D2}';

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

interface SearchContext {
  connection: IBCConnection;
  rawClient: BCRawWebSocketClient;
  sessionId: string;
  query: string;
  logger: ReturnType<typeof createConnectionLogger>;
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

    // Step 1: Validate and setup
    const setupResult = await this.setupSearchContext(query, bcConfig, logger);
    if (!isOk(setupResult)) return setupResult;
    const ctx = setupResult.value;

    // Step 2: Open Tell Me dialog
    const dialogResult = await this.openTellMeDialog(ctx);
    if (!isOk(dialogResult)) return dialogResult;
    const { dialogHandlers, searchControlId } = dialogResult.value;

    // Step 3: Initialize search
    await this.initializeSearch(ctx, searchControlId);

    // Step 4: Execute search and get results
    const searchResult = await this.executeSearchAndGetResults(ctx, searchControlId);
    if (!isOk(searchResult)) return searchResult;
    const results = searchResult.value;

    // Step 5: Close dialog and return
    await this.closeDialog(ctx.connection);

    return ok({
      query,
      results,
      totalCount: results.length,
      sessionId: ctx.sessionId,
    });
  }

  /** Validate query and establish connection */
  private async setupSearchContext(
    query: string,
    bcConfig: { baseUrl: string; username: string; password: string; tenantId: string } | undefined,
    logger: ReturnType<typeof createConnectionLogger>
  ): Promise<Result<SearchContext, BCError>> {
    if (!query || query.trim().length === 0) {
      return err(new ProtocolError('Search query cannot be empty', { query }));
    }

    if (!bcConfig) {
      return err(new ProtocolError('No BC configuration provided', { query }));
    }

    const manager = ConnectionManager.getInstance();
    const sessionResult = await manager.getOrCreateSession(bcConfig);
    if (!isOk(sessionResult)) {
      return err(sessionResult.error);
    }

    const connection = sessionResult.value.connection;
    const rawClient = connection as unknown as BCRawWebSocketClient;

    if (!rawClient.onHandlers || !rawClient.waitForHandlers) {
      return err(new ProtocolError('Connection does not support event-driven operations', { query }));
    }

    return ok({
      connection,
      rawClient,
      sessionId: sessionResult.value.sessionId,
      query,
      logger,
    });
  }

  /** Open Tell Me dialog with retry */
  private async openTellMeDialog(
    ctx: SearchContext
  ): Promise<Result<{ dialogHandlers: any[]; searchControlId: string }, BCError>> {
    ctx.logger.debug('Opening Tell Me dialog');

    const openDialogResult = await retryWithBackoff(
      async () => {
        const openResult = await ctx.connection.invoke({
          interactionName: 'SystemAction',
          namedParameters: { Id: TELL_ME_ACTION_ID },
          controlPath: 'server:',
          callbackId: '0',
        });

        if (!isOk(openResult)) {
          return openResult as Result<never, BCError>;
        }

        const dialogHandlers = await ctx.rawClient.waitForHandlers(
          (handlers: any[]) => {
            const found = handlers.some((h: any) =>
              h.handlerType === 'DN.FormToShow' &&
              h.parameters?.[0]?.Caption?.includes('Tell Me')
            );
            return { matched: found, data: found ? handlers : undefined };
          },
          { timeoutMs: 5000 }
        );

        ctx.logger.debug('Tell Me dialog opened successfully');
        return ok(dialogHandlers);
      },
      {
        maxAttempts: 1,
        initialDelayMs: 500,
        onRetry: () => ctx.logger.debug('Dialog open timeout, retrying...'),
      }
    );

    if (!isOk(openDialogResult)) {
      return err(new TimeoutError('Tell Me dialog did not open after retries', {
        query: ctx.query,
        timeout: 5000,
        error: openDialogResult.error.message,
      }));
    }

    const dialogHandlers = openDialogResult.value;
    const searchControlId = this.extractSearchControlId(dialogHandlers);

    return ok({ dialogHandlers, searchControlId });
  }

  /** Extract search control ID from dialog handlers */
  private extractSearchControlId(dialogHandlers: any[]): string {
    const formToShow = dialogHandlers.find((h: any) => h.handlerType === 'DN.FormToShow');
    if (formToShow?.parameters?.[0]?.Controls) {
      const searchControl = this.findSearchControl(formToShow.parameters[0].Controls);
      if (searchControl) {
        return searchControl.ControlId || 'Search';
      }
    }
    return 'Search';
  }

  /** Initialize search (required by BC protocol) */
  private async initializeSearch(ctx: SearchContext, searchControlId: string): Promise<void> {
    ctx.logger.debug('Initializing search');

    const initResult = await ctx.connection.invoke({
      interactionName: 'SaveValue',
      namedParameters: { controlId: searchControlId, newValue: '' },
      controlPath: 'dialog:c[0]',
      callbackId: '0',
    });

    if (!isOk(initResult)) {
      ctx.logger.warn({ error: initResult.error }, 'Search initialization failed, continuing anyway');
    }
  }

  /** Execute search and wait for results */
  private async executeSearchAndGetResults(
    ctx: SearchContext,
    searchControlId: string
  ): Promise<Result<SearchResult[], BCError>> {
    // Set up listener before executing search
    const resultsPromise = ctx.rawClient.waitForHandlers(
      (handlers: any[]) => {
        const found = handlers.some((h: any) => {
          if (h.handlerType === 'DN.LogicalClientChangeHandler') {
            const changes = h.parameters?.[1];
            return Array.isArray(changes) && changes.some((change: any) =>
              change.t === 'DataRefreshChange' && change.RowChanges?.length > 0
            );
          }
          return false;
        });
        return { matched: found, data: found ? handlers : undefined };
      },
      { timeoutMs: 10000 }
    );

    // Execute search
    ctx.logger.debug({ query: ctx.query }, 'Executing search');

    const searchResult = await ctx.connection.invoke({
      interactionName: 'SaveValue',
      namedParameters: { controlId: searchControlId, newValue: ctx.query },
      controlPath: 'dialog:c[0]',
      callbackId: '0',
    });

    if (!isOk(searchResult)) {
      return err(new ProtocolError('Failed to execute search', {
        query: ctx.query,
        error: searchResult.error.message,
      }));
    }

    // Wait for results
    let resultHandlers: any[];
    try {
      resultHandlers = await resultsPromise;
      ctx.logger.debug('Search results received');
    } catch {
      return err(new TimeoutError('Search results did not arrive within timeout', {
        query: ctx.query,
        timeout: 10000,
      }));
    }

    // Parse results
    const parseResult = this.parser.parseTellMeResults(resultHandlers);
    if (!isOk(parseResult)) {
      return err(parseResult.error);
    }

    const pages = parseResult.value;
    ctx.logger.info({ query: ctx.query, count: pages.length }, 'Search completed');

    return ok(pages.map(page => ({
      id: page.id,
      caption: page.caption,
      type: this.determinePageType(page.caption, page.badges),
      tooltip: page.tooltip,
      badges: page.badges,
      navigable: true,
    })));
  }

  /** Close the Tell Me dialog */
  private async closeDialog(connection: IBCConnection): Promise<void> {
    await connection.invoke({
      interactionName: 'DialogCancel',
      namedParameters: {},
      controlPath: 'dialog:c[0]',
      callbackId: '0',
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