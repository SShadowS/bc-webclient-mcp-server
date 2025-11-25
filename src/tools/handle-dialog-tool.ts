/**
 * Handle Dialog MCP Tool
 *
 * Interacts with Business Central dialog windows (prompts, confirmations, template selection).
 * Detects dialogs via DialogToShow events, optionally selects rows, and clicks buttons.
 *
 * Protocol (based on captured customer template selection workflow):
 * 1. Wait for DialogToShow event or assume dialog already open
 * 2. Optionally select row using SetCurrentRowAndRowsSelection
 * 3. Click button (OK/Cancel) using InvokeAction with systemAction
 * 4. Return result
 *
 * See DIALOG_HANDLING_DESIGN.md for implementation details.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError, ValidationError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type {
  HandleDialogInput,
  HandleDialogOutput,
} from '../types/mcp-types.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';
import type { AuditLogger } from '../services/audit-logger.js';
import { SessionStateManager } from '../services/session-state-manager.js';
import { HandlerParser } from '../parsers/handler-parser.js';
import { defaultTimeouts } from '../core/timeouts.js';
import { createWorkflowIntegration } from '../services/workflow-integration.js';

/** Session context for dialog handling */
interface DialogSessionContext {
  sessionId: string;
  connection: IBCConnection;
}

/** Dialog detection result */
interface DetectedDialog {
  dialogFormId: string;
  dialogHandlers: readonly unknown[];
  caption?: string;
}

/**
 * MCP Tool: handle_dialog
 *
 * Handles BC dialog interactions including row selection and button clicks.
 */
export class HandleDialogTool extends BaseMCPTool {
  public readonly name = 'handle_dialog';

  public readonly description =
    'Handles Business Central dialog windows (template selection, confirmations, prompts) within an existing session. ' +
    'Requires pageContextId to identify the session where dialog appears. ' +
    'action (required): button to click - "OK" (systemAction: 0) or "Cancel" (systemAction: 1). ' +
    'selection (optional): {bookmark: "..."} or {rowNumber: 1} or {rowFilter: {"Code": "EU-VIRKS"}} to select a row before clicking OK. ' +
    'wait (optional): "appear" to wait for dialog, "existing" to use already-open dialog (default: "appear"). ' +
    'timeoutMs (default: 5000): maximum time to wait for dialog when wait="appear". ' +
    'Returns: {success, pageContextId, sessionId, dialogId, action, selectedBookmark?, message}. ' +
    'Errors: DialogNotFound, DialogTimeout, ValidationError. ' +
    'Typical usage: After execute_action triggers dialog (e.g., "New" action), ' +
    'call handle_dialog with wait="appear", selection={rowFilter:{"Code":"EU-VIRKS"}}, action="OK" to select template and confirm.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Required: Page context ID to identify the session',
      },
      action: {
        type: 'string',
        description: 'Button to click: "OK" or "Cancel"',
        enum: ['OK', 'Cancel'],
        default: 'OK',
      },
      selection: {
        type: 'object',
        description: 'Optional: Row to select before clicking button. Provide bookmark, rowNumber, or rowFilter.',
        properties: {
          bookmark: {
            type: 'string',
            description: 'Direct bookmark of row to select',
          },
          rowNumber: {
            type: 'number',
            description: '1-based row number to select',
          },
          rowFilter: {
            type: 'object',
            description: 'Filter to find row (e.g., {"Code": "EU-VIRKS"})',
            additionalProperties: true,
          },
        },
      },
      wait: {
        type: 'string',
        description: 'Wait mode: "appear" (wait for dialog) or "existing" (use open dialog)',
        enum: ['appear', 'existing'],
        default: 'appear',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds for wait="appear" (default: 5000)',
        default: 5000,
      },
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID to track this operation. Records dialog interactions for workflow audit trail.',
      },
    },
    required: ['pageContextId', 'action'],
  };

  // Consent configuration - Medium risk (can confirm dangerous operations)
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'medium' as const;
  public readonly consentPrompt =
    'Interact with a Business Central dialog window? This may select options or confirm operations.';

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
    super({ auditLogger });
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<HandleDialogInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract required pageContextId
    const pageContextIdResult = this.getRequiredString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    // Extract required action
    const actionResult = this.getRequiredString(input, 'action');
    if (!isOk(actionResult)) {
      return actionResult as Result<never, BCError>;
    }

    // Validate action is OK or Cancel
    const action = actionResult.value;
    if (action !== 'OK' && action !== 'Cancel') {
      return err(
        new ValidationError(`action must be "OK" or "Cancel", got "${action}"`)
      );
    }

    // Extract optional selection with runtime type validation
    const selectionResult = this.getOptionalObject(input, 'selection');
    if (!isOk(selectionResult)) {
      return selectionResult as Result<never, BCError>;
    }

    // Validate selection field types if provided
    const selectionValue = selectionResult.value as Record<string, unknown> | undefined;
    if (selectionValue) {
      const { bookmark, rowNumber, rowFilter } = selectionValue;
      if (bookmark !== undefined && typeof bookmark !== 'string') {
        return err(new ValidationError(`selection.bookmark must be a string, got ${typeof bookmark}`));
      }
      if (rowNumber !== undefined && typeof rowNumber !== 'number') {
        return err(new ValidationError(`selection.rowNumber must be a number, got ${typeof rowNumber}`));
      }
      if (rowFilter !== undefined && (typeof rowFilter !== 'object' || rowFilter === null || Array.isArray(rowFilter))) {
        return err(new ValidationError(`selection.rowFilter must be an object`));
      }
    }

    // Extract optional wait mode
    const waitValue = (input as Record<string, unknown>).wait;
    const wait = (waitValue === 'appear' || waitValue === 'existing') ? waitValue : 'appear';

    // Extract optional timeoutMs
    const timeoutMsValue = (input as Record<string, unknown>).timeoutMs;
    const timeoutMs = typeof timeoutMsValue === 'number' ? timeoutMsValue : 5000;

    // Extract optional workflowId
    const workflowIdValue = (input as Record<string, unknown>).workflowId;
    const workflowId = typeof workflowIdValue === 'string' ? workflowIdValue : undefined;

    return ok({
      pageContextId: pageContextIdResult.value,
      action,
      selection: selectionResult.value as { bookmark?: string; rowNumber?: number; rowFilter?: Record<string, any> } | undefined,
      wait,
      timeoutMs,
      workflowId,
    });
  }

  /**
   * Executes the tool to handle a dialog.
   */
  protected async executeInternal(input: unknown): Promise<Result<HandleDialogOutput, BCError>> {
    const logger = createToolLogger('handle_dialog', (input as any)?.pageContextId);

    // Step 1: Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, action, selection, wait, timeoutMs, workflowId } = validatedInput.value;
    const workflow = createWorkflowIntegration(workflowId);

    logger.info(`Handling dialog: action="${action}", wait=${wait}, hasSelection=${!!selection}`);

    // Step 2: Get session context
    const sessionResult = this.getSessionContext(pageContextId);
    if (!isOk(sessionResult)) return sessionResult;
    const { sessionId, connection } = sessionResult.value;

    const waitMode = wait ?? 'appear';
    const timeout = timeoutMs ?? 5000;

    try {
      // Step 3: Get or wait for dialog
      const dialogResult = await this.getOrWaitForDialog(connection, sessionId, waitMode, timeout, logger);
      if (!isOk(dialogResult)) return dialogResult;
      const { dialogFormId, dialogHandlers } = dialogResult.value;

      // Step 4: Select row if selection provided
      const selectionResult = await this.handleRowSelection(connection, dialogFormId, selection, logger);
      if (!isOk(selectionResult)) return selectionResult;
      const selectedBookmark = selectionResult.value;

      // Step 5: Click button (OK or Cancel)
      const clickResult = await this.clickDialogButton(connection, dialogFormId, action, selectedBookmark, logger);
      if (!isOk(clickResult)) return clickResult;

      // Step 6: Cleanup and record
      this.closeDialogState(sessionId, dialogFormId, logger);
      this.recordWorkflowOperation(workflow, pageContextId, action, selection, waitMode, timeout, dialogFormId, selectedBookmark);

      return ok({
        success: true,
        pageContextId,
        sessionId,
        dialogId: dialogFormId,
        action,
        selectedBookmark,
        result: 'Closed',
        message: `Dialog ${action} clicked successfully${selectedBookmark ? ` (selected: ${selectedBookmark})` : ''}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new ProtocolError(
        `Failed to handle dialog: ${errorMessage}`,
        { sessionId, action, selection, error: errorMessage }
      ));
    }
  }

  // ============================================================================
  // Helper Methods - Extracted from executeInternal for reduced complexity
  // ============================================================================

  /** Get session context from pageContextId */
  private getSessionContext(pageContextId: string): Result<DialogSessionContext, BCError> {
    const sessionId = pageContextId.split(':', 1)[0];
    if (!sessionId) {
      return err(new ValidationError(
        `Invalid pageContextId format: ${pageContextId}`,
        undefined,
        undefined,
        { reason: 'InvalidPageContextId', pageContextId }
      ));
    }

    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(sessionId);
    if (!connection) {
      return err(new ProtocolError(`Session ${sessionId} not found`, {
        reason: 'SessionNotFound',
        sessionId,
        pageContextId,
      }));
    }

    return ok({ sessionId, connection });
  }

  /** Get or wait for dialog depending on wait mode */
  private async getOrWaitForDialog(
    connection: IBCConnection,
    sessionId: string,
    wait: 'appear' | 'existing',
    timeoutMs: number,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<DetectedDialog, BCError>> {
    if (wait === 'appear') {
      return await this.waitForDialogToAppear(connection, sessionId, timeoutMs, logger);
    } else {
      return this.getExistingDialog(sessionId, logger);
    }
  }

  /** Wait for a new dialog to appear */
  private async waitForDialogToAppear(
    connection: IBCConnection,
    sessionId: string,
    timeoutMs: number,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<DetectedDialog, BCError>> {
    // FIRST: Check if a dialog was already opened (race condition fix)
    const sessionStateManager = SessionStateManager.getInstance();
    const existingDialog = sessionStateManager.getActiveDialog(sessionId);

    if (existingDialog) {
      logger.info(`Found existing dialog: formId=${existingDialog.dialogId}, caption="${existingDialog.caption}"`);
      return ok({
        dialogFormId: existingDialog.dialogId,
        dialogHandlers: [],
        caption: existingDialog.caption,
      });
    }

    // No existing dialog - wait for one to appear
    logger.info(`Waiting for dialog to appear (timeout: ${timeoutMs}ms)...`);

    const dialogHandlers = await connection.waitForHandlers(
      this.createDialogPredicate(),
      { timeoutMs }
    );

    // Extract dialog form ID
    const parser = new HandlerParser();
    const dialogFormResult = parser.extractDialogForm(dialogHandlers as any[]);
    if (!isOk(dialogFormResult)) {
      return err(new ProtocolError(
        `Failed to extract dialog form: ${dialogFormResult.error.message}`,
        { sessionId, handlers: dialogHandlers }
      ));
    }

    const dialogForm = dialogFormResult.value as any;
    const dialogFormId = dialogForm.ServerId;
    logger.info(`Dialog detected: formId=${dialogFormId}, caption="${dialogForm.Caption}"`);

    // Track dialog in SessionStateManager
    sessionStateManager.addDialog(sessionId, {
      dialogId: dialogFormId,
      caption: dialogForm.Caption || 'Dialog',
      isTaskDialog: !!dialogForm.IsTaskDialog,
      isModal: !!dialogForm.IsModal,
    });

    return ok({ dialogFormId, dialogHandlers, caption: dialogForm.Caption });
  }

  /** Create predicate for DialogToShow detection */
  private createDialogPredicate(): (handlers: unknown[]) => { matched: boolean; data?: unknown[] } {
    return (handlers: unknown[]) => {
      for (const handler of handlers) {
        if (
          typeof handler === 'object' &&
          handler !== null &&
          'handlerType' in handler &&
          handler.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          'parameters' in handler &&
          Array.isArray(handler.parameters) &&
          handler.parameters[0] === 'DialogToShow'
        ) {
          return { matched: true, data: handlers };
        }
      }
      return { matched: false };
    };
  }

  /** Get existing dialog from SessionStateManager */
  private getExistingDialog(
    sessionId: string,
    logger: ReturnType<typeof createToolLogger>
  ): Result<DetectedDialog, BCError> {
    const sessionStateManager = SessionStateManager.getInstance();
    const activeDialog = sessionStateManager.getActiveDialog(sessionId);
    if (!activeDialog) {
      return err(new ProtocolError(
        `No active dialog found in session. Use wait="appear" to detect dialog.`,
        { reason: 'DialogNotFound', sessionId, wait: 'existing' }
      ));
    }

    logger.info(`Using existing dialog: formId=${activeDialog.dialogId}, caption="${activeDialog.caption}"`);
    return ok({
      dialogFormId: activeDialog.dialogId,
      dialogHandlers: [],
      caption: activeDialog.caption,
    });
  }

  /** Handle row selection if provided */
  private async handleRowSelection(
    connection: IBCConnection,
    dialogFormId: string,
    selection: { bookmark?: string; rowNumber?: number; rowFilter?: Record<string, any> } | undefined,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<string | undefined, BCError>> {
    if (!selection) {
      return ok(undefined);
    }

    logger.info(`Selecting row in dialog...`);

    // Determine bookmark
    const bookmarkResult = this.resolveSelectionBookmark(selection);
    if (!isOk(bookmarkResult)) return bookmarkResult;
    const bookmark = bookmarkResult.value;

    logger.info(`Using bookmark: ${bookmark}`);

    // Execute SetCurrentRowAndRowsSelection
    const setCurrentResult = await connection.invoke({
      interactionName: 'SetCurrentRowAndRowsSelection',
      namedParameters: {
        formId: dialogFormId,
        controlPath: 'server:c[2]', // Standard repeater path in dialogs
        key: bookmark,
        selectAll: false,
        rowsToSelect: [bookmark],
        unselectAll: true,
        rowsToUnselect: [],
      },
      formId: dialogFormId,
    } as any);

    if (!isOk(setCurrentResult)) {
      return err(new ProtocolError(
        `Failed to select row: ${setCurrentResult.error.message}`,
        { dialogFormId, bookmark }
      ));
    }

    logger.info(`Row selected: bookmark=${bookmark}`);
    return ok(bookmark);
  }

  /** Resolve selection to a bookmark */
  private resolveSelectionBookmark(
    selection: { bookmark?: string; rowNumber?: number; rowFilter?: Record<string, any> }
  ): Result<string, BCError> {
    if (selection.bookmark) {
      return ok(selection.bookmark);
    } else if (selection.rowNumber !== undefined) {
      return err(new ProtocolError(
        `rowNumber selection not yet implemented. Use bookmark instead.`,
        { reason: 'SelectionNotImplemented', selection, field: 'rowNumber' }
      ));
    } else if (selection.rowFilter) {
      return err(new ProtocolError(
        `rowFilter selection not yet implemented. Use bookmark instead.`,
        { reason: 'SelectionNotImplemented', selection, field: 'rowFilter' }
      ));
    } else {
      return err(new ValidationError(`selection must provide bookmark, rowNumber, or rowFilter`));
    }
  }

  /** Click OK or Cancel button on dialog */
  private async clickDialogButton(
    connection: IBCConnection,
    dialogFormId: string,
    action: string,
    selectedBookmark: string | undefined,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<void, BCError>> {
    logger.info(`Clicking "${action}" button...`);

    const systemAction = action === 'OK' ? 0 : 1;

    const invokeActionResult = await connection.invoke({
      interactionName: 'InvokeAction',
      namedParameters: {
        formId: dialogFormId,
        controlPath: 'server:c[2]/cr', // Standard action control path in dialogs
        systemAction,
        key: selectedBookmark || '',
        data: { AlwaysCommit: false },
        repeaterControlTarget: null,
      },
      formId: dialogFormId,
    } as any);

    if (!isOk(invokeActionResult)) {
      return err(new ProtocolError(
        `Failed to click ${action}: ${invokeActionResult.error.message}`,
        { dialogFormId, action, systemAction }
      ));
    }

    logger.info(`${action} clicked successfully`);
    return ok(undefined);
  }

  /** Close dialog state in SessionStateManager (non-fatal) */
  private closeDialogState(
    sessionId: string,
    dialogFormId: string,
    logger: ReturnType<typeof createToolLogger>
  ): void {
    try {
      const sessionStateManager = SessionStateManager.getInstance();
      sessionStateManager.closeDialog(sessionId, dialogFormId);
    } catch (error) {
      logger.warn({
        sessionId,
        dialogFormId,
        error: String(error),
      }, 'Failed to close dialog in SessionStateManager (non-fatal)');
    }
  }

  /** Record operation in workflow */
  private recordWorkflowOperation(
    workflow: ReturnType<typeof createWorkflowIntegration> | undefined,
    pageContextId: string,
    action: string,
    selection: unknown,
    wait: string,
    timeoutMs: number,
    dialogFormId: string,
    selectedBookmark: string | undefined
  ): void {
    if (!workflow) return;
    workflow.recordOperation(
      'handle_dialog',
      { pageContextId, action, selection, wait, timeoutMs },
      { success: true, data: { dialogId: dialogFormId, action, selectedBookmark } }
    );
  }
}
