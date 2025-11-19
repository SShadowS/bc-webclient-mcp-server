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
import type { AuditLogger } from '../services/audit-logger.js';
import { ControlParser } from '../parsers/control-parser.js';
import type { LogicalForm, FieldMetadata } from '../types/bc-types.js';
import { PageContextCache } from '../services/page-context-cache.js';

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
                value: { type: ['string', 'number', 'boolean', 'null'], description: 'Field value (null to clear)' },
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

  // Consent configuration - Write operation requiring user approval
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'medium' as const;
  public readonly consentPrompt =
    'Write field values to a Business Central record? This will modify data in your Business Central database.';

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
   * Validates and extracts input with field normalization.
   * NOTE: write-page-data-tool uses legacy validation due to complex field format normalization.
   * Zod migration deferred pending refactoring.
   */
  protected override validateInput(input: unknown): Result<WritePageDataInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    const pageContextIdResult = this.getRequiredString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    const fieldsValue = (input as Record<string, unknown>).fields;
    if (!fieldsValue) {
      return err(
        new InputValidationError('fields parameter is required', 'fields', ['Must provide fields'])
      ) as Result<never, BCError>;
    }

    // Normalize fields to internal format: Record<string, {value, controlPath?}>
    let fields: Record<string, { value: unknown; controlPath?: string }>;
    if (typeof fieldsValue === 'object' && !Array.isArray(fieldsValue)) {
      fields = {};
      for (const [name, value] of Object.entries(fieldsValue as Record<string, unknown>)) {
        fields[name] = { value };
      }
    } else {
      return err(
        new InputValidationError('fields must be an object', 'fields', ['Expected object format'])
      ) as Result<never, BCError>;
    }

    const stopOnErrorValue = (input as Record<string, unknown>).stopOnError;
    const stopOnError = typeof stopOnErrorValue === 'boolean' ? stopOnErrorValue : true;

    const immediateValidationValue = (input as Record<string, unknown>).immediateValidation;
    const immediateValidation = typeof immediateValidationValue === 'boolean' ? immediateValidationValue : true;

    return ok({
      pageContextId: pageContextIdResult.value,
      fields,
      stopOnError,
      immediateValidation,
    });
  }

  /**
   * Builds a map of field names to metadata from cached LogicalForm.
   * Uses ControlParser to extract all fields from the control tree.
   *
   * @param logicalForm - Cached LogicalForm from pageContext
   * @returns Map of field name → FieldMetadata (case-insensitive keys)
   */
  private buildFieldMap(logicalForm: LogicalForm): Map<string, FieldMetadata> {
    const parser = new ControlParser();
    const controls = parser.walkControls(logicalForm);
    const fields = parser.extractFields(controls);

    const fieldMap = new Map<string, FieldMetadata>();

    for (const field of fields) {
      // Add field by all possible names (case-insensitive)
      const names = [
        field.name,
        field.caption,
        field.controlId,
      ].filter((n): n is string => !!n);

      for (const name of names) {
        const key = name.toLowerCase().trim();
        if (!fieldMap.has(key)) {
          fieldMap.set(key, field);
        }
      }
    }

    return fieldMap;
  }

  /**
   * Validates that a field exists and is editable using cached metadata.
   * Provides helpful error messages for common issues.
   *
   * @param fieldName - Field name to validate
   * @param fieldMap - Map of available fields from buildFieldMap()
   * @returns Result with field metadata or validation error
   */
  private validateFieldExists(
    fieldName: string,
    fieldMap: Map<string, FieldMetadata>
  ): Result<FieldMetadata, BCError> {
    const key = fieldName.toLowerCase().trim();
    const field = fieldMap.get(key);

    if (!field) {
      // Field doesn't exist - provide helpful error
      const availableFields = Array.from(new Set(
        Array.from(fieldMap.values())
          .map(f => f.caption || f.name)
          .filter((n): n is string => !!n)
      )).slice(0, 10);

      return err(
        new InputValidationError(
          `Field "${fieldName}" not found on page`,
          fieldName,
          [
            `Field "${fieldName}" does not exist on this page.`,
            `Available fields: ${availableFields.join(', ')}${fieldMap.size > 10 ? ', ...' : ''}`,
            `Hint: Field names are case-insensitive. Check spelling and use caption or name.`
          ]
        )
      );
    }

    // Check if field is visible
    if (!field.visible) {
      return err(
        new InputValidationError(
          `Field "${fieldName}" is not visible`,
          fieldName,
          [
            `Field "${fieldName}" exists but is not visible on the page.`,
            `Hidden fields cannot be edited.`
          ]
        )
      );
    }

    // Check if field is enabled
    if (!field.enabled) {
      return err(
        new InputValidationError(
          `Field "${fieldName}" is disabled`,
          fieldName,
          [
            `Field "${fieldName}" exists but is disabled.`,
            `Disabled fields cannot be edited.`
          ]
        )
      );
    }

    // Check if field is readonly
    if (field.readonly) {
      return err(
        new InputValidationError(
          `Field "${fieldName}" is read-only`,
          fieldName,
          [
            `Field "${fieldName}" is marked as read-only.`,
            `Read-only fields cannot be modified.`
          ]
        )
      );
    }

    return ok(field);
  }

  /**
   * Executes the tool to write page data.
   * Uses legacy validation with field normalization.
   *
   * Sets field values on the current record using SaveValue interactions.
   */
  protected async executeInternal(input: unknown): Promise<Result<WritePageDataOutput, BCError>> {
    const logger = createToolLogger('write_page_data', (input as any)?.pageContextId);

    // Validate and normalize input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, fields, stopOnError, immediateValidation } = validatedInput.value;

    const fieldNames = Object.keys(fields);

    logger.info(`Writing ${fieldNames.length} fields using pageContext: "${pageContextId}"`);
    logger.info(`Fields: ${fieldNames.join(', ')}`);
    logger.info(`Options: stopOnError=${stopOnError}, immediateValidation=${immediateValidation}`);

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

      // Check if the page context is still valid in memory
      let pageContext = (connection as any).pageContexts?.get(pageContextId);

      // 💾 If not in memory, try restoring from persistent cache
      if (!pageContext) {
        logger.info(`⚠️  Page context not in memory, checking persistent cache...`);
        try {
          const cache = PageContextCache.getInstance();
          const cachedContext = await cache.load(pageContextId);

          if (cachedContext) {
            logger.info(`✓ Restored pageContext from cache: ${pageContextId}`);
            // Restore to memory
            if (!(connection as any).pageContexts) {
              (connection as any).pageContexts = new Map();
            }
            (connection as any).pageContexts.set(pageContextId, cachedContext);
            pageContext = cachedContext;
          }
        } catch (error) {
          logger.error(`Failed to load from cache: ${error}`);
        }
      }

      // If still not found, return error
      if (!pageContext) {
        logger.info(`❌ Page context not found in memory or cache`);
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

    // 🎯 OPTIMIZATION: Use cached LogicalForm for client-side field validation
    // This follows the caching pattern: extract metadata once in get_page_metadata, reuse here
    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    let fieldMap: Map<string, FieldMetadata> | null = null;

    if (pageContext?.logicalForm) {
      logger.info(`✓ Using cached LogicalForm for client-side field validation`);
      fieldMap = this.buildFieldMap(pageContext.logicalForm);
      logger.info(`  Field map contains ${fieldMap.size} field entries`);

      // Pre-validate all fields before making BC API calls
      for (const fieldName of fieldNames) {
        const validationResult = this.validateFieldExists(fieldName, fieldMap);
        if (!isOk(validationResult)) {
          logger.info(`✗ Pre-validation failed for field "${fieldName}": ${validationResult.error.message}`);
          return validationResult as Result<never, BCError>;
        }
        logger.info(`✓ Pre-validated field "${fieldName}"`);
      }
    } else {
      logger.info(`⚠️  No cached LogicalForm available, skipping client-side validation`);
    }

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
        saved: false, // This tool never saves - caller must use execute_action("Save")
        message: `Successfully updated ${updatedFields.length} field(s): ${updatedFields.join(', ')}`,
        updatedFields,
      });
    } else if (updatedFields.length > 0) {
      // Partial success
      return ok({
        success: false,
        pageContextId,
        saved: false, // This tool never saves
        message: `Partially updated ${updatedFields.length} field(s). Failed: ${failedFields.map(f => f.field).join(', ')}`,
        updatedFields,
        failedFields, // Structured: [{ field, error, validationMessage? }]
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
   *
   * Supports null values for clearing fields (converted to empty string).
   */
  private async setFieldValue(
    connection: IBCConnection,
    formId: string,
    fieldName: string,
    value: unknown,
    controlPath?: string,
    immediateValidation: boolean = true
  ): Promise<Result<void, BCError>> {
    // Handle null values (clear field)
    let actualValue: string | number | boolean;
    if (value === null || value === undefined) {
      actualValue = ''; // Clear field by setting to empty string
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      actualValue = value;
    } else {
      return err(
        new InputValidationError(
          `Field '${fieldName}' value must be a string, number, boolean, or null`,
          fieldName,
          [`Expected string|number|boolean|null, got ${typeof value}`]
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
        newValue: actualValue,
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

    // If immediateValidation is enabled, inspect handlers for errors and other messages
    if (immediateValidation) {
      const handlers = result.value;

      // Check for BC error messages (blocking errors)
      const errorHandler = handlers.find(
        (h: any) => h.handlerType === 'DN.ErrorMessageProperties' || h.handlerType === 'DN.ErrorDialogProperties'
      );

      if (errorHandler) {
        const errorParams = (errorHandler as any).parameters?.[0];
        const errorMessage = errorParams?.Message || errorParams?.ErrorMessage || 'Unknown error';

        return err(
          new ProtocolError(
            `BC error: ${errorMessage}`,
            { fieldName, value, formId, controlPath, errorHandler, validationMessage: errorMessage, handlerType: 'error' }
          )
        );
      }

      // Check for validation errors (blocking validation)
      const validationHandler = handlers.find(
        (h: any) => h.handlerType === 'DN.ValidationMessageProperties'
      );

      if (validationHandler) {
        const validationParams = (validationHandler as any).parameters?.[0];
        const validationMessage = validationParams?.Message || 'Validation failed';

        return err(
          new ProtocolError(
            `BC validation error: ${validationMessage}`,
            { fieldName, value, formId, controlPath, validationHandler, validationMessage, handlerType: 'validation' }
          )
        );
      }

      // Check for confirmation dialogs (require user interaction)
      const confirmHandler = handlers.find(
        (h: any) => h.handlerType === 'DN.ConfirmDialogProperties' || h.handlerType === 'DN.YesNoDialogProperties'
      );

      if (confirmHandler) {
        const confirmParams = (confirmHandler as any).parameters?.[0];
        const confirmMessage = confirmParams?.Message || confirmParams?.ConfirmText || 'Confirmation required';

        return err(
          new ProtocolError(
            `BC confirmation required: ${confirmMessage}`,
            { fieldName, value, formId, controlPath, confirmHandler, validationMessage: confirmMessage, handlerType: 'confirm' }
          )
        );
      }

      // Note: Info messages and busy states are non-blocking, so we don't fail on them
      // They're available in the raw handlers if caller needs them
    }

    // Success - field value saved
    return ok(undefined);
  }
}
