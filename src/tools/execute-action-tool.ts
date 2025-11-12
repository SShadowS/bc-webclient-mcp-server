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
import type { AuditLogger } from '../services/audit-logger.js';

/**
 * Input parameters for execute_action tool.
 */
export interface ExecuteActionInput {
  readonly pageContextId?: string; // Preferred: from get_page_metadata
  readonly pageId?: string; // Fallback: stateless execution
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
      pageContextId: {
        type: 'string',
        description: 'Recommended: Page context ID from get_page_metadata. Ensures action targets the correct page instance when multiple pages are open.',
      },
      pageId: {
        type: ['string', 'number'],
        description: 'Fallback: BC page ID (e.g., "21" for Customer Card). Ambiguous if multiple instances of the same page are open. Use pageContextId instead.',
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
    required: ['actionName'],
    oneOf: [
      { required: ['pageContextId', 'actionName'] },
      { required: ['pageId', 'actionName'] },
    ],
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
    super({ auditLogger });
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

    // Get actionName (required)
    const actionNameResult = this.getRequiredString(input, 'actionName');
    if (!actionNameResult.ok) {
      return actionNameResult as Result<ExecuteActionInput, BCError>;
    }

    // Get either pageContextId or pageId (at least one required)
    const pageContextIdResult = this.getOptionalString(input, 'pageContextId');
    const pageIdResult = this.getOptionalString(input, 'pageId');

    if (!isOk(pageContextIdResult) || !isOk(pageIdResult)) {
      return err(
        new InputValidationError('Failed to parse input parameters')
      );
    }

    const pageContextId = pageContextIdResult.value;
    const pageId = pageIdResult.value;

    // At least one must be provided
    if (!pageContextId && !pageId) {
      return err(
        new InputValidationError(
          'Either pageContextId or pageId must be provided'
        )
      );
    }

    // Get optional fields
    const controlPathResult = this.getOptionalString(input, 'controlPath');
    if (!controlPathResult.ok) {
      return controlPathResult as Result<ExecuteActionInput, BCError>;
    }

    return ok({
      pageContextId,
      pageId: pageId ? String(pageId) : undefined,
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

    const { pageContextId, pageId, actionName, controlPath } = validationResult.value;

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;
    let actualPageId: string;
    let formId: string;

    // Preferred path: Use pageContextId for precise targeting
    if (pageContextId) {
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

      actualSessionId = contextParts[0];
      actualPageId = contextParts[2];

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

      connection = existing;
      logger.info(`♻️  Reusing session from pageContext: ${actualSessionId}`);

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

      formId = formIds[0]; // Use first formId (main form)
      logger.info(`Using formId from pageContext: ${formId}`);
    }
    // Fallback path: Use pageId only (less precise)
    else if (pageId) {
      logger.info(`Executing action "${actionName}" on page ${pageId}...`);
      logger.warn(`⚠️  Using pageId without pageContextId may be ambiguous if multiple page instances are open. Recommend using pageContextId from get_page_metadata.`);

      actualPageId = pageId;

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
      const foundFormId = connection.getOpenFormId(pageId);
      if (!foundFormId) {
        return err(
          new ProtocolError(
            `No formId found for page ${pageId}. Page may not be properly opened.`,
            { pageId, actionName }
          )
        );
      }

      formId = foundFormId;
      logger.info(`Using formId: ${formId}`);
    } else {
      // Should never reach here due to validation, but TypeScript needs this
      return err(
        new ProtocolError(
          `Either pageContextId or pageId must be provided`,
          { actionName }
        )
      );
    }

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
          { pageId: actualPageId, actionName, formId, sessionId: actualSessionId, originalError: result.error }
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
          { pageId: actualPageId, actionName, formId, sessionId: actualSessionId, errorHandler }
        )
      );
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
