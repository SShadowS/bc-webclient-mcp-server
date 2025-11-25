/**
 * Select and Drill Down Tool
 *
 * Selects a specific row in a BC list page and drills down to the detail page.
 * Implements the SetCurrentRowAndRowsSelection + InvokeAction protocol discovered
 * from WebSocket capture analysis.
 *
 * Based on BC_PROTOCOL_PATTERNS.md - Pattern 5: Row Selection and Drill-Down
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
import {
  SelectAndDrillDownInputSchema,
  type SelectAndDrillDownInput,
} from '../validation/schemas.js';
import { PageContextCache } from '../services/page-context-cache.js';
import { PageMetadataParser } from '../parsers/page-metadata-parser.js';
import { decompressResponse, extractServerIds, filterFormsToLoad, createLoadFormInteraction } from '../util/loadform-helpers.js';
import type { Handler, PageMetadata } from '../types/bc-types.js';

/**
 * Output from select_and_drill_down tool.
 */
export interface SelectAndDrillDownOutput {
  readonly success: boolean;
  readonly sourcePageContextId: string;
  readonly targetPageContextId: string;
  readonly sourcePageId: string;
  readonly targetPageId: string;
  readonly bookmark: string;
  readonly action: string;
  readonly message: string;
}

/**
 * System action codes for BC InvokeAction
 */
const SystemAction = {
  Edit: 40,
  View: 39,
} as const;

/**
 * Options for sendInvokeAction
 */
interface InvokeActionOptions {
  connection: IBCConnection;
  action: string;
  systemAction: number;
  actionControlPath: string;
  formId: string;
  sourcePageId: string;
  bookmark: string;
  sessionId: string;
  logger: ReturnType<typeof createToolLogger>;
}

/** Parsed page context info */
interface ParsedPageContext {
  actualSessionId: string;
  sourcePageId: string;
}

/** Validated session info */
interface ValidatedSession {
  connection: IBCConnection;
  pageContext: any;
  formId: string;
}

/**
 * MCP Tool for selecting a row and drilling down to detail page.
 * Implements the SetCurrentRowAndRowsSelection + InvokeAction protocol.
 */
export class SelectAndDrillDownTool extends BaseMCPTool {
  public readonly name = 'select_and_drill_down';

  public readonly description =
    'Selects a specific row in a Business Central List page and navigates to its detail page (Card/Document) by invoking a header action (Edit or View). ' +
    'Uses the page metadata (HeaderActions) to locate suitable actions in /ha[N] or /a[N] arrays (not :c[N] Children duplicates). ' +
    'Arguments: bookmark (from read_page_data, identifies the row), action ("Edit" default or "View"), pageContextId (List page from get_page_metadata). ' +
    'Returns: {sourcePageContextId, targetPageContextId} where targetPageContextId can be used with read_page_data/write_page_data to work with the opened detail page. ' +
    'Side effects: Navigates to a new page, creating a new pageContext. Original list page remains open. ' +
    'Fails if no matching header action is found. Use this for "open card/document" workflows. For list-only reads/updates without navigation, use get_page_metadata + read_page_data/write_page_data directly. ' +
    'WARNING: Requires consent as it triggers navigation and may load sensitive data.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Required: Page context ID from get_page_metadata (must be a List page)',
      },
      bookmark: {
        type: 'string',
        description:
          'The bookmark identifying the row to select (from read_page_data output)',
      },
      action: {
        type: 'string',
        enum: ['Edit', 'View'],
        description: 'Action to invoke: "Edit" (default) or "View"',
        default: 'Edit',
      },
    },
    required: ['pageContextId', 'bookmark'],
  };

  // Consent configuration - Navigation operation with data loading
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'medium' as const;
  public readonly consentPrompt =
    'Select a row and drill down to detail page in Business Central? This will navigate to a new page and may load sensitive data.';

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    },
    auditLogger?: AuditLogger,
    private readonly metadataParser: PageMetadataParser = new PageMetadataParser()
  ) {
    super({ auditLogger, inputZod: SelectAndDrillDownInputSchema });
  }

  /**
   * Executes the select and drill-down operation.
   * Input is pre-validated by BaseMCPTool using Zod schema.
   */
  protected async executeInternal(
    input: unknown
  ): Promise<Result<SelectAndDrillDownOutput, BCError>> {
    const { pageContextId, bookmark, action } = input as SelectAndDrillDownInput;
    const logger = createToolLogger('select_and_drill_down', pageContextId);
    logger.info(`Selecting row with bookmark "${bookmark}" and drilling down with action "${action}"`);

    // Step 1: Parse and validate pageContextId
    const parseResult = this.parsePageContextId(pageContextId, bookmark);
    if (!isOk(parseResult)) return parseResult;
    const { actualSessionId, sourcePageId } = parseResult.value;

    // Step 2: Validate session and get connection
    const sessionResult = this.validateSession(actualSessionId, pageContextId, bookmark);
    if (!isOk(sessionResult)) return sessionResult;
    const { connection, pageContext, formId } = sessionResult.value;
    logger.info(`Reusing session: ${actualSessionId}, formId: ${formId}`);

    // Step 3: Find repeater control path
    const repeaterPath = this.findRepeaterControlPath(pageContext.logicalForm);
    if (!repeaterPath) {
      return err(new ProtocolError(
        `No repeater control found in page. This tool requires a List page with a data grid.`,
        { pageContextId, pageId: sourcePageId }
      ));
    }
    logger.info(`Found repeater control at: ${repeaterPath}`);

    // Step 4: Set up listeners BEFORE interactions (avoid race conditions)
    const navigationPromise = connection.waitForHandlers(
      this.createFormToShowPredicate(logger),
      { timeoutMs: 10000 }
    );
    const asyncDataPromise = connection.waitForHandlers(
      this.createRecordDataPredicate(logger),
      { timeoutMs: 5000 }
    );

    // Step 5: Select the row
    const selectionResult = await this.sendRowSelection(
      connection, formId, bookmark, repeaterPath, sourcePageId, actualSessionId, logger
    );
    if (!isOk(selectionResult)) return selectionResult;

    // Step 6: Find and invoke the action
    const actionResult = this.findActionControlPath(pageContext, action, sourcePageId, pageContextId, logger);
    if (!isOk(actionResult)) return actionResult;
    const { controlPath: actionControlPath, systemAction, caption } = actionResult.value;
    logger.info(`Selected action: "${caption}", controlPath: ${actionControlPath}`);

    const invokeResult = await this.sendInvokeAction({
      connection, action, systemAction, actionControlPath, formId, sourcePageId, bookmark, sessionId: actualSessionId, logger
    });
    if (!isOk(invokeResult)) return invokeResult;

    // Step 7: Wait for navigation
    const navResult = await this.waitForNavigation(navigationPromise, action, sourcePageId, bookmark, logger);
    if (!isOk(navResult)) return navResult;

    // Step 8: Load child forms and collect async data
    const { allHandlers, shellFormId } = await this.loadChildFormsAndData(
      connection, navResult.value, asyncDataPromise, logger
    );

    // Step 9: Create target page context
    const contextResult = await this.createTargetPageContext(
      connection, actualSessionId, allHandlers, shellFormId, logger
    );
    if (!isOk(contextResult)) return contextResult;
    const { targetPageContextId, targetPageId, targetCaption } = contextResult.value;

    logger.info(`Navigated to target page: ${targetPageId} (${targetCaption})`);

    return ok({
      success: true,
      sourcePageContextId: pageContextId,
      targetPageContextId,
      sourcePageId,
      targetPageId,
      bookmark,
      action,
      message: `Successfully selected row and drilled down from ${sourcePageId} to ${targetPageId} using ${action}`,
    });
  }

  // ============================================================================
  // Helper Methods - Extracted from executeInternal for reduced complexity
  // ============================================================================

  /** Parse pageContextId and extract session/page info */
  private parsePageContextId(pageContextId: string, bookmark: string): Result<ParsedPageContext, BCError> {
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(`Invalid pageContextId format: ${pageContextId}`, {
          pageContextId,
          bookmark,
        })
      );
    }
    return ok({
      actualSessionId: contextParts[0],
      sourcePageId: contextParts[2],
    });
  }

  /** Validate session exists and get connection + pageContext */
  private validateSession(
    actualSessionId: string,
    pageContextId: string,
    bookmark: string
  ): Result<ValidatedSession, BCError> {
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(actualSessionId);

    if (!connection) {
      return err(
        new ProtocolError(
          `Session ${actualSessionId} from pageContext not found. Page may have been closed. Call get_page_metadata again.`,
          { pageContextId, bookmark, sessionId: actualSessionId }
        )
      );
    }

    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    if (!pageContext) {
      return err(
        new ProtocolError(
          `Page context ${pageContextId} not found. Page may have been closed. Call get_page_metadata again.`,
          { pageContextId, bookmark }
        )
      );
    }

    const formIds = pageContext.formIds || [];
    if (formIds.length === 0) {
      return err(
        new ProtocolError(
          `No formId found in page context. Page may not be properly opened.`,
          { pageContextId, bookmark }
        )
      );
    }

    return ok({
      connection,
      pageContext,
      formId: formIds[0],
    });
  }

  /** Create predicate for FormToShow events */
  private createFormToShowPredicate(logger: ReturnType<typeof createToolLogger>) {
    return (handlers: Handler[]): { matched: boolean; data?: Handler[] } => {
      const matchingHandlers = handlers.filter(
        (h) =>
          h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          Array.isArray((h as any).parameters) &&
          (h as any).parameters[0] === 'FormToShow'
      );

      if (matchingHandlers.length > 0) {
        logger.info(`Detected FormToShow event, ${matchingHandlers.length} handler(s)`);
        return { matched: true, data: handlers };
      }
      return { matched: false };
    };
  }

  /** Create predicate for record data events */
  private createRecordDataPredicate(logger: ReturnType<typeof createToolLogger>) {
    return (handlers: Handler[]): { matched: boolean; data?: Handler[] } => {
      const matched = handlers.some((h: any) => {
        if (h.handlerType === 'DN.LogicalClientChangeHandler' && Array.isArray(h.parameters?.[1])) {
          return h.parameters[1].some((change: any) => {
            if (change.t === 'DataRefreshChange' || change.t === 'InitializeChange') {
              return true;
            }
            if (change.t === 'DataRowUpdated') {
              logger.info('Detected DataRowUpdated event (List control data)');
              return true;
            }
            if (change.t === 'PropertyChanges' && change.Changes) {
              const hasFieldValue = change.Changes.StringValue !== undefined ||
                                  change.Changes.ObjectValue !== undefined ||
                                  change.Changes.DecimalValue !== undefined;
              if (hasFieldValue) {
                logger.info('Detected PropertyChanges with field value (Card data)');
                return true;
              }
            }
            return false;
          });
        }
        return false;
      });

      if (matched) {
        logger.info(`hasRecordData matched! Returning ${handlers.length} handlers`);
        return { matched: true, data: handlers };
      }
      return { matched: false };
    };
  }

  /** Send SetCurrentRowAndRowsSelection interaction */
  private async sendRowSelection(
    connection: IBCConnection,
    formId: string,
    bookmark: string,
    repeaterPath: string,
    sourcePageId: string,
    actualSessionId: string,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<void, BCError>> {
    const selectionInteraction = {
      interactionName: 'SetCurrentRowAndRowsSelection',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify({
        key: bookmark,
        selectAll: false,
        rowsToSelect: [bookmark],
        unselectAll: true,
        rowsToUnselect: [],
      }),
      callbackId: '',
      controlPath: repeaterPath,
      formId,
    };

    logger.info(`Sending SetCurrentRowAndRowsSelection interaction...`);
    const selectionResult = await connection.invoke(selectionInteraction);

    if (!isOk(selectionResult)) {
      return err(
        new ProtocolError(
          `Failed to select row with bookmark "${bookmark}": ${selectionResult.error.message}`,
          {
            pageId: sourcePageId,
            bookmark,
            formId,
            sessionId: actualSessionId,
            originalError: selectionResult.error,
          }
        )
      );
    }

    logger.info(`Row selected successfully`);
    return ok(undefined);
  }

  /** Find the action control path from metadata */
  private findActionControlPath(
    pageContext: any,
    action: string,
    sourcePageId: string,
    pageContextId: string,
    logger: ReturnType<typeof createToolLogger>
  ): Result<{ controlPath: string; systemAction: number; caption: string }, BCError> {
    const systemAction = action === 'View' ? SystemAction.View : SystemAction.Edit;

    const actionMetadataResult = this.metadataParser.parse(pageContext.handlers);
    if (!isOk(actionMetadataResult)) {
      return err(
        new ProtocolError(
          `Failed to parse page metadata to find action: ${actionMetadataResult.error.message}`,
          { pageId: sourcePageId, action, pageContextId, originalError: actionMetadataResult.error }
        )
      );
    }

    const metadata = actionMetadataResult.value;
    const editActions = metadata.actions.filter(a => a.systemAction === systemAction);
    logger.info(`Found ${editActions.length} actions with systemAction ${systemAction}:`);
    editActions.forEach((a, i) => {
      logger.info(`  [${i}] Caption: "${a.caption}", controlPath: ${a.controlPath || 'MISSING'}`);
    });

    // Prefer canonical action paths (/ha[N] or /a[N]) over Children paths (:c[N])
    const targetAction = metadata.actions
      .filter(a => a.systemAction === systemAction)
      .sort((a, b) => {
        const aIsCanonical = a.controlPath?.includes('/ha[') || a.controlPath?.includes('/a[');
        const bIsCanonical = b.controlPath?.includes('/ha[') || b.controlPath?.includes('/a[');
        if (aIsCanonical && !bIsCanonical) return -1;
        if (!aIsCanonical && bIsCanonical) return 1;
        return 0;
      })[0];

    if (!targetAction || !targetAction.controlPath) {
      return err(
        new ProtocolError(
          `${action} action (systemAction ${systemAction}) not found or missing controlPath in page metadata`,
          {
            pageId: sourcePageId,
            action,
            systemAction,
            availableActions: metadata.actions.map(a => ({
              caption: a.caption,
              systemAction: a.systemAction,
              hasControlPath: !!a.controlPath,
            })),
          }
        )
      );
    }

    return ok({
      controlPath: targetAction.controlPath,
      systemAction,
      caption: targetAction.caption || action,
    });
  }

  /** Send InvokeAction interaction */
  private async sendInvokeAction(opts: InvokeActionOptions): Promise<Result<void, BCError>> {
    const { connection, action, systemAction, actionControlPath, formId, sourcePageId, bookmark, sessionId, logger } = opts;

    const actionInteraction = {
      interactionName: 'InvokeAction',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify({
        systemAction,
        key: null,
        repeaterControlTarget: null,
      }),
      callbackId: '',
      controlPath: actionControlPath,
      formId,
    };

    logger.info(`Sending InvokeAction (${action}, systemAction=${systemAction})...`);
    const actionResult = await connection.invoke(actionInteraction);

    if (!isOk(actionResult)) {
      return err(
        new ProtocolError(
          `Failed to invoke action "${action}": ${actionResult.error.message}`,
          {
            pageId: sourcePageId,
            action,
            bookmark,
            formId,
            sessionId,
            originalError: actionResult.error,
          }
        )
      );
    }

    logger.info(`Action invoked successfully`);
    return ok(undefined);
  }

  /** Wait for navigation FormToShow event */
  private async waitForNavigation(
    navigationPromise: Promise<Handler[] | null>,
    action: string,
    sourcePageId: string,
    bookmark: string,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<Handler[], BCError>> {
    try {
      const result = await navigationPromise;
      if (!result || !Array.isArray(result)) {
        return err(
          new ProtocolError(
            `Navigation did not occur after invoking ${action}. The action may not support navigation or the row may not have detail records.`,
            { pageId: sourcePageId, action, bookmark }
          )
        );
      }
      logger.info(`Navigation detected, received ${result.length} handlers`);
      return ok(result);
    } catch (error) {
      return err(
        new ProtocolError(
          `Timeout waiting for navigation after ${action}. The page may not have opened or BC may be slow to respond.`,
          { pageId: sourcePageId, action, bookmark, originalError: error }
        )
      );
    }
  }

  /** Load child forms and collect async data */
  private async loadChildFormsAndData(
    connection: IBCConnection,
    navigationHandlers: Handler[],
    asyncDataPromise: Promise<Handler[] | null>,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<{ allHandlers: Handler[]; shellFormId: string | null }> {
    const decompressed = decompressResponse(navigationHandlers);
    let allNavigationHandlers = decompressed || navigationHandlers;
    let targetShellFormId: string | null = null;

    try {
      const { shellFormId, childFormIds } = extractServerIds(allNavigationHandlers);
      targetShellFormId = shellFormId;
      logger.info(`Extracted shellFormId for target page: ${shellFormId}`);
      const formsToLoad = filterFormsToLoad(childFormIds);

      if (formsToLoad.length > 0) {
        logger.info(`Found ${formsToLoad.length} child form(s) requiring LoadForm after navigation`);
        for (let i = 0; i < formsToLoad.length; i++) {
          const child = formsToLoad[i];
          const interaction = createLoadFormInteraction(child.serverId, String(i));
          logger.info(`Calling LoadForm for child form: ${child.serverId}`);
          const loadResult = await connection.invoke(interaction);
          if (!isOk(loadResult)) {
            logger.info(`LoadForm failed for ${child.serverId}: ${loadResult.error.message}`);
          } else {
            logger.info(`LoadForm sent for: ${child.serverId}`);
          }
        }
      } else {
        logger.info(`No child forms requiring LoadForm`);
      }

      // Wait for async record data
      logger.info(`Checking for async record data (timeout 5s)...`);
      try {
        const asyncHandlers = await asyncDataPromise;
        if (asyncHandlers && Array.isArray(asyncHandlers)) {
          logger.info(`Received ${asyncHandlers.length} async handlers with record data`);
          allNavigationHandlers.push(...asyncHandlers);
        } else {
          logger.info(`No async record data received (predicate returned no data)`);
        }
      } catch (err) {
        logger.info(`No async record data received (timeout): ${String(err)}`);
      }
    } catch (err) {
      logger.info(`LoadForm/AsyncData extraction failed: ${String(err)} - continuing with FormToShow data only`);
    }

    return { allHandlers: allNavigationHandlers, shellFormId: targetShellFormId };
  }

  /** Create and store target page context */
  private async createTargetPageContext(
    connection: IBCConnection,
    actualSessionId: string,
    dataToProcess: Handler[],
    targetShellFormId: string | null,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<{ targetPageContextId: string; targetPageId: string; targetCaption: string }, BCError>> {
    const metadataResult = this.metadataParser.parse(dataToProcess);
    if (!isOk(metadataResult)) {
      return err(
        new ProtocolError(
          `Failed to parse metadata from opened page: ${metadataResult.error.message}`,
          { originalError: metadataResult.error }
        )
      );
    }

    const targetMetadata: PageMetadata = metadataResult.value;
    const targetPageId = targetMetadata.pageId;
    const targetPageContextId = `${actualSessionId}:page:${targetPageId}:${Date.now()}`;
    const targetPageType = this.inferPageType(dataToProcess, targetMetadata.caption);
    const targetLogicalForm = this.extractLogicalFormFromHandlers(dataToProcess);
    const targetFormIds = targetShellFormId ? [targetShellFormId] : connection.getAllOpenFormIds();

    logger.info(`Creating pageContext with formIds: ${JSON.stringify(targetFormIds)} (shellFormId=${targetShellFormId})`);

    const targetPageContextData = {
      sessionId: actualSessionId,
      pageId: targetPageId,
      formIds: targetFormIds,
      openedAt: Date.now(),
      pageType: targetPageType as 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report',
      logicalForm: targetLogicalForm,
      handlers: dataToProcess,
    };

    // Store in memory
    if ((connection as any).pageContexts) {
      (connection as any).pageContexts.set(targetPageContextId, targetPageContextData);
    } else {
      (connection as any).pageContexts = new Map();
      (connection as any).pageContexts.set(targetPageContextId, targetPageContextData);
    }

    // Persist to disk
    try {
      const cache = PageContextCache.getInstance();
      await cache.save(targetPageContextId, targetPageContextData);
      logger.debug(`Persisted target pageContext to cache: ${targetPageContextId}`);
    } catch (error) {
      logger.warn(`Failed to persist target pageContext: ${error}`);
    }

    return ok({
      targetPageContextId,
      targetPageId,
      targetCaption: targetMetadata.caption,
    });
  }

  /**
   * Finds the repeater control path in a LogicalForm.
   * Returns the control path for the main list repeater.
   */
  private findRepeaterControlPath(logicalForm: any): string | null {
    let repeaterPath: string | null = null;

    const walkControl = (control: any, path: string): void => {
      if (!control || typeof control !== 'object') return;

      // Check if this is a repeater control
      const controlType = control.t as string;
      if (controlType === 'rc' || controlType === 'lrc') {
        // Found a repeater - use this path
        if (!repeaterPath) {
          repeaterPath = path;
        }
        return; // Don't walk into repeater children
      }

      // Walk children with updated paths
      if (Array.isArray(control.Children)) {
        for (let i = 0; i < control.Children.length; i++) {
          const childPath = path ? `${path}:c[${i}]` : `c[${i}]`;
          walkControl(control.Children[i], childPath);
        }
      }
    };

    // Start walk from root
    walkControl(logicalForm, 'server');
    return repeaterPath;
  }

  /**
   * Infers page type from handlers.
   * Uses ViewMode/FormStyle if available, falls back to caption heuristics.
   */
  private inferPageType(handlers: Handler[], caption: string): string {
    // Try to find FormStyleProperties handler
    const formStyleHandler = handlers.find(
      (h: any) => h.handlerType === 'DN.FormStyleProperties'
    );

    if (formStyleHandler) {
      const params = (formStyleHandler as any).parameters?.[0];
      const viewMode = params?.ViewMode;

      // BC ViewMode enum values
      const viewModes: Record<number, string> = {
        0: 'Card', // Normal/Card
        1: 'List', // List
        2: 'Document', // Document
        3: 'Worksheet', // Worksheet
      };

      if (viewMode !== undefined && viewMode in viewModes) {
        return viewModes[viewMode];
      }
    }

    // Fallback: caption heuristics
    const lowerCaption = caption.toLowerCase();
    if (lowerCaption.includes('list')) return 'List';
    if (lowerCaption.includes('card')) return 'Card';
    if (lowerCaption.includes('order') || lowerCaption.includes('invoice'))
      return 'Document';
    if (lowerCaption.includes('worksheet')) return 'Worksheet';

    // Default to Card for drill-down targets
    return 'Card';
  }

  /**
   * Extracts the LogicalForm from handlers for caching.
   */
  private extractLogicalFormFromHandlers(handlers: Handler[]): any {
    const logicalFormHandler = handlers.find(
      (h: any) => h.handlerType === 'DN.LogicalFormToShowProperties'
    );

    if (logicalFormHandler) {
      const params = (logicalFormHandler as any).parameters;
      if (params && params.length > 1) {
        return params[1]; // LogicalForm is second parameter
      }
    }

    return null;
  }
}
