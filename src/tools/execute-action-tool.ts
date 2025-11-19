/**
 * Execute Action Tool
 *
 * Executes an action (button click) on a Business Central page.
 * Uses the InvokeAction interaction to trigger actions like Edit, New, Delete, etc.
 *
 * Based on BC_INTERACTION_CAPTURE_PLAN.md - InvokeAction protocol.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { BaseMCPTool } from './base-tool.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';
import type { AuditLogger } from '../services/audit-logger.js';
import { ExecuteActionInputSchema, type ExecuteActionInput } from '../validation/schemas.js';

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
    'Optionally provide controlPath if known. ' +
    'Returns: {success, actionName, pageId, formId, message, handlers}. ' +
    'Common actions: Edit, New, Delete, Post, Save, Cancel, OK. ' +
    'Note: High-risk operation - some actions like Post or Delete may be irreversible.';

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
    const { pageContextId, actionName, controlPath } = input as ExecuteActionInput;
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

    const formId = formIds[0]; // Use first formId (main form)
    logger.info(`Using formId from pageContext: ${formId}`);


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
