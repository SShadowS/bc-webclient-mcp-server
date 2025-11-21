/**
 * Execute Action Tool
 *
 * Executes an action (button click) on a Business Central page.
 * Uses the InvokeAction interaction to trigger actions like Edit, New, Delete, etc.
 *
 * Based on BC_INTERACTION_CAPTURE_PLAN.md - InvokeAction protocol.
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { BaseMCPTool } from './base-tool.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';
import type { AuditLogger } from '../services/audit-logger.js';
import { ExecuteActionInputSchema, type ExecuteActionInput } from '../validation/schemas.js';
import { PageContextCache } from '../services/page-context-cache.js';

/**
 * Output from execute_action tool.
 */
export interface ExecuteActionOutput {
  readonly success: boolean;
  readonly actionName: string;
  readonly pageId: string;
  readonly formId: string;
  readonly message: string;
  readonly handlers?: readonly unknown[];
}

/**
 * MCP Tool for executing actions on BC pages.
 * Implements the InvokeAction interaction protocol.
 */
export class ExecuteActionTool extends BaseMCPTool {
  public readonly name = 'execute_action';

  public readonly description =
    'Executes an action (button click) on a Business Central page using an existing pageContextId from get_page_metadata. ' +
    'actionName: Use action identifiers from get_page_metadata.actions array when available. ' +
    'Common well-known actions: "Edit", "New", "Delete", "Post", "Save", "Cancel", "OK", "Yes", "No". ' +
    'controlPath (optional): Control path for the action button to disambiguate when multiple actions share similar names. ' +
    'Returns: {success, actionName, pageId, formId, message}. ' +
    'Side effects: May navigate to another page (requiring new get_page_metadata call) or trigger dialog windows (use handle_dialog to respond). ' +
    'WARNING: High-risk operation. Actions like "Post", "Delete", or "Approve" may irreversibly commit or delete data. Use only with explicit consent.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Required: Page context ID from get_page_metadata. Ensures action targets the correct page instance.',
      },
      actionName: {
        type: 'string',
        description: 'The name of the action to execute (e.g., "Edit", "New", "Delete", "Post", "Save")',
      },
      controlPath: {
        type: 'string',
        description: 'Optional: The control path for the action button. If not provided, will attempt automatic lookup.',
      },
      systemAction: {
        type: 'number',
        description: 'Optional: The BC systemAction code from action metadata. Required for some actions.',
      },
    },
    required: ['pageContextId', 'actionName'],
  };

  // Consent configuration - High risk operation (can trigger Post, Delete, etc.)
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'high' as const;
  public readonly consentPrompt =
    'Execute an action in Business Central? WARNING: Some actions like Post or Delete may be irreversible and cannot be undone.';

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    },
    auditLogger?: AuditLogger
  ) {
    super({ auditLogger, inputZod: ExecuteActionInputSchema });
  }

  /**
   * Executes the action on the BC page.
   * Input is pre-validated by BaseMCPTool using Zod schema.
   */
  protected async executeInternal(input: unknown): Promise<Result<ExecuteActionOutput, BCError>> {
    // Input is already validated by BaseMCPTool with Zod
    const { pageContextId, actionName, controlPath, systemAction, key } = input as ExecuteActionInput & { systemAction?: number; key?: string };
    const logger = createToolLogger('execute_action', pageContextId);

    logger.info(`Executing action "${actionName}" using pageContext: ${pageContextId}`);

    // Parse pageContextId (format: sessionId:page:pageId:timestamp)
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(
          `Invalid pageContextId format: ${pageContextId}`,
          { pageContextId, actionName }
        )
      );
    }

    const manager = ConnectionManager.getInstance();
    const actualSessionId = contextParts[0];
    const actualPageId = contextParts[2];

    // Get connection from session
    const existing = manager.getSession(actualSessionId);
    if (!existing) {
      return err(
        new ProtocolError(
          `Session ${actualSessionId} from pageContext not found. Page may have been closed. Call get_page_metadata again.`,
          { pageContextId, actionName, sessionId: actualSessionId }
        )
      );
    }

    const connection = existing;
    logger.info(`Reusing session from pageContext: ${actualSessionId}`);

    // Get pageContext to access formId
    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    if (!pageContext) {
      return err(
        new ProtocolError(
          `Page context ${pageContextId} not found. Page may have been closed. Call get_page_metadata again.`,
          { pageContextId, actionName }
        )
      );
    }

    // Use formId from pageContext
    const formIds = pageContext.formIds || [];
    if (formIds.length === 0) {
      return err(
        new ProtocolError(
          `No formId found in page context. Page may not be properly opened.`,
          { pageContextId, actionName }
        )
      );
    }

    const formId = formIds[0]; // Use first formId (main form)
    logger.info(`Using formId from pageContext: ${formId}`);


    // Build InvokeAction interaction (real BC protocol)
    // BC triggers actions via controlPath - the path to the action button
    //
    // CRITICAL: Browser WebUI ALWAYS sends these 4 parameters for Document page actions:
    //   { "systemAction": 0, "key": null, "data": {}, "repeaterControlTarget": null }
    //
    // For List page row actions, browser sends:
    //   { "systemAction": X, "key": "bookmark", "data": {}, "repeaterControlTarget": null }
    //
    // Our previous implementation was missing required fields, causing BC to ignore actions.
    const namedParams: { systemAction: number; key: string | null; data: Record<string, unknown>; repeaterControlTarget: null } = {
      systemAction: systemAction ?? 0,  // Default to 0 for document page actions
      key: key ?? null,                  // null for document actions, bookmark for list row actions
      data: {},                          // Always empty object
      repeaterControlTarget: null,       // Always null
    };

    const interaction = {
      interactionName: 'InvokeAction',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify(namedParams),
      callbackId: '', // Will be set by connection
      controlPath: controlPath || undefined, // Required: path to action button
      formId,
    };

    const namedParamsJson = JSON.stringify(namedParams);
    console.log(`[ExecuteAction] Building interaction: controlPath=${controlPath}, formId=${formId}`);
    console.log(`[ExecuteAction] namedParameters JSON: ${namedParamsJson}`);
    logger.info(`Building InvokeAction: controlPath=${controlPath}, formId=${formId}, systemAction=${systemAction}, key=${key}`);

    logger.info(`Sending InvokeAction interaction...`);

    // CRITICAL: Use async handler pattern - BC sends action results asynchronously!
    // BC sends MULTIPLE async Message events after invoke returns.
    // We need to accumulate ALL handlers over a time window, not just the first one.
    const rawClient = (connection as any).getRawClient?.();
    if (!rawClient) {
      return err(
        new ProtocolError(
          `Cannot access raw WebSocket client for async handler capture`,
          { pageId: actualPageId, actionName, formId }
        )
      );
    }

    // Accumulate all async handlers over a time window
    // BC may send multiple Message events with different handler types
    const accumulatedHandlers: any[] = [];
    let handlerCount = 0;
    const ACCUMULATION_WINDOW_MS = 1000; // Wait 1 second to accumulate all handlers

    // Set up listener BEFORE calling invoke
    console.log('[ExecuteAction] Setting up async handler listener...');
    const unsubscribe = rawClient.onHandlers((event: any) => {
      console.log(`[ExecuteAction] onHandlers callback - event:`, JSON.stringify(event).substring(0, 200));
      console.log(`[ExecuteAction] event.kind: ${event.kind}, isArray: ${Array.isArray(event)}`);

      // Check if event IS the handlers array (not wrapped in {kind, handlers})
      if (Array.isArray(event)) {
        accumulatedHandlers.push(...event);
        handlerCount++;
        console.log(`[ExecuteAction] Received async handler batch #${handlerCount}: ${event.length} handlers (direct array)`);
        logger.info(`Received async handler batch #${handlerCount}: ${event.length} handlers`);
      } else if (event.kind === 'RawHandlers') {
        accumulatedHandlers.push(...event.handlers);
        handlerCount++;
        console.log(`[ExecuteAction] Received async handler batch #${handlerCount}: ${event.handlers.length} handlers (wrapped)`);
        logger.info(`Received async handler batch #${handlerCount}: ${event.handlers.length} handlers`);
      }
    });

    try {
      console.log('[ExecuteAction] Firing invoke...');
      // AWAIT invoke() to capture response handlers - they come back synchronously!
      const invokeResult = await connection.invoke(interaction);

      if (isOk(invokeResult)) {
        const responseHandlers = invokeResult.value;
        console.log(`[ExecuteAction] invoke() returned ${responseHandlers.length} handlers`);
        logger.info(`invoke() returned ${responseHandlers.length} handlers`);
        accumulatedHandlers.push(...responseHandlers);
      } else {
        console.log(`[ExecuteAction] Invoke error: ${invokeResult.error.message}`);
        logger.info(`Invoke error: ${invokeResult.error.message}`);
      }

      // Also wait briefly for any additional async handlers
      console.log(`[ExecuteAction] Waiting ${ACCUMULATION_WINDOW_MS}ms for additional handlers...`);
      await new Promise((resolve) => setTimeout(resolve, ACCUMULATION_WINDOW_MS));

      console.log(`[ExecuteAction] Accumulated ${accumulatedHandlers.length} total handlers from ${handlerCount} batches`);
      logger.info(`Action executed, accumulated ${accumulatedHandlers.length} total handlers from ${handlerCount} batches`);
    } finally {
      // Clean up listener
      console.log('[ExecuteAction] Cleaning up listener');
      unsubscribe();
    }

    const handlers = accumulatedHandlers;
    logger.info(`Total handlers received: ${handlers.length}`);

    // Check for errors in response handlers
    const errorHandler = handlers.find(
      (h: any) => h.handlerType === 'DN.ErrorMessageProperties' || h.handlerType === 'DN.ErrorDialogProperties'
    );

    if (errorHandler) {
      const errorParams = (errorHandler as any).parameters?.[0];
      const errorMessage = errorParams?.Message || errorParams?.ErrorMessage || 'Unknown error';

      return err(
        new ProtocolError(
          `BC returned error: ${errorMessage}`,
          { pageId: actualPageId, actionName, formId, sessionId: actualSessionId, errorHandler }
        )
      );
    }

    // CRITICAL: Mark pageContext as needing refresh
    // Actions may change page state, so cached data would be stale
    // Set needsRefresh flag so read_page_data will call LoadForm for fresh data
    try {
      logger.info(`Setting needsRefresh flag on pageContext (exists: ${!!pageContext})`);
      if (pageContext) {
        pageContext.needsRefresh = true;
        logger.info(`Marked pageContext as needing refresh (needsRefresh=${pageContext.needsRefresh})`);
      } else {
        logger.info(`pageContext is null/undefined, cannot set needsRefresh`);
      }

      // Also clear persistent cache (it stores stale data)
      const cache = PageContextCache.getInstance();
      await cache.delete(pageContextId);
      logger.info(`Invalidated persistent cache for pageContext: ${pageContextId}`);
    } catch (cacheError) {
      logger.info(`Failed to invalidate cache: ${cacheError}`);
      // Non-fatal - continue with success
    }

    return ok({
      success: true,
      actionName,
      pageId: actualPageId,
      formId,
      message: `Successfully executed action "${actionName}" on page ${actualPageId}`,
      handlers,
    });
  }
}
