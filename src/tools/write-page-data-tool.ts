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
import type {
  LogicalForm, FieldMetadata, RepeaterMetadata, ColumnMetadata,
  Handler, LogicalClientChangeHandler, BCHandler
} from '../types/bc-types.js';
import { PageContextCache } from '../services/page-context-cache.js';
import type { PageState, RepeaterState } from '../state/page-state.js';
import { PageStateManager } from '../state/page-state-manager.js';
import { createWorkflowIntegration } from '../services/workflow-integration.js';
import type {
  Change, PropertyChanges, PropertyChange, ControlReference,
  DataRefreshChange, DataRowInsertedChange
} from '../types/bc-protocol-types.js';
import { isPropertyChange, isPropertyChanges } from '../types/bc-protocol-types.js';
import {
  isDataRefreshChangeType,
  isDataRowInsertedType,
  isPropertyChangesType,
  isPropertyChangeType,
} from '../types/bc-type-discriminators.js';

/**
 * PageContext structure stored in connection
 */
interface PageContext {
  pageId: string;
  formId: string;
  sessionId: string;
  logicalForm: LogicalForm;
  handlers: Handler[];
  pageType?: string;
  fields?: readonly FieldMetadata[];
  repeaters?: readonly RepeaterMetadata[];
  needsRefresh?: boolean;
}

/**
 * Extended connection type with pageContexts map
 */
interface ConnectionWithPageContexts extends IBCConnection {
  pageContexts?: Map<string, PageContext>;
}

/**
 * Type guard to check if a handler is a LogicalClientChangeHandler
 */
function isLogicalClientChangeHandler(handler: Handler | BCHandler): handler is LogicalClientChangeHandler {
  return handler.handlerType === 'DN.LogicalClientChangeHandler';
}

/**
 * BCError with optional context for validation messages
 */
interface BCErrorWithContext extends BCError {
  context?: {
    validationMessage?: string;
    [key: string]: unknown;
  };
}

/**
 * Generic BC handler interface for special handler types not in standard union
 * (e.g., ErrorMessageProperties, ValidationMessageProperties, ConfirmDialogProperties)
 */
interface GenericBCHandler {
  handlerType: string;
  parameters?: readonly unknown[];
}

/**
 * Get the handlerType from any handler (standard or generic)
 */
function getHandlerType(handler: Handler | GenericBCHandler): string {
  return handler.handlerType;
}

/**
 * Get parameters from any handler (standard or generic)
 */
function getHandlerParams(handler: Handler | GenericBCHandler): readonly unknown[] | undefined {
  return handler.parameters;
}

/**
 * Mutable PropertyChange structure for cache updates
 */
interface MutablePropertyChange {
  t: string;
  ControlReference?: {
    controlPath?: string;
    ControlPath?: string;
    formId?: string;
  };
  Changes?: {
    StringValue?: string;
    DecimalValue?: number;
    IntegerValue?: number;
    BooleanValue?: boolean;
    ObjectValue?: unknown;
  };
}

/**
 * Mutable handler structure for cache updates
 */
interface MutableHandler {
  handlerType: string;
  parameters?: unknown[];
}

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
    'SUBPAGE/LINE OPERATIONS (NEW): To write to document lines (Sales Orders, Purchase Orders, etc.), provide subpage parameter with line identifier. ' +
    'subpage (optional): Subpage/repeater name (e.g., "SalesLines") for line item operations. ' +
    'lineBookmark (optional): Bookmark of specific line to update (most reliable). ' +
    'lineNo (optional): Line number to update (1-based, resolved to bookmark internally). ' +
    'If neither lineBookmark nor lineNo provided, creates NEW line. Provide EITHER lineBookmark OR lineNo, not both. ' +
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
      subpage: {
        type: 'string',
        description: 'Optional: Subpage/repeater name for line item operations (e.g., "SalesLines")',
      },
      lineBookmark: {
        type: 'string',
        description: 'Optional: Bookmark of specific line to update (most reliable method)',
      },
      lineNo: {
        type: 'number',
        description: 'Optional: Line number to update (1-based, resolved to bookmark internally)',
        minimum: 1,
      },
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID to track this operation as part of a multi-step business process. ' +
          'When provided, tracks unsaved field changes and records operation result.',
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

    // Extract and validate subpage/line parameters
    const subpage = (input as Record<string, unknown>).subpage as string | undefined;
    const lineBookmark = (input as Record<string, unknown>).lineBookmark as string | undefined;
    const lineNo = (input as Record<string, unknown>).lineNo as number | undefined;

    // Validate: Cannot provide both lineBookmark AND lineNo
    if (lineBookmark && lineNo) {
      return err(
        new InputValidationError(
          'Cannot provide both lineBookmark and lineNo - use one or the other',
          'lineBookmark/lineNo',
          ['Provide EITHER lineBookmark OR lineNo, not both']
        )
      ) as Result<never, BCError>;
    }

    // Validate: lineBookmark/lineNo require subpage parameter
    if ((lineBookmark || lineNo) && !subpage) {
      return err(
        new InputValidationError(
          'lineBookmark or lineNo requires subpage parameter to be specified',
          'subpage',
          ['Must provide subpage name when using lineBookmark or lineNo']
        )
      ) as Result<never, BCError>;
    }

    return ok({
      pageContextId: pageContextIdResult.value,
      fields,
      stopOnError,
      immediateValidation,
      subpage,
      lineBookmark,
      lineNo,
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
    const inputObj = input as Record<string, unknown> | null;
    const logger = createToolLogger('write_page_data', inputObj?.pageContextId as string | undefined);

    // Validate and normalize input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const validatedData = validatedInput.value as WritePageDataInput & {
      subpage?: string;
      lineBookmark?: string;
      lineNo?: number;
      workflowId?: string;
    };
    const { pageContextId, fields, stopOnError, immediateValidation, subpage, lineBookmark, lineNo, workflowId } = validatedData;

    // Create workflow integration if workflowId provided
    const workflow = createWorkflowIntegration(workflowId);

    const fieldNames = Object.keys(fields);

    logger.info(`Writing ${fieldNames.length} fields using pageContext: "${pageContextId}"`);
    logger.info(`Fields: ${fieldNames.join(', ')}`);
    logger.info(`Options: stopOnError=${stopOnError}, immediateValidation=${immediateValidation}`);
    if (subpage) {
      logger.info(`Line operation: subpage="${subpage}", lineBookmark="${lineBookmark || 'N/A'}", lineNo=${lineNo || 'N/A'}`);
    }

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
      const connWithCtx = connection as ConnectionWithPageContexts;
      let pageContext = connWithCtx.pageContexts?.get(pageContextId);

      // If not in memory, try restoring from persistent cache
      if (!pageContext) {
        logger.info(`Page context not in memory, checking persistent cache...`);
        try {
          const cache = PageContextCache.getInstance();
          const cachedContext = await cache.load(pageContextId);

          if (cachedContext) {
            logger.info(`Restored pageContext from cache: ${pageContextId}`);
            // Restore to memory
            if (!connWithCtx.pageContexts) {
              connWithCtx.pageContexts = new Map();
            }
            // Cast through unknown since CachedPageContext may have different optional fields
            connWithCtx.pageContexts.set(pageContextId, cachedContext as unknown as PageContext);
            pageContext = cachedContext as unknown as PageContext;
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
    const pageContext = (connection as ConnectionWithPageContexts).pageContexts?.get(pageContextId);
    let fieldMap: Map<string, FieldMetadata | ColumnMetadata> | null = null;
    let targetRowBookmark: string | undefined;  // Bookmark for existing row modification in subpages

    if (pageContext?.logicalForm && !subpage) {
      // Only validate header fields if NOT in line mode
      logger.info(`Using cached LogicalForm for client-side field validation`);
      const headerFieldMap = this.buildFieldMap(pageContext.logicalForm);
      fieldMap = headerFieldMap; // Store for later use in field-writing loop
      logger.info(`  Field map contains ${headerFieldMap.size} field entries`);

      // Pre-validate all fields before making BC API calls
      for (const fieldName of fieldNames) {
        const validationResult = this.validateFieldExists(fieldName, headerFieldMap);
        if (!isOk(validationResult)) {
          logger.info(`Pre-validation failed for field "${fieldName}": ${validationResult.error.message}`);
          return validationResult as Result<never, BCError>;
        }
        logger.info(`Pre-validated field "${fieldName}"`);
      }
    } else if (!subpage) {
      logger.info(`No cached LogicalForm available, skipping client-side validation`);
    }

    // LINE/SUBPAGE OPERATION: Handle line operations if subpage is provided
    if (subpage) {
      logger.info(`Handling line operation for subpage "${subpage}"`);

      // Find repeater by subpage name (uses PageState if available)
      const repeaterResult = await this.findRepeaterBySubpage(pageContextId, pageContext, subpage);
      if (!isOk(repeaterResult)) {
        return repeaterResult as Result<never, BCError>;
      }

      const repeater = repeaterResult.value;
      logger.info(`Found repeater: ${repeater.caption || repeater.name} at ${repeater.controlPath}`);

      // If lineBookmark or lineNo provided, we're updating an existing line
      if (lineBookmark || lineNo) {
        // Determine which bookmark to use
        targetRowBookmark = lineBookmark;

        // If lineNo provided, resolve to bookmark from PageState cache
        if (lineNo && !lineBookmark) {
          const cache = PageContextCache.getInstance();
          const pageState = await cache.getPageState(pageContextId);

          if (!pageState) {
            return err(
              new InputValidationError(
                `lineNo parameter requires cached page state - call read_page_data first`,
                'lineNo',
                [`Page state not found in cache for pageContextId: ${pageContextId}`]
              )
            );
          }

          // Find the repeater in PageState by matching name/caption
          let repeaterState: import('../state/page-state.js').RepeaterState | undefined;
          for (const [, rs] of pageState.repeaters) {
            // Match by caption (user-facing name like "SalesLines") or name
            if (
              rs.caption?.toLowerCase().includes(subpage.toLowerCase()) ||
              rs.name.toLowerCase().includes(subpage.toLowerCase())
            ) {
              repeaterState = rs;
              break;
            }
          }

          if (!repeaterState) {
            return err(
              new InputValidationError(
                `Repeater "${subpage}" not found in cached page state`,
                'subpage',
                [`Available repeaters: ${Array.from(pageState.repeaters.keys()).join(', ')}`]
              )
            );
          }

          // Get bookmark from rowOrder array (1-indexed lineNo to 0-indexed array)
          const rowIndex = lineNo - 1;
          if (rowIndex < 0 || rowIndex >= repeaterState.rowOrder.length) {
            return err(
              new InputValidationError(
                `lineNo ${lineNo} is out of range - only ${repeaterState.rowOrder.length} rows available`,
                'lineNo',
                [`Valid range: 1 to ${repeaterState.rowOrder.length}`]
              )
            );
          }

          targetRowBookmark = repeaterState.rowOrder[rowIndex];
          logger.info(`Resolved lineNo ${lineNo} to bookmark: ${targetRowBookmark}`);
        }

        // PROTOCOL FIX: Instead of using SetCurrentRowAndRowsSelection, we pass the bookmark
        // directly in SaveValue's 'key' parameter. This is more reliable and matches how
        // BC web client handles cell edits in existing rows.
        logger.info(`Updating existing line with bookmark: ${targetRowBookmark} (using SaveValue key)`);
      } else {
        // Neither lineBookmark nor lineNo provided - writing to draft row (new line creation)
        logger.info(`Writing to draft row in subpage "${subpage}"`);

        // CORRECT APPROACH from decompiled BC code analysis:
        // BC uses DraftLinePattern/MultipleNewLinesPattern to PRE-CREATE draft rows during LoadForm.
        // Document subforms (Sales Lines, Purchase Lines) have 15+ draft rows at the end.
        //
        // PROTOCOL SEQUENCE:
        // 1. Draft rows already exist from LoadForm (in DataRefreshChange)
        // 2. User clicks into draft row OR we find first available draft row
        // 3. SaveValue populates fields (marks row as Dirty | Draft)
        // 4. AutoInsertPattern automatically commits when user tabs to next field
        //
        // See decompiled:
        // - Microsoft.Dynamics.Nav.Client.UI/Nav/Client/UIPatterns/DraftLinePattern.cs
        // - Microsoft.Dynamics.Nav.Client.UI/Nav/Client/UIPatterns/MultipleNewLinesPattern.cs
        // - Microsoft.Dynamics.Nav.Client.UI/Nav/Client/UIPatterns/AutoInsertPattern.cs
        //
        // SIMPLIFIED APPROACH:
        // Since draft rows exist and BC's web client uses SetCurrentRow with Delta to navigate,
        // we can simply send SaveValue directly to the repeater. BC will:
        // - Position to the next available draft row automatically
        // - Apply the values and mark row as dirty
        // - AutoInsertPattern commits when we move on
        //
        // No explicit row selection needed for NEW lines - BC handles positioning.

        logger.info(`Draft rows should exist from LoadForm - proceeding directly with field writes`);
      }

      // Build column field map from repeater metadata for field validation
      fieldMap = this.buildColumnFieldMap(repeater);
      logger.info(`Built column field map with ${fieldMap.size} columns`);
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
        immediateValidation,
        targetRowBookmark  // Pass bookmark for existing row modification
      );

      if (isOk(result)) {
        updatedFields.push(fieldName);
        logger.info(`Field "${fieldName}" updated successfully`);
      } else {
        const errorMsg = result.error.message;
        const errorWithCtx = result.error as BCErrorWithContext;
        const validationMsg = errorWithCtx.context?.validationMessage;
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

      // Track unsaved changes and record operation in workflow
      if (workflow) {
        workflow.trackUnsavedChanges(fields);
        workflow.recordOperation(
          'write_page_data',
          { pageContextId, fields, subpage, lineBookmark, lineNo },
          { success: true, data: { updatedFields, fieldCount: updatedFields.length } }
        );
      }

      return ok({
        success: true,
        pageContextId,
        saved: false, // This tool never saves - caller must use execute_action("Save")
        message: `Successfully updated ${updatedFields.length} field(s): ${updatedFields.join(', ')}`,
        updatedFields,
      });
    } else if (updatedFields.length > 0) {
      // Partial success

      // Track partial unsaved changes and record operation with errors in workflow
      if (workflow) {
        // Track only the fields that succeeded
        const successfulFieldsObj: Record<string, unknown> = {};
        for (const fieldName of updatedFields) {
          successfulFieldsObj[fieldName] = fields[fieldName];
        }
        workflow.trackUnsavedChanges(successfulFieldsObj);

        // Record operation with partial success
        workflow.recordOperation(
          'write_page_data',
          { pageContextId, fields, subpage, lineBookmark, lineNo },
          {
            success: false,
            error: `Partially updated ${updatedFields.length} field(s). Failed: ${failedFields.map(f => f.field).join(', ')}`,
            data: { updatedFields, failedFields }
          }
        );

        // Record failed fields as errors
        for (const failed of failedFields) {
          workflow.recordError(`Field "${failed.field}": ${failed.error}${failed.validationMessage ? ` - ${failed.validationMessage}` : ''}`);
        }
      }

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

      // Record operation failure and errors in workflow
      if (workflow) {
        const errorMsg = `Failed to update any fields. Errors: ${failedFields.map(f => `${f.field}: ${f.error}`).join('; ')}`;
        workflow.recordOperation(
          'write_page_data',
          { pageContextId, fields, subpage, lineBookmark, lineNo },
          { success: false, error: errorMsg, data: { failedFields } }
        );

        // Record each field failure as an error
        for (const failed of failedFields) {
          workflow.recordError(`Field "${failed.field}": ${failed.error}${failed.validationMessage ? ` - ${failed.validationMessage}` : ''}`);
        }
      }

      return err(
        new ProtocolError(
          `Failed to update any fields. Errors: ${failedFields.map(f => `${f.field}: ${f.error}`).join('; ')}`,
          { pageId, formId, failedFields }
        )
      );
    }
  }

  /**
   * Finds a repeater (subpage) by name using PageState (preferred) or LogicalForm (fallback).
   * Searches by both caption and design name (case-insensitive).
   *
   * Phase 1: Uses PageState if available, falls back to LogicalForm
   * Phase 2: PageState will be required
   */
  private async findRepeaterBySubpage(
    pageContextId: string,
    pageContext: PageContext | undefined,
    subpageName: string
  ): Promise<Result<RepeaterMetadata, BCError>> {
    const logger = moduleLogger.child({ method: 'findRepeaterBySubpage' });

    // Try PageState first (Phase 1: Dual-state approach)
    try {
      const cache = PageContextCache.getInstance();
      const pageState = await cache.getPageState(pageContextId);

      if (pageState) {
        logger.info(`Using PageState for repeater lookup`);

        // Search repeaters Map by name (case-insensitive)
        const searchKey = subpageName.toLowerCase().trim();
        let foundRepeater: RepeaterState | undefined;

        for (const [_key, repeater] of pageState.repeaters.entries()) {
          if (
            repeater.caption?.toLowerCase().trim() === searchKey ||
            repeater.name?.toLowerCase().trim() === searchKey
          ) {
            foundRepeater = repeater;
            break;
          }
        }

        if (foundRepeater) {
          // Convert PageState RepeaterState to RepeaterMetadata for compatibility
          const repeaterMeta: RepeaterMetadata = {
            name: foundRepeater.name,
            caption: foundRepeater.caption,
            controlPath: foundRepeater.controlPath,
            formId: foundRepeater.formId,
            columns: Array.from(foundRepeater.columns.values()).map(col => ({
              caption: col.caption,
              designName: col.designName,
              controlPath: col.controlPath,
              index: col.index,
              controlId: col.controlId,
              visible: col.visible,
              editable: col.editable,
              columnBinderPath: col.columnBinderPath,
            })),
          };

          logger.info(`Found repeater "${repeaterMeta.caption || repeaterMeta.name}" via PageState`);
          logger.info(`  - controlPath: ${repeaterMeta.controlPath}`);
          logger.info(`  - formId: ${repeaterMeta.formId || 'undefined'}`);
          logger.info(`  - columns.length: ${repeaterMeta.columns.length}`);
          logger.info(`  - totalRowCount: ${foundRepeater.totalRowCount || 'undefined'}`);
          logger.info(`  - loaded rows: ${foundRepeater.rows.size}`);
          logger.info(`  - pendingOperations: ${foundRepeater.pendingOperations}`);
          logger.info(`  - isDirty: ${foundRepeater.isDirty}`);

          return ok(repeaterMeta);
        }

        // Not found in PageState - fall through to LogicalForm
        logger.info(`Repeater "${subpageName}" not found in PageState, trying LogicalForm fallback`);
      } else {
        logger.info(`No PageState available, using LogicalForm for repeater lookup`);
      }
    } catch (error) {
      logger.warn(`PageState lookup failed: ${error}, falling back to LogicalForm`);
    }

    // Fallback: Use LogicalForm (original implementation)
    const logicalForm = pageContext?.logicalForm;
    if (!logicalForm) {
      return err(
        new ProtocolError(
          `No cached LogicalForm or PageState available for repeater lookup`,
          { subpageName }
        )
      );
    }

    // Extract repeaters from logicalForm using ControlParser
    const parser = new ControlParser();
    const controls = parser.walkControls(logicalForm);
    const repeaters = parser.extractRepeaters(controls);

    // Search by name (case-insensitive)
    const searchKey = subpageName.toLowerCase().trim();
    const found = repeaters.find(r =>
      r.caption?.toLowerCase().trim() === searchKey ||
      r.name?.toLowerCase().trim() === searchKey
    );

    if (!found) {
      const availableNames = repeaters
        .map(r => r.caption || r.name)
        .filter(Boolean)
        .join(', ');
      return err(
        new InputValidationError(
          `Subpage "${subpageName}" not found on page`,
          'subpage',
          [
            `The subpage/repeater "${subpageName}" does not exist on this page.`,
            `Available subpages: ${availableNames || 'none'}`,
          ]
        )
      );
    }

    // DIAGNOSTIC: Log found repeater metadata
    logger.info(`Found repeater "${found.caption || found.name}" via LogicalForm`);
    logger.info(`  - controlPath: ${found.controlPath}`);
    logger.info(`  - formId: ${found.formId || 'undefined'}`);
    logger.info(`  - columns.length: ${found.columns.length}`);
    if (found.columns.length > 0) {
      logger.info(`  - First 3 columns: ${found.columns.slice(0, 3).map(c => c.caption || c.designName).join(', ')}`);
    } else {
      logger.warn(`  WARNING: Repeater has ZERO columns! This will cause "Cannot find controlPath" error.`);
    }

    return ok(found);
  }

  /**
   * Builds a field map from repeater column metadata.
   * Maps column captions and design names to column metadata.
   */
  private buildColumnFieldMap(repeater: RepeaterMetadata): Map<string, ColumnMetadata> {
    const logger = moduleLogger.child({ method: 'buildColumnFieldMap' });
    const map = new Map<string, ColumnMetadata>();

    // DIAGNOSTIC: Log what we're building from
    logger.info(`Building field map from ${repeater.columns.length} columns`);
    if (repeater.columns.length === 0) {
      logger.warn(`  ⚠️ PROBLEM: No columns to build map from!`);
      return map;
    }

    for (const column of repeater.columns) {
      // Add by caption
      if (column.caption) {
        const key = column.caption.toLowerCase().trim();
        map.set(key, column);
      }

      // Add by design name
      if (column.designName) {
        const key = column.designName.toLowerCase().trim();
        map.set(key, column);
      }
    }

    logger.info(`  Built map with ${map.size} field name mappings`);
    if (map.size > 0) {
      const sampleKeys = Array.from(map.keys()).slice(0, 5);
      logger.info(`  Sample keys: ${sampleKeys.join(', ')}`);
    }

    return map;
  }

  /**
   * Selects a line in a repeater using SetCurrentRowAndRowsSelection.
   * This sets server-side focus to the target row before field updates.
   */
  private async selectLine(
    connection: IBCConnection,
    formId: string,
    repeaterPath: string,
    bookmark: string
  ): Promise<Result<void, BCError>> {
    const logger = createToolLogger('write_page_data', formId);

    logger.info(`Selecting line with bookmark "${bookmark}" in repeater ${repeaterPath}`);

    try {
      await connection.invoke({
        interactionName: 'SetCurrentRowAndRowsSelection',
        namedParameters: {
          key: bookmark,
          selectAll: false,
          rowsToSelect: [bookmark],
          unselectAll: true,
          rowsToUnselect: [],
        },
        controlPath: repeaterPath,
        formId,
        callbackId: '',  // Empty callback for synchronous operations
      });

      logger.info(`Successfully selected line`);
      return ok(undefined);
    } catch (error) {
      logger.error(`Failed to select line: ${error}`);
      return err(
        new ProtocolError(
          `Failed to select line in subpage: ${error}`,
          { repeaterPath, bookmark, error }
        )
      );
    }
  }

  /**
   * Extracts bookmark from DataRefreshChange event (for new line creation).
   * BC sends this async event when a new line is inserted with the new bookmark.
   */
  private extractBookmarkFromDataRefresh(handlers: readonly Handler[]): string | undefined {
    const logger = createToolLogger('write_page_data', 'bookmark-extraction');

    // Look for LogicalClientChangeHandler with DataRefreshChange
    for (const handler of handlers) {
      if (isLogicalClientChangeHandler(handler)) {
        const changes = handler.parameters?.[1] as readonly Change[] | undefined;
        if (Array.isArray(changes)) {
          for (const change of changes) {
            // BC27+ uses full type name 'DataRefreshChange' instead of shorthand 'drch'
            if (isDataRefreshChangeType(change.t)) {
              // Look for DataRowInserted with bookmark
              const dataRefresh = change as DataRefreshChange;
              const rowChanges = dataRefresh.RowChanges || [];
              for (const rowChange of rowChanges) {
                // BC27+ uses full type name 'DataRowInserted' instead of shorthand 'drich'
                if (isDataRowInsertedType(rowChange.t)) {
                  // DataRowInsertedChange has Row: ClientDataRow with Bookmark property
                  const rowData = rowChange.Row;
                  const bookmark = rowData?.Bookmark;
                  if (bookmark) {
                    logger.info(`Extracted bookmark from new line: ${bookmark}`);
                    return bookmark;
                  }
                }
              }
            }
          }
        }
      }
    }

    logger.warn(`No bookmark found in DataRefreshChange handlers`);
    return undefined;
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
    immediateValidation: boolean = true,
    rowBookmark?: string  // Bookmark for existing row modification (null for header/new rows)
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
        key: rowBookmark || null,  // Use bookmark for existing row, null for header/new rows
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
    const asyncHandlerPromise = connection.waitForHandlers<Handler[]>(
      (handlers: Handler[]) => {
        // Look for LogicalClientChangeHandler with PropertyChanges for our field
        const logicalHandler = handlers.find((h) => isLogicalClientChangeHandler(h));

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
      // Suppress the AbortedError from the promise since we're returning early
      asyncHandlerPromise.catch(() => {});
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
      moduleLogger.info(`[PropertyChanges] Sync handler type: ${handler.handlerType}`);
      if (isLogicalClientChangeHandler(handler)) {
        const params = handler.parameters;
        moduleLogger.info(`[PropertyChanges] Found LogicalClientChangeHandler in sync response, params.length=${Array.isArray(params) ? params.length : 'not array'}`);
        if (Array.isArray(params) && params.length >= 2) {
          const changes = params[1] as readonly Change[];
          moduleLogger.info(`[PropertyChanges] Changes is array: ${Array.isArray(changes)}, length: ${changes.length}`);
          for (const change of changes) {
            moduleLogger.info(`[PropertyChanges] Change type: ${change?.t}`);
            // BC uses both "prc" (PropertyChanges) and "prch" (PropertyChange) type ids
            if (isPropertyChanges(change) || isPropertyChange(change)) {
              foundPropertyChangesInSync = true;
              moduleLogger.info(`[PropertyChanges] Found PropertyChange(s) in sync response!`);
              break;
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
    // Use Promise.race with setTimeout as a defensive fallback in case AbortSignal.timeout fails
    const FALLBACK_TIMEOUT_MS = 2000; // Slightly longer than the 1000ms primary timeout
    let asyncHandlers: Handler[] = [];
    try {
      const fallbackTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Fallback timeout')), FALLBACK_TIMEOUT_MS);
      });

      asyncHandlers = await Promise.race([asyncHandlerPromise, fallbackTimeoutPromise]);
      moduleLogger.info(`[PropertyChanges] Received ${asyncHandlers.length} async handlers after SaveValue`);
    } catch (error: unknown) {
      // AbortError means we found PropertyChanges in sync response - this is good!
      // Timeout (either AbortSignal or fallback) means no async handlers - this is also OK for some fields
      const errorObj = error as { name?: string; message?: string } | null;
      if (errorObj?.name === 'AbortError') {
        moduleLogger.info(`[PropertyChanges] Async wait aborted (PropertyChanges already in sync response)`);
      } else if (errorObj?.message === 'Fallback timeout') {
        moduleLogger.info(`[PropertyChanges] Fallback timeout - no async handlers received`);
      } else {
        moduleLogger.info(`[PropertyChanges] No async handlers received (timeout) - this is OK for some fields`);
      }
    }

    // If immediateValidation is enabled, inspect handlers for errors and other messages
    if (immediateValidation) {
      // Cast to GenericBCHandler for checking special handler types not in standard union
      const handlers = result.value as unknown as GenericBCHandler[];

      // Check for BC error messages (blocking errors)
      const errorHandler = handlers.find(
        (h) => h.handlerType === 'DN.ErrorMessageProperties' || h.handlerType === 'DN.ErrorDialogProperties'
      );

      if (errorHandler) {
        const errorParams = errorHandler.parameters?.[0] as Record<string, unknown> | undefined;
        const errorMessage = String(errorParams?.Message || errorParams?.ErrorMessage || 'Unknown error');

        return err(
          new ProtocolError(
            `BC error: ${errorMessage}`,
            { fieldName, value, formId, controlPath, errorHandler, validationMessage: errorMessage, handlerType: 'error' }
          )
        );
      }

      // Check for validation errors (blocking validation)
      const validationHandler = handlers.find(
        (h) => h.handlerType === 'DN.ValidationMessageProperties'
      );

      if (validationHandler) {
        const validationParams = validationHandler.parameters?.[0] as Record<string, unknown> | undefined;
        const validationMessage = String(validationParams?.Message || 'Validation failed');

        return err(
          new ProtocolError(
            `BC validation error: ${validationMessage}`,
            { fieldName, value, formId, controlPath, validationHandler, validationMessage, handlerType: 'validation' }
          )
        );
      }

      // Check for confirmation dialogs (require user interaction)
      const confirmHandler = handlers.find(
        (h) => h.handlerType === 'DN.ConfirmDialogProperties' || h.handlerType === 'DN.YesNoDialogProperties'
      );

      if (confirmHandler) {
        const confirmParams = confirmHandler.parameters?.[0] as Record<string, unknown> | undefined;
        const confirmMessage = String(confirmParams?.Message || confirmParams?.ConfirmText || 'Confirmation required');

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
    const allHandlers: Handler[] = [...result.value, ...asyncHandlers];
    const pageContext = (connection as ConnectionWithPageContexts).pageContexts?.get(pageContextId);

    moduleLogger.info(`[PropertyChanges] SaveValue total handlers: ${allHandlers.length} (sync: ${result.value.length}, async: ${asyncHandlers.length}), pageContext exists: ${!!pageContext}, pageContext.handlers exists: ${!!pageContext?.handlers}`);
    if (allHandlers.length > 0) {
      moduleLogger.info(`[PropertyChanges] Handler types: ${allHandlers.map((h) => h.handlerType).join(', ')}`);
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
        if (isLogicalClientChangeHandler(handler)) {
          foundLogicalHandler = true;
          const params = handler.parameters;
          moduleLogger.info(`[PropertyChanges] Found LogicalClientChangeHandler, params length: ${Array.isArray(params) ? params.length : 'not array'}`);

          if (Array.isArray(params) && params.length >= 2) {
            const formIdParam = params[0];
            const changes = params[1] as readonly Change[];
            moduleLogger.info(`[PropertyChanges] FormId match: request=${formId}, response=${formIdParam}, changes is array: ${Array.isArray(changes)}, changes length: ${changes.length}`);

            // Verify this is for our form
            if (formIdParam === formId) {
              moduleLogger.error(`[CACHE DEBUG] FormId matches! ${changes.length} changes. Looking for controlPath="${controlPath}"`);
              moduleLogger.info(`[PropertyChanges] FormId matches! Processing ${changes.length} changes...`);

              // Process each change
              for (let i = 0; i < changes.length; i++) {
                const change = changes[i];
                const changeWithRef = change as PropertyChanges | PropertyChange;
                // BC27 uses lowercase controlPath, older versions use ControlPath
                const changeControlPath = changeWithRef?.ControlReference?.controlPath ?? changeWithRef?.ControlReference?.ControlPath;
                moduleLogger.error(`[CACHE DEBUG]   Change[${i}]: t=${change?.t}, controlPath=${changeControlPath}`);
                moduleLogger.info(`[PropertyChanges]   Change[${i}].t = ${change?.t}`);

                // BC uses both "prc" (PropertyChanges) and "prch" (PropertyChange) type ids
                if (isPropertyChanges(change)) {
                  // PropertyChanges (batch) - has Changes which can be array OR object (BC27 format)
                  // BC27 uses lowercase controlPath, older versions use ControlPath
                  const responseControlPath = changeWithRef.ControlReference?.controlPath ?? changeWithRef.ControlReference?.ControlPath;
                  moduleLogger.info(`[PropertyChanges]   PropertyChanges (batch) found! controlPath=${responseControlPath}`);

                  // BC27 sends Changes as object with StringValue/ObjectValue properties
                  // Legacy sends Changes as array of PropertyChange items
                  // Cast through unknown since TypeScript types don't reflect BC27's object format
                  const changesValue = change.Changes as unknown;
                  if (Array.isArray(changesValue)) {
                    // Legacy format: array of PropertyChange items
                    for (const innerChange of changesValue as readonly PropertyChange[]) {
                      const updatedValue = innerChange.PropertyValue;
                      moduleLogger.info(`[PropertyChanges]   Inner change: ${innerChange.PropertyName} = ${JSON.stringify(updatedValue)}`);

                      if (updatedValue !== undefined && responseControlPath) {
                        moduleLogger.info(`[PropertyChanges]   Calling updateCachedPropertyChange for controlPath=${responseControlPath}`);
                        const updated = this.updateCachedPropertyChange(pageContext.handlers, formId, responseControlPath, updatedValue);
                        if (updated) cacheUpdated = true;
                        moduleLogger.info(`[PropertyChanges]   updateCachedPropertyChange returned: ${updated}`);
                      }
                    }
                  } else if (changesValue && typeof changesValue === 'object') {
                    // BC27 format: object with StringValue, ObjectValue, DecimalValue etc.
                    const bc27Changes = changesValue as Record<string, unknown>;
                    const updatedValue = bc27Changes.StringValue ?? bc27Changes.ObjectValue ?? bc27Changes.DecimalValue ?? bc27Changes.IntValue ?? bc27Changes.DateTimeValue;
                    moduleLogger.info(`[PropertyChanges]   BC27 format Changes object, extracted value: ${JSON.stringify(updatedValue)}`);

                    if (updatedValue !== undefined && responseControlPath) {
                      moduleLogger.info(`[PropertyChanges]   Calling updateCachedPropertyChange for controlPath=${responseControlPath}`);
                      const updated = this.updateCachedPropertyChange(pageContext.handlers, formId, responseControlPath, updatedValue);
                      if (updated) cacheUpdated = true;
                      moduleLogger.info(`[PropertyChanges]   updateCachedPropertyChange returned: ${updated}`);
                    }
                  }
                } else if (isPropertyChange(change)) {
                  // Single PropertyChange - has PropertyName and PropertyValue directly
                  // BC27 uses lowercase controlPath, older versions use ControlPath
                  const responseControlPath = changeWithRef.ControlReference?.controlPath ?? changeWithRef.ControlReference?.ControlPath;
                  moduleLogger.info(`[PropertyChanges]   PropertyChange found! controlPath=${responseControlPath}`);

                  const updatedValue = change.PropertyValue;
                  moduleLogger.info(`[PropertyChanges]   Extracted value: ${JSON.stringify(updatedValue)}`);

                  if (updatedValue !== undefined && responseControlPath) {
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
    cachedHandlers: Handler[],
    formId: string,
    controlPath: string,
    newValue: unknown
  ): boolean {
    // Find the LogicalClientChangeHandler for this form
    // Cast to mutable types since we need to modify the cache
    const mutableHandlers = cachedHandlers as unknown as MutableHandler[];
    let targetChanges: MutablePropertyChange[] | null = null;

    for (const handler of mutableHandlers) {
      if (handler.handlerType === 'DN.LogicalClientChangeHandler') {
        const params = handler.parameters;
        if (Array.isArray(params) && params.length >= 2) {
          const formIdParam = params[0] as string;
          const changes = params[1] as MutablePropertyChange[];

          if (formIdParam === formId && Array.isArray(changes)) {
            targetChanges = changes;
            break;
          }
        }
      }
    }

    if (!targetChanges) {
      moduleLogger.debug(`[PropertyChanges] No LogicalClientChangeHandler found for formId "${formId}"`);
      return false;
    }

    // Try to find existing PropertyChange for this controlPath
    // BC uses both "prc"/"lcpchs" (PropertyChanges) and "prch"/"lcpch" (PropertyChange) type ids
    let existingChange: MutablePropertyChange | null = null;
    for (const change of targetChanges) {
      const changeControlPath = change.ControlReference?.controlPath || change.ControlReference?.ControlPath;
      if ((isPropertyChangesType(change?.t) || isPropertyChangeType(change?.t)) && changeControlPath === controlPath) {
        existingChange = change;
        break;
      }
    }

    if (existingChange) {
      // UPDATE existing PropertyChange
      const existingControlPath = existingChange.ControlReference?.controlPath || existingChange.ControlReference?.ControlPath;
      moduleLogger.error(`[CACHE DIAGNOSTIC] Found existing change to update: t=${existingChange.t}, controlPath=${existingControlPath}`);
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
      const newPropertyChange: MutablePropertyChange = {
        t: 'prc',
        ControlReference: {
          controlPath,
          ControlPath: controlPath,
          formId
        },
        Changes: {}
      };

      if (typeof newValue === 'string') {
        newPropertyChange.Changes!.StringValue = newValue;
      } else if (typeof newValue === 'number') {
        newPropertyChange.Changes!.DecimalValue = newValue;
        newPropertyChange.Changes!.IntegerValue = newValue;
      } else if (typeof newValue === 'boolean') {
        newPropertyChange.Changes!.BooleanValue = newValue;
      } else if (typeof newValue === 'object') {
        newPropertyChange.Changes!.ObjectValue = newValue;
      }

      targetChanges.push(newPropertyChange);
      moduleLogger.debug(`[PropertyChanges] Inserted new PropertyChange for controlPath "${controlPath}"`);
      return true;
    }
  }
}
