/**
 * BC Page Connection - Connection Per Page Architecture
 *
 * Creates a NEW WebSocket connection for each page request, matching the real BC client behavior.
 * This prevents BC's connection-level form caching from affecting different pages.
 *
 * Solution for: BC caches forms at the WebSocket connection level, causing all pages
 * to return the same cached form data when using a single connection.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ConnectionError, ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type { BCSession, BCInteraction, Handler, LogicalForm, LogicalClientEventRaisingHandler } from '../types/bc-types.js';
import { BCRawWebSocketClient } from './clients/BCRawWebSocketClient.js';
import type { BCConfig } from '../types.js';
import type { ChildFormInfo } from '../util/loadform-helpers.js';
import { logger } from '../core/logger.js';

/**
 * Type guard for LogicalClientEventRaisingHandler
 */
function isLogicalClientEventRaisingHandler(handler: Handler | GenericHandler): handler is LogicalClientEventRaisingHandler {
  return handler.handlerType === 'DN.LogicalClientEventRaisingHandler';
}

/**
 * Generic handler interface for non-standard handlers
 */
interface GenericHandler {
  handlerType: string;
  parameters?: readonly unknown[];
}

/**
 * Configuration for BC page connection.
 */
export interface BCPageConnectionConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly tenantId?: string;
  readonly timeout?: number;
}

/**
 * BC Connection that creates a NEW connection for each page request.
 * This matches the real BC web client behavior to prevent form caching.
 */
export class BCPageConnection implements IBCConnection {
  private readonly config: BCPageConnectionConfig;
  private currentClient: BCRawWebSocketClient | null = null;
  private currentSession: BCSession | undefined;
  private currentPageId: string | null = null;

  // Track open forms for compatibility (but we'll create new connections anyway)
  private openForms: Map<string, string> = new Map();

  // Ack sequence tracking for protocol correlation
  private lastAckSequence = -1;

  public constructor(config: BCPageConnectionConfig) {
    this.config = config;
  }

  /**
   * Creates a fresh connection for page requests.
   * For non-page requests, reuses existing connection.
   */
  public async connect(): Promise<Result<BCSession, BCError>> {
    try {
      // If we already have a session, return it (for initial connection)
      if (this.currentSession) {
        return ok(this.currentSession);
      }

      // Create initial connection
      const client = await this.createNewConnection();
      this.currentClient = client;

      // Build session info (using same pattern as BCSessionConnection)
      this.currentSession = {
        sessionId: 'bc-page-session',
        sessionKey: '',
        company: '',
      };

      return ok(this.currentSession as BCSession);
    } catch (error) {
      return err(
        new ConnectionError(
          `Failed to connect to BC: ${String(error)}`,
          { baseUrl: this.config.baseUrl, error: String(error) }
        )
      );
    }
  }

  /**
   * Creates a new WebSocket connection and authenticates.
   * Sets up global dialog listening to automatically track DialogToShow events.
   */
  private async createNewConnection(): Promise<BCRawWebSocketClient> {
    logger.info(`[BCPageConnection] Creating NEW WebSocket connection...`);

    // Basic auth only needs baseUrl - use type assertion for BCConfig
    const config: BCConfig = {
      baseUrl: this.config.baseUrl,
      tenantId: this.config.tenantId || 'default',
      environment: '',
      azureClientId: '',
      azureTenantId: '',
      azureAuthority: '',
      roleCenterPageId: 0,
    };
    const client = new BCRawWebSocketClient(
      config,
      this.config.username,
      this.config.password,
      this.config.tenantId || 'default'
    );

    // Authenticate via web login
    await client.authenticateWeb();

    // Connect to SignalR hub
    await client.connect();

    // Open BC session
    await client.openSession({
      clientType: 'WebClient',
      clientVersion: '27.0.0.0', // Must match BC server version (BC27 = 27.0.0.0)
      clientCulture: 'en-US',
      clientTimeZone: 'UTC',
    });

    // GLOBAL DIALOG LISTENING: Set up continuous listener for DialogToShow events
    // This handles the race condition where dialogs appear asynchronously after actions complete
    // Dialogs can come from extensions, user actions, or BC workflows at any time
    client.onHandlers((handlers) => {
      this.handleDialogEvents(handlers as Handler[]);
    });

    logger.info(`[BCPageConnection] New connection established with global dialog listening`);
    return client;
  }

  /**
   * Global handler for DialogToShow events.
   * Automatically tracks dialogs in SessionStateManager when they appear.
   */
  private handleDialogEvents(handlers: Handler[]): void {
    for (const handler of handlers) {
      if (isLogicalClientEventRaisingHandler(handler) && handler.parameters?.[0] === 'DialogToShow') {
        // Found DialogToShow event - extract and track it
        this.trackDialog([handler]).catch((error) => {
          logger.warn(`[BCPageConnection] Failed to track dialog: ${String(error)}`);
        });
        break; // Only process first dialog
      }
    }
  }

  /**
   * Extracts dialog information and tracks it in SessionStateManager.
   */
  private async trackDialog(handlers: Handler[]): Promise<void> {
    try {
      // Dynamically import to avoid circular dependencies
      const { HandlerParser } = await import('../parsers/handler-parser.js');
      const { SessionStateManager } = await import('../services/session-state-manager.js');
      const { ConnectionManager } = await import('./connection-manager.js');
      const { isOk } = await import('../core/result.js');

      const parser = new HandlerParser();
      const dialogFormResult = parser.extractDialogForm(handlers);

      if (isOk(dialogFormResult)) {
        const dialogForm = dialogFormResult.value;
        const dialogFormId = dialogForm.ServerId;

        // Get sessionId from ConnectionManager (this connection should be registered)
        const manager = ConnectionManager.getInstance();
        const sessionId = manager.getSessionIdByConnection(this);

        if (sessionId) {
          const sessionStateManager = SessionStateManager.getInstance();
          sessionStateManager.addDialog(sessionId, {
            dialogId: dialogFormId,
            caption: dialogForm.Caption || 'Dialog',
            isTaskDialog: !!dialogForm.IsTaskDialog,
            isModal: !!dialogForm.IsModal,
            logicalForm: dialogForm, // Store LogicalForm for dynamic action extraction in handle_dialog
          });

          logger.info(`[BCPageConnection] Auto-tracked dialog: formId=${dialogFormId}, caption="${dialogForm.Caption}"`);
        } else {
          logger.warn(`[BCPageConnection] Could not track dialog - session not found in ConnectionManager`);
        }
      }
    } catch (error) {
      logger.warn(`[BCPageConnection] Dialog tracking error: ${String(error)}`);
      // Non-fatal - don't disrupt the connection
    }
  }

  /**
   * Sends an interaction and waits for response.
   * Creates fresh connection for each main page OpenForm (Connection Per Page architecture).
   * Reuses connection for other interactions within the same page context.
   */
  public async invoke(interaction: BCInteraction): Promise<Result<readonly Handler[], BCError>> {
    try {
      // Track page ID for OpenForm calls
      const isOpenForm = interaction.interactionName === 'OpenForm';
      if (isOpenForm) {
        const namedParams = typeof interaction.namedParameters === 'object' && interaction.namedParameters !== null
          ? interaction.namedParameters as Record<string, unknown>
          : {};
        const queryString = String(namedParams.query || '');
        const pageMatch = queryString.match(/page=(\d+)/);
        if (pageMatch) {
          const newPageId = pageMatch[1];
          // Force fresh connection for main page OpenForm to clear BC server state
          // BC caches page state per connection - reusing connection causes empty FormToShow
          if (this.currentClient) {
            logger.info(`[BCPageConnection] Closing connection for new page ${newPageId} (was ${this.currentPageId})`);
            await this.close();
          }
          this.currentPageId = newPageId;
          logger.info(`[BCPageConnection] Opening Page ${this.currentPageId} with fresh connection`);
        }
      }

      // Ensure we have a connection (create only if needed)
      if (!this.currentClient) {
        logger.info(`[BCPageConnection] Creating initial connection...`);
        this.currentClient = await this.createNewConnection();
      }

      // Send the interaction
      // FIX: Don't override openFormIds - let BCRawWebSocketClient manage session-level form tracking
      // BCPageConnection was incorrectly accumulating formIds across unrelated pages (Page 21 → Page 22)
      // causing BC to return empty responses due to form state mismatch
      const response = await this.currentClient.invoke({
        interactionName: interaction.interactionName,
        namedParameters: interaction.namedParameters || {},
        controlPath: interaction.controlPath,
        formId: interaction.formId,
        openFormIds: interaction.openFormIds ? [...interaction.openFormIds] : undefined, // Convert readonly to mutable
        lastClientAckSequenceNumber: this.lastAckSequence,
      });

      // Validate response
      if (!Array.isArray(response)) {
        return err(
          new ProtocolError(
            'Invalid response from BC: expected array of handlers',
            {
              interaction: interaction.interactionName,
              receivedType: typeof response,
            }
          )
        );
      }

      // Cast response for typed handler processing
      const handlers = response as readonly Handler[];

      // Update ack sequence from response
      this.updateAckSequenceFromHandlers(handlers);

      // Track form if this was an OpenForm
      if (isOpenForm) {
        const formId = this.extractFormId(handlers);
        if (formId && this.currentPageId) {
          this.openForms.set(this.currentPageId, formId);
          logger.debug(`[BCPageConnection] Tracking form: Page ${this.currentPageId} -> formId ${formId}`);
          // CRITICAL: Add form to openFormIds so BC actions work on this form
          const rawClient = this.getRawClient();
          if (rawClient) {
            rawClient.addOpenForm(formId);
          }
        }
      }

      return ok(handlers);
    } catch (error) {
      const errorMessage = String(error);
      return err(
        new ProtocolError(
          `Interaction failed: ${errorMessage}`,
          {
            interaction: interaction.interactionName,
            error: errorMessage,
          }
        )
      );
    }
  }

  /**
   * Extracts form ID from OpenForm response.
   * BC returns form ID in DN.LogicalClientEventRaisingHandler with FormToShow event.
   */
  private extractFormId(handlers: readonly Handler[]): string | null {
    try {
      // Look for FormToShow event with ServerId
      const formShowHandler = handlers.find(
        (h) => isLogicalClientEventRaisingHandler(h) && h.parameters?.[0] === 'FormToShow'
      );

      if (formShowHandler && isLogicalClientEventRaisingHandler(formShowHandler)) {
        const logicalForm = formShowHandler.parameters?.[1] as LogicalForm | undefined;
        if (logicalForm?.ServerId) {
          return logicalForm.ServerId;
        }
      }

      // Fallback: try old callback response format (for compatibility)
      const callbackHandler = (handlers as readonly GenericHandler[]).find(
        (h) => h.handlerType === 'DN.CallbackResponseProperties'
      );

      if (callbackHandler) {
        const params = callbackHandler.parameters?.[0] as { CompletedInteractions?: Array<{ Result?: { value?: string } }> } | undefined;
        const completedInteractions = params?.CompletedInteractions;
        if (Array.isArray(completedInteractions) && completedInteractions.length > 0) {
          return completedInteractions[0].Result?.value ?? null;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Updates ack sequence number from handler responses.
   * Scans handlers recursively for sequence numbers.
   */
  private updateAckSequenceFromHandlers(handlers: readonly Handler[]): void {
    let maxSeq = this.lastAckSequence;

    const visit = (obj: unknown): void => {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const key = k.toLowerCase();
        if (
          typeof v === 'number' &&
          (key.includes('sequencenumber') || key.includes('ack') || key.includes('serversequence'))
        ) {
          if (v > maxSeq) maxSeq = v;
        } else if (v && typeof v === 'object') {
          visit(v);
        } else if (Array.isArray(v)) {
          for (const item of v) visit(item);
        }
      }
    };

    for (const h of handlers) visit(h);
    if (maxSeq > this.lastAckSequence) {
      this.lastAckSequence = maxSeq;
      logger.debug(`[BCPageConnection] Updated lastAckSequence=${this.lastAckSequence}`);
    }
  }

  /**
   * Load child forms using the LoadForm interaction.
   */
  public async loadChildForms(childForms: ChildFormInfo[]): Promise<Result<readonly Handler[], BCError>> {
    if (!this.currentClient) {
      return err(
        new ConnectionError(
          'No active connection - call connect() first',
          { state: 'not_connected' }
        )
      );
    }

    logger.info(`[BCPageConnection] Loading ${childForms.length} child forms...`);

    const allHandlers: Handler[] = [];
    for (const child of childForms) {
      try {
        // ChildFormInfo from loadform-helpers may have optional controlPath
        const childWithPath = child as ChildFormInfo & { controlPath?: string };
        const response = await this.currentClient.invoke({
          interactionName: 'LoadForm',
          formId: child.serverId,
          controlPath: childWithPath.controlPath || child.serverId || 'server:',
          namedParameters: {},
          openFormIds: undefined, // Let BCRawWebSocketClient manage form tracking
          lastClientAckSequenceNumber: this.lastAckSequence,
        });

        if (Array.isArray(response)) {
          allHandlers.push(...(response as Handler[]));
          logger.debug(`[BCPageConnection] Loaded ${child.serverId}: ${response.length} handlers`);

          // Track the loaded child form so openFormIds stays in sync
          if (this.currentPageId) {
            this.openForms.set(`${this.currentPageId}_child_${child.serverId}`, child.serverId);
            logger.debug(`[BCPageConnection] Tracked child form: ${child.serverId}`);
          }
        }
      } catch (error) {
        // Child form load failures are non-fatal (FactBoxes/Parts require parent record context)
        logger.warn(`[BCPageConnection] Skipped ${child.serverId} (${String(error)}) - continuing without it`);
      }
    }

    return ok(allHandlers as readonly Handler[]);
  }

  /**
   * Waits for handlers that match a predicate.
   * Delegates to the underlying WebSocket client.
   */
  public async waitForHandlers<T>(
    predicate: (handlers: Handler[]) => { matched: boolean; data?: T },
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<T> {
    if (!this.currentClient) {
      throw new Error('No active connection - call connect() first');
    }
    // Wrap predicate to handle unknown[] → Handler[] cast
    const wrappedPredicate = (handlers: unknown[]): { matched: boolean; data?: T } => {
      return predicate(handlers as Handler[]);
    };
    return this.currentClient.waitForHandlers(wrappedPredicate, options);
  }

  /**
   * Gets the underlying raw WebSocket client
   */
  public getRawClient(): BCRawWebSocketClient | null {
    return this.currentClient;
  }

  // Compatibility methods
  public isPageOpen(pageId: string): boolean {
    return this.openForms.has(pageId);
  }

  public getOpenFormId(pageId: string): string | undefined {
    return this.openForms.get(pageId);
  }

  public trackOpenForm(pageId: string, formId: string): void {
    this.openForms.set(pageId, formId);
  }

  public getAllOpenFormIds(): string[] {
    return Array.from(new Set(this.openForms.values()));
  }

  public getCompanyName(): string | null {
    return this.currentClient?.getCompanyName() ?? null;
  }

  public getTenantId(): string {
    return this.currentClient?.getTenantId() ?? 'default';
  }

  public isConnected(): boolean {
    return this.currentClient !== null && this.currentSession !== undefined;
  }

  public getSession(): BCSession | undefined {
    return this.currentSession;
  }

  /**
   * Closes the connection gracefully.
   */
  public async close(): Promise<Result<void, BCError>> {
    try {
      if (this.currentClient) {
        await this.currentClient.disconnect();
        this.currentClient = null;
        this.currentSession = undefined;
        this.currentPageId = null;
        this.openForms.clear();
      }
      return ok(undefined);
    } catch (error) {
      return err(
        new ConnectionError(
          `Failed to close connection: ${String(error)}`,
          { error: String(error) }
        )
      );
    }
  }
}