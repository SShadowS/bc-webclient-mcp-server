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
import { createWorkflowIntegration } from '../services/workflow-integration.js';
import { ControlParser } from '../parsers/control-parser.js';
import type { Handler, LogicalForm, LogicalClientEventRaisingHandler } from '../types/bc-types.js';

/**
 * PageContext structure stored in connection
 */
interface PageContext {
  sessionId: string;
  pageId: string;
  formIds: string[];
  openedAt: number;
  pageType?: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report';
  logicalForm?: LogicalForm | null;
  handlers?: Handler[];
  needsRefresh?: boolean;
}

/**
 * Connection type with pageContexts map
 */
interface ConnectionWithPageContexts extends IBCConnection {
  pageContexts?: Map<string, PageContext>;
}

/**
 * Generic BC handler for special handler types
 */
interface GenericBCHandler {
  handlerType: string;
  parameters?: readonly unknown[];
}

/**
 * Raw WebSocket client with onHandlers method
 */
interface RawClient {
  onHandlers: (callback: (event: Handler[] | { kind: string; handlers: Handler[] }) => void) => () => void;
}

/**
 * Type guard for LogicalClientEventRaisingHandler
 */
function isLogicalClientEventRaisingHandler(handler: Handler | GenericBCHandler): handler is LogicalClientEventRaisingHandler {
  return handler.handlerType === 'DN.LogicalClientEventRaisingHandler';
}

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

/** Parsed page context info */
interface ParsedContext {
  actualSessionId: string;
  actualPageId: string;
}

/** Validated session info */
interface ValidatedSession {
  connection: IBCConnection;
  pageContext: PageContext;
  formId: string;
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
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID to track this operation. For Save/Post actions, automatically clears unsaved changes in workflow.',
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
    const { pageContextId, actionName, controlPath, systemAction, key, workflowId } = input as ExecuteActionInput & { systemAction?: number; key?: string; workflowId?: string };
    const logger = createToolLogger('execute_action', pageContextId);
    const workflow = createWorkflowIntegration(workflowId);

    logger.info(`Executing action "${actionName}" using pageContext: ${pageContextId}`);

    // Step 1: Parse and validate pageContextId
    const parseResult = this.parsePageContextId(pageContextId, actionName);
    if (!isOk(parseResult)) return parseResult;
    const { actualSessionId, actualPageId } = parseResult.value;

    // Step 2: Validate session and get connection
    const sessionResult = this.validateSession(actualSessionId, pageContextId, actionName);
    if (!isOk(sessionResult)) return sessionResult;
    const { connection, pageContext, formId } = sessionResult.value;
    logger.info(`Reusing session: ${actualSessionId}, formId: ${formId}`);

    // Step 2.5: Auto-lookup controlPath from cached metadata if not provided
    let resolvedControlPath = controlPath;
    let resolvedSystemAction = systemAction;
    if (!controlPath) {
      const lookup = this.lookupActionFromCache(pageContext, actionName, logger);
      if (lookup) {
        resolvedControlPath = lookup.controlPath;
        // Only use cached systemAction if not explicitly provided
        if (systemAction === undefined && lookup.systemAction !== undefined) {
          resolvedSystemAction = lookup.systemAction;
        }
        logger.info(`Auto-resolved action "${actionName}": controlPath=${resolvedControlPath}, systemAction=${resolvedSystemAction}`);
      } else {
        logger.warn(`Could not find action "${actionName}" in cached metadata - proceeding without controlPath`);
      }
    }

    // Step 3: Build InvokeAction interaction
    const interaction = this.buildInvokeActionInteraction(formId, resolvedControlPath, resolvedSystemAction, key);
    logger.info(`Building InvokeAction: controlPath=${resolvedControlPath}, formId=${formId}, systemAction=${resolvedSystemAction}, key=${key}`);

    // Step 4: Execute action and accumulate handlers
    const handlersResult = await this.accumulateAsyncHandlers(connection, interaction, actualPageId, actionName, formId, logger);
    if (!isOk(handlersResult)) return handlersResult;
    const handlers = handlersResult.value;

    // Step 5: Auto-track dialogs from handlers
    await this.autoTrackDialogs(handlers, actualSessionId, logger);

    // Step 6: Check for errors in handlers
    const errorResult = this.checkForErrors(handlers, actualPageId, actionName, formId, actualSessionId);
    if (errorResult) return errorResult;

    // Step 7: Mark pageContext as stale
    await this.markPageContextStale(pageContext, pageContextId, logger);

    // Step 8: Record workflow operation
    this.recordWorkflowOperation(workflow, pageContextId, actionName, resolvedControlPath, resolvedSystemAction, actualPageId, formId, logger);

    return ok({
      success: true,
      actionName,
      pageId: actualPageId,
      formId,
      message: `Successfully executed action "${actionName}" on page ${actualPageId}`,
      handlers,
    });
  }

  // ============================================================================
  // Helper Methods - Extracted from executeInternal for reduced complexity
  // ============================================================================

  /** Parse pageContextId and extract session/page info */
  private parsePageContextId(pageContextId: string, actionName: string): Result<ParsedContext, BCError> {
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(new ProtocolError(
        `Invalid pageContextId format: ${pageContextId}`,
        { pageContextId, actionName }
      ));
    }
    return ok({
      actualSessionId: contextParts[0],
      actualPageId: contextParts[2],
    });
  }

  /** Validate session exists and get connection + pageContext */
  private validateSession(actualSessionId: string, pageContextId: string, actionName: string): Result<ValidatedSession, BCError> {
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(actualSessionId);

    if (!connection) {
      return err(new ProtocolError(
        `Session ${actualSessionId} from pageContext not found. Page may have been closed. Call get_page_metadata again.`,
        { pageContextId, actionName, sessionId: actualSessionId }
      ));
    }

    const pageContext = (connection as ConnectionWithPageContexts).pageContexts?.get(pageContextId);
    if (!pageContext) {
      return err(new ProtocolError(
        `Page context ${pageContextId} not found. Page may have been closed. Call get_page_metadata again.`,
        { pageContextId, actionName }
      ));
    }

    const formIds = pageContext.formIds || [];
    if (formIds.length === 0) {
      return err(new ProtocolError(
        `No formId found in page context. Page may not be properly opened.`,
        { pageContextId, actionName }
      ));
    }

    return ok({ connection, pageContext, formId: formIds[0] });
  }

  /** Build InvokeAction interaction object */
  private buildInvokeActionInteraction(
    formId: string,
    controlPath?: string,
    systemAction?: number,
    key?: string
  ): { interactionName: string; skipExtendingSessionLifetime: boolean; namedParameters: string; callbackId: string; controlPath?: string; formId: string } {
    const namedParams = {
      systemAction: systemAction ?? 0,
      key: key ?? null,
      data: {},
      repeaterControlTarget: null,
    };

    return {
      interactionName: 'InvokeAction',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify(namedParams),
      callbackId: '',
      controlPath: controlPath || undefined,
      formId,
    };
  }

  /** Accumulate async handlers from BC response */
  private async accumulateAsyncHandlers(
    connection: IBCConnection,
    interaction: { interactionName: string; skipExtendingSessionLifetime: boolean; namedParameters: string; callbackId: string; controlPath?: string; formId: string },
    actualPageId: string,
    actionName: string,
    formId: string,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<Handler[], BCError>> {
    const rawClient = connection.getRawClient() as RawClient | null;
    if (!rawClient) {
      return err(new ProtocolError(
        `Cannot access raw WebSocket client for async handler capture`,
        { pageId: actualPageId, actionName, formId }
      ));
    }

    const accumulatedHandlers: Handler[] = [];
    let handlerCount = 0;
    const ACCUMULATION_WINDOW_MS = 1000;

    const unsubscribe = rawClient.onHandlers((event) => {
      if (Array.isArray(event)) {
        accumulatedHandlers.push(...event);
        handlerCount++;
        logger.info(`Received async handler batch #${handlerCount}: ${event.length} handlers`);
      } else if (event.kind === 'RawHandlers') {
        accumulatedHandlers.push(...event.handlers);
        handlerCount++;
        logger.info(`Received async handler batch #${handlerCount}: ${event.handlers.length} handlers`);
      }
    });

    try {
      const invokeResult = await connection.invoke(interaction);
      if (isOk(invokeResult)) {
        logger.info(`invoke() returned ${invokeResult.value.length} handlers`);
        accumulatedHandlers.push(...invokeResult.value);
      } else {
        logger.info(`Invoke error: ${invokeResult.error.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, ACCUMULATION_WINDOW_MS));
      logger.info(`Action executed, accumulated ${accumulatedHandlers.length} total handlers from ${handlerCount} batches`);
    } finally {
      unsubscribe();
    }

    return ok(accumulatedHandlers);
  }

  /** Auto-track dialogs from handlers */
  private async autoTrackDialogs(handlers: Handler[], actualSessionId: string, logger: ReturnType<typeof createToolLogger>): Promise<void> {
    for (const handler of handlers) {
      if (isLogicalClientEventRaisingHandler(handler) && handler.parameters?.[0] === 'DialogToShow') {
        try {
          const HandlerParser = (await import('../parsers/handler-parser.js')).HandlerParser;
          const SessionStateManager = (await import('../services/session-state-manager.js')).SessionStateManager;

          const parser = new HandlerParser();
          const dialogFormResult = parser.extractDialogForm([handler]);

          if (isOk(dialogFormResult)) {
            const dialogForm = dialogFormResult.value;
            const dialogFormId = dialogForm.ServerId;
            const sessionStateManager = SessionStateManager.getInstance();

            sessionStateManager.addDialog(actualSessionId, {
              dialogId: dialogFormId,
              caption: dialogForm.Caption || 'Dialog',
              isTaskDialog: !!dialogForm.IsTaskDialog,
              isModal: !!dialogForm.IsModal,
              logicalForm: dialogForm, // Store LogicalForm for dynamic action extraction in handle_dialog
            });

            logger.info(`Auto-tracked dialog: formId=${dialogFormId}, caption="${dialogForm.Caption}"`);
          }
        } catch (error) {
          logger.warn({ error: String(error) }, 'Failed to auto-track dialog (non-fatal)');
        }
        break; // Only process first dialog
      }
    }
  }

  /** Check for error handlers in response */
  private checkForErrors(
    handlers: Handler[],
    actualPageId: string,
    actionName: string,
    formId: string,
    actualSessionId: string
  ): Result<never, BCError> | null {
    const errorHandler = (handlers as readonly GenericBCHandler[]).find(
      (h) => h.handlerType === 'DN.ErrorMessageProperties' || h.handlerType === 'DN.ErrorDialogProperties'
    );

    if (errorHandler) {
      const errorParams = errorHandler.parameters?.[0] as { Message?: string; ErrorMessage?: string } | undefined;
      const errorMessage = errorParams?.Message || errorParams?.ErrorMessage || 'Unknown error';

      return err(new ProtocolError(
        `BC returned error: ${errorMessage}`,
        { pageId: actualPageId, actionName, formId, sessionId: actualSessionId, errorHandler }
      ));
    }

    return null;
  }

  /** Mark pageContext as stale and clear cache */
  private async markPageContextStale(
    pageContext: PageContext,
    pageContextId: string,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<void> {
    try {
      if (pageContext) {
        pageContext.needsRefresh = true;
        logger.info(`Marked pageContext as needing refresh`);
      }

      const cache = PageContextCache.getInstance();
      await cache.delete(pageContextId);
      logger.info(`Invalidated persistent cache for pageContext: ${pageContextId}`);
    } catch (cacheError) {
      logger.info(`Failed to invalidate cache: ${cacheError}`);
    }
  }

  /** Record operation in workflow */
  private recordWorkflowOperation(
    workflow: ReturnType<typeof createWorkflowIntegration>,
    pageContextId: string,
    actionName: string,
    controlPath: string | undefined,
    systemAction: number | undefined,
    actualPageId: string,
    formId: string,
    logger: ReturnType<typeof createToolLogger>
  ): void {
    if (!workflow) return;

    const commitActions = ['save', 'post', 'ok', 'yes'];
    const isCommitAction = commitActions.includes(actionName.toLowerCase());

    if (isCommitAction) {
      workflow.clearUnsavedChanges();
      logger.info(`Cleared unsaved changes for commit action: ${actionName}`);
    }

    workflow.recordOperation(
      'execute_action',
      { pageContextId, actionName, controlPath, systemAction },
      { success: true, data: { actionName, pageId: actualPageId, formId } }
    );
  }

  /**
   * Look up action from cached page metadata.
   * Searches for action by name (DesignName) or caption.
   * Returns controlPath and systemAction if found.
   */
  private lookupActionFromCache(
    pageContext: PageContext,
    actionName: string,
    logger: ReturnType<typeof createToolLogger>
  ): { controlPath: string; systemAction?: number } | null {
    if (!pageContext?.logicalForm) {
      logger.debug(`[Action Lookup] No logicalForm in pageContext - checking handlers`);

      // Try to find LogicalForm in handlers
      const handlers = pageContext?.handlers || [];
      let logicalForm: LogicalForm | null = null;

      for (const handler of handlers) {
        // LogicalForm might be embedded in handlers - check for LogicalForm structure
        const handlerObj = handler as unknown as Record<string, unknown>;
        if (handlerObj?.t === 'lf' || handlerObj?.DesignName || handlerObj?.c) {
          logicalForm = handlerObj as unknown as LogicalForm;
          break;
        }
      }

      if (!logicalForm) {
        logger.debug(`[Action Lookup] No logicalForm found in handlers either`);
        return null;
      }

      // Use the found logicalForm
      return this.searchActionsInLogicalForm(logicalForm, actionName, logger);
    }

    return this.searchActionsInLogicalForm(pageContext.logicalForm, actionName, logger);
  }

  private searchActionsInLogicalForm(
    logicalForm: LogicalForm,
    actionName: string,
    logger: ReturnType<typeof createToolLogger>
  ): { controlPath: string; systemAction?: number } | null {
    const normalizedName = actionName.toLowerCase().replace(/[&_]/g, '');

    // Use ControlParser to properly walk controls and assign controlPath
    const controlParser = new ControlParser();
    const actions = controlParser.extractActions(controlParser.walkControls(logicalForm));

    logger.debug(`[Action Lookup] Looking up "${actionName}" (normalized: "${normalizedName}") among ${actions.length} actions`);

    // Find matching action - prefer exact matches over partial matches
    // Also prefer real actions over _Promoted variants
    let bestMatch: { controlPath: string; systemAction?: number } | null = null;
    let bestMatchScore = 0;

    for (const action of actions) {
      // Caption includes & character (e.g., "Re&lease"), normalize by removing it
      const rawCaption = action.caption || '';
      const captionNormalized = rawCaption.toLowerCase().replace(/[&_]/g, '');

      // Check for match
      let score = 0;
      if (captionNormalized === normalizedName) {
        score = 100; // Exact match after normalization
      } else if (rawCaption.toLowerCase().replace(/&/g, '') === normalizedName) {
        score = 90; // Exact match preserving underscore
      } else if (captionNormalized.includes(normalizedName)) {
        score = 50; // Partial match
      }

      if (score > 0) {
        // Penalize _Promoted variants (they are toolbar shortcuts, not the actual action)
        if (rawCaption.includes('_Promoted')) {
          score -= 30;
        }

        logger.debug(`[Action Lookup] Candidate: caption="${rawCaption}", score=${score}, controlPath="${action.controlPath}"`);

        if (score > bestMatchScore && action.controlPath) {
          bestMatch = { controlPath: action.controlPath, systemAction: action.systemAction };
          bestMatchScore = score;
          logger.debug(`[Action Lookup] Best match: caption="${rawCaption}", score=${score}, controlPath="${action.controlPath}"`);
        }
      }
    }

    if (bestMatch) {
      return bestMatch;
    }

    // Log available actions if no match
    if (actions.length > 0) {
      const preview = actions.slice(0, 15).map(a => a.caption).join(', ');
      logger.info(`[Action Lookup] Found ${actions.length} actions, but none matched "${actionName}". Sample: ${preview}`);
    }

    return null;
  }
}
