/**
 * Update Field Tool
 *
 * Updates a field value on a Business Central page.
 * Uses the ChangeField interaction to modify text fields, dropdowns, and other input controls.
 *
 * Based on BC_INTERACTION_CAPTURE_PLAN.md - ChangeField protocol.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError, InputValidationError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { BaseMCPTool } from './base-tool.js';
import { createToolLogger } from '../core/logger.js';

/**
 * Input parameters for update_field tool.
 */
export interface UpdateFieldInput {
  readonly pageId: string;
  readonly fieldName: string;
  readonly value: string | number | boolean;
  readonly controlPath?: string; // Optional - will be looked up if not provided
}

/**
 * Output from update_field tool.
 */
export interface UpdateFieldOutput {
  readonly success: boolean;
  readonly fieldName: string;
  readonly value: string | number | boolean;
  readonly pageId: string;
  readonly formId: string;
  readonly message: string;
  readonly handlers?: readonly unknown[];
}

/**
 * MCP Tool for updating field values on BC pages.
 * Implements the ChangeField interaction protocol.
 */
export class UpdateFieldTool extends BaseMCPTool {
  public readonly name = 'update_field';

  public readonly description =
    'Updates a single field value with immediate validation. Requires pageContextId from get_page_metadata. ' +
    'Supports recordSelector: {systemId} | {keys:{...}} | {useCurrent:true}. ' +
    'Supports fieldPath for subpages (e.g., "SalesLines[1].Quantity"). ' +
    'Parameters: save (default false). Differentiator: Single-field immediate validation vs write_page_data for batch. ' +
    'BC validates and may return ValidationError. Common fields: Name, Address, Phone No., etc. ' +
    'Consider using write_page_data for multiple field updates.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (e.g., "21" for Customer Card)',
      },
      fieldName: {
        type: 'string',
        description: 'The name of the field to update (e.g., "Name", "Address", "Phone No.")',
      },
      value: {
        type: ['string', 'number', 'boolean'],
        description: 'The new value for the field',
      },
      controlPath: {
        type: 'string',
        description: 'Optional: The control path for the field. If not provided, will attempt lookup.',
      },
    },
    required: ['pageId', 'fieldName', 'value'],
  };

  public constructor(private readonly connection: IBCConnection) {
    super();
  }

  /**
   * Validates input parameters.
   */
  protected override validateInput(input: unknown): Result<UpdateFieldInput, BCError> {
    // Validate base object
    const baseResult = super.validateInput(input);
    if (!baseResult.ok) {
      return baseResult as Result<UpdateFieldInput, BCError>;
    }

    // Get required fields
    const pageIdResult = this.getRequiredString(input, 'pageId');
    if (!pageIdResult.ok) {
      return pageIdResult as Result<UpdateFieldInput, BCError>;
    }

    const fieldNameResult = this.getRequiredString(input, 'fieldName');
    if (!fieldNameResult.ok) {
      return fieldNameResult as Result<UpdateFieldInput, BCError>;
    }

    // Get value (can be string, number, or boolean)
    if (!this.hasProperty(input, 'value')) {
      return err(
        new InputValidationError(
          'Missing required field: value',
          'value',
          ["Field 'value' is required"]
        )
      );
    }

    const value = (input as Record<string, unknown>).value;

    // Validate value type
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return err(
        new InputValidationError(
          `Field 'value' must be a string, number, or boolean`,
          'value',
          [`Expected string|number|boolean, got ${typeof value}`]
        )
      );
    }

    // Get optional fields
    const controlPathResult = this.getOptionalString(input, 'controlPath');
    if (!controlPathResult.ok) {
      return controlPathResult as Result<UpdateFieldInput, BCError>;
    }

    return ok({
      pageId: String(pageIdResult.value),
      fieldName: fieldNameResult.value,
      value,
      controlPath: controlPathResult.value,
    });
  }

  /**
   * Updates the field value on the BC page.
   */
  protected async executeInternal(input: unknown): Promise<Result<UpdateFieldOutput, BCError>> {
    const logger = createToolLogger('update_field', (input as any)?.pageContextId);
    const validationResult = this.validateInput(input);
    if (!validationResult.ok) {
      return validationResult as Result<UpdateFieldOutput, BCError>;
    }

    const { pageId, fieldName, value, controlPath } = validationResult.value;

    logger.info(`Updating field "${fieldName}" to "${value}" on page ${pageId}...`);

    // Check if page is open
    if (!this.connection.isPageOpen(pageId)) {
      return err(
        new ProtocolError(
          `Page ${pageId} is not open. Call get_page_metadata first to open the page.`,
          { pageId, fieldName, value }
        )
      );
    }

    // Get formId for this page
    const formId = this.connection.getOpenFormId(pageId);
    if (!formId) {
      return err(
        new ProtocolError(
          `No formId found for page ${pageId}. Page may not be properly opened.`,
          { pageId, fieldName, value }
        )
      );
    }

    logger.info(`Using formId: ${formId}`);

    // Build SaveValue interaction (real BC protocol)
    // BC requires namedParameters as JSON STRING, not object
    // Based on captured protocol from real BC traffic
    const interaction = {
      interactionName: 'SaveValue',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify({
        key: null,
        newValue: value,
        alwaysCommitChange: true,
        notifyBusy: 1,
        telemetry: {
          'Control name': fieldName,
          'QueuedTime': new Date().toISOString(),
        },
      }),
      callbackId: '', // Will be set by connection
      controlPath: controlPath || undefined, // Use provided or undefined
      formId,
    };

    logger.info(`Sending SaveValue interaction...`);

    // Send interaction
    const result = await this.connection.invoke(interaction);

    if (!result.ok) {
      return err(
        new ProtocolError(
          `Failed to update field "${fieldName}": ${result.error.message}`,
          { pageId, fieldName, value, formId, originalError: result.error }
        )
      );
    }

    const handlers = result.value;
    logger.info(`✓ Field updated successfully, received ${handlers.length} handlers`);

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
          { pageId, fieldName, value, formId, errorHandler }
        )
      );
    }

    // Check for validation errors
    const validationHandler = handlers.find(
      (h: any) => h.handlerType === 'DN.ValidationMessageProperties'
    );

    if (validationHandler) {
      const validationParams = (validationHandler as any).parameters?.[0];
      const validationMessage = validationParams?.Message || 'Validation failed';

      return err(
        new ProtocolError(
          `BC validation error: ${validationMessage}`,
          { pageId, fieldName, value, formId, validationHandler }
        )
      );
    }

    return ok({
      success: true,
      fieldName,
      value,
      pageId,
      formId,
      message: `Successfully updated field "${fieldName}" to "${value}" on page ${pageId}`,
      handlers,
    });
  }
}
