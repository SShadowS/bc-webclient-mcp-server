/**
 * Read Page Data MCP Tool
 *
 * Reads data records from a BC page (both card and list types).
 * Extracts field values using PageDataExtractor.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection, ILogger } from '../core/interfaces.js';
import type { ReadPageDataOutput } from '../types/mcp-types.js';
import { ReadPageDataInputSchema, type ReadPageDataInput } from '../validation/schemas.js';
import { PageDataExtractor, type PageRecord } from '../parsers/page-data-extractor.js';
import { HandlerParser } from '../parsers/handler-parser.js';
import { decompressResponse } from '../util/loadform-helpers.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';
import { PageContextCache } from '../services/page-context-cache.js';
import { FilterMetadataService } from '../services/filter-metadata-service.js';
import { ColumnEnrichmentService } from '../services/column-enrichment-service.js';
import { defaultTimeouts } from '../core/timeouts.js';
import { createWorkflowIntegration } from '../services/workflow-integration.js';
import type { LogicalForm, Control, Handler, LogicalClientChangeHandler } from '../types/bc-types.js';
import type { Change, DataRefreshChange, ControlTypeId } from '../types/bc-protocol-types.js';
import { isDataRefreshChange } from '../types/bc-protocol-types.js';
import { isPropertyChangesType } from '../types/bc-type-discriminators.js';
import type { Logger as PinoLogger } from 'pino';

/**
 * Type guard for LogicalClientChangeHandler
 */
function isLogicalClientChangeHandler(handler: Handler): handler is LogicalClientChangeHandler {
  return handler.handlerType === 'DN.LogicalClientChangeHandler';
}

/**
 * Helper interface for page context stored on connection
 */
interface PageContext {
  sessionId: string;
  pageId: string;
  formIds: string[];
  openedAt: number;
  pageType?: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report';
  logicalForm?: LogicalForm;
  handlers: Handler[];
  needsRefresh?: boolean;
}

/**
 * Extended connection interface with pageContexts map
 */
interface ConnectionWithPageContexts extends IBCConnection {
  pageContexts?: Map<string, PageContext>;
}

/**
 * Flattened record format for output and filtering
 * Converted from PageRecord by extracting field values to top-level properties
 */
interface FlatRecord {
  bookmark?: string;
  [fieldName: string]: unknown;
}

/**
 * MCP Tool: read_page_data
 *
 * Reads data records from a BC page with optional filtering.
 */
export class ReadPageDataTool extends BaseMCPTool {
  public readonly name = 'read_page_data';

  public readonly description =
    'Reads data records from a Business Central page using an existing pageContextId from get_page_metadata. ' +
    'IMPORTANT: BC filters trigger server-side database queries. After applying filters, must wait for DataRefreshChange with filtered results. ' +
    'For record-specific navigation, use get_page_metadata with bookmark parameter (faster and more reliable). ' +
    'filters: Optional object where keys are field names/captions and values specify filter criteria. ' +
    'Filters are sent to BC server and trigger ExecuteFilter() → BindingManager.Fill() → GetPage() with database-level filtering. ' +
    'Simple format: {"No.": "10000"} for equality. Advanced: {"No.": {operator: "=", value: "10000"}}. ' +
    'Supported operators: = (equals), != (not equals), contains, startsWith, >= (greater/equal), <= (less/equal), between (provide [min, max]). ' +
    'Multiple filters are combined with AND logic. ' +
    'setCurrent: If true and exactly ONE record matches (after filtering), sets it as the current record for subsequent operations. ' +
    'Returns error if 0 or multiple records match when setCurrent=true. ' +
    'Returns: {records: [...], total?, nextOffset?} for pagination support.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Required page context ID from get_page_metadata',
      },
      filters: {
        type: 'object',
        description: 'Filter records by field values (operators: =, !=, contains, startsWith, >=, <=, between)',
        additionalProperties: true,
      },
      setCurrent: {
        type: 'boolean',
        description: 'Set found record as current (requires single match)',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of records to return',
      },
      offset: {
        type: 'number',
        description: 'Number of records to skip (for pagination)',
      },
      workflowId: {
        type: 'string',
        description: 'Optional workflow ID to track this operation. Records data reads for workflow audit trail.',
      },
    },
    required: ['pageContextId'],
  };

  // Consent configuration - Read-only data operation, no consent needed
  public readonly requiresConsent = false;
  public readonly sensitivityLevel = 'low' as const;

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    },
    private readonly dataExtractor: PageDataExtractor = new PageDataExtractor(),
    private readonly handlerParser: HandlerParser = new HandlerParser()
  ) {
    super({ inputZod: ReadPageDataInputSchema });
  }

  // ============================================================================
  // Filter Support Methods
  // ============================================================================

  /**
   * Finds the repeater control path in a LogicalForm.
   * Returns the control path for the main list repeater.
   */
  private findRepeaterControlPath(logicalForm: LogicalForm): string | null {
    let repeaterPath: string | null = null;

    const walkControl = (control: Control | LogicalForm, path: string): void => {
      if (!control || typeof control !== 'object') return;

      // Check if this is a repeater control
      const controlType = control.t as string;
      if (controlType === 'rc' || controlType === 'lrc') {
        // Found a repeater - use this path
        if (!repeaterPath) {
          repeaterPath = path;
        }
        return; // Don't walk into repeater children
      }

      // Walk children with updated paths
      if (Array.isArray(control.Children)) {
        for (let i = 0; i < control.Children.length; i++) {
          const childPath = path ? `${path}:c[${i}]` : `c[${i}]`;
          walkControl(control.Children[i], childPath);
        }
      }
    };

    // Start walk from root
    walkControl(logicalForm, 'server');
    return repeaterPath;
  }

  /**
   * Extracts field metadata from a LogicalForm.
   * Returns a map of field name to FieldMetadata for all filterable fields.
   *
   * Walks the LogicalForm tree and extracts metadata from RepeaterColumnControls
   * and other field controls. This metadata is used for filter pre-validation.
   */
  /**
   * Finds the FilterLogicalControl in the LogicalForm metadata.
   * In BC27, this control has type 'filc' and is typically at server:c[2].
   *
   * @param logicalForm The root LogicalForm object
   * @returns Path to FilterLogicalControl (e.g., "server:c[2]") or null if not found
   */
  private findFilterLogicalControl(logicalForm: LogicalForm): string | null {
    // Search top-level children for type 'filc' (FilterLogicalControl)
    if (!Array.isArray(logicalForm.Children)) {
      return null;
    }

    for (let i = 0; i < logicalForm.Children.length; i++) {
      const child = logicalForm.Children[i];

      // BC27: FilterLogicalControl has type 'filc'
      if (child.t === 'filc') {
        return `server:c[${i}]`;
      }
    }

    return null;
  }

  private extractFieldMetadata(logicalForm: LogicalForm): Map<string, import('../types/bc-types.js').FieldMetadata> {
    const fields = new Map<string, import('../types/bc-types.js').FieldMetadata>();

    // Recursive walker that extracts field metadata
    const walkControl = (control: Control | LogicalForm): void => {
      if (!control || typeof control !== 'object') return;

      const controlType = control.t as string;

      // Special handling for repeater control ('rc') with Columns array
      if (controlType === 'rc' && Array.isArray(control.Columns)) {
        for (const column of control.Columns) {
          const fieldName = column.DesignName || column.Caption;
          if (fieldName) {
            fields.set(fieldName, {
              type: column.t || 'rcc',
              caption: column.Caption,
              name: column.DesignName || column.Caption,
              controlId: column.ControlId,
              enabled: column.Editable !== false,
              visible: column.Visible !== false,
              readonly: column.ReadOnly === true,
              options: column.Options,
              // CRITICAL: Use pre-formatted ColumnBinderPath as filterColumnId
              // Format is already "{tableId}_{tableName}.{fieldId}" (e.g., "36_Sales Header.3")
              filterColumnId: column.ColumnBinderPath,
            });
          }
        }
      }

      // Also extract from other field control types for non-list pages
      const fieldTypes = ['sc', 'dc', 'bc', 'i32c', 'sec', 'dtc', 'pc'];
      if (fieldTypes.includes(controlType)) {
        // Access properties with type safety
        const ctrlRecord = control as Record<string, unknown>;
        const fieldName = String(ctrlRecord.DesignName || ctrlRecord.Name || ctrlRecord.Caption || '');
        if (fieldName && !fields.has(fieldName)) {
          fields.set(fieldName, {
            type: controlType as import('../types/bc-types.js').ControlType,
            caption: typeof ctrlRecord.Caption === 'string' ? ctrlRecord.Caption : undefined,
            name: String(ctrlRecord.Name || ctrlRecord.DesignName || ''),
            controlId: String(ctrlRecord.ID || ctrlRecord.ControlIdentifier || ''),
            enabled: ctrlRecord.Enabled !== false,
            visible: ctrlRecord.Visible !== false,
            readonly: ctrlRecord.ReadOnly === true,
            options: ctrlRecord.Options as readonly string[] | undefined,
          });
        }
      }

      // Walk children recursively
      if (Array.isArray(control.Children)) {
        for (const child of control.Children) {
          walkControl(child);
        }
      }
    };

    // Start walk from root
    walkControl(logicalForm);
    return fields;
  }

  /**
   * Builds filterColumnId in BC's format: "{tableId}_{tableName}.{fieldId}"
   *
   * Examples:
   * - "18_Customer.1" (Customer No.)
   * - "36_Sales Header.3" (Sales Order No.)
   * - "36_Sales Header.79.79" (Sales Order Sell-to Customer No.)
   *
   * Format rules:
   * - If fieldId === dataColumnNo: single segment ".{fieldId}"
   * - If fieldId !== dataColumnNo: double segment ".{dataColumnNo}.{fieldId}"
   */
  private buildFilterColumnId(fieldMeta: {
    sourceTable?: string;
    sourceTableID?: number;
    fieldId?: number | null;
    dataColumnNo?: number | null;
  }): string {
    const tablePart = `${fieldMeta.sourceTableID}_${fieldMeta.sourceTable}`;

    const fieldId = fieldMeta.fieldId ?? fieldMeta.dataColumnNo;
    const dataColumnNo = fieldMeta.dataColumnNo ?? fieldMeta.fieldId;

    if (fieldId == null && dataColumnNo == null) {
      throw new Error(
        `Cannot build filterColumnId: both fieldId and dataColumnNo are null/undefined for ${fieldMeta.sourceTable}`
      );
    }

    // If both exist and are different, use double segment
    if (
      fieldMeta.fieldId != null &&
      fieldMeta.dataColumnNo != null &&
      fieldMeta.fieldId !== fieldMeta.dataColumnNo
    ) {
      return `${tablePart}.${fieldMeta.dataColumnNo}.${fieldMeta.fieldId}`;
    }

    // Otherwise use single segment
    return `${tablePart}.${fieldId}`;
  }

  /**
   * Applies filters to a list page before reading data.
   * Uses BC's Filter + SaveValue protocol.
   *
   * OPTIMIZATION: Caches filter state to skip redundant Filter/SaveValue calls.
   * This is the highest-value optimization (validated by GPT-5.1 analysis).
   *
   * Filter format:
   * - Simple: { "No.": "10000" } → equality filter
   * - Advanced: { "No.": { operator: "=", value: "10000" } }
   *
   * Supported operators: =, !=, contains, startsWith, >=, <=, between
   */
  private async applyFilters(
    connection: IBCConnection,
    filters: Record<string, unknown>,
    repeaterPath: string,
    sessionId: string,
    pageId: string,
    logger: PinoLogger,
    logicalForm: LogicalForm,
    formId: string
  ): Promise<Result<{ filteredHandlers?: Handler[] }, BCError>> {
    if (!filters || Object.keys(filters).length === 0) {
      return ok({});
    }

    logger.info(`Applying ${Object.keys(filters).length} filter(s) using QuickFilter (Path A)...`);

    // CRITICAL: Set up async handler wait BEFORE applying filters
    // BC sends DataRefreshChange with filtered data AFTER SaveValue completes
    const asyncDataPromise = connection.waitForHandlers(
      (handlers: Handler[]) => {
        const matched =
          Array.isArray(handlers) &&
          handlers.some(
            (h) =>
              isLogicalClientChangeHandler(h) &&
              Array.isArray(h.parameters) &&
              h.parameters.length >= 2 &&
              Array.isArray(h.parameters[1]) &&
              (h.parameters[1] as Change[]).some((p) => isDataRefreshChange(p))
          );
        logger.info(`[applyFilters] DataRefreshChange check: matched=${matched}, handlers=${handlers.length}`);
        return { matched, data: matched ? handlers : undefined };
      },
      { timeoutMs: defaultTimeouts.readOpTimeoutMs }
    );

    // Find FilterLogicalControl for Path A (QuickFilter)
    const filterControlPath = this.findFilterLogicalControl(logicalForm);
    if (!filterControlPath) {
      logger.warn('FilterLogicalControl (filc) not found - QuickFilter not supported on this page');
      return err(
        new ProtocolError(
          'QuickFilter is not supported on this page (no FilterLogicalControl found)',
          { pageId, filterControlPath: null }
        )
      );
    }

    logger.info(`Found FilterLogicalControl at: ${filterControlPath}`);

    // Get cached filter state (Phase 1: Filter State Cache)
    const filterService = FilterMetadataService.getInstance();
    const filterState = filterService.getFilterState(sessionId, pageId);
    let filtersApplied = false;

    // Get or compute field metadata (Phase 3: Field Metadata Cache)
    const fieldMetadata = await filterService.getOrComputeFieldMetadata(
      pageId,
      logicalForm,
      (form) => this.extractFieldMetadata(form as LogicalForm)
    );

    // Pre-validate filter fields (Phase 3: Field Metadata Cache)
    const invalidFields: string[] = [];
    for (const fieldName of Object.keys(filters)) {
      if (!fieldMetadata.has(fieldName)) {
        invalidFields.push(fieldName);
      }
    }

    if (invalidFields.length > 0) {
      const availableFields = Array.from(fieldMetadata.keys()).sort();
      return err(
        new ProtocolError(
          `Invalid filter field(s): ${invalidFields.join(', ')}. ` +
            `Available fields: ${availableFields.join(', ')}`,
          { invalidFields, availableFields }
        )
      );
    }

    // Apply each filter atomically using Path A (QuickFilter)
    for (const [columnName, filterSpec] of Object.entries(filters)) {
      try {
        // Get Control ID for the column - CRITICAL for Path A (QuickFilter)
        const fieldMeta = fieldMetadata.get(columnName);
        if (!fieldMeta || !fieldMeta.controlId) {
          logger.warn(`    Skipping "${columnName}" - could not determine Control ID`);
          continue;
        }

        // Parse filter spec (simple string/number or { operator, value })
        let operator = '=';
        let value: string | number | unknown[] | unknown;

        if (typeof filterSpec === 'object' && filterSpec !== null && 'operator' in filterSpec) {
          const spec = filterSpec as { operator?: string; value?: unknown };
          operator = spec.operator || '=';
          value = spec.value;
        } else {
          value = filterSpec;
        }

        // CHECK CACHE: Skip if filter already applied with same operator and value
        const cached = filterState.get(columnName);
        if (cached && cached.operator === operator && cached.value === value) {
          logger.info(`  Skipping "${columnName}" ${operator} "${value}" - already active (cached)`);
          continue;
        }

        // Translate operator to BC filter syntax
        let bcFilterValue: string;
        switch (operator.toLowerCase()) {
          case '=':
          case 'equals':
            bcFilterValue = String(value);
            break;
          case '!=':
          case 'notequals':
            bcFilterValue = `<>${value}`;
            break;
          case 'contains':
            bcFilterValue = `*${value}*`;
            break;
          case 'startswith':
            bcFilterValue = `${value}*`;
            break;
          case '>=':
            bcFilterValue = `>=${value}`;
            break;
          case '<=':
            bcFilterValue = `<=${value}`;
            break;
          case '>':
            bcFilterValue = `>${value}`;
            break;
          case '<':
            bcFilterValue = `<${value}`;
            break;
          case 'between':
            // Expects value to be [min, max]
            if (Array.isArray(value) && value.length === 2) {
              bcFilterValue = `${value[0]}..${value[1]}`;
            } else {
              logger.warn(`    Invalid 'between' value for "${columnName}": expected [min, max]`);
              continue;
            }
            break;
          case '..':
          case 'range':
            // Range filter: accepts "min..max" string or [min, max] array
            if (typeof value === 'string' && value.includes('..')) {
              // Value is already in BC range format like "101002..101005"
              bcFilterValue = value;
            } else if (Array.isArray(value) && value.length === 2) {
              // Value is [min, max] array
              bcFilterValue = `${value[0]}..${value[1]}`;
            } else {
              logger.warn(`    Invalid range value for "${columnName}": expected "min..max" string or [min, max] array`);
              continue;
            }
            break;
          default:
            logger.warn(`    Unsupported operator "${operator}" for "${columnName}"`);
            continue;
        }

        // Get pre-formatted filterColumnId from field metadata
        const filterColumnId = fieldMeta.filterColumnId;

        if (!filterColumnId) {
          logger.warn(`    No filterColumnId found for "${columnName}" - skipping filter`);
          continue;
        }

        logger.info(`  Filter: "${columnName}" → filterColumnId="${filterColumnId}", value="${bcFilterValue}"`);

        // STEP 1: Filter(AddLine) - Create filter row in BC UI
        // CRITICAL: namedParameters MUST be JSON STRING, not object!
        const filterNamedParams = JSON.stringify({
          filterOperation: 1,           // 1 = AddLine (NOT 0 = Execute!)
          filterColumnId: filterColumnId,
        });

        logger.info(`  → Step 1: Filter(AddLine) with params: ${filterNamedParams}`);

        const filterResult = await connection.invoke({
          interactionName: 'Filter',
          namedParameters: filterNamedParams,    // JSON string!
          controlPath: filterControlPath,        // e.g., "server:c[2]" (FilterLogicalControl)
          callbackId: '0',
          formId: formId,
        });

        if (!isOk(filterResult)) {
          logger.warn(`    Step 1 failed for "${columnName}": ${filterResult.error.message}`);
          continue;
        }

        logger.info(`    ✓ Step 1 complete: Filter row created`);

        // STEP 2: SaveValue - Set the actual filter value
        // Determine SaveValue controlPath (pragmatic pattern for now)
        // Pattern: "{filterControlPath}/c[2]/c[1]"
        // Example: "server:c[2]/c[2]/c[1]"
        const saveValueControlPath = `${filterControlPath}/c[2]/c[1]`;

        const saveValueNamedParams = JSON.stringify({
          key: null,
          newValue: bcFilterValue,
          alwaysCommitChange: true,
          ignoreForSavingState: true,
          notifyBusy: 1,
          telemetry: {
            'Control name': fieldMeta.caption || fieldMeta.name || columnName,
            QueuedTime: new Date().toISOString(),
          },
        });

        logger.info(`  → Step 2: SaveValue to ${saveValueControlPath} with value="${bcFilterValue}"`);

        const saveValueResult = await connection.invoke({
          interactionName: 'SaveValue',
          namedParameters: saveValueNamedParams,  // JSON string!
          controlPath: saveValueControlPath,
          callbackId: '0',
          formId: formId,
        });

        if (!isOk(saveValueResult)) {
          logger.warn(`    Step 2 failed for "${columnName}": ${saveValueResult.error.message}`);
          continue;
        }

        logger.info(`    ✓ Step 2 complete: Filter value set`);
        logger.info(`    ✅ Filter applied successfully: "${columnName}" ${operator} "${value}"`);

        // UPDATE CACHE: Track successfully applied filter
        filterState.set(columnName, { operator, value });
        filtersApplied = true;

        // Small delay to allow server state to settle if applying multiple filters
        if (Object.keys(filters).length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (error) {
        logger.warn(`    Error applying filter for "${columnName}": ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
    }

    // Save filter state regardless of whether new filters were applied
    if (filtersApplied || filterState.size > 0) {
      filterService.setFilterState(sessionId, pageId, filterState);
    }

    if (filtersApplied) {
      logger.info('✅ All filters applied using two-step protocol (Filter AddLine + SaveValue)');
      logger.info('   Waiting for BC to send DataRefreshChange with filtered data...');

      // CRITICAL: Wait for the NEW DataRefreshChange with filtered data
      // This promise was set up BEFORE we started applying filters
      try {
        const filteredHandlers = await asyncDataPromise;
        logger.info(`   ✓ Received DataRefreshChange with filtered data (${(filteredHandlers as any[]).length} handlers)`);

        // Return the new filtered handlers to replace cached ones
        return ok({ filteredHandlers: filteredHandlers as any[] });
      } catch (error) {
        logger.warn(`   Timeout waiting for DataRefreshChange: ${error instanceof Error ? error.message : String(error)}`);
        logger.warn(`   Filters may not have executed server-side - returning empty result`);
        return ok({});
      }
    } else {
      logger.info('No new filters applied (all cached or empty)');
      return ok({});
    }
  }

  /**
   * Applies setCurrent functionality by navigating BC to a specific record using bookmark-based SetSelection.
   * Enforces "single match" requirement and calls SetCurrentRowAndRowsSelection interaction.
   *
   * @param connection BC WebSocket connection
   * @param records Array of flat records with bookmark field
   * @param filters Filter criteria to identify the target record
   * @param repeaterPath Control path to the repeater (from findRepeaterControlPath)
   * @param formId Form ID containing the list
   * @param logger Logger instance
   * @returns Result with bookmark on success, or error if validation fails
   */
  private async applySetCurrent(
    connection: IBCConnection,
    records: FlatRecord[],
    filters: Record<string, unknown> | undefined,
    repeaterPath: string,
    formId: string,
    logger: PinoLogger
  ): Promise<Result<{ bookmark: string }, BCError>> {
    // Require filters for setCurrent
    if (!filters || Object.keys(filters).length === 0) {
      return err(
        new ProtocolError(
          'setCurrent requires filters to identify which record to select',
          { setCurrent: true, filtersProvided: false }
        )
      );
    }

    // Helper function to check if a record matches all filters
    const matchesFilters = (record: FlatRecord): boolean => {
      for (const [fieldName, filterSpec] of Object.entries(filters)) {
        const recordValue = record[fieldName];

        // Handle both simple value and operator-based filter specs
        let operator = '=';
        let filterValue: unknown;

        if (typeof filterSpec === 'object' && filterSpec !== null && 'operator' in filterSpec) {
          const spec = filterSpec as { operator?: string; value?: unknown };
          operator = spec.operator || '=';
          filterValue = spec.value;
        } else {
          filterValue = filterSpec;
        }

        // Apply operator-based matching
        switch (operator) {
          case '=':
          case 'equals':
            if (recordValue !== filterValue) return false;
            break;
          case '!=':
          case 'notEquals':
            if (recordValue === filterValue) return false;
            break;
          case 'contains':
            if (!String(recordValue).toLowerCase().includes(String(filterValue).toLowerCase())) return false;
            break;
          case 'startsWith':
            if (!String(recordValue).toLowerCase().startsWith(String(filterValue).toLowerCase())) return false;
            break;
          case '>=':
            if ((recordValue as number) < (filterValue as number)) return false;
            break;
          case '<=':
            if ((recordValue as number) > (filterValue as number)) return false;
            break;
          case 'between':
            if (!Array.isArray(filterValue) || filterValue.length !== 2) return false;
            if ((recordValue as number) < (filterValue[0] as number) || (recordValue as number) > (filterValue[1] as number)) return false;
            break;
          default:
            logger.warn(`Unknown filter operator: ${operator}, treating as equals`);
            if (recordValue !== filterValue) return false;
        }
      }
      return true;
    };

    // Find matching records
    const matches = records.filter(record => matchesFilters(record));

    // Validate exactly one match
    if (matches.length === 0) {
      return err(
        new ProtocolError(
          'setCurrent failed: No records match the provided filters',
          { filters, totalRecords: records.length }
        )
      );
    }

    if (matches.length > 1) {
      return err(
        new ProtocolError(
          `setCurrent failed: Multiple records match filters (found ${matches.length}). Provide more specific filters to select exactly one record`,
          { filters, matchCount: matches.length }
        )
      );
    }

    // Extract bookmark from the single matching record
    const targetRecord = matches[0];
    const bookmark = targetRecord.bookmark;

    if (!bookmark) {
      return err(
        new ProtocolError(
          'setCurrent failed: Record does not have a bookmark field',
          { record: targetRecord }
        )
      );
    }

    logger.info(`setCurrent: Found single matching record with bookmark: ${bookmark}`);

    // Call SetCurrentRowAndRowsSelection interaction
    const setCurrentInteraction = {
      interactionName: 'SetCurrentRowAndRowsSelection',
      skipExtendingSessionLifetime: false,
      namedParameters: JSON.stringify({
        key: bookmark,
        selectAll: false,
        rowsToSelect: [bookmark],
        unselectAll: true,
        rowsToUnselect: [],
      }),
      controlPath: repeaterPath,
      formId: formId,
      callbackId: '0',
    };

    logger.info(`Invoking SetCurrentRowAndRowsSelection with bookmark: ${bookmark}`);
    const setCurrentResult = await connection.invoke(setCurrentInteraction);

    if (!isOk(setCurrentResult)) {
      return err(
        new ProtocolError(
          `setCurrent failed: SetCurrentRowAndRowsSelection interaction failed: ${setCurrentResult.error.message}`,
          { bookmark, interaction: 'SetCurrentRowAndRowsSelection' }
        )
      );
    }

    logger.info(`Successfully set current record to bookmark: ${bookmark}`);
    return ok({ bookmark });
  }

  /**
   * Executes the tool to read page data.
   * Input is pre-validated by BaseMCPTool using Zod schema.
   */
  protected async executeInternal(input: unknown): Promise<Result<ReadPageDataOutput, BCError>> {
    // Input is already validated by BaseMCPTool with Zod
    const { pageContextId, filters, setCurrent, limit, offset, workflowId } = input as ReadPageDataInput & { workflowId?: string };
    const logger = createToolLogger('read_page_data', pageContextId);

    // Create workflow integration if workflowId provided
    const workflow = createWorkflowIntegration(workflowId);

    logger.info(`Reading data using pageContext: "${pageContextId}"`);

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;
    let pageId: string;

    // Extract sessionId from pageContextId (format: sessionId:page:pageId:timestamp)
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

    // Page is already open (from get_page_metadata), no need to open again
    // Get the page context to access the form IDs and cached handlers
    const connWithContexts = connection as ConnectionWithPageContexts;
    const pageContext = connWithContexts.pageContexts?.get(pageContextId);
    const formIds = pageContext?.formIds || [];
    const cachedHandlers = pageContext?.handlers; // Handlers from get_page_metadata (includes LoadForm data)

    logger.info(`Using existing page context with ${formIds.length} open forms`);

    let handlers: readonly Handler[];

    // Check if page needs refresh (e.g., after execute_action changed state)
    const needsRefresh = pageContext?.needsRefresh === true;

    // Validate that cached handlers contain actual data (not just metadata)
    const hasDataHandlers = Array.isArray(cachedHandlers) && cachedHandlers.some((h) =>
      isLogicalClientChangeHandler(h) && Array.isArray(h.parameters?.[1]) &&
      (h.parameters[1] as Change[]).some((c) => {
        // Check for DataRefreshChange with row data
        if (isDataRefreshChange(c) && Array.isArray(c.RowChanges) && c.RowChanges.length > 0) {
          return true;
        }
        // Check for PropertyChanges with actual values
        // BC27+ uses full type name 'PropertyChanges' instead of shorthand 'lcpchs'
        // BC27 sends Changes as an OBJECT (not array) with StringValue/ObjectValue directly
        if (isPropertyChangesType(c.t)) {
          const changes = (c as unknown as { Changes?: Record<string, unknown> | readonly { StringValue?: unknown; ObjectValue?: unknown; DecimalValue?: unknown }[] }).Changes;
          if (changes) {
            // BC27 format: Changes is an object with StringValue/ObjectValue properties
            if (!Array.isArray(changes)) {
              return (changes as Record<string, unknown>).StringValue !== undefined ||
                     (changes as Record<string, unknown>).ObjectValue !== undefined ||
                     (changes as Record<string, unknown>).DecimalValue !== undefined;
            }
            // Legacy format: Changes is an array
            if (changes.length > 0) {
              const firstChange = changes[0];
              return firstChange?.StringValue !== undefined ||
                     firstChange?.ObjectValue !== undefined ||
                     firstChange?.DecimalValue !== undefined;
            }
          }
        }
        return false;
      })
    );

    // Use cached handlers if available, not stale, AND contains actual data
    // get_page_metadata now calls LoadForm and caches all handlers including async data
    if (cachedHandlers && cachedHandlers.length > 0 && !needsRefresh && hasDataHandlers) {
      logger.info(`Using ${cachedHandlers.length} cached handlers (includes data changes)`);
      handlers = cachedHandlers;
    } else if (needsRefresh || (cachedHandlers && !hasDataHandlers)) {
      // After action execution OR cached handlers lack data - call LoadForm
      logger.info(`${needsRefresh ? 'Page needs refresh' : 'Cached handlers missing data'}, calling LoadForm...`);
      const mainFormId = formIds[0];
      const loadFormResult = await connection.invoke({
        interactionName: 'LoadForm',
        formId: mainFormId,
        controlPath: `server:`,
        callbackId: '0',
        namedParameters: { loadData: true },
      });

      if (isOk(loadFormResult)) {
        logger.info(`LoadForm returned ${loadFormResult.value.length} handlers`);
        handlers = loadFormResult.value;

        // Enrich page context with any column metadata from LoadForm response
        const enrichmentService = ColumnEnrichmentService.getInstance();
        const enrichment = await enrichmentService.enrichFromResponse(
          pageContextId,
          { handlers: loadFormResult.value }
        );
        if (enrichment.enriched) {
          logger.info(`Discovered columns for ${enrichment.repeaterCount} repeater(s)`);
        }

        // Update cached handlers and clear refresh flag
        if (pageContext) {
          pageContext.handlers = handlers as any;
          pageContext.needsRefresh = false;
          logger.info(`Updated cached handlers and cleared refresh flag`);
        }
      } else {
        // CRITICAL FIX: LoadForm failure means page state is invalid/stale
        // Using stale cached handlers guarantees wrong data - MUST propagate error
        // Per GPT-5 analysis: This indicates session/page instance mismatch, NOT recoverable
        logger.error(`LoadForm failed - page instance invalid: ${loadFormResult.error.message}`);
        return err(
          new ProtocolError(
            `Failed to refresh page data: ${loadFormResult.error.message}`,
            {
              pageContextId,
              formId: formIds[0],
              originalError: loadFormResult.error.message,
            }
          )
        );
      }
    } else {
      // Legacy fallback: Call RefreshForm to get current data
      logger.info(`No cached handlers, falling back to RefreshForm`);
      const refreshResult = await connection.invoke({
        interactionName: 'RefreshForm',
        namedParameters: {},
        controlPath: 'server:c[0]',
        callbackId: '0',
      });

      if (isOk(refreshResult)) {
        logger.info(`Page refreshed, received ${refreshResult.value.length} handlers`);
        handlers = refreshResult.value;
      } else {
        // Fall back - invoke a simple interaction to get current state
        logger.info(`RefreshForm failed, getting current state`);
        const stateResult = await connection.invoke({
          interactionName: 'GetState',
          namedParameters: {},
          controlPath: 'server:c[0]',
          callbackId: '0',
        });
        if (isOk(stateResult)) {
          handlers = stateResult.value;
        } else {
          // No handlers available
          handlers = [];
        }
      }
    }

    // Use cached LogicalForm and pageType from page context
    // (avoids needing to re-extract from refresh handlers which don't contain FormToShow)
    const cachedLogicalForm = pageContext?.logicalForm;
    const cachedPageType = pageContext?.pageType;

    let logicalForm: LogicalForm | undefined = cachedLogicalForm;

    if (!cachedLogicalForm) {
      // Fallback: try to extract from handlers if not cached
      const logicalFormResult = this.handlerParser.extractLogicalForm(handlers as Handler[]);
      if (!isOk(logicalFormResult)) {
        return err(
          new ProtocolError(
            `Failed to extract LogicalForm for page ${pageId}. Page context may be stale. Please call get_page_metadata again.`,
            { pageId }
          )
        );
      }
      logicalForm = logicalFormResult.value;
    }

    // At this point logicalForm is guaranteed to be defined (either cached or extracted)
    if (!logicalForm) {
      return err(
        new ProtocolError(
          `Failed to obtain LogicalForm for page ${pageId}. Page context may be stale.`,
          { pageId }
        )
      );
    }
    const caption = logicalForm.Caption || `Page ${pageId}`;

    logger.info(`LogicalForm: ${caption}`);

    // Check for Document page type FIRST (Sales Order, Purchase Order, etc.)
    const isDocumentPage = cachedPageType === 'Document';
    if (isDocumentPage) {
      logger.info(`Page type: Document - extracting header + lines`);

      // setCurrent is not supported on Document pages
      if (setCurrent) {
        return err(
          new ProtocolError(
            'setCurrent is only supported on List pages, not Card/Document pages',
            { pageType: 'Document', setCurrent: true }
          )
        );
      }

      const extractionResult = this.dataExtractor.extractDocumentPageData(logicalForm, handlers);

      if (!isOk(extractionResult)) {
        return extractionResult as Result<never, BCError>;
      }

      const { header, linesBlocks, totalCount } = extractionResult.value;
      logger.info(`Extracted Document page: ${Object.keys(header.fields || {}).length} header fields, ${linesBlocks.length} lines block(s)`);

      // Flatten header: {bookmark, fields: {name: FieldValue}} -> {bookmark, name: value}
      const flatHeader: Record<string, any> = { bookmark: header.bookmark };
      for (const [name, fieldValue] of Object.entries(header.fields)) {
        // Handle both wrapped {value: x} and primitive values
        flatHeader[name] = typeof fieldValue === 'object' && fieldValue !== null && 'value' in fieldValue
          ? (fieldValue as any).value
          : fieldValue;
      }

      // Flatten linesBlocks too
      const flatLinesBlocks = linesBlocks.map(block => ({
        ...block,
        lines: block.lines.map(line => {
          const flatLine: Record<string, any> = { bookmark: line.bookmark };
          for (const [name, fieldValue] of Object.entries(line.fields)) {
            // Handle both wrapped {value: x} and primitive values
            flatLine[name] = typeof fieldValue === 'object' && fieldValue !== null && 'value' in fieldValue
              ? (fieldValue as any).value
              : fieldValue;
          }
          return flatLine;
        }),
      }));

      // Return structured output with header + lines
      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'Document',
        header: flatHeader,
        linesBlocks: flatLinesBlocks,
        records: [flatHeader], // Backwards compatibility
        totalCount,
      } as any);
    }

    // Use cached page type if available, otherwise detect from LogicalForm
    const isListPage = cachedPageType === 'List' || cachedPageType === 'Worksheet' || this.dataExtractor.isListPage(logicalForm);
    logger.info(`Page type: ${isListPage ? 'list' : 'card'}`);

    // Compute repeater path if filters or setCurrent are requested (for list pages)
    const hasFilters = filters && Object.keys(filters).length > 0;
    let repeaterPath: string | null = null;
    let filtersWereApplied = false; // Track if we received filtered data from applyFilters

    // Check for stale filter state: if no filters provided but previous filters were applied,
    // the BC server still has those filters active. In this case, return an error so caller
    // can handle it (e.g., open a fresh page context without filters).
    if (isListPage && !hasFilters) {
      const filterService = FilterMetadataService.getInstance();
      const previousFilterState = filterService.getFilterState(sessionId, pageId);
      if (previousFilterState.size > 0) {
        logger.info(`[STALE-FILTER] Page ${pageId} has ${previousFilterState.size} previously applied filters, but current call has no filters.`);
        logger.info(`[STALE-FILTER] BC server still has these filters active. Clearing filter state and returning error.`);
        // Clear the cached filter state so next call starts fresh
        filterService.clearFilterStateForPage(sessionId, pageId);
        return err(
          new ProtocolError(
            `Page context has stale filters applied. The BC server has filters active from a previous call, but this call has no filters. Please open a fresh page context to read unfiltered data.`,
            { pageContextId, pageId, previousFiltersCount: previousFilterState.size }
          )
        );
      }
    }

    if (isListPage && (hasFilters || setCurrent)) {
      // Find repeater control path from LogicalForm (with Phase 2 cache optimization)
      const filterService = FilterMetadataService.getInstance();
      repeaterPath = await filterService.getOrComputeRepeaterPath(
        pageId,
        logicalForm,
        (form) => this.findRepeaterControlPath(form as LogicalForm)
      );

      if (!repeaterPath) {
        logger.warn(`Could not find repeater control in LogicalForm for filtering/setCurrent`);
        if (setCurrent) {
          // setCurrent requires repeater path - abort if not found
          return err(
            new ProtocolError(
              'setCurrent failed: Unable to locate repeater control for this list page',
              { pageId, setCurrent: true }
            )
          );
        }
        // For filters only: continue without filtering (best-effort)
      } else {
        logger.info(`Found repeater at path: ${repeaterPath}`);

        // Apply filters if provided (with cache optimization - Phases 1, 2, & 3)
        if (hasFilters) {
          const filterResult = await this.applyFilters(connection, filters, repeaterPath, sessionId, pageId, logger, logicalForm, formIds[0]);

          if (!isOk(filterResult)) {
            // Log warning but continue - filtering is best-effort
            logger.warn(`Filter application encountered errors: ${filterResult.error.message}`);
          } else if (filterResult.value.filteredHandlers) {
            // Use the filtered handlers returned from applyFilters()
            // applyFilters() already waited for DataRefreshChange with filtered data
            logger.info(`Using filtered handlers from applyFilters (${filterResult.value.filteredHandlers.length} handlers)`);
            handlers = filterResult.value.filteredHandlers;
            filtersWereApplied = true; // Mark that we got filtered data
            // Update cached handlers
            if (pageContext) {
              pageContext.handlers = handlers as any;
              pageContext.needsRefresh = false;
            }
          }
        }
      }
    }

    if (isListPage) {
      // List page - BC may send data asynchronously via DelayedControls
      logger.info(`Processing list page data...`);

      // Check if LogicalForm indicates delayed controls
      const hasDelayedControls = logicalForm?.DelayedControls;

      // Try to decompress response to get full data
      const decompressed = decompressResponse(handlers);
      const dataToProcess = decompressed || handlers;

      // Try synchronous extraction first (with LogicalForm for field filtering)
      const syncExtractionResult = this.dataExtractor.extractListPageData(
        dataToProcess as readonly unknown[],
        logicalForm  // Pass LogicalForm for visibility filtering
      );

      if (isOk(syncExtractionResult) && syncExtractionResult.value.totalCount > 0) {
        // Got data synchronously
        const { records, totalCount } = syncExtractionResult.value;
        logger.info(`Extracted ${totalCount} records from list page (synchronous)`);

        // Flatten records: {bookmark, fields: {name: FieldValue}} -> {bookmark, name: value}
        const flatRecords = records.map(r => {
          const flatFields: Record<string, any> = {};
          for (const [name, fieldValue] of Object.entries(r.fields)) {
            // Handle both wrapped {value: x} and primitive values
            flatFields[name] = typeof fieldValue === 'object' && fieldValue !== null && 'value' in fieldValue
              ? (fieldValue as any).value
              : fieldValue;
          }
          return { bookmark: r.bookmark, ...flatFields };
        });

        // Apply setCurrent if requested (before returning data)
        if (setCurrent) {
          if (!repeaterPath) {
            return err(
              new ProtocolError(
                'setCurrent failed: Unable to locate repeater control for this list page',
                { pageId, setCurrent: true }
              )
            );
          }

          const setCurrentResult = await this.applySetCurrent(
            connection,
            flatRecords,
            filters,
            repeaterPath,
            formIds[0],
            logger
          );

          if (!isOk(setCurrentResult)) {
            return setCurrentResult as Result<never, BCError>;
          }

          logger.info(`Set current record to bookmark: ${setCurrentResult.value.bookmark}`);
        }

        // Record operation in workflow (if participating)
        if (workflow) {
          workflow.recordOperation(
            'read_page_data',
            { pageContextId, filters, setCurrent, limit, offset },
            { success: true, data: { pageId: String(pageId), recordCount: flatRecords.length, totalCount } }
          );
        }

        return ok({
          pageId: String(pageId),
          pageContextId,
          caption,
          pageType: 'List',
          records: flatRecords,
          totalCount,
        });
      }

      // If no data, wait for async data
      // BC list pages often send data asynchronously even without DelayedControls flag
      // CRITICAL: Skip async wait if we just applied filters - filtered data is already final
      // CRITICAL: Skip async wait if sync extraction already got data (even with DelayedControls flag)
      const noSyncData = isOk(syncExtractionResult) && syncExtractionResult.value.totalCount === 0;
      if (!filtersWereApplied && noSyncData) {
        logger.info(`No data from sync extraction, waiting for async data...`);

        // Predicate to detect DataRefreshChange with row data
        const hasListData = (handlers: Handler[]): { matched: boolean; data?: Handler[] } => {
          const changeHandler = handlers.find(
            (h) => isLogicalClientChangeHandler(h)
          );
          if (!changeHandler || !isLogicalClientChangeHandler(changeHandler)) return { matched: false };

          const changes = changeHandler.parameters?.[1];
          if (!Array.isArray(changes)) return { matched: false };

          // Look for DataRefreshChange with RowChanges (drch type ID)
          const dataChange = (changes as Change[]).find(
            (c) =>
              isDataRefreshChange(c) &&
              Array.isArray(c.RowChanges) &&
              c.RowChanges.length > 0
          );

          if (!dataChange) return { matched: false };

          // Return the full handlers array as data
          return { matched: true, data: handlers };
        };

        try {
          // BC list pages automatically send data via async Message handlers after opening
          // We don't need to trigger RefreshForm - just wait for the data to arrive
          logger.info(`Waiting for BC to send list data asynchronously...`);
          const asyncHandlers = await connection.waitForHandlers(hasListData, { timeoutMs: defaultTimeouts.readOpTimeoutMs });
          logger.info(`Received async data with ${asyncHandlers.length} handlers`);

          // Extract from async handlers (with LogicalForm for field filtering)
          const asyncDecompressed = decompressResponse(asyncHandlers);
          const asyncData = asyncDecompressed || asyncHandlers;

          const asyncExtractionResult = this.dataExtractor.extractListPageData(
            asyncData as readonly unknown[],
            logicalForm  // Pass LogicalForm for visibility filtering
          );

          if (!isOk(asyncExtractionResult)) {
            return asyncExtractionResult as Result<never, BCError>;
          }

          const { records, totalCount } = asyncExtractionResult.value;
          logger.info(`Extracted ${totalCount} records from list page (asynchronous)`);

          // Flatten records: {bookmark, fields: {name: FieldValue}} -> {bookmark, name: value}
          const flatRecords = records.map(r => {
            const flatFields: Record<string, any> = {};
            for (const [name, fieldValue] of Object.entries(r.fields)) {
              flatFields[name] = fieldValue.value;
            }
            return { bookmark: r.bookmark, ...flatFields };
          });

          // Apply setCurrent if requested (before returning data)
          if (setCurrent) {
            if (!repeaterPath) {
              return err(
                new ProtocolError(
                  'setCurrent failed: Unable to locate repeater control for this list page',
                  { pageId, setCurrent: true }
                )
              );
            }

            const setCurrentResult = await this.applySetCurrent(
              connection,
              flatRecords,
              filters,
              repeaterPath,
              formIds[0],
              logger
            );

            if (!isOk(setCurrentResult)) {
              return setCurrentResult as Result<never, BCError>;
            }

            logger.info(`Set current record to bookmark: ${setCurrentResult.value.bookmark}`);
          }

          return ok({
            pageId: String(pageId),
            pageContextId,
            caption,
            pageType: 'List',
            records: flatRecords,
            totalCount,
          });
        } catch (error) {
          logger.error(`Failed to wait for async data: ${error instanceof Error ? error.message : String(error)}`);
          // Fall through to return empty result
        }
      }

      // No data available (or async wait failed)
      logger.info(`No records found for list page`);

      // Record operation in workflow (if participating)
      if (workflow) {
        workflow.recordOperation(
          'read_page_data',
          { pageContextId, filters, setCurrent, limit, offset },
          { success: true, data: { pageId: String(pageId), recordCount: 0, totalCount: 0 } }
        );
      }

      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'List',
        records: [],
        totalCount: 0,
      });
    } else {
      // Card page - data is directly in LogicalForm
      logger.info(`Extracting card page data...`);

      // setCurrent is not supported on Card pages
      if (setCurrent) {
        return err(
          new ProtocolError(
            'setCurrent is only supported on List pages, not Card/Document pages',
            { pageType: 'Card', setCurrent: true }
          )
        );
      }

      // Apply PropertyChanges from handlers to logicalForm before extraction
      const { updatedForm } = this.dataExtractor.applyPropertyChangesToLogicalForm(logicalForm, handlers);

      const extractionResult = this.dataExtractor.extractCardPageData(updatedForm, handlers);

      if (!isOk(extractionResult)) {
        return extractionResult as Result<never, BCError>;
      }

      const { records, totalCount } = extractionResult.value;

      logger.info(`Extracted ${Object.keys(records[0]?.fields || {}).length} fields from card page`);

      // Flatten records: {bookmark, fields: {name: FieldValue}} -> {bookmark, name: value}
      const flatRecords = records.map(r => {
        const flatFields: Record<string, any> = {};
        for (const [name, fieldValue] of Object.entries(r.fields)) {
          flatFields[name] = fieldValue.value;
        }
        return { bookmark: r.bookmark, ...flatFields };
      });

      // Record operation in workflow (if participating)
      if (workflow) {
        workflow.recordOperation(
          'read_page_data',
          { pageContextId, filters, setCurrent, limit, offset },
          { success: true, data: { pageId: String(pageId), recordCount: flatRecords.length, totalCount } }
        );
      }

      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'Card',
        records: flatRecords,
        totalCount,
      });
    }
  }

}
