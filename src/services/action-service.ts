/**
 * Action Service
 *
 * Handles Business Central action execution, including standard actions
 * (New, Delete, Post) and custom page actions.
 *
 * This service layer abstracts the business logic from the MCP tool adapters.
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createConnectionLogger } from '../core/logger.js';
import { HandlerParser } from '../parsers/handler-parser.js';

export interface ActionResult {
  success: boolean;
  actionName: string;
  pageContextId: string;
  message?: string;
  result?: unknown;
  validationErrors?: Array<{
    field?: string;
    message: string;
  }>;
}

export interface DialogField {
  name: string;
  value: unknown;
  type?: string;
}

export interface DialogAction {
  name: string;
  caption: string;
  enabled: boolean;
}

/** Action name to BC interaction name mapping */
const ACTION_MAP: Record<string, string> = {
  new: 'New_Rec',
  delete: 'DeleteRecord',
  post: 'Post',
  save: 'SaveRecord',
  refresh: 'RefreshForm',
  next: 'NextRecord',
  previous: 'PreviousRecord',
  first: 'FirstRecord',
  last: 'LastRecord',
};

/**
 * Service for executing Business Central actions
 */
export class ActionService {
  private readonly handlerParser: HandlerParser;

  constructor() {
    this.handlerParser = new HandlerParser();
  }

  /**
   * Execute an action on a Business Central page
   */
  async executeAction(
    pageContextId: string,
    actionName: string,
    parameters?: Record<string, unknown>
  ): Promise<Result<ActionResult, BCError>> {
    const logger = createConnectionLogger('ActionService', 'executeAction');
    logger.info({ pageContextId, actionName, parameters }, 'Executing action');

    // Step 1: Validate context and get connection
    const connectionResult = this.validateAndGetConnection(pageContextId);
    if (!isOk(connectionResult)) return connectionResult;
    const connection = connectionResult.value;

    // Step 2: Map action and build parameters
    const interactionName = this.mapActionToInteraction(actionName);
    const namedParameters = this.buildNamedParameters(parameters);

    // Step 3: Execute the action
    const result = await connection.invoke({
      interactionName,
      namedParameters,
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    // Step 4: Handle result
    if (!isOk(result)) {
      return this.buildActionErrorResult(result.error, actionName, pageContextId, logger);
    }

    return this.buildActionSuccessResult(result.value, actionName, pageContextId, logger);
  }

  /** Validate pageContextId and get connection */
  private validateAndGetConnection(pageContextId: string): Result<IBCConnection, BCError> {
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(`Invalid pageContextId format: ${pageContextId}`, { pageContextId })
      );
    }

    const [sessionId] = contextParts;
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(sessionId);

    if (!connection) {
      return err(
        new ProtocolError(
          `Session ${sessionId} not found. Please open a page first.`,
          { pageContextId, sessionId }
        )
      );
    }

    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    if (!pageContext) {
      return err(
        new ProtocolError(
          `Page context ${pageContextId} not found. Page may have been closed.`,
          { pageContextId }
        )
      );
    }

    return ok(connection);
  }

  /** Map action name to BC interaction name */
  private mapActionToInteraction(actionName: string): string {
    return ACTION_MAP[actionName.toLowerCase()] || actionName;
  }

  /** Build named parameters from input */
  private buildNamedParameters(parameters?: Record<string, unknown>): Record<string, unknown> {
    if (!parameters) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parameters)) {
      result[key] = String(value);
    }
    return result;
  }

  /** Build error result for failed action */
  private buildActionErrorResult(
    error: BCError,
    actionName: string,
    pageContextId: string,
    logger: ReturnType<typeof createConnectionLogger>
  ): Result<ActionResult, BCError> {
    logger.warn({ error }, 'Action execution failed');
    const validationErrors = this.extractValidationErrors(error);

    return ok({
      success: false,
      actionName,
      pageContextId,
      message: error.message,
      validationErrors,
    });
  }

  /** Build success result, checking for triggered dialogs */
  private buildActionSuccessResult(
    handlers: readonly unknown[],
    actionName: string,
    pageContextId: string,
    logger: ReturnType<typeof createConnectionLogger>
  ): Result<ActionResult, BCError> {
    const hasDialog = this.checkForDialog(handlers);

    if (hasDialog) {
      logger.info('Action triggered a dialog');
      return ok({
        success: true,
        actionName,
        pageContextId,
        message: 'Action triggered a dialog. Use handle_dialog tool to interact with it.',
        result: { dialogTriggered: true },
      });
    }

    return ok({
      success: true,
      actionName,
      pageContextId,
      message: `Action '${actionName}' executed successfully`,
    });
  }

  /**
   * Handle dialog interactions
   */
  async handleDialog(
    pageContextId: string,
    fields?: DialogField[],
    action?: string
  ): Promise<Result<ActionResult, BCError>> {
    const logger = createConnectionLogger('ActionService', 'handleDialog');
    logger.info({ pageContextId, fields, action }, 'Handling dialog');

    // Extract sessionId from pageContextId
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(`Invalid pageContextId format: ${pageContextId}`, { pageContextId })
      );
    }

    const [sessionId] = contextParts;
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(sessionId);

    if (!connection) {
      return err(
        new ProtocolError(
          `Session ${sessionId} not found. Please open a page first.`,
          { pageContextId, sessionId }
        )
      );
    }

    // Set dialog fields if provided
    if (fields && fields.length > 0) {
      for (const field of fields) {
        const saveResult = await connection.invoke({
          interactionName: 'SaveValue',
          namedParameters: {
            controlId: field.name,
            newValue: String(field.value),
          },
          controlPath: 'dialog:c[0]', // Note: dialogs use different control path
          callbackId: '0',
        });

        if (!isOk(saveResult)) {
          logger.warn({ field: field.name, error: saveResult.error }, 'Failed to set dialog field');
        }
      }
    }

    // Execute dialog action if provided
    if (action) {
      const dialogActionMap: Record<string, string> = {
        ok: 'DialogOK',
        cancel: 'DialogCancel',
        yes: 'DialogYes',
        no: 'DialogNo',
      };

      const interactionName = dialogActionMap[action.toLowerCase()] || action;

      const result = await connection.invoke({
        interactionName,
        namedParameters: {},
        controlPath: 'dialog:c[0]',
        callbackId: '0',
      });

      if (!isOk(result)) {
        return ok({
          success: false,
          actionName: 'handle_dialog',
          pageContextId,
          message: `Failed to execute dialog action '${action}': ${result.error.message}`,
        });
      }

      return ok({
        success: true,
        actionName: 'handle_dialog',
        pageContextId,
        message: `Dialog action '${action}' executed successfully`,
      });
    }

    return ok({
      success: true,
      actionName: 'handle_dialog',
      pageContextId,
      message: 'Dialog fields updated successfully',
    });
  }

  /**
   * Check if handlers contain a dialog
   */
  private checkForDialog(handlers: readonly unknown[]): boolean {
    if (!Array.isArray(handlers)) return false;

    return handlers.some((handler: any) => {
      if (handler?.handlerType === 'DN.FormToShow') {
        const formType = handler.parameters?.[0]?.FormType;
        return formType === 'Dialog' || formType === 'ConfirmDialog';
      }
      return false;
    });
  }

  /**
   * Extract validation errors from error context
   */
  private extractValidationErrors(
    error: BCError
  ): Array<{ field?: string; message: string }> | undefined {
    const context = (error as any).context;
    if (!context) return undefined;

    const errors: Array<{ field?: string; message: string }> = [];

    // Check for validation messages in context
    if (context.validationMessages && Array.isArray(context.validationMessages)) {
      context.validationMessages.forEach((msg: any) => {
        errors.push({
          field: msg.field,
          message: msg.message || msg,
        });
      });
    }

    // Check for error in message format
    if (context.errorMessage) {
      errors.push({
        message: context.errorMessage,
      });
    }

    return errors.length > 0 ? errors : undefined;
  }
}