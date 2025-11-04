/**
 * Write Page Data MCP Tool
 *
 * Creates or updates records on a BC page by setting field values.
 * Uses the real SaveValue protocol captured from BC traffic.
 *
 * Usage workflow:
 * 1. Call get_page_metadata to open the page
 * 2. Call execute_action with "Edit" (for updates) or "New" (for creates)
 * 3. Call write_page_data with field values
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type {
  WritePageDataInput,
  WritePageDataOutput,
} from '../types/mcp-types.js';
import { InputValidationError, ProtocolError } from '../core/errors.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';

/**
 * MCP Tool: write_page_data
 *
 * Writes data to a BC page (sets field values on current record).
 *
 * Prerequisites:
 * - Page must be open (call get_page_metadata first)
 * - Record must be in edit mode (call execute_action with "Edit" or "New")
 */
export class WritePageDataTool extends BaseMCPTool {
  public readonly name = 'write_page_data';

  public readonly description =
    'Sets field values on a Business Central record with immediate validation. Requires pageContextId from get_page_metadata. ' +
    'Prerequisites: Record must be in edit mode (use execute_action with "Edit" or "New"). ' +
    'Supports simple fields map OR array with controlPath: [{name, value, controlPath?}]. ' +
    'Options: stopOnError (default true), immediateValidation (default true). ' +
    'Returns: {updatedFields, failedFields with validation messages, saved}. Use for batch field updates.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Required page context ID from get_page_metadata',
      },
      recordSelector: {
        type: 'object',
        description: 'Optional record selector: {systemId} | {keys:{...}} | {useCurrent:true}',
        properties: {
          systemId: { type: 'string' },
          keys: { type: 'object' },
          useCurrent: { type: 'boolean' },
        },
      },
      fields: {
        oneOf: [
          {
            type: 'object',
            description: 'Simple map: field name → value (e.g., {"Name": "Test", "Credit Limit (LCY)": 5000})',
            additionalProperties: true,
          },
          {
            type: 'array',
            description: 'Advanced: array with controlPath support [{name, value, controlPath?}]',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: ['string', 'number', 'boolean'] },
                controlPath: { type: 'string' },
              },
              required: ['name', 'value'],
            },
          },
        ],
      },
      stopOnError: {
        type: 'boolean',
        description: 'Stop on first validation error (default: true)',
        default: true,
      },
      immediateValidation: {
        type: 'boolean',
        description: 'Parse BC handlers for validation errors (default: true)',
        default: true,
      },
    },
    required: ['pageContextId', 'fields'],
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
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<WritePageDataInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract required pageContextId
    const pageContextIdResult = this.getRequiredString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    // Extract optional recordSelector
    const recordSelectorResult = this.getOptionalObject(input, 'recordSelector');
    if (!isOk(recordSelectorResult)) {
      return recordSelectorResult as Result<never, BCError>;
    }

    // Extract required fields (object or array)
    const fieldsValue = (input as Record<string, unknown>).fields;
    if (!fieldsValue) {
      return err(
        new InputValidationError(
          'fields parameter is required',
          'fields',
          ['Must provide fields as object or array']
        )
      ) as Result<never, BCError>;
    }

    // Normalize fields to internal format
    let fields: Record<string, { value: unknown; controlPath?: string }>;

    if (Array.isArray(fieldsValue)) {
      // Array format: [{name, value, controlPath?}]
      if (fieldsValue.length === 0) {
        return err(
          new InputValidationError(
            'fields array cannot be empty',
            'fields',
            ['Must provide at least one field to update']
          )
        ) as Result<never, BCError>;
      }

      fields = {};
      for (const field of fieldsValue) {
        if (typeof field !== 'object' || !field || !('name' in field) || !('value' in field)) {
          return err(
            new InputValidationError(
              'Invalid field format in array',
              'fields',
              ['Each field must have {name, value, controlPath?}']
            )
          ) as Result<never, BCError>;
        }

        const { name, value, controlPath } = field as { name: string; value: unknown; controlPath?: string };
        fields[name] = { value, controlPath };
      }
    } else if (typeof fieldsValue === 'object') {
      // Object format: {fieldName: value}
      const fieldObj = fieldsValue as Record<string, unknown>;
      if (Object.keys(fieldObj).length === 0) {
        return err(
          new InputValidationError(
            'fields object cannot be empty',
            'fields',
            ['Must provide at least one field to update']
          )
        ) as Result<never, BCError>;
      }

      fields = {};
      for (const [name, value] of Object.entries(fieldObj)) {
        fields[name] = { value };
      }
    } else {
      return err(
        new InputValidationError(
          'fields must be object or array',
          'fields',
          ['Expected object or array format']
        )
      ) as Result<never, BCError>;
    }

    // Extract optional flags
    const saveValue = (input as Record<string, unknown>).save;
    const save = typeof saveValue === 'boolean' ? saveValue : false;

    const autoEditValue = (input as Record<string, unknown>).autoEdit;
    const autoEdit = typeof autoEditValue === 'boolean' ? autoEditValue : false;

    const stopOnErrorValue = (input as Record<string, unknown>).stopOnError;
    const stopOnError = typeof stopOnErrorValue === 'boolean' ? stopOnErrorValue : true;

    const immediateValidationValue = (input as Record<string, unknown>).immediateValidation;
    const immediateValidation = typeof immediateValidationValue === 'boolean' ? immediateValidationValue : true;

    return ok({
      pageContextId: pageContextIdResult.value,
      recordSelector: recordSelectorResult.value,
      fields,
      save,
      autoEdit,
      stopOnError,
      immediateValidation,
    });
  }

  /**
   * Executes the tool to write page data.
   *
   * Sets field values on the current record using SaveValue interactions.
   */
  protected async executeInternal(input: unknown): Promise<Result<WritePageDataOutput, BCError>> {
    const logger = createToolLogger('write_page_data', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, fields, save, autoEdit, stopOnError, immediateValidation } = validatedInput.value;
    const fieldNames = Object.keys(fields);

    logger.info(`Writing ${fieldNames.length} fields using pageContext: "${pageContextId}"`);
    logger.info(`Fields: ${fieldNames.join(', ')}`);
    logger.info(`Options: save=${save}, autoEdit=${autoEdit}, stopOnError=${stopOnError}, immediateValidation=${immediateValidation}`);

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;
    let pageId: string;

    // Extract sessionId and pageId from pageContextId (format: sessionId:page:pageId:timestamp)
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(
          `Invalid pageContextId format: ${pageContextId}`,
          { pageContextId }
        )
      );
    }

    const sessionId = contextParts[0];
    pageId = contextParts[2];

    // Try to reuse existing session from pageContextId
    const existing = manager.getSession(sessionId);
    if (existing) {
      logger.info(`♻️  Reusing session from pageContext: ${sessionId}`);
      connection = existing;
      actualSessionId = sessionId;

      // Check if the page context is still valid
      const pageContext = (connection as any).pageContexts?.get(pageContextId);
      if (!pageContext) {
        logger.info(`⚠️  Page context not found, page may have been closed`);
        return err(
          new ProtocolError(
            `Page context ${pageContextId} not found. Page may have been closed. Please call get_page_metadata again.`,
            { pageContextId }
          )
        );
      }
    } else {
      return err(
        new ProtocolError(
          `Session ${sessionId} from pageContext not found. Please call get_page_metadata first.`,
          { pageContextId, sessionId }
        )
      );
    }

    // Check if page is open
    if (!connection.isPageOpen(pageId)) {
      return err(
        new ProtocolError(
          `Page ${pageId} is not open in session ${actualSessionId}. Call get_page_metadata first to open the page.`,
          { pageId, fields: fieldNames, sessionId: actualSessionId }
        )
      );
    }

    // Get formId for this page
    const formId = connection.getOpenFormId(pageId);
    if (!formId) {
      return err(
        new ProtocolError(
          `No formId found for page ${pageId} in session ${actualSessionId}. Page may not be properly opened.`,
          { pageId, fields: fieldNames, sessionId: actualSessionId }
        )
      );
    }

    logger.info(`Using formId: ${formId}`);

    // Set each field value using SaveValue interaction
    const updatedFields: string[] = [];
    const failedFields: Array<{ field: string; error: string; validationMessage?: string }> = [];

    for (const [fieldName, fieldSpec] of Object.entries(fields)) {
      const { value: fieldValue, controlPath } = fieldSpec;
      logger.info(`Setting field "${fieldName}" = "${fieldValue}"${controlPath ? ` (controlPath: ${controlPath})` : ''}...`);

      const result = await this.setFieldValue(
        connection,
        formId,
        fieldName,
        fieldValue,
        controlPath,
        immediateValidation
      );

      if (isOk(result)) {
        updatedFields.push(fieldName);
        logger.info(`✓ Field "${fieldName}" updated successfully`);
      } else {
        const errorMsg = result.error.message;
        const validationMsg = (result.error as any).context?.validationMessage;
        failedFields.push({
          field: fieldName,
          error: errorMsg,
          validationMessage: validationMsg,
        });
        logger.info(`✗ Field "${fieldName}" failed: ${errorMsg}`);

        // Stop on first error if stopOnError is true
        if (stopOnError) {
          logger.info(`⚠️  Stopping on first error (stopOnError=true)`);
          break;
        }
      }
    }

    // Return result
    if (failedFields.length === 0) {
      // All fields updated successfully
      return ok({
        success: true,
        pageContextId,
        saved: save || false, // Indicates whether changes were saved
        message: `Successfully updated ${updatedFields.length} field(s): ${updatedFields.join(', ')}`,
        updatedFields,
      });
    } else if (updatedFields.length > 0) {
      // Partial success
      return ok({
        success: false,
        pageContextId,
        saved: false, // Partial updates are not saved
        message: `Partially updated ${updatedFields.length} field(s). Failed: ${failedFields.map(f => f.field).join(', ')}`,
        updatedFields,
        failedFields: failedFields.map(f => `${f.field}: ${f.error}`),
      });
    } else {
      // Complete failure
      return err(
        new ProtocolError(
          `Failed to update any fields. Errors: ${failedFields.map(f => `${f.field}: ${f.error}`).join('; ')}`,
          { pageId, formId, failedFields }
        )
      );
    }
  }

  /**
   * Sets a field value using the SaveValue interaction.
   * Uses the real BC protocol captured from traffic.
   * Optionally inspects handlers for validation errors.
   */
  private async setFieldValue(
    connection: IBCConnection,
    formId: string,
    fieldName: string,
    value: unknown,
    controlPath?: string,
    immediateValidation: boolean = true
  ): Promise<Result<void, BCError>> {
    // Validate value type
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return err(
        new InputValidationError(
          `Field '${fieldName}' value must be a string, number, or boolean`,
          fieldName,
          [`Expected string|number|boolean, got ${typeof value}`]
        )
      );
    }

    // Build SaveValue interaction using real BC protocol
    // This matches the protocol we captured and verified
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
      controlPath: controlPath || undefined, // Use provided controlPath or let BC find it
      formId,
    };

    // Send interaction
    const result = await connection.invoke(interaction);

    if (!result.ok) {
      return err(
        new ProtocolError(
          `Failed to set field "${fieldName}": ${result.error.message}`,
          { fieldName, value, formId, controlPath, originalError: result.error }
        )
      );
    }

    // If immediateValidation is enabled, inspect handlers for errors
    if (immediateValidation) {
      const handlers = result.value;

      // Check for BC error messages
      const errorHandler = handlers.find(
        (h: any) => h.handlerType === 'DN.ErrorMessageProperties' || h.handlerType === 'DN.ErrorDialogProperties'
      );

      if (errorHandler) {
        const errorParams = (errorHandler as any).parameters?.[0];
        const errorMessage = errorParams?.Message || errorParams?.ErrorMessage || 'Unknown error';

        return err(
          new ProtocolError(
            `BC error: ${errorMessage}`,
            { fieldName, value, formId, controlPath, errorHandler, validationMessage: errorMessage }
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
            { fieldName, value, formId, controlPath, validationHandler, validationMessage }
          )
        );
      }
    }

    // Success - field value saved
    return ok(undefined);
  }
}
