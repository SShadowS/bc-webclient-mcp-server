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
import { ProtocolError, InputValidationError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { BaseMCPTool } from './base-tool.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';

/**
 * Input parameters for execute_action tool.
 */
export interface ExecuteActionInput {
  readonly pageId: string;
  readonly actionName: string;
  readonly controlPath?: string; // Optional - will be looked up if not provided
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

/**
 * MCP Tool for executing actions on BC pages.
 * Implements the InvokeAction interaction protocol.
 */
export class ExecuteActionTool extends BaseMCPTool {
  public readonly name = 'execute_action';

  public readonly description =
    'Executes an action (button click) on a Business Central page. Requires pageContextId from get_page_metadata. ' +
    'Supports: actionId or captionPath. For subpages use target:{partId}. ' +
    'For row actions provide recordSelector. Parameters: expectDialog, waitForDialogMs. ' +
    'Returns: {result: "Success"|"Navigation"|"DialogOpened", navigation?:{pageContextId}, dialog?:{dialogId,fields}}. ' +
    'Common actions: Edit, New, Delete, Post, Save, Cancel, OK. ' +
    'Errors: ActionUnavailable, RecordNotFound, DialogTimeout.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (e.g., "21" for Customer Card)',
      },
      actionName: {
        type: 'string',
        description: 'The name of the action to execute (e.g., "Edit", "New", "Delete")',
      },
      controlPath: {
        type: 'string',
        description: 'Optional: The control path for the action button. If not provided, will attempt lookup.',
      },
    },
    required: ['pageId', 'actionName'],
  };

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    }
  ) {
    super();
  }

  /**
   * Validates input parameters.
   */
  protected override validateInput(input: unknown): Result<ExecuteActionInput, BCError> {
    // Validate base object
    const baseResult = super.validateInput(input);
    if (!baseResult.ok) {
      return baseResult as Result<ExecuteActionInput, BCError>;
    }

    // Get required fields
    const pageIdResult = this.getRequiredString(input, 'pageId');
    if (!pageIdResult.ok) {
      return pageIdResult as Result<ExecuteActionInput, BCError>;
    }

    const actionNameResult = this.getRequiredString(input, 'actionName');
    if (!actionNameResult.ok) {
      return actionNameResult as Result<ExecuteActionInput, BCError>;
    }

    // Get optional fields
    const controlPathResult = this.getOptionalString(input, 'controlPath');
    if (!controlPathResult.ok) {
      return controlPathResult as Result<ExecuteActionInput, BCError>;
    }

    return ok({
      pageId: String(pageIdResult.value),
      actionName: actionNameResult.value,
      controlPath: controlPathResult.value,
    });
  }

  /**
   * Executes the action on the BC page.
   */
  protected async executeInternal(input: unknown): Promise<Result<ExecuteActionOutput, BCError>> {
    const logger = createToolLogger('execute_action', (input as any)?.pageContextId);
    const validationResult = this.validateInput(input);
    if (!validationResult.ok) {
      return validationResult as Result<ExecuteActionOutput, BCError>;
    }

    const { pageId, actionName, controlPath } = validationResult.value;

    logger.info(`Executing action "${actionName}" on page ${pageId}...`);

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;

    // Get or create session using BC config
    if (!this.bcConfig) {
      if (!this.connection) {
        return err(
          new ProtocolError(
            `No BC config or fallback connection available`,
            { pageId, actionName }
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
        `[ExecuteActionTool] ${sessionResult.value.isNewSession ? '🆕 New' : '♻️  Reused'} session: ${actualSessionId}`
      );
    }

    // Check if page is open
    if (!connection.isPageOpen(pageId)) {
      return err(
        new ProtocolError(
          `Page ${pageId} is not open in session ${actualSessionId}. Call get_page_metadata first to open the page.`,
          { pageId, actionName, sessionId: actualSessionId }
        )
      );
    }

    // Get formId for this page
    const formId = connection.getOpenFormId(pageId);
    if (!formId) {
      return err(
        new ProtocolError(
          `No formId found for page ${pageId}. Page may not be properly opened.`,
          { pageId, actionName }
        )
      );
    }

    logger.info(`Using formId: ${formId}`);

    // Build InvokeAction interaction (real BC protocol)
    // BC requires namedParameters as JSON STRING, not object
    // NOTE: Real BC uses numeric systemAction codes, but BC is lenient
    // and accepts actionName string as well. For full canonical format,
    // we'd need to map action names to systemAction codes.
    const interaction = {
      interactionName: 'InvokeAction',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify({
        actionName,
      }),
      callbackId: '', // Will be set by connection
      controlPath: controlPath || undefined, // Use provided or undefined
      formId,
    };

    logger.info(`Sending InvokeAction interaction...`);

    // Send interaction
    const result = await connection.invoke(interaction);

    if (!result.ok) {
      return err(
        new ProtocolError(
          `Failed to execute action "${actionName}": ${result.error.message}`,
          { pageId, actionName, formId, sessionId: actualSessionId, originalError: result.error }
        )
      );
    }

    const handlers = result.value;
    logger.info(`✓ Action executed successfully, received ${handlers.length} handlers`);

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
          { pageId, actionName, formId, sessionId: actualSessionId, errorHandler }
        )
      );
    }

    return ok({
      success: true,
      actionName,
      pageId,
      formId,
      message: `Successfully executed action "${actionName}" on page ${pageId}`,
      handlers,
    });
  }
}
