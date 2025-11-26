/**
 * PageStateManager - Message-Driven State Reducer
 *
 * Implements the reducer pattern for updating PageState based on BC protocol messages.
 * All operations MUTATE state in-place (not Redux/immutable).
 *
 * See: PageState.md v2.0 for full architecture documentation
 *
 * Key Responsibilities:
 * - Initialize PageState from LoadForm response
 * - Apply BC protocol messages to update state
 * - Handle row updates with upsert pattern
 * - Track bookmark changes (temp → permanent)
 * - Enrich column metadata from RCC messages
 * - Handle validation errors and dialogs
 */

import {
  PageState,
  PageMetadata,
  FieldState,
  ActionState,
  RepeaterState,
  ColumnState,
  RowState,
  FactboxState,
  BcHandlerMessage,
  RowLookupResult,
} from './page-state.js';

import { ControlParser } from '../parsers/control-parser.js';
import { createToolLogger } from '../core/logger.js';
import type { LogicalForm } from '../types/bc-types.js';
// Note: PageStateManager uses its own change type abstractions that don't match
// the BC protocol types exactly (uses full names vs type IDs). These local types
// represent the processed/transformed change objects.

/** Base interface for all change types in PageStateManager */
interface BaseChange {
  t: string;
  ControlReference?: { controlPath: string };
}

/** DataRefreshChange - contains row-level deltas */
interface PageDataRefreshChange extends BaseChange {
  t: 'DataRefreshChange';
  RowChanges?: RowChange[];
}

/** Row data structure passed in DataRowInserted/DataRowUpdated */
interface RowDataPayload {
  bookmark?: string;
  oldBookmark?: string;
  cells?: Record<string, unknown>;
}

/** Row change types */
interface RowChange {
  t: string;
  /** Tuple: [index, rowData] for inserts */
  DataRowInserted?: [number, RowDataPayload];
  /** Tuple: [index, rowData] for updates (BC uses same format as insert) */
  DataRowUpdated?: [number, RowDataPayload];
  /** Object with bookmark for deletes */
  DataRowDeleted?: { RowBookmark?: string };
  DataRowFlush?: unknown;
}

/** PropertyChanges - batch of property updates */
interface PagePropertyChanges extends BaseChange {
  t: 'PropertyChanges';
  Changes?: Array<{ PropertyName?: string; PropertyValue?: unknown; StringValue?: string }>;
}

/** CursorMove - row cursor position change */
interface PageCursorMoveChange extends BaseChange {
  t: 'CursorMove';
  NewRowBookmark?: string;
  RowCount?: number;
}

/** ViewportChange - visible rows in repeater */
interface PageViewportChange extends BaseChange {
  t: 'ViewportChange';
  FirstRow?: number;
  LastRow?: number;
}

/** RCC - RepeaterColumnControl enrichment (BC sends shorthand 'rcc') */
interface PageRCCChange extends BaseChange {
  t: 'rcc';
  ColumnIndex?: number;
  Index?: number;
  TemplateControlPath?: string;
  FormId?: string;
  Columns?: Array<{ Caption?: string; SourceField?: string; ControlId?: string; columnIndex?: number }>;
}

/** Union of all change types handled by PageStateManager */
type PageChange =
  | PageDataRefreshChange
  | PagePropertyChanges
  | PageCursorMoveChange
  | PageViewportChange
  | PageRCCChange
  | BaseChange;

/** Callback response for form operations */
interface CallbackResponseParams {
  CompletedInteractions?: Array<{ Result?: { value?: string } }>;
}

/** Validation error structure */
interface ValidationErrorInfo {
  controlPath?: string;
  ControlReference?: { controlPath?: string };
  Message?: string;
  message?: string;
}

/** Dialog message structure */
interface DialogInfo {
  formId?: string;
  Caption?: string;
  IsModal?: boolean;
}

const logger = createToolLogger('PageStateManager');

/**
 * PageStateManager - Manages PageState lifecycle and updates
 *
 * CRITICAL: All methods MUTATE state in-place (not immutable)
 * - Methods return PageState for chaining, but it's the SAME object
 * - No new objects created, all Maps/Arrays modified in-place
 * - Tools MUST NOT share PageState between sessions
 */
export class PageStateManager {
  /**
   * Initialize PageState from LoadForm response
   *
   * @param logicalForm - The LogicalForm from LoadForm response (parameters[1])
   * @param pageId - BC page ID
   * @param pageType - Page type (Card, List, Document)
   * @returns Initialized PageState (with empty data, ready for messages)
   */
  initFromLoadForm(
    logicalForm: LogicalForm,
    pageId: string,
    pageType: 'Card' | 'List' | 'Document'
  ): PageState {
    logger.info(`Initializing PageState for page ${pageId} (${pageType})`);

    // Extract metadata
    const pageMetadata: PageMetadata = {
      pageId,
      pageType,
      caption: logicalForm.Caption ? String(logicalForm.Caption) : undefined,
      formId: logicalForm.FormId ? String(logicalForm.FormId) : undefined,
    };

    // Initialize state
    const state: PageState = {
      pageMetadata,
      fields: new Map(),
      actions: new Map(),
      repeaters: new Map(),
      factboxes: new Map(),
      status: 'Ready',
      globalErrors: [],
    };

    // Extract repeaters using existing control-parser logic
    // Note: This extracts repeater scaffolds WITHOUT column controlPaths
    // Column controlPaths will be enriched later via RCC messages
    const parser = new ControlParser();

    // Walk controls to assign controlPaths
    const controls = parser.walkControls(logicalForm);

    // Extract repeaters
    const repeaterMetadata = parser.extractRepeaters(controls);

    for (const repeaterMeta of repeaterMetadata) {
      const repeater: RepeaterState = {
        name: repeaterMeta.name || repeaterMeta.formId || 'unknown',
        caption: repeaterMeta.caption,
        controlPath: repeaterMeta.controlPath || '',
        formId: repeaterMeta.formId,
        columns: new Map(),
        orderedColumnKeys: [],
        rows: new Map(),
        rowOrder: [],
        viewport: undefined,
        cursorBookmark: undefined,
        totalRowCount: undefined,
        isDirty: false,
        lastError: undefined,
        pendingOperations: 0,
      };

      // Initialize columns from metadata (controlPath may be undefined)
      for (const colMeta of repeaterMeta.columns) {
        const column: ColumnState = {
          caption: colMeta.caption,
          designName: colMeta.designName,
          controlPath: colMeta.controlPath, // May be undefined until RCC enrichment
          columnBinderPath: colMeta.columnBinderPath,
          index: repeater.columns.size, // Sequential index
          controlId: undefined, // Not available yet
          visible: true, // Default
          editable: true, // Default
        };

        const key = colMeta.designName || colMeta.caption || `col_${column.index}`;
        repeater.columns.set(key, column);
        repeater.orderedColumnKeys!.push(key);
      }

      // Key by formId or name
      const repeaterKey = repeater.formId || repeater.name;
      state.repeaters.set(repeaterKey, repeater);

      logger.debug(
        `Initialized repeater "${repeater.name}" with ${repeater.columns.size} columns (controlPaths may be undefined)`
      );
    }

    logger.info(
      `PageState initialized: ${state.repeaters.size} repeaters, status=${state.status}`
    );

    return state;
  }

  /**
   * Apply handlers array to update state (MUTATES in-place)
   *
   * @param state - PageState to update
   * @param handlers - Array of BC handler messages
   * @returns Same PageState object (mutated)
   */
  applyMessages(state: PageState, handlers: BcHandlerMessage[]): PageState {
    for (const handler of handlers) {
      this.applyMessage(state, handler);
    }
    return state;
  }

  /**
   * Apply single handler to update state (MUTATES in-place)
   *
   * Routes handler to appropriate change processor based on handlerType
   *
   * @param state - PageState to update
   * @param handler - BC handler message
   * @returns Same PageState object (mutated)
   */
  private applyMessage(state: PageState, handler: BcHandlerMessage): PageState {
    switch (handler.handlerType) {
      case 'DN.LogicalClientChangeHandler':
        // parameters[1] is array of change objects
        const changes = handler.parameters[1];
        if (Array.isArray(changes)) {
          for (const change of changes) {
            this.applyChange(state, change as BaseChange);
          }
        }
        break;

      case 'DN.CallbackResponseProperties':
        // Handle property changes from callbacks
        this.applyCallbackResponse(state, handler.parameters as CallbackResponseParams[]);
        break;

      default:
        // Unknown handler type - log but don't fail
        logger.debug(`Unknown handler type: ${handler.handlerType}`);
        break;
    }

    return state;
  }

  /**
   * Apply individual change object (MUTATES in-place)
   *
   * Routes change to appropriate reducer based on change.t
   *
   * @param state - PageState to update
   * @param change - Change object from handler.parameters[1]
   * @returns Same PageState object (mutated)
   */
  private applyChange(state: PageState, change: PageChange): PageState {
    // Type narrowing via switch doesn't work perfectly with union containing
    // BaseChange (t: string), so we use type assertions in each case.
    switch (change.t) {
      case 'DataRefreshChange':
        this.applyDataRefreshChange(state, change as PageDataRefreshChange);
        break;

      case 'PropertyChanges':
        this.applyPropertyChanges(state, change as PagePropertyChanges);
        break;

      case 'rcc':
        logger.info(`[RCC] Received RCC change for formId=${(change as PageRCCChange).FormId}, Index=${(change as PageRCCChange).Index}`);
        this.applyRCCEnrichment(state, change as PageRCCChange);
        break;

      case 'CursorMove':
        this.applyCursorMove(state, change as PageCursorMoveChange);
        break;

      case 'ViewportChange':
        this.applyViewportChange(state, change as PageViewportChange);
        break;

      default:
        // Unknown change type - log but don't fail
        logger.debug(`Unknown change type: ${change.t}`);
        break;
    }

    return state;
  }

  // ============================================================================
  // DataRefreshChange Reducer (The Complex One)
  // ============================================================================

  /**
   * Apply DataRefreshChange to update repeater rows (MUTATES in-place)
   *
   * DataRefreshChange contains row-level deltas (insert, update, delete, flush)
   *
   * CRITICAL:
   * - BC uses DataRowUpdated for BOTH initial load and updates (upsert pattern)
   * - Bookmark changes (temp → permanent) must be detected and handled
   * - Deep merge values, never replace entire rows
   *
   * @param state - PageState to update
   * @param change - DataRefreshChange object
   * @returns Same PageState object (mutated)
   */
  private applyDataRefreshChange(state: PageState, change: PageDataRefreshChange): PageState {
    // 1. Identify target repeater by controlPath
    const targetPath = change.ControlReference?.controlPath;
    const repeater = this.findRepeaterByPath(state, targetPath);

    if (!repeater) {
      logger.warn(`DataRefreshChange: Repeater not found for path "${targetPath}"`);
      return state;
    }

    logger.debug(
      `DataRefreshChange for repeater "${repeater.name}": ${change.RowChanges?.length || 0} row changes`
    );

    // 2. Process row changes
    for (const rowChange of change.RowChanges || []) {
      switch (rowChange.t) {
        case 'DataRowInserted':
          this.upsertRow(repeater, rowChange, 'insert');
          break;

        case 'DataRowDeleted':
          this.deleteRow(repeater, rowChange);
          break;

        case 'DataRowUpdated':
          // CRITICAL: BC uses DataRowUpdated for BOTH initial load and updates!
          this.upsertRow(repeater, rowChange, 'update');
          break;

        case 'DataFlush':
          this.flushRows(repeater);
          break;

        default:
          logger.debug(`Unknown row change type: ${rowChange.t}`);
          break;
      }
    }

    // 3. Clear pending operations (data arrived)
    repeater.pendingOperations = Math.max(0, repeater.pendingOperations - 1);
    if (repeater.pendingOperations === 0) {
      repeater.isDirty = false;
    }

    logger.debug(
      `DataRefreshChange applied: ${repeater.rows.size} rows, pendingOperations=${repeater.pendingOperations}`
    );

    return state;
  }

  /**
   * Helper: Find column by index (CRITICAL for DataRefreshChange)
   *
   * BC sends row data with column indices, not keys
   * We must map index → ColumnState → designName
   */
  private findColumnByIndex(repeater: RepeaterState, index: number): ColumnState | undefined {
    return Array.from(repeater.columns.values()).find((c) => c.index === index);
  }

  /**
   * UPSERT: Update or insert row (MUTATES repeater in-place)
   *
   * CRITICAL: BC uses DataRowUpdated for BOTH initial load and updates!
   * - Always check if row exists first
   * - Create new row if not found (initial load case)
   * - Deep merge values if row exists (update case)
   * - Handle bookmark changes (temp → permanent)
   *
   * @param repeater - RepeaterState to update
   * @param change - DataRowInserted or DataRowUpdated object
   * @param operation - 'insert' or 'update' (for isNew flag)
   */
  private upsertRow(
    repeater: RepeaterState,
    change: RowChange,
    operation: 'insert' | 'update'
  ): void {
    const tupleData = change.DataRowUpdated || change.DataRowInserted;
    if (!tupleData) {
      logger.warn('upsertRow: No DataRowUpdated or DataRowInserted in change');
      return;
    }
    const [index, rowData] = tupleData;
    const bookmark = rowData.bookmark;

    if (!bookmark) {
      logger.warn('upsertRow: No bookmark in row data, skipping');
      return;
    }

    // UPSERT: Always handle as potential new row
    if (!repeater.rows.has(bookmark)) {
      // This is actually a new row (or first load)
      repeater.rows.set(bookmark, {
        bookmark,
        values: new Map(),
        isNew: operation === 'insert',
      });

      // Add to order at specified index
      repeater.rowOrder.splice(index, 0, bookmark);

      logger.debug(`Row inserted at index ${index}: ${bookmark}`);
    } else {
      logger.debug(`Row updated: ${bookmark}`);
    }

    // Merge cell values (DEEP MERGE, never replace!)
    const row = repeater.rows.get(bookmark)!;
    for (const [colIndexStr, value] of Object.entries(rowData.cells || {})) {
      const colIndex = Number(colIndexStr);
      const column = this.findColumnByIndex(repeater, colIndex);

      if (column?.designName) {
        row.values.set(column.designName, value);
      } else {
        logger.warn(
          `Column not found for index ${colIndex} in repeater "${repeater.name}"`
        );
      }
    }

    // Handle bookmark changes (temp → permanent)
    if (rowData.oldBookmark && rowData.oldBookmark !== bookmark) {
      logger.info(`Bookmark changed: ${rowData.oldBookmark} → ${bookmark}`);
      this.remapBookmark(repeater, rowData.oldBookmark, bookmark);
    }
  }

  /**
   * Remap bookmark (temp → permanent) (MUTATES repeater in-place)
   *
   * When BC saves a new row, bookmark changes from temporary to permanent
   * We must update both rows Map and rowOrder array
   *
   * @param repeater - RepeaterState to update
   * @param oldBookmark - Temporary bookmark
   * @param newBookmark - Permanent bookmark
   */
  private remapBookmark(
    repeater: RepeaterState,
    oldBookmark: string,
    newBookmark: string
  ): void {
    const row = repeater.rows.get(oldBookmark);
    if (!row) {
      logger.warn(`remapBookmark: Old bookmark not found: ${oldBookmark}`);
      return;
    }

    // Remove old, add new
    repeater.rows.delete(oldBookmark);
    repeater.rows.set(newBookmark, { ...row, bookmark: newBookmark, isNew: false });

    // Update rowOrder
    const orderIndex = repeater.rowOrder.indexOf(oldBookmark);
    if (orderIndex >= 0) {
      repeater.rowOrder[orderIndex] = newBookmark;
    } else {
      logger.warn(`remapBookmark: Old bookmark not found in rowOrder: ${oldBookmark}`);
    }

    logger.debug(`Bookmark remapped: ${oldBookmark} → ${newBookmark}`);
  }

  /**
   * Delete row (MUTATES repeater in-place)
   *
   * @param repeater - RepeaterState to update
   * @param change - DataRowDeleted object
   */
  private deleteRow(repeater: RepeaterState, change: RowChange): void {
    const deleted = change.DataRowDeleted;
    if (!deleted) return;
    const bookmark = deleted.RowBookmark || repeater.rowOrder[0];

    if (bookmark) {
      const orderIndex = repeater.rowOrder.indexOf(bookmark);
      repeater.rows.delete(bookmark);
      repeater.rowOrder = repeater.rowOrder.filter((b) => b !== bookmark);
      logger.debug(`Row deleted at index ${orderIndex}: ${bookmark}`);
    } else {
      logger.warn(`deleteRow: No bookmark found in change or rowOrder`);
    }
  }

  /**
   * Flush all rows (MUTATES repeater in-place)
   *
   * BC sends DataFlush to clear all rows (e.g., after filter change)
   *
   * @param repeater - RepeaterState to update
   */
  private flushRows(repeater: RepeaterState): void {
    const rowCount = repeater.rows.size;
    repeater.rows.clear();
    repeater.rowOrder = [];
    logger.debug(`Flushed ${rowCount} rows from repeater "${repeater.name}"`);
  }

  // ============================================================================
  // RCC Enrichment Reducer
  // ============================================================================

  /**
   * Apply RCC (Repeater Column Control) enrichment (MUTATES in-place)
   *
   * RCC messages provide TemplateControlPath for columns
   * This is progressive enrichment - columns gain controlPaths over time
   *
   * @param state - PageState to update
   * @param rcc - RepeaterColumnControl change object
   * @returns Same PageState object (mutated)
   */
  private applyRCCEnrichment(state: PageState, rcc: PageRCCChange): PageState {
    const formId = rcc.FormId;
    const repeater = this.findRepeaterByFormId(state, formId);

    if (!repeater) {
      logger.warn(`RCC enrichment: Repeater not found for formId "${formId}"`);
      return state;
    }

    const columnIndex = rcc.Index;
    if (columnIndex === undefined) {
      logger.warn(`RCC enrichment: No Index in RCC message for formId "${formId}"`);
      return state;
    }
    const column = this.findColumnByIndex(repeater, columnIndex);

    if (column && rcc.TemplateControlPath) {
      column.controlPath = rcc.TemplateControlPath;
      logger.info(
        `[RCC ENRICHMENT] Column enriched: "${column.designName}" → controlPath="${column.controlPath}"`
      );
    } else {
      logger.warn(
        `RCC enrichment failed: Column index ${columnIndex} not found in repeater "${repeater.name}"`
      );
    }

    return state;
  }

  // ============================================================================
  // Property Changes Reducer
  // ============================================================================

  /**
   * Apply PropertyChanges (MUTATES in-place)
   *
   * PropertyChanges update field values, visibility, enabled state, etc.
   *
   * @param state - PageState to update
   * @param change - PropertyChanges object
   * @returns Same PageState object (mutated)
   */
  private applyPropertyChanges(state: PageState, change: PagePropertyChanges): PageState {
    // TODO: Implement property changes reducer
    // This will update field values, visibility, enabled state, etc.
    logger.debug('PropertyChanges not yet implemented');
    return state;
  }

  /**
   * Apply callback response properties (MUTATES in-place)
   *
   * @param state - PageState to update
   * @param parameters - Callback parameters
   * @returns Same PageState object (mutated)
   */
  private applyCallbackResponse(state: PageState, parameters: CallbackResponseParams[]): PageState {
    // TODO: Implement callback response handler
    logger.debug('CallbackResponse not yet implemented');
    return state;
  }

  // ============================================================================
  // Cursor & Viewport Reducers
  // ============================================================================

  /**
   * Apply cursor movement (MUTATES in-place)
   *
   * @param state - PageState to update
   * @param change - CursorMove object
   * @returns Same PageState object (mutated)
   */
  private applyCursorMove(state: PageState, change: PageCursorMoveChange): PageState {
    const cursorChange = change as unknown as { repeaterName?: string; newBookmark?: string };
    const repeaterName =
      cursorChange.repeaterName || this.findRepeaterNameByPath(state, change.ControlReference?.controlPath);
    const repeater = state.repeaters.get(repeaterName);

    if (!repeater) {
      logger.warn(`CursorMove: Repeater not found: ${repeaterName}`);
      return state;
    }

    repeater.cursorBookmark = cursorChange.newBookmark || change.NewRowBookmark;
    logger.debug(`Cursor moved in "${repeater.name}" to bookmark: ${repeater.cursorBookmark}`);

    return state;
  }

  /**
   * Apply viewport changes (MUTATES in-place)
   *
   * @param state - PageState to update
   * @param change - ViewportChange object
   * @returns Same PageState object (mutated)
   */
  private applyViewportChange(state: PageState, change: PageViewportChange): PageState {
    const viewportChange = change as unknown as { repeaterName?: string; firstIndex?: number; lastIndex?: number; totalCount?: number };
    const repeater = state.repeaters.get(viewportChange.repeaterName || '');

    if (!repeater) {
      logger.warn(`ViewportChange: Repeater not found: ${viewportChange.repeaterName}`);
      return state;
    }

    repeater.viewport = {
      firstVisibleIndex: viewportChange.firstIndex ?? change.FirstRow ?? 0,
      lastVisibleIndex: viewportChange.lastIndex ?? change.LastRow ?? 0,
    };

    // Also update totalRowCount if provided
    if (viewportChange.totalCount !== undefined) {
      repeater.totalRowCount = viewportChange.totalCount;
    }

    logger.debug(
      `Viewport changed in "${repeater.name}": ${repeater.viewport.firstVisibleIndex}-${repeater.viewport.lastVisibleIndex}, total=${repeater.totalRowCount}`
    );

    return state;
  }

  // ============================================================================
  // Error Handling Reducers (CRITICAL for Phase 1)
  // ============================================================================

  /**
   * Apply validation error (MUTATES in-place)
   *
   * @param state - PageState to update
   * @param error - Validation error object
   * @returns Same PageState object (mutated)
   */
  applyValidationError(state: PageState, error: ValidationErrorInfo & { scope?: string; repeaterName?: string; bookmark?: string; fieldName?: string }): PageState {
    const errorMessage = error.Message || error.message || 'Unknown validation error';

    if (error.scope === 'page') {
      state.globalErrors.push(errorMessage);
      state.status = 'Error';
      logger.error(`Page validation error: ${errorMessage}`);
    } else if (error.scope === 'repeater') {
      const repeater = state.repeaters.get(error.repeaterName || '');
      if (repeater) {
        repeater.lastError = errorMessage;
        repeater.isDirty = false; // BC rejected the change
        repeater.pendingOperations = Math.max(0, repeater.pendingOperations - 1);
        logger.error(`Repeater "${error.repeaterName}" validation error: ${errorMessage}`);
      }
    } else if (error.scope === 'field') {
      const repeater = state.repeaters.get(error.repeaterName || '');
      const row = repeater?.rows.get(error.bookmark || '');
      if (row) {
        if (!row.validationErrors) row.validationErrors = new Map();
        row.validationErrors.set(error.fieldName || '', errorMessage);
        logger.error(
          `Field "${error.fieldName}" validation error in "${error.repeaterName}": ${errorMessage}`
        );
      }
    }

    return state;
  }

  /**
   * Apply dialog message (MUTATES in-place)
   *
   * BC shows validation dialog - clear all pending operations
   *
   * @param state - PageState to update
   * @param dialog - Dialog message object
   * @returns Same PageState object (mutated)
   */
  applyDialogMessage(state: PageState, dialog: DialogInfo & { message?: string }): PageState {
    // BC shows validation dialog
    const dialogMessage = dialog.message || dialog.Caption || 'Dialog displayed';
    state.globalErrors.push(dialogMessage);
    state.status = 'Error';

    // Clear any pending operations (they failed)
    for (const repeater of state.repeaters.values()) {
      if (repeater.pendingOperations > 0) {
        repeater.pendingOperations = 0;
        repeater.isDirty = false;
      }
    }

    logger.error(`Dialog message: ${dialogMessage}`);

    return state;
  }

  // ============================================================================
  // Lookup Helpers
  // ============================================================================

  /**
   * Find repeater by controlPath
   */
  private findRepeaterByPath(state: PageState, controlPath?: string): RepeaterState | undefined {
    if (!controlPath) return undefined;

    for (const repeater of state.repeaters.values()) {
      if (repeater.controlPath === controlPath) {
        return repeater;
      }
    }

    return undefined;
  }

  /**
   * Find repeater by formId
   */
  private findRepeaterByFormId(state: PageState, formId?: string): RepeaterState | undefined {
    if (!formId) return undefined;

    for (const repeater of state.repeaters.values()) {
      if (repeater.formId === formId) {
        return repeater;
      }
    }

    return undefined;
  }

  /**
   * Find repeater name by controlPath
   */
  private findRepeaterNameByPath(state: PageState, controlPath?: string): string {
    const repeater = this.findRepeaterByPath(state, controlPath);
    return repeater?.name || '';
  }

  // ============================================================================
  // Virtualization Helpers
  // ============================================================================

  /**
   * Get row with virtualization awareness
   *
   * CRITICAL: Distinguish "Data Missing" from "Data Empty"
   * - RowState: Row exists and is loaded
   * - undefined: Row genuinely doesn't exist
   * - 'NOT_LOADED': Row exists but is outside loaded viewport
   *
   * @param repeater - RepeaterState to query
   * @param bookmark - Row bookmark
   * @returns RowLookupResult (tri-state)
   */
  getRow(repeater: RepeaterState, bookmark: string): RowLookupResult {
    const row = repeater.rows.get(bookmark);

    if (row) {
      return row;
    }

    // Check if this bookmark is outside loaded range
    if (repeater.totalRowCount && repeater.rows.size < repeater.totalRowCount) {
      // Grid has more rows than loaded - this might be unloaded
      return 'NOT_LOADED';
    }

    // Row genuinely doesn't exist
    return undefined;
  }

  /**
   * Get grid line count (CRITICAL: Use totalRowCount, not rows.size)
   *
   * @param repeater - RepeaterState to query
   * @returns Full grid size (or loaded size if totalRowCount not set)
   */
  getGridLineCount(repeater: RepeaterState): number {
    return repeater.totalRowCount ?? repeater.rows.size;
  }
}
