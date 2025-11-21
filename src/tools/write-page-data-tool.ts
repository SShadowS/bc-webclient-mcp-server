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
import { createToolLogger, logger as moduleLogger } from '../core/logger.js';
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
    'Sets field values on the current Business Central record with immediate validation. Requires pageContextId from get_page_metadata. ' +
    'Prerequisites: Record MUST be in edit mode (call execute_action with "Edit" for existing records or "New" for new records first). ' +
    'fields: Provide as simple map {"FieldName": value} where keys are field names/captions (case-insensitive), ' +
    'OR as array [{name: "FieldName", value: value, controlPath?: "path"}] for precise targeting. ' +
    'Field references use field name or caption from get_page_metadata.fields. ' +
    'stopOnError (default true): stops processing remaining fields on first validation error. ' +
    'immediateValidation (default true): runs Business Central OnValidate triggers immediately and surfaces validation messages. ' +
    'Returns: {updatedFields: [], failedFields: [{field, error, validationMessage}], saved: false}. ' +
    'IMPORTANT: This call does NOT commit/post to the database. Field changes are held in memory. ' +
    'Use execute_action("Save") or execute_action("Post") to persist changes to the database.';

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
        // Check if value is already wrapped with {value, controlPath?} structure
        if (typeof value === 'object' && value !== null && 'value' in value) {
          // Already wrapped - use as-is
          fields[name] = value as { value: unknown; controlPath?: string };
        } else {
          // Primitive or other format - wrap it
          fields[name] = { value };
        }
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
      logger.info(`Reusing session from pageContext: ${sessionId}`);
      connection = existing;
      actualSessionId = sessionId;

      // Check if the page context is still valid in memory
      let pageContext = (connection as any).pageContexts?.get(pageContextId);

      // If not in memory, try restoring from persistent cache
      if (!pageContext) {
        logger.info(`Page context not in memory, checking persistent cache...`);
        try {
          const cache = PageContextCache.getInstance();
          const cachedContext = await cache.load(pageContextId);

          if (cachedContext) {
            logger.info(`Restored pageContext from cache: ${pageContextId}`);
            // Restore to memory
            if (!(connection as any).pageContexts) {
              (connection as any).pageContexts = new Map();
            }
            (connection as any).pageContexts.set(pageContextId, cachedContext);
            pageContext = cachedContext;
          }
        } catch (error) {
          logger.warn(`Failed to load from cache: ${error}`);
        }
      }

      // If still not found, return error
      if (!pageContext) {
        logger.info(`Page context not found in memory or cache`);
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

    // OPTIMIZATION: Use cached LogicalForm for client-side field validation
    // This follows the caching pattern: extract metadata once in get_page_metadata, reuse here
    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    let fieldMap: Map<string, FieldMetadata> | null = null;

    if (pageContext?.logicalForm) {
      logger.info(`Using cached LogicalForm for client-side field validation`);
      fieldMap = this.buildFieldMap(pageContext.logicalForm);
      logger.info(`  Field map contains ${fieldMap.size} field entries`);

      // Pre-validate all fields before making BC API calls
      for (const fieldName of fieldNames) {
        const validationResult = this.validateFieldExists(fieldName, fieldMap);
        if (!isOk(validationResult)) {
          logger.info(`Pre-validation failed for field "${fieldName}": ${validationResult.error.message}`);
          return validationResult as Result<never, BCError>;
        }
        logger.info(`Pre-validated field "${fieldName}"`);
      }
    } else {
      logger.info(`No cached LogicalForm available, skipping client-side validation`);
    }

    // Set each field value using SaveValue interaction
    const updatedFields: string[] = [];
    const failedFields: Array<{ field: string; error: string; validationMessage?: string }> = [];

    for (const [fieldName, fieldSpec] of Object.entries(fields)) {
      let { value: fieldValue, controlPath } = fieldSpec;

      // CRITICAL: Look up controlPath from fieldMap if not provided
      // This is essential for cache updates to work properly
      if (!controlPath && fieldMap) {
        const lookupKey = fieldName.toLowerCase().trim();
        const fieldMeta = fieldMap.get(lookupKey);
        if (fieldMeta?.controlPath) {
          controlPath = fieldMeta.controlPath;
          logger.info(`Resolved controlPath for "${fieldName}": ${controlPath}`);
        } else {
          // Debug: show what keys are available and check if key exists
          const hasKey = fieldMap.has(lookupKey);
          const fieldMetaDebug = fieldMap.get(lookupKey);
          const availableKeys = Array.from(fieldMap.keys()).slice(0, 10).join(', ');
          logger.error(`[CACHE DEBUG] controlPath lookup failed for "${fieldName}": hasKey=${hasKey}, fieldMeta exists=${!!fieldMetaDebug}, fieldMeta.controlPath=${fieldMetaDebug?.controlPath}`);
          logger.warn(`Could not resolve controlPath for "${fieldName}" (key="${lookupKey}") from fieldMap. Available keys (first 10): ${availableKeys}`);
        }
      }

      logger.info(`Setting field "${fieldName}" = "${fieldValue}"${controlPath ? ` (controlPath: ${controlPath})` : ''}...`);

      const result = await this.setFieldValue(
        connection,
        formId,
        fieldName,
        fieldValue,
        pageContextId,
        controlPath,
        immediateValidation
      );

      if (isOk(result)) {
        updatedFields.push(fieldName);
        logger.info(`Field "${fieldName}" updated successfully`);
      } else {
        const errorMsg = result.error.message;
        const validationMsg = (result.error as any).context?.validationMessage;
        failedFields.push({
          field: fieldName,
          error: errorMsg,
          validationMessage: validationMsg,
        });
        logger.info(`Field "${fieldName}" failed: ${errorMsg}`);

        // Stop on first error if stopOnError is true
        if (stopOnError) {
          logger.info(`Stopping on first error (stopOnError=true)`);
          break;
        }
      }
    }

    // NOTE: needsRefresh flag is now set conditionally in setFieldValue() method
    // Only set if PropertyChanges cache update fails - avoids broken LoadForm on Card pages

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
    pageContextId: string,
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

    // ===== CRITICAL: SaveValue uses async handler pattern =====
    // BC sends PropertyChanges via async Message events OR in synchronous response
    // We must wait for async LogicalClientChangeHandler but abort if found in sync response

    // Create AbortController to cancel async wait if PropertyChanges found in sync response
    const abortController = new AbortController();

    // Set up async handler listener BEFORE sending interaction
    const asyncHandlerPromise = connection.waitForHandlers(
      (handlers: any[]) => {
        // Look for LogicalClientChangeHandler with PropertyChanges for our field
        const logicalHandler = handlers.find((h: any) =>
          h.handlerType === 'DN.LogicalClientChangeHandler'
        );

        if (logicalHandler) {
          moduleLogger.info(`[PropertyChanges] Found async LogicalClientChangeHandler after SaveValue`);
          return { matched: true, data: handlers };
        }
        return { matched: false };
      },
      { timeoutMs: 1000, signal: abortController.signal } // Pass abort signal
    );

    // Send interaction
    const result = await connection.invoke(interaction);

    if (!result.ok) {
      abortController.abort(); // Cancel async wait on error
      return err(
        new ProtocolError(
          `Failed to set field "${fieldName}": ${result.error.message}`,
          { fieldName, value, formId, controlPath, originalError: result.error }
        )
      );
    }

    // Check if PropertyChanges are in synchronous response
    let foundPropertyChangesInSync = false;
    moduleLogger.info(`[PropertyChanges] Checking ${result.value.length} synchronous handlers for PropertyChanges`);
    for (const handler of result.value) {
      moduleLogger.info(`[PropertyChanges] Sync handler type: ${(handler as any).handlerType}`);
      if ((handler as any).handlerType === 'DN.LogicalClientChangeHandler') {
        const params = (handler as any).parameters;
        moduleLogger.info(`[PropertyChanges] Found LogicalClientChangeHandler in sync response, params.length=${Array.isArray(params) ? params.length : 'not array'}`);
        if (Array.isArray(params) && params.length >= 2) {
          const changes = params[1];
          moduleLogger.info(`[PropertyChanges] Changes is array: ${Array.isArray(changes)}, length: ${Array.isArray(changes) ? changes.length : 'N/A'}`);
          if (Array.isArray(changes)) {
            for (const change of changes) {
              moduleLogger.info(`[PropertyChanges] Change type: ${change?.t}`);
              // BC uses both "PropertyChanges" (plural) and "PropertyChange" (singular)
              if (change?.t === 'PropertyChanges' || change?.t === 'PropertyChange') {
                foundPropertyChangesInSync = true;
                moduleLogger.info(`[PropertyChanges] Found PropertyChange(s) in sync response!`);
                break;
              }
            }
          }
        }
      }
      if (foundPropertyChangesInSync) break;
    }

    // If PropertyChanges found in sync response, cancel async wait to avoid timeout delay
    if (foundPropertyChangesInSync) {
      abortController.abort();
      moduleLogger.info(`[PropertyChanges] Found in synchronous response, cancelled async wait`);
    } else {
      moduleLogger.info(`[PropertyChanges] PropertyChanges NOT in sync response, waiting for async...`);
    }

    // Wait for async PropertyChanges handlers (will be aborted if already found in sync)
    let asyncHandlers: any[] = [];
    try {
      asyncHandlers = await asyncHandlerPromise;
      moduleLogger.info(`[PropertyChanges] Received ${asyncHandlers.length} async handlers after SaveValue`);
    } catch (error: any) {
      // AbortError means we found PropertyChanges in sync response - this is good!
      // Timeout means no async handlers - this is also OK for some fields
      if (error?.name === 'AbortError') {
        moduleLogger.info(`[PropertyChanges] Async wait aborted (PropertyChanges already in sync response)`);
      } else {
        moduleLogger.info(`[PropertyChanges] No async handlers received (timeout) - this is OK for some fields`);
      }
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

    // ===== CRITICAL: Capture PropertyChanges from SaveValue response =====
    // BC returns updated field values in LogicalClientChangeHandler PropertyChanges
    // PropertyChanges arrive via ASYNC Message events, not synchronous SaveValue response
    // We must merge these into cached handlers so read_page_data returns fresh values
    // without requiring LoadForm (which returns stale Card page data)

    // Combine synchronous response handlers + async Message handlers
    const allHandlers = [...result.value, ...asyncHandlers];
    const pageContext = (connection as any).pageContexts?.get(pageContextId);

    moduleLogger.info(`[PropertyChanges] SaveValue total handlers: ${allHandlers.length} (sync: ${result.value.length}, async: ${asyncHandlers.length}), pageContext exists: ${!!pageContext}, pageContext.handlers exists: ${!!pageContext?.handlers}`);
    if (allHandlers.length > 0) {
      moduleLogger.info(`[PropertyChanges] Handler types: ${allHandlers.map((h: any) => h.handlerType).join(', ')}`);
    }

    // Track whether we successfully updated the cache
    let cacheUpdated = false;

    // CRITICAL: Manually update cache with value WE SENT (BC doesn't echo it back!)
    // BC's SaveValue response contains PropertyChanges for OTHER fields that recalculated,
    // but NOT for the field we updated. We must manually update the cache first.
    if (pageContext?.handlers && controlPath) {
      moduleLogger.info(`[PropertyChanges] Manually updating cache with our sent value: "${actualValue}"`);

      const manualUpdate = this.updateCachedPropertyChange(
        pageContext.handlers,
        formId,
        controlPath,
        actualValue  // Use the value WE sent, not waiting for BC to echo it
      );

      if (manualUpdate) {
        cacheUpdated = true;
        moduleLogger.info(`[PropertyChanges] Manual cache update SUCCEEDED for "${fieldName}"`);
      } else {
        moduleLogger.warn(`[PropertyChanges] Manual cache update FAILED for "${fieldName}" - no existing PropertyChange found`);
      }
    }

    // Also process any PropertyChanges BC sent for recalculated fields
    if (pageContext?.handlers) {
      moduleLogger.info(`[PropertyChanges] Page context has ${pageContext.handlers.length} cached handlers`);

      // Find LogicalClientChangeHandler with PropertyChanges for recalculated fields
      let foundLogicalHandler = false;
      for (const handler of allHandlers) {
        if ((handler as any).handlerType === 'DN.LogicalClientChangeHandler') {
          foundLogicalHandler = true;
          const params = (handler as any).parameters;
          moduleLogger.info(`[PropertyChanges] Found LogicalClientChangeHandler, params length: ${Array.isArray(params) ? params.length : 'not array'}`);

          if (Array.isArray(params) && params.length >= 2) {
            const formIdParam = params[0];
            const changes = params[1];
            moduleLogger.info(`[PropertyChanges] FormId match: request=${formId}, response=${formIdParam}, changes is array: ${Array.isArray(changes)}, changes length: ${Array.isArray(changes) ? changes.length : 'N/A'}`);

            // Verify this is for our form
            if (formIdParam === formId && Array.isArray(changes)) {
              moduleLogger.error(`[CACHE DEBUG] FormId matches! ${changes.length} changes. Looking for controlPath="${controlPath}"`);
              moduleLogger.info(`[PropertyChanges] FormId matches! Processing ${changes.length} changes...`);

              // Process each change
              for (let i = 0; i < changes.length; i++) {
                const change = changes[i];
                moduleLogger.error(`[CACHE DEBUG]   Change[${i}]: t=${change?.t}, controlPath=${change?.ControlReference?.controlPath}`);
                moduleLogger.info(`[PropertyChanges]   Change[${i}].t = ${change?.t}`);

                // BC uses both "PropertyChanges" (plural) and "PropertyChange" (singular)
                if (change?.t === 'PropertyChanges' || change?.t === 'PropertyChange') {
                  // Extract controlPath from response (needed for cache update matching)
                  const responseControlPath = change.ControlReference?.controlPath;
                  moduleLogger.info(`[PropertyChanges]   PropertyChanges found! controlPath=${responseControlPath}`);

                  // Extract updated value (BC uses StringValue, ObjectValue, DecimalValue, etc.)
                  // BC sends values in Changes property, not directly on change object
                  const changesObj = change.Changes;
                  const updatedValue = changesObj?.StringValue ?? changesObj?.ObjectValue ?? changesObj?.DecimalValue ??
                                      changesObj?.BooleanValue ?? changesObj?.IntegerValue;
                  moduleLogger.info(`[PropertyChanges]   Extracted value: ${JSON.stringify(updatedValue)}`);

                  if (updatedValue !== undefined && responseControlPath) {
                    // Update the field in cached handlers using controlPath from response
                    // This ensures we match the exact same field in the cache
                    moduleLogger.info(`[PropertyChanges]   Calling updateCachedPropertyChange for controlPath=${responseControlPath}`);
                    const updated = this.updateCachedPropertyChange(pageContext.handlers, formId, responseControlPath, updatedValue);
                    moduleLogger.info(`[PropertyChanges]   updateCachedPropertyChange returned: ${updated}`);

                    if (updated) {
                      cacheUpdated = true;
                    }
                    moduleLogger.info(`[PropertyChanges] Captured updated value for "${fieldName}" (controlPath: ${responseControlPath}): ${JSON.stringify(updatedValue)}, cacheUpdated=${cacheUpdated}`);
                  } else {
                    moduleLogger.warn(`[PropertyChanges]   Missing data: updatedValue=${updatedValue}, responseControlPath=${responseControlPath}`);
                  }
                }
              }
            } else {
              if (formIdParam !== formId) {
                moduleLogger.info(`[PropertyChanges] FormId mismatch: expected=${formId}, got=${formIdParam}`);
              }
            }
          }
        }
      }

      if (!foundLogicalHandler) {
        moduleLogger.info(`[PropertyChanges] No LogicalClientChangeHandler found in SaveValue response (checked ${allHandlers.length} handlers)`);
      }

      // CRITICAL: NEVER set needsRefresh = true after writes!
      // LoadForm fails with RPC errors on Card pages after editing (see BC_PROTOCOL_PATTERNS.md)
      // Even if cache update fails, we should use existing cached handlers (slightly stale is better than RPC error)
      moduleLogger.error(`[CACHE DEBUG] field="${fieldName}", cacheUpdated=${cacheUpdated}, allHandlers.length=${allHandlers.length}, foundLogicalHandler=${foundLogicalHandler}, pageContext exists=${!!pageContext}, cachedHandlers.length=${pageContext?.handlers?.length || 0}`);
      moduleLogger.info(`[PropertyChanges] Final cacheUpdated status: ${cacheUpdated}`);
      if (!cacheUpdated) {
        moduleLogger.error(`[CACHE DEBUG] Cache update FAILED for field "${fieldName}" - Why? foundLogicalHandler=${foundLogicalHandler}, formId=${formId}`);
        moduleLogger.warn(`[PropertyChanges] Cache update FAILED, but NOT setting needsRefresh (LoadForm would fail on Card pages after edits)`);
      } else {
        moduleLogger.info(`[PropertyChanges] Cache successfully updated`);
        // Clear needsRefresh flag since we just updated the cache
        // This prevents read_page_data from calling LoadForm which would fail with InvalidSessionException
        if (pageContext) {
          pageContext.needsRefresh = false;
          moduleLogger.info(`[PropertyChanges] Cleared needsRefresh flag after successful cache update`);
        }
      }
    } else {
      moduleLogger.warn(`[PropertyChanges] No page context or no cached handlers available for cache update!`);
    }

    // Success - field value saved
    return ok(undefined);
  }

  /**
   * Updates a PropertyChange in cached handlers with new value from SaveValue response.
   * Implements UPSERT logic: updates existing PropertyChange or inserts new one.
   * This ensures read_page_data returns fresh values without requiring LoadForm.
   *
   * @param cachedHandlers - Cached handlers from pageContext
   * @param formId - Form ID to match
   * @param controlPath - Exact controlPath from SaveValue response (e.g., "server:c[1]/c[1]")
   * @param newValue - Updated value to cache
   * @returns true if cache was updated/inserted, false if LogicalClientChangeHandler not found
   */
  private updateCachedPropertyChange(
    cachedHandlers: any[],
    formId: string,
    controlPath: string,
    newValue: unknown
  ): boolean {
    // Find the LogicalClientChangeHandler for this form
    let targetHandler: any = null;
    let targetChanges: any[] | null = null;

    for (const handler of cachedHandlers) {
      if ((handler as any).handlerType === 'DN.LogicalClientChangeHandler') {
        const params = (handler as any).parameters;
        if (Array.isArray(params) && params.length >= 2) {
          const formIdParam = params[0];
          const changes = params[1];

          if (formIdParam === formId && Array.isArray(changes)) {
            targetHandler = handler;
            targetChanges = changes;
            break;
          }
        }
      }
    }

    if (!targetHandler || !targetChanges) {
      moduleLogger.debug(`[PropertyChanges] No LogicalClientChangeHandler found for formId "${formId}"`);
      return false;
    }

    // Try to find existing PropertyChange for this controlPath
    // BC uses both "PropertyChanges" (plural) and "PropertyChange" (singular)
    let existingChange: any = null;
    for (const change of targetChanges) {
      if ((change?.t === 'PropertyChanges' || change?.t === 'PropertyChange') && change.ControlReference?.controlPath === controlPath) {
        existingChange = change;
        break;
      }
    }

    if (existingChange) {
      // UPDATE existing PropertyChange
      moduleLogger.error(`[CACHE DIAGNOSTIC] Found existing change to update: t=${existingChange.t}, controlPath=${existingChange.ControlReference?.controlPath}`);
      if (!existingChange.Changes) {
        existingChange.Changes = {};
      }

      if (typeof newValue === 'string') {
        existingChange.Changes.StringValue = newValue;
        moduleLogger.error(`[CACHE DIAGNOSTIC] Set Changes.StringValue = "${newValue}"`);
      } else if (typeof newValue === 'number') {
        existingChange.Changes.DecimalValue = newValue;
        existingChange.Changes.IntegerValue = newValue;
      } else if (typeof newValue === 'boolean') {
        existingChange.Changes.BooleanValue = newValue;
      } else if (typeof newValue === 'object') {
        existingChange.Changes.ObjectValue = newValue;
      }

      // Verify the update actually happened
      moduleLogger.error(`[CACHE DIAGNOSTIC] After update: Changes.StringValue = "${existingChange.Changes.StringValue}"`);
      moduleLogger.debug(`[PropertyChanges] Updated existing PropertyChange for controlPath "${controlPath}"`);
      return true;
    } else {
      // INSERT new PropertyChange into existing LogicalClientChangeHandler
      const newPropertyChange: any = {
        t: 'PropertyChanges',
        ControlReference: {
          controlPath,
          formId
        },
        Changes: {}
      };

      if (typeof newValue === 'string') {
        newPropertyChange.Changes.StringValue = newValue;
      } else if (typeof newValue === 'number') {
        newPropertyChange.Changes.DecimalValue = newValue;
        newPropertyChange.Changes.IntegerValue = newValue;
      } else if (typeof newValue === 'boolean') {
        newPropertyChange.Changes.BooleanValue = newValue;
      } else if (typeof newValue === 'object') {
        newPropertyChange.Changes.ObjectValue = newValue;
      }

      targetChanges.push(newPropertyChange);
      moduleLogger.debug(`[PropertyChanges] Inserted new PropertyChange for controlPath "${controlPath}"`);
      return true;
    }
  }
}
