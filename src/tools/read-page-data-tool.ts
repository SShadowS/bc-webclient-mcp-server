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
import type { IBCConnection } from '../core/interfaces.js';
import type { ReadPageDataOutput } from '../types/mcp-types.js';
import { ReadPageDataInputSchema, type ReadPageDataInput } from '../validation/schemas.js';
import { PageDataExtractor } from '../parsers/page-data-extractor.js';
import { HandlerParser } from '../parsers/handler-parser.js';
import { decompressResponse } from '../util/loadform-helpers.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';
import { PageContextCache } from '../services/page-context-cache.js';
import { FilterMetadataService } from '../services/filter-metadata-service.js';

/**
 * MCP Tool: read_page_data
 *
 * Reads data records from a BC page with optional filtering.
 */
export class ReadPageDataTool extends BaseMCPTool {
  public readonly name = 'read_page_data';

  public readonly description =
    'Reads data records from a Business Central page using an existing pageContextId from get_page_metadata. ' +
    'filters: Optional object where keys are field names/captions (case-insensitive) and values specify filter criteria. ' +
    'Simple format: {"No.": "10000"} for equality. Advanced: {"No.": {operator: "=", value: "10000"}}. ' +
    'Supported operators: = (equals), != (not equals), contains, startsWith, >= (greater/equal), <= (less/equal), between (provide [min, max]). ' +
    'Multiple filters are combined with AND logic. ' +
    'setCurrent: If true and exactly ONE record matches, sets it as the current record for subsequent operations (write_page_data, execute_action). ' +
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
  private findRepeaterControlPath(logicalForm: any): string | null {
    let repeaterPath: string | null = null;

    const walkControl = (control: any, path: string): void => {
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
  private extractFieldMetadata(logicalForm: any): Map<string, import('../types/bc-types.js').FieldMetadata> {
    const fields = new Map<string, import('../types/bc-types.js').FieldMetadata>();

    const walkControl = (control: any): void => {
      if (!control || typeof control !== 'object') return;

      const controlType = control.t as string;

      // Extract field metadata from various control types
      const fieldTypes = ['rcc', 'sc', 'dc', 'bc', 'i32c', 'sec', 'dtc', 'pc'];
      if (fieldTypes.includes(controlType)) {
        // Get field name (prefer DesignName, fall back to Name or Caption)
        const fieldName = control.DesignName || control.Name || control.Caption;
        if (fieldName) {
          fields.set(fieldName, {
            type: controlType,
            caption: control.Caption,
            name: control.Name || control.DesignName,
            controlId: control.ID || control.ControlIdentifier,
            enabled: control.Enabled !== false,
            visible: control.Visible !== false,
            readonly: control.ReadOnly === true,
            options: control.Options,
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
    filters: Record<string, any>,
    repeaterPath: string,
    sessionId: string,
    pageId: string,
    logger: any,
    logicalForm: any
  ): Promise<Result<void, BCError>> {
    if (!filters || Object.keys(filters).length === 0) {
      return ok(undefined);
    }

    logger.info(`Applying ${Object.keys(filters).length} filter(s)...`);

    // Get cached filter state (Phase 1: Filter State Cache)
    const filterService = FilterMetadataService.getInstance();
    const filterState = filterService.getFilterState(sessionId, pageId);
    let stateChanged = false;

    // Get or compute field metadata (Phase 3: Field Metadata Cache)
    const fieldMetadata = await filterService.getOrComputeFieldMetadata(
      pageId,
      logicalForm,
      (form) => this.extractFieldMetadata(form)
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

    for (const [columnName, filterSpec] of Object.entries(filters)) {
      try {
        // Parse filter spec (simple string/number or { operator, value })
        let operator = '=';
        let value: any;

        if (typeof filterSpec === 'object' && filterSpec !== null && 'operator' in filterSpec) {
          operator = filterSpec.operator || '=';
          value = filterSpec.value;
        } else {
          value = filterSpec;
        }

        // CHECK CACHE: Skip if filter already applied with same operator and value
        const cached = filterState.get(columnName);
        if (cached && cached.operator === operator && cached.value === value) {
          logger.info(`  ✓ Skipping "${columnName}" ${operator} "${value}" - already active (cached)`);
          continue;
        }

        logger.info(`  Filtering "${columnName}" ${operator} "${value}"`);

        // Step 1: Send Filter interaction to activate filter for this column
        const filterResult = await connection.invoke({
          interactionName: 'Filter',
          namedParameters: {
            columnName: columnName,
          },
          controlPath: repeaterPath,
          callbackId: '0',
        });

        if (!isOk(filterResult)) {
          logger.warn(`    Failed to activate filter for "${columnName}": ${filterResult.error.message}`);
          continue; // Try next filter
        }

        // Step 2: Set filter value using SaveValue
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
          default:
            logger.warn(`    Unsupported operator "${operator}" for "${columnName}"`);
            continue;
        }

        const saveValueResult = await connection.invoke({
          interactionName: 'SaveValue',
          namedParameters: {
            newValue: bcFilterValue,
          },
          controlPath: `${repeaterPath}:filter`,
          callbackId: '0',
        });

        if (!isOk(saveValueResult)) {
          logger.warn(`    Failed to set filter value for "${columnName}": ${saveValueResult.error.message}`);
          continue;
        }

        logger.info(`    ✓ Filter applied: "${columnName}" ${operator} "${value}"`);

        // UPDATE CACHE: Track successfully applied filter
        filterState.set(columnName, { operator, value });
        stateChanged = true;
      } catch (error) {
        logger.warn(`    Error applying filter for "${columnName}": ${error instanceof Error ? error.message : String(error)}`);
        continue; // Try next filter
      }
    }

    // Save updated filter state if any filters were applied
    if (stateChanged) {
      filterService.setFilterState(sessionId, pageId, filterState);
    }

    logger.info(`✓ Filters applied`);
    return ok(undefined);
  }

  /**
   * Executes the tool to read page data.
   * Input is pre-validated by BaseMCPTool using Zod schema.
   */
  protected async executeInternal(input: unknown): Promise<Result<ReadPageDataOutput, BCError>> {
    // Input is already validated by BaseMCPTool with Zod
    const { pageContextId, filters, setCurrent, limit, offset } = input as ReadPageDataInput;
    const logger = createToolLogger('read_page_data', pageContextId);

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

    // Page is already open (from get_page_metadata), no need to open again
    // Get the page context to access the form IDs and cached handlers
    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    const formIds = pageContext?.formIds || [];
    const cachedHandlers = pageContext?.handlers; // Handlers from get_page_metadata (includes LoadForm data)

    logger.info(`Using existing page context with ${formIds.length} open forms`);

    let handlers: readonly unknown[];

    // Check if page needs refresh (e.g., after execute_action changed state)
    const needsRefresh = pageContext?.needsRefresh === true;

    // Use cached handlers if available AND not stale (avoids RefreshForm which can cause errors)
    // get_page_metadata now calls LoadForm and caches all handlers including async data
    if (cachedHandlers && cachedHandlers.length > 0 && !needsRefresh) {
      logger.info(`✓ Using ${cachedHandlers.length} cached handlers from get_page_metadata (includes LoadForm data)`);
      handlers = cachedHandlers;
    } else if (needsRefresh) {
      // After action execution, we need fresh data - call LoadForm
      logger.info(`🔄 Page marked as needing refresh, calling LoadForm for fresh data...`);
      const mainFormId = formIds[0];
      const loadFormResult = await connection.invoke({
        interactionName: 'LoadForm',
        formId: mainFormId,
        controlPath: `server:`,
        namedParameters: { loadData: true },
      });

      if (isOk(loadFormResult)) {
        logger.info(`✓ LoadForm returned ${loadFormResult.value.length} handlers`);
        handlers = loadFormResult.value;
        // Update cached handlers and clear refresh flag
        if (pageContext) {
          pageContext.handlers = handlers as any;
          pageContext.needsRefresh = false;
          logger.info(`✓ Updated cached handlers and cleared refresh flag`);
        }
      } else {
        logger.info(`⚠️  LoadForm failed, using stale cached handlers: ${loadFormResult.error.message}`);
        handlers = cachedHandlers || [];
      }
    } else {
      // Legacy fallback: Call RefreshForm to get current data
      logger.info(`⚠️  No cached handlers, falling back to RefreshForm`);
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

    let logicalForm = cachedLogicalForm;

    if (!cachedLogicalForm) {
      // Fallback: try to extract from handlers if not cached
      const logicalFormResult = this.handlerParser.extractLogicalForm(handlers as any);
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
    const caption = logicalForm.Caption || `Page ${pageId}`;

    logger.info(`LogicalForm: ${caption}`);

    // Check for Document page type FIRST (Sales Order, Purchase Order, etc.)
    const isDocumentPage = cachedPageType === 'Document';
    if (isDocumentPage) {
      logger.info(`Page type: Document - extracting header + lines`);

      const extractionResult = this.dataExtractor.extractDocumentPageData(logicalForm, handlers);

      if (!isOk(extractionResult)) {
        return extractionResult as Result<never, BCError>;
      }

      const { header, linesBlocks, totalCount } = extractionResult.value;
      logger.info(`Extracted Document page: ${Object.keys(header.fields || {}).length} header fields, ${linesBlocks.length} lines block(s)`);

      // Return structured output with header + lines
      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'Document',
        header,
        linesBlocks,
        records: [header], // Backwards compatibility
        totalCount,
      });
    }

    // Use cached page type if available, otherwise detect from LogicalForm
    const isListPage = cachedPageType === 'List' || cachedPageType === 'Worksheet' || this.dataExtractor.isListPage(logicalForm);
    logger.info(`Page type: ${isListPage ? 'list' : 'card'}`);

    // Apply filters if provided (only for list pages)
    if (isListPage && filters && Object.keys(filters).length > 0) {
      // Find repeater control path from LogicalForm (with Phase 2 cache optimization)
      const filterService = FilterMetadataService.getInstance();
      const repeaterPath = await filterService.getOrComputeRepeaterPath(
        pageId,
        logicalForm,
        (form) => this.findRepeaterControlPath(form)
      );

      if (!repeaterPath) {
        logger.warn(`Could not find repeater control in LogicalForm for filtering`);
        // Continue without filtering
      } else {
        logger.info(`Found repeater at path: ${repeaterPath}`);

        // Apply filters (with cache optimization - Phases 1, 2, & 3)
        const filterResult = await this.applyFilters(connection, filters, repeaterPath, sessionId, pageId, logger, logicalForm);

        if (!isOk(filterResult)) {
          // Log warning but continue - filtering is best-effort
          logger.warn(`Filter application encountered errors: ${filterResult.error.message}`);
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

        return ok({
          pageId: String(pageId),
          pageContextId,
          caption,
          pageType: 'List',
          records,
          totalCount,
        });
      }

      // If no data, wait for async data (either DelayedControls or empty sync result)
      // BC list pages often send data asynchronously even without DelayedControls flag
      if (hasDelayedControls || (isOk(syncExtractionResult) && syncExtractionResult.value.totalCount === 0)) {
        if (hasDelayedControls) {
          logger.info(`DelayedControls detected, waiting for async data...`);
        } else {
          logger.info(`No data from sync extraction, waiting for async data...`);
        }

        // Predicate to detect DataRefreshChange with row data
        const hasListData = (handlers: any[]): { matched: boolean; data?: any[] } => {
          const changeHandler = handlers.find(
            (h: any) => h.handlerType === 'DN.LogicalClientChangeHandler'
          );
          if (!changeHandler) return { matched: false };

          const changes = changeHandler.parameters?.[1];
          if (!Array.isArray(changes)) return { matched: false };

          // Look for DataRefreshChange or InitializeChange with RowChanges
          const dataChange = changes.find(
            (c: any) =>
              (c.t === 'DataRefreshChange' || c.t === 'InitializeChange') &&
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
          const asyncHandlers = await connection.waitForHandlers(hasListData, { timeoutMs: 10000 });
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

          return ok({
            pageId: String(pageId),
            pageContextId,
            caption,
            pageType: 'List',
            records,
            totalCount,
          });
        } catch (error) {
          logger.error(`Failed to wait for async data: ${error instanceof Error ? error.message : String(error)}`);
          // Fall through to return empty result
        }
      }

      // No data available (or async wait failed)
      logger.info(`No records found for list page`);
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

      const extractionResult = this.dataExtractor.extractCardPageData(logicalForm, handlers);

      if (!isOk(extractionResult)) {
        return extractionResult as Result<never, BCError>;
      }

      const { records, totalCount } = extractionResult.value;

      logger.info(`Extracted ${Object.keys(records[0]?.fields || {}).length} fields from card page`);

      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'Card',
        records,
        totalCount,
      });
    }
  }

}
