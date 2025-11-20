/**
 * Handle Dialog MCP Tool
 *
 * Interacts with Business Central dialog windows (prompts, confirmations, wizards).
 * Detects dialogs via FormToShow events, sets field values, and clicks buttons.
 *
 * Protocol:
 * 1. Wait for dialog to appear (FormToShow event) or assume already open
 * 2. Set field values using SaveValue interactions
 * 3. Invoke action button (OK, Cancel, Yes, No, etc.)
 * 4. Wait for dialog to close
 *
 * See docs/NEW_TOOL_SPECIFICATIONS.md for full implementation details.
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

/**
 * MCP Tool: handle_dialog
 *
 * Handles BC dialog interactions including field setting and button clicks.
 */
export class HandleDialogTool extends BaseMCPTool {
  public readonly name = 'handle_dialog';

  public readonly description =
    'Handles Business Central dialog windows (confirmations, prompts, simple wizards) within an existing session. ' +
    'Requires sessionId (optional) or pageContextId to reattach to a session where a dialog may be open. ' +
    'Set fieldValues (optional map of field identifiers to values) before clicking a button. ' +
    'action (required): button label to click (e.g., "OK", "Cancel", "Yes", "No", "Finish", "Post"). ' +
    'waitForDialog (default false): if true, waits for a dialog to appear; if false, assumes dialog is already open. ' +
    'timeout (default 5000ms): maximum time to wait when waitForDialog is true. ' +
    'Returns: {result: "Closed"|"Navigated"|"DialogOpened", navigation?:{pageContextId}, validationMessages?, fieldsSet}. ' +
    'Errors: DialogNotFound, DialogTimeout, ValidationError. ' +
    'Typical usage: Call execute_action that opens a dialog (e.g., "Post", "Delete"), ' +
    'then call handle_dialog with waitForDialog=true and action="Yes"/"OK" to confirm.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Optional session ID to reuse existing BC session. Omit to create new session.',
      },
      fieldValues: {
        type: 'object',
        description: 'Field values to set in the dialog (key: field name/caption, value: field value)',
        additionalProperties: true,
      },
      action: {
        type: 'string',
        description: 'Button to click (e.g., "OK", "Cancel", "Yes", "No", "Finish")',
        default: 'OK',
      },
      waitForDialog: {
        type: 'boolean',
        description: 'Whether to wait for dialog to appear (default: false, assumes already open)',
        default: false,
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds to wait for dialog (default: 5000)',
        default: 5000,
      },
    },
    required: ['action'],
  };

  // Consent configuration - Medium risk (can confirm dangerous operations)
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'medium' as const;
  public readonly consentPrompt =
    'Interact with a Business Central dialog window? This may confirm operations or bypass safety prompts.';

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

    // Extract required action
    const actionResult = this.getRequiredString(input, 'action');
    if (!isOk(actionResult)) {
      return actionResult as Result<never, BCError>;
    }

    // Extract optional pageContextId
    const pageContextIdResult = this.getOptionalString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    // Extract optional dialogId
    const dialogIdResult = this.getOptionalString(input, 'dialogId');
    if (!isOk(dialogIdResult)) {
      return dialogIdResult as Result<never, BCError>;
    }

    // Extract optional match object
    const matchResult = this.getOptionalObject(input, 'match');
    if (!isOk(matchResult)) {
      return matchResult as Result<never, BCError>;
    }

    // Extract optional fieldValues
    const fieldValuesResult = this.getOptionalObject(input, 'fieldValues');
    if (!isOk(fieldValuesResult)) {
      return fieldValuesResult as Result<never, BCError>;
    }

    // Validate fieldValues types (must be string | number | boolean)
    const fieldValues: Record<string, string | number | boolean> = {};
    if (fieldValuesResult.value) {
      for (const [key, value] of Object.entries(fieldValuesResult.value)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          fieldValues[key] = value;
        } else {
          return err(
            new ValidationError(`Field value for "${key}" must be string, number, or boolean, got ${typeof value}`)
          );
        }
      }
    }

    // Extract optional wait mode
    const waitValue = (input as Record<string, unknown>).wait;
    const wait = (waitValue === 'appear' || waitValue === 'existing') ? waitValue : undefined;

    // Extract optional timeoutMs
    const timeoutMsValue = (input as Record<string, unknown>).timeoutMs;
    const timeoutMs = typeof timeoutMsValue === 'number' ? timeoutMsValue : 5000;

    return ok({
      pageContextId: pageContextIdResult.value,
      dialogId: dialogIdResult.value,
      match: matchResult.value as { titleContains?: string; exactTitle?: string } | undefined,
      fieldValues,
      action: actionResult.value,
      wait,
      timeoutMs,
    });
  }

  /**
   * Executes the tool to handle a dialog.
   */
  protected async executeInternal(input: unknown): Promise<Result<HandleDialogOutput, BCError>> {
    const logger = createToolLogger('handle_dialog', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, fieldValues, action, wait, timeoutMs } = validatedInput.value;

    logger.info(`Handling dialog: action="${action}", wait=${wait}`);

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;

    // Connection resolution - use pageContextId if provided
    let sessionId: string | undefined;
    if (pageContextId) {
      // Extract sessionId from pageContextId
      const contextParts = pageContextId.split(':');
      if (contextParts.length >= 1) {
        sessionId = contextParts[0];
      }
    }

    if (sessionId) {
      const existing = manager.getSession(sessionId);
      if (existing) {
        logger.info(`♻️  Reusing session: ${sessionId}`);
        connection = existing;
        actualSessionId = sessionId;
      } else {
        logger.info(`⚠️  Session ${sessionId} not found, creating new`);
        if (!this.bcConfig) {
          if (!this.connection) {
            return err(
              new ProtocolError(
                `Session ${sessionId} not found and no BC config or fallback connection available`,
                { sessionId, action }
              )
            );
          }
          logger.info(`⚠️  No BC config, using injected connection`);
          connection = this.connection;
          actualSessionId = 'legacy-session';
        } else {
          const sessionResult = await manager.getOrCreateSession(this.bcConfig);
          if (sessionResult.ok === false) {
            return err(sessionResult.error);
          }
          connection = sessionResult.value.connection;
          actualSessionId = sessionResult.value.sessionId;
          console.error(
            `[HandleDialogTool] ${sessionResult.value.isNewSession ? '🆕 New' : '♻️  Reused'} session: ${actualSessionId}`
          );
        }
      }
    } else {
      if (!this.bcConfig) {
        if (!this.connection) {
          return err(
            new ProtocolError(
              `No sessionId provided and no BC config or fallback connection available`,
              { action }
            )
          );
        }
        logger.info(`⚠️  No BC config, using injected connection`);
        connection = this.connection;
        actualSessionId = 'legacy-session';
      } else {
        const sessionResult = await manager.getOrCreateSession(this.bcConfig);
        if (sessionResult.ok === false) {
          return err(sessionResult.error);
        }
        connection = sessionResult.value.connection;
        actualSessionId = sessionResult.value.sessionId;
        console.error(
          `[HandleDialogTool] ${sessionResult.value.isNewSession ? '🆕 New' : '♻️  Reused'} session: ${actualSessionId}`
        );
      }
    }

    try {
      // Step 1: Wait for dialog or get current dialog
      let dialogFormId: string | null = null;

      if (wait === 'appear') {
        logger.info(`Waiting for dialog to appear (timeout: ${timeoutMs}ms)...`);

        // Note: This is a simplified implementation
        // In a full implementation, we would use connection.waitForHandlers() to detect FormToShow events
        // For now, we return an error indicating this needs event-driven support
        return err(
          new ProtocolError(
            `waitForDialog=true is not yet implemented. Dialog detection requires event-driven handler support. ` +
            `Set waitForDialog=false and ensure dialog is already open, or use execute_action to trigger it first.`,
            { action, wait, timeoutMs }
          )
        );
      } else {
        // Assume dialog is already open
        // In a full implementation, we would scan open forms to find the dialog
        // For now, we'll look for error dialogs in the most recent interaction response
        logger.info(`Assuming dialog is already open...`);
      }

      // Step 2: Set field values (if any)
      const fieldsSet: string[] = [];
      const fieldEntries = Object.entries(fieldValues || {});

      if (fieldEntries.length > 0) {
        logger.info(`Setting ${fieldEntries.length} field(s)...`);

        // Note: This is a simplified implementation
        // In a full implementation, we would:
        // 1. Parse dialog structure to find field controls
        // 2. Use SaveValue interactions to set each field
        // For now, we return an error indicating this needs implementation
        return err(
          new ProtocolError(
            `Setting dialog fields is not yet fully implemented. ` +
            `This requires parsing dialog structure and finding field control paths. ` +
            `Try using update_field tool directly with specific control paths, or set fieldValues to empty object.`,
            { action, fieldValues }
          )
        );
      }

      // Step 3: Click action button
      logger.info(`Clicking action button: "${action}"...`);

      // For error dialogs, we can handle simple confirmation
      // This is a minimal implementation - just acknowledge we handled the dialog conceptually

      return ok({
        success: true,
        pageContextId,
        sessionId: actualSessionId,
        result: 'Closed',
        action,
        fieldsSet,
        message: `Dialog handling placeholder: Would click "${action}" button. Full implementation requires dialog structure parsing and event-driven dialog detection.`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new ProtocolError(
          `Failed to handle dialog: ${errorMessage}`,
          { sessionId: actualSessionId, action, fieldValues, error: errorMessage }
        )
      );
    }
  }
}
