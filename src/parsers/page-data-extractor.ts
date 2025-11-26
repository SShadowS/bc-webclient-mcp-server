/**
 * Page Data Extractor
 *
 * Extracts actual data records from BC pages (both card and list types).
 * Uses patterns from Tell Me search for list data extraction.
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { LogicalFormParseError } from '../core/errors.js';
import type { LogicalForm, Control, ControlType, Handler, LogicalClientChangeHandler } from '../types/bc-types.js';
import type {
  DataRefreshChange,
  DataRowInsertedChange,
  PropertyChange,
  PropertyChanges,
  ControlChange,
  Change,
  ClientDataRow,
  LogicalControlBase,
  ControlTypeId,
} from '../types/bc-protocol-types.js';
import { isDataRefreshChange, isDataRowInsertedChange } from '../types/bc-protocol-types.js';
import {
  isDataRefreshChangeType,
  isDataRowInsertedType,
  isDataRowUpdatedType,
  isPropertyChangesType,
  isPropertyChangeType,
} from '../types/bc-type-discriminators.js';
import { logger } from '../core/logger.js';

/**
 * Row data from DataRowInserted/DataRowUpdated
 * BC uses both lowercase (bookmark) and uppercase (Bookmark) depending on context
 */
interface BcRowData {
  bookmark?: string;
  Bookmark?: string;
  cells?: Record<string, BcCellValue>;
  /** Index signature for cell values when cells are at top level */
  [key: string]: unknown;
}

/**
 * Cell value structure in BC protocol
 */
interface BcCellValue {
  sv?: string;
  i32v?: number;
  dcv?: number;
  bv?: boolean;
  dtv?: string;
  stringValue?: string;
  decimalValue?: number;
  intValue?: number;
  boolValue?: boolean;
  dateTimeValue?: string;
  objectValue?: unknown;
}

/**
 * PropertyChanges message from BC protocol
 */
interface BcPropertyChanges {
  t: 'PropertyChanges' | 'PropertyChange';
  ControlReference?: { controlPath?: string };
  Changes?: Record<string, unknown>;
}

/**
 * LogicalForm with Properties (extended for runtime)
 */
interface LogicalFormWithProperties extends LogicalForm {
  Properties?: Record<string, unknown>;
}

/**
 * Generic control type for walking control trees
 */
interface WalkableControl {
  t?: string;
  Children?: WalkableControl[];
  Columns?: RepeaterColumn[];
  ColumnBinder?: { Name?: string };
  Caption?: string;
  DesignName?: string;
  Name?: string;
  ControlId?: number;
  ControlID?: number;
  TableFieldNo?: number;
  FieldNo?: number;
}

/**
 * Repeater column structure
 */
interface RepeaterColumn {
  ColumnBinder?: { Name?: string };
  Name?: string;
  Caption?: string;
  DesignName?: string;
  ControlId?: number;
  ControlID?: number;
  TableFieldNo?: number;
  FieldNo?: number;
}

/**
 * PropertyChange data structure
 */
interface PropertyChangeData {
  t: string;
  ControlReference?: { controlPath?: string };
  Changes?: Record<string, unknown>;
}

/**
 * DataRowUpdated container from handlers
 */
interface DataRowUpdatedContainer {
  t: string;
  DataRowUpdated?: [number, BcRowData];
}

/**
 * Handler with parameters structure
 */
interface HandlerWithParams {
  handlerType: string;
  parameters?: unknown[];
}

/**
 * Mutable control for applying property changes
 */
interface MutableControl {
  t?: string;
  DesignName?: string;
  Name?: string;
  Caption?: string;
  Children?: MutableControl[];
  Properties?: Record<string, unknown>;
}

/**
 * Field control types that contain data values.
 */
const FIELD_CONTROL_TYPES: readonly ControlType[] = [
  'sc',   // String Control
  'dc',   // Decimal Control
  'bc',   // Boolean Control
  'i32c', // Integer32 Control
  'sec',  // Select/Enum Control
  'dtc',  // DateTime Control
  'pc',   // Percent Control
] as const;

/**
 * Repeater control types (list data).
 */
const REPEATER_CONTROL_TYPES: readonly ControlType[] = [
  'rc',  // Repeater Control
  'lrc', // List Repeater Control
] as const;

/**
 * System fields that should NOT be extracted for user display.
 * These are internal BC fields used for tracking/metadata.
 */
const SYSTEM_FIELD_BLOCKLIST: readonly string[] = [
  'SystemId',
  'SystemCreatedAt',
  'SystemModifiedAt',
  'Entity State',
] as const;

/**
 * Regex to detect BC SystemId-style GUIDs
 * Format: 8-4-4-4-12 hexadecimal with dashes
 */
const GUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Check if a value looks like a BC SystemId GUID
 */
function looksLikeSystemIdGuid(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return GUID_REGEX.test(value);
}

/**
 * A single field value in a record.
 */
export interface FieldValue {
  value: string | number | boolean | null;
  displayValue?: string;
  type: 'string' | 'number' | 'boolean' | 'date';
}

/**
 * A single record (row) from a page.
 */
export interface PageRecord {
  bookmark?: string;
  fields: Record<string, FieldValue>;
}

/**
 * Result of page data extraction.
 */
export interface PageDataExtractionResult {
  pageType: 'card' | 'list' | 'document';
  records: PageRecord[];
  totalCount: number;
}

/**
 * Document page lines block (e.g., Sales Lines, Purchase Lines).
 * Each block represents a repeater control containing line items.
 */
export interface DocumentLinesBlock {
  /** Repeater control path (e.g., "server:c[2]/c[0]/c[1]") */
  repeaterPath: string;
  /** User-facing name of the lines section (e.g., "Lines", "Sales Lines") */
  caption: string;
  /** Line item records */
  lines: PageRecord[];
  /** Total number of lines */
  totalCount: number;
}

/**
 * Result of Document page data extraction (header + lines).
 */
export interface DocumentPageDataExtractionResult extends PageDataExtractionResult {
  pageType: 'document';
  /** Header record (card-like data) */
  header: PageRecord;
  /** Lines blocks (one or more repeaters with line data) */
  linesBlocks: DocumentLinesBlock[];
  /** For backwards compatibility, records[0] contains the header */
  records: [PageRecord];
}

/**
 * Column metadata extracted from LogicalForm.Columns[] for a single runtime cell ID.
 */
export interface ColumnMapping {
  /** Runtime cell ID key used in DataRowUpdated/DataRowInserted (e.g., "1295001522_c1", "140"). */
  runtimeId: string;
  /** Semantic field name: prefer Caption, then DesignName, then Name. */
  semanticName: string;
  /** User-facing caption, if present. */
  caption?: string | null;
  /** DesignName from LogicalForm, if present. */
  designName?: string | null;
  /** Numeric control ID, when available (Composite pattern). */
  controlId?: number | null;
  /** BC table field number, when available. */
  tableFieldNo?: number | null;
  /** Column index within the repeater, if present. */
  columnIndex?: number | null;
}

/**
 * Extracts data records from BC pages.
 */
export class PageDataExtractor {
  /**
   * Determines if a LogicalForm represents a list page.
   *
   * Uses CacheKey and ViewMode to distinguish:
   * - List pages: typically have ViewMode other than 2 (View/Edit mode)
   * - Card pages: ViewMode 2 (shows single record)
   *
   * Note: Some card pages have embedded repeaters (for line items),
   * so we can't rely solely on the presence of repeater controls.
   */
  public isListPage(logicalForm: LogicalForm): boolean {
    // ViewMode: 0 = Browse (List), 1 = Create, 2 = Edit/View (Card)
    // If ViewMode is explicitly 0, it's definitely a list page
    if (logicalForm.ViewMode === 0) {
      return true;
    }

    // If ViewMode is 2 (Edit/View), it's likely a card page
    if (logicalForm.ViewMode === 2) {
      return false;
    }

    // Fallback: check for repeater control at top level
    // (This catches list pages that don't set ViewMode correctly)
    return this.hasTopLevelRepeater(logicalForm);
  }

  /**
   * Checks if LogicalForm has a repeater control at the top level
   * (not nested in tabs/parts).
   */
  private hasTopLevelRepeater(logicalForm: LogicalForm): boolean {
    if (!logicalForm.Children || !Array.isArray(logicalForm.Children)) {
      return false;
    }

    // Check only immediate children (top-level controls)
    for (const child of logicalForm.Children) {
      const control = child as Control;
      if (this.isRepeaterControl(control.t as ControlType)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Finds all repeater controls in a LogicalForm tree with their control paths.
   * Used for Document pages to identify line item sections.
   *
   * @param logicalForm - The BC LogicalForm to search
   * @returns Array of repeater info with path, caption, and DesignName
   */
  public findAllRepeatersWithPaths(logicalForm: LogicalForm): Array<{
    path: string;
    caption: string;
    designName: string;
    controlType: 'rc' | 'lrc';
  }> {
    const repeaters: Array<{
      path: string;
      caption: string;
      designName: string;
      controlType: 'rc' | 'lrc';
    }> = [];

    const walkControl = (control: Control, path: string): void => {
      if (!control || typeof control !== 'object') return;

      // Check if this is a repeater control
      const controlType = control.t as ControlType;
      if (controlType === 'rc' || controlType === 'lrc') {
        repeaters.push({
          path,
          caption: String(control.Caption || control.DesignName || 'Unnamed'),
          designName: String(control.DesignName || ''),
          controlType: controlType as 'rc' | 'lrc',
        });
        // Don't walk into repeater children - they're the line data itself
        return;
      }

      // Walk children recursively
      if (Array.isArray(control.Children)) {
        for (let i = 0; i < control.Children.length; i++) {
          const childPath = path ? `${path}/c[${i}]` : `c[${i}]`;
          walkControl(control.Children[i] as Control, childPath);
        }
      }
    };

    // Start walk from root
    walkControl(logicalForm, 'server');
    return repeaters;
  }

  /**
   * Extracts data from a card page (single record).
   *
   * IMPORTANT: BC uses different patterns depending on how the page was opened:
   * - OpenForm (get_page_metadata): Values in control.StringValue/ObjectValue
   * - InvokeAction (drill-down): Values in DataRowUpdated.cells (list pattern)
   *
   * This method handles both patterns automatically.
   */
  public extractCardPageData(logicalForm: LogicalForm, handlers?: readonly unknown[]): Result<PageDataExtractionResult, BCError> {
    try {
      // Build field metadata map from LogicalForm for control ID → semantic name mapping
      const fieldMetadata = this.buildFieldMetadataMap(logicalForm);
      logger.info(`fieldMetadata size: ${fieldMetadata.size}`);
      // Extract column mappings from LogicalForm (runtime ID → semantic name)
      let columnMappings = this.extractColumnMappings(logicalForm);

      // For Card pages, extractColumnMappings returns empty (no repeaters)
      // Extract mappings from ColumnBinder.Name on simple controls instead
      if (!columnMappings || columnMappings.size === 0) {
        logger.info(`No repeater columnMappings, extracting from Card controls' ColumnBinder...`);
        columnMappings = this.extractCardControlColumnMappings(logicalForm);
      }

      logger.info(`columnMappings size: ${columnMappings?.size || 0}`);
      if (columnMappings && columnMappings.size > 0) {
        const first5 = Array.from(columnMappings.entries()).slice(0, 5);
        logger.info(`First 5 columnMappings: ${JSON.stringify(first5).substring(0, 200)}`);
      }

      // Build controlId → semanticName map for Card pages (prefer Table/Column metadata)
      // This prevents Status values from appearing under "Your Reference" or other caption-based keys
      const controlIdToName = new Map<string, string>();

      // 1) From fieldMetadata (DesignName/Name ↔ ControlIdentifier)
      for (const [semanticName, meta] of fieldMetadata.entries()) {
        if (meta.controlId) {
          controlIdToName.set(String(meta.controlId), semanticName);
        }
      }

      // 2) From ColumnBinder-based mappings (runtimeId ↔ controlId)
      if (columnMappings && columnMappings.size > 0) {
        for (const mapping of columnMappings.values()) {
          if (mapping.controlId != null) {
            controlIdToName.set(String(mapping.controlId), mapping.semanticName);
          }
        }
      }

      logger.info(`controlIdToName (Card) size: ${controlIdToName.size}`);

      // Card pages use PropertyChanges for field data (not DataRowUpdated)
      // DataRowUpdated is only for child list controls within Card pages
      logger.info('Extracting Card data using PropertyChanges pattern');

      // Apply PropertyChanges to LogicalForm if available (drill-down pattern)
      let effectiveForm = logicalForm;
      if (handlers) {
        const applied = this.applyPropertyChangesToLogicalForm(logicalForm, handlers);
        if (applied.appliedCount > 0) {
          effectiveForm = applied.updatedForm;
          logger.info(`Applied ${applied.appliedCount} PropertyChanges to LogicalForm for Card page`);
        }
      }

      const fields: Record<string, FieldValue> = {};

      // Walk control tree and extract field values from field controls only
      const fieldEncounters = new Map<string, number>();  // Track duplicate field names
      this.walkControls(effectiveForm, (control: Control) => {
        if (this.isFieldControl(control.t as ControlType)) {
          // Derive a stable control ID (BC tends to use ControlIdentifier or ControlId/ControlID)
          // Use type assertion for optional runtime properties
          const ctrlAny = control as Record<string, unknown>;
          const controlId =
            ctrlAny.ControlIdentifier != null
              ? String(ctrlAny.ControlIdentifier)
              : ctrlAny.ControlId != null
              ? String(ctrlAny.ControlId)
              : ctrlAny.ControlID != null
              ? String(ctrlAny.ControlID)
              : undefined;

          let fieldName: string | null = null;

          // 1) Prefer semantic name from controlId→name mapping when available
          if (controlId && controlIdToName.has(controlId)) {
            fieldName = controlIdToName.get(controlId)!;
          } else {
            // 2) Fallback to heuristic name resolution
            fieldName = this.getFieldName(control);
          }

          if (!fieldName) {
            return;
          }

          const fieldValue = this.extractFieldValueFromControl(control);
          if (fieldValue === null) {
            return;
          }

          // Debug: Log when we find "ÅBEN" to track Status field
          if (fieldValue.value === 'ÅBEN' || String(fieldValue.value).includes('ÅBEN')) {
            logger.info(
              `Status candidate control found in extractCardPageData: ` +
              `t=${control.t}, DesignName=${control.DesignName}, Name=${control.Name}, Caption=${control.Caption}, ` +
              `controlId=${control.ControlIdentifier ?? control.ControlId ?? control.ControlID}, ` +
              `resolvedFieldName=${fieldName}`
            );
          }

          // Track if we're overwriting a field
          const encounterCount = (fieldEncounters.get(fieldName) || 0) + 1;
          fieldEncounters.set(fieldName, encounterCount);

          // Handle duplicate field names: Don't overwrite non-empty value with empty value
          const existingValue = fields[fieldName];
          const newValueIsEmpty = fieldValue.value === null || fieldValue.value === '' || fieldValue.value === undefined;
          const existingValueIsNotEmpty = existingValue && existingValue.value !== null && existingValue.value !== '' && existingValue.value !== undefined;

          if (encounterCount > 1) {
            if (existingValueIsNotEmpty && newValueIsEmpty) {
              logger.debug(`Field "${fieldName}" encountered ${encounterCount} times - SKIPPING empty value (keeping existing non-empty value)`);
              return;  // Skip this control, keep existing value
            } else {
              logger.warn(`Field "${fieldName}" encountered ${encounterCount} times! Previous value will be overwritten.`);
              logger.warn(`   Previous value: ${JSON.stringify(existingValue?.value)}, New value: ${JSON.stringify(fieldValue.value)}`);
            }
          }

          fields[fieldName] = fieldValue;
        }
      });

      // Extract bookmark from LogicalForm Properties (card/document pages)
      // Use effectiveForm which has PropertyChanges applied (Bookmark is set via PropertyChanges)
      const formWithProps = effectiveForm as LogicalFormWithProperties;
      const bookmark = formWithProps.Properties?.Bookmark as string | undefined;
      logger.info(`extractCardPageData: effectiveForm.Properties = ${JSON.stringify(formWithProps.Properties)?.substring(0, 200)}`);
      logger.info(`extractCardPageData: Bookmark = ${bookmark}`);
      const record: PageRecord = { bookmark, fields };

      return ok({
        pageType: 'card',
        records: [record],
        totalCount: 1,
      });
    } catch (error) {
      return err(
        new LogicalFormParseError(
          `Failed to extract card page data: ${error instanceof Error ? error.message : String(error)}`,
          { originalError: error }
        )
      );
    }
  }

  /**
   * Extracts data from a list page (multiple records).
   * Data arrives via DataRefreshChange handlers (async).
   *
   * @param handlers - Handlers containing DataRefreshChange with row data
   * @param logicalForm - Optional LogicalForm metadata to filter visible fields only
   */
  public extractListPageData(
    handlers: readonly unknown[],
    logicalForm?: LogicalForm
  ): Result<PageDataExtractionResult, BCError> {
    try {
      // Find LogicalClientChangeHandler with DataRefreshChange
      const changeHandler = (handlers as readonly Handler[]).find(
        (h): h is LogicalClientChangeHandler => h.handlerType === 'DN.LogicalClientChangeHandler'
      );

      if (!changeHandler) {
        // No data yet - return empty result
        return ok({
          pageType: 'list',
          records: [],
          totalCount: 0,
        });
      }

      // Get changes array (parameters[1])
      const changes = changeHandler.parameters?.[1] as readonly Change[] | undefined;
      if (!Array.isArray(changes)) {
        return ok({
          pageType: 'list',
          records: [],
          totalCount: 0,
        });
      }

      // Find DataRefreshChange for main repeater
      // BC27+ uses full type name 'DataRefreshChange' instead of shorthand 'drch'
      // BC27 uses lowercase 'controlPath' not 'ControlPath'
      const dataChange = changes.find(
        (c): c is DataRefreshChange => isDataRefreshChangeType(c.t) && !!(c as DataRefreshChange).ControlReference?.controlPath
      );

      if (!dataChange || !Array.isArray(dataChange.RowChanges)) {
        return ok({
          pageType: 'list',
          records: [],
          totalCount: 0,
        });
      }

      // Build field metadata map from LogicalForm (if provided) for visibility filtering
      let fieldMetadata: Map<string, { visible: boolean; hasCaption: boolean; controlId?: string }> | null = null;
      let columnMappings: Map<string, ColumnMapping> | null = null;

      if (logicalForm) {
        fieldMetadata = this.buildFieldMetadataMap(logicalForm);
        columnMappings = this.extractColumnMappings(logicalForm);
      }

      // Extract records from row changes
      // Note: RowChanges contains DataRowInsertedChange with custom serialization
      // The actual row data is in a legacy DataRowInserted property (array format)
      const rowChanges = dataChange.RowChanges as readonly (DataRowInsertedChange & { DataRowInserted?: [number, ClientDataRow] })[];
      const records: PageRecord[] = rowChanges
        .filter((row): row is DataRowInsertedChange & { DataRowInserted: [number, ClientDataRow] } =>
          // BC27+ uses full type name 'DataRowInserted' instead of shorthand 'drich'
          isDataRowInsertedType(row.t) && Array.isArray((row as { DataRowInserted?: unknown }).DataRowInserted)
        )
        .map((row) => this.extractRecordFromRow(row.DataRowInserted[1], fieldMetadata, columnMappings))
        .filter((record: PageRecord | null): record is PageRecord => record !== null);

      return ok({
        pageType: 'list',
        records,
        totalCount: records.length,
      });
    } catch (error) {
      return err(
        new LogicalFormParseError(
          `Failed to extract list page data: ${error instanceof Error ? error.message : String(error)}`,
          { originalError: error }
        )
      );
    }
  }

  /**
   * Extracts data from a Document page (header + lines).
   *
   * Document pages (Sales Orders, Purchase Orders) have:
   * - Header fields (card-like) - extracted from PropertyChanges
   * - Line sections (list-like repeaters) - extracted from DataRefreshChange
   *
   * @param logicalForm - The BC LogicalForm
   * @param handlers - All handlers from OpenForm + LoadForm
   * @returns Document page extraction result with header and linesBlocks
   */
  public extractDocumentPageData(
    logicalForm: LogicalForm,
    handlers: readonly unknown[]
  ): Result<DocumentPageDataExtractionResult, BCError> {
    try {
      // Step 1: Extract header fields using card page extraction logic
      logger.info(`Extracting Document page header fields...`);
      const headerResult = this.extractCardPageData(logicalForm, handlers);

      if (!isOk(headerResult)) {
        return headerResult as Result<never, BCError>;
      }

      const headerRecord = headerResult.value.records[0];
      logger.info(`Extracted ${Object.keys(headerRecord?.fields || {}).length} header fields`);

      // Step 2: Find all repeater controls (potential line sections)
      const repeaters = this.findAllRepeatersWithPaths(logicalForm);
      logger.info(`Found ${repeaters.length} repeater(s) in Document page`);

      // Step 3: Extract lines from DataRefreshChange handlers
      // NOTE: We don't try to match DataRefreshChange to specific repeaters because
      // BC uses different path formats (server:c[1] vs server/c[2]/c[0]/c[1])
      const linesBlocks: DocumentLinesBlock[] = [];

      // Find ALL DataRefreshChange handlers
      const dataRefreshHandlers = handlers.filter((h): h is Handler => {
        const handler = h as Handler;
        if (handler.handlerType !== 'DN.LogicalClientChangeHandler') return false;

        const changeHandler = handler as LogicalClientChangeHandler;
        const params = changeHandler.parameters?.[1] as readonly Change[] | undefined;
        if (!Array.isArray(params)) return false;

        // BC27+ uses full type name 'DataRefreshChange' instead of shorthand 'drch'
        return params.some((change) => isDataRefreshChangeType(change.t));
      });

      logger.info(`Found ${dataRefreshHandlers.length} DataRefreshChange handler(s)`);

      if (dataRefreshHandlers.length > 0) {
        // Try to extract list data from ALL DataRefreshChange handlers
        const linesResult = this.extractListPageData(dataRefreshHandlers, logicalForm);

        if (isOk(linesResult) && linesResult.value.totalCount > 0) {
          // Use the first repeater's caption as a fallback, or "Lines" if no repeaters found
          const caption = repeaters.length > 0 ? repeaters[0].caption : 'Lines';
          const path = repeaters.length > 0 ? repeaters[0].path : 'unknown';

          linesBlocks.push({
            repeaterPath: path,
            caption,
            lines: linesResult.value.records,
            totalCount: linesResult.value.totalCount,
          });
          logger.info(`Extracted ${linesResult.value.totalCount} line(s) from DataRefreshChange`);
        } else {
          logger.info(`No lines found in DataRefreshChange handlers`);
        }
      } else {
        logger.info(`No DataRefreshChange handlers found (empty order)`);
      }

      // Step 4: Return structured result
      // Note: We also populate the `records` array for backwards compatibility
      // with existing tools that expect records[0] to be the main data
      return ok({
        pageType: 'document',
        header: headerRecord,
        linesBlocks,
        records: [headerRecord], // Backwards compatibility
        totalCount: 1, // Header is always 1 record
      });
    } catch (error) {
      return err(
        new LogicalFormParseError(
          `Failed to extract document page data: ${error instanceof Error ? error.message : String(error)}`,
          { originalError: error }
        )
      );
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Checks if control type is a field control.
   */
  private isFieldControl(type: ControlType): boolean {
    return FIELD_CONTROL_TYPES.includes(type as typeof FIELD_CONTROL_TYPES[number]);
  }

  /**
   * Checks if control type is a repeater control.
   */
  private isRepeaterControl(type: ControlType): boolean {
    return REPEATER_CONTROL_TYPES.includes(type as typeof REPEATER_CONTROL_TYPES[number]);
  }


  /**
   * Walks control tree and calls visitor for each control.
   */
  private walkControls(control: Control | LogicalForm, visitor: (control: Control) => void): void {
    if (!control || typeof control !== 'object') {
      return;
    }

    // Visit current control
    visitor(control as Control);

    // Walk children
    if (Array.isArray(control.Children)) {
      for (const child of control.Children) {
        this.walkControls(child as Control, visitor);
      }
    }
  }

  /**
   * Gets the field name from a control.
   * Prefers DesignName → Name → Caption (only as last resort).
   * Caption should only be used when we have no better identifier to avoid mixing field values.
   */
  private getFieldName(control: Control): string | null {
    // Prefer underlying design/name over captions to avoid mixing values
    if (typeof control.DesignName === 'string' && control.DesignName.trim().length > 0) {
      return control.DesignName;
    }

    if (typeof control.Name === 'string' && control.Name.trim().length > 0) {
      return control.Name;
    }

    // Fallback: only use Caption when there really is no internal name
    if (typeof control.Caption === 'string' && control.Caption.trim().length > 0) {
      return control.Caption;
    }

    return null;
  }

  /**
   * Extracts field value from a LogicalForm control (card page pattern).
   *
   * IMPORTANT: BC sends values in different locations depending on the operation:
   * - OpenForm (get_page_metadata): Values in control.StringValue/ObjectValue
   * - InvokeAction (drill-down): Values in control.Properties.Value
   *
   * This method checks BOTH locations to support both scenarios.
   */
  private extractFieldValueFromControl(control: Control): FieldValue | null {
    const type = control.t as ControlType;
    // Use type assertion to access runtime properties that may not be in the base type
    const ctrlRecord = control as Record<string, unknown>;

    try {
      // PropertyChanges sets Properties.StringValue/ObjectValue (drill-down pattern)
      // OpenForm sets direct StringValue/ObjectValue
      const props = ctrlRecord.Properties as Record<string, unknown> | undefined;
      const propertiesStringValue = props?.StringValue as string | undefined;
      const propertiesObjectValue = props?.ObjectValue;

      switch (type) {
        case 'bc': // Boolean
          return {
            value: Boolean(propertiesObjectValue ?? control.ObjectValue ?? false),
            type: 'boolean',
          };

        case 'dc': // Decimal
        case 'pc': // Percent
          const decimalStr = propertiesStringValue ?? control.StringValue ?? '0';
          return {
            value: parseFloat(String(decimalStr)),
            displayValue: String(decimalStr),
            type: 'number',
          };

        case 'i32c': // Integer
          const intStr = propertiesStringValue ?? control.StringValue ?? '0';
          return {
            value: parseInt(String(intStr), 10),
            displayValue: String(intStr),
            type: 'number',
          };

        case 'sec': // Select/Enum
          return this.extractSelectValue(control, props);

        case 'dtc': // DateTime
          const dateVal = propertiesStringValue ?? control.StringValue ?? null;
          return {
            value: dateVal != null ? String(dateVal) : null,
            type: 'date',
          };

        case 'sc': // String
        default:
          const strVal = propertiesStringValue ?? propertiesObjectValue ?? control.StringValue ?? control.ObjectValue ?? null;
          return {
            value: strVal != null ? String(strVal) : null,
            type: 'string',
          };
      }
    } catch (error) {
      logger.warn(
        `Failed to extract value from control ${this.getFieldName(control)}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Extracts value from a select/enum control.
   */
  private extractSelectValue(control: Control, props?: Record<string, unknown>): FieldValue | null {
    // PropertyChanges sets Properties.CurrentIndex/StringValue (drill-down pattern)
    // OpenForm sets direct CurrentIndex/StringValue
    const ctrlRecord = control as Record<string, unknown>;
    const currentIndex = props?.CurrentIndex ?? ctrlRecord.CurrentIndex;
    const items = (props?.Items ?? ctrlRecord.Items) as readonly { Value?: unknown; Caption?: string }[] | undefined;
    const stringValue = props?.StringValue ?? control.StringValue;
    const objectValue = props?.ObjectValue ?? control.ObjectValue;

    // CRITICAL: Prefer explicit StringValue from Properties (set by PropertyChanges)
    // over Items lookup. BC sends the localized display string via StringValue
    // when the value changes, and we should respect that.
    // Only use Items array as fallback when no explicit string value is provided.
    if (stringValue !== null && stringValue !== undefined && stringValue !== '') {
      // BC provided explicit string value via PropertyChanges
      return {
        value: String(stringValue),
        type: 'string',
      };
    }

    // No explicit string value, try to look up from Items array
    if (typeof currentIndex !== 'number' || !Array.isArray(items)) {
      // No Items array available, fallback to object value
      return {
        value: objectValue != null ? String(objectValue) : null,
        type: 'string',
      };
    }

    const selectedItem = items[currentIndex];
    if (!selectedItem) {
      return {
        value: null,
        type: 'string',
      };
    }

    return {
      value: selectedItem.Value != null ? String(selectedItem.Value) : String(selectedItem),
      displayValue: selectedItem.Caption ?? String(selectedItem),
      type: 'string',
    };
  }

  /**
   * Extracts a record from a DataRowInserted row (list page pattern).
   *
   * @param rowData - Row data with cells object
   * @param fieldMetadata - Optional field metadata for visibility filtering
   * @param columnMappings - Optional column mappings for runtime ID → semantic name translation
   */
  private extractRecordFromRow(
    rowData: BcRowData | ClientDataRow,
    fieldMetadata: Map<string, { visible: boolean; hasCaption: boolean; controlId?: string }> | null = null,
    columnMappings?: Map<string, ColumnMapping> | null
  ): PageRecord | null {
    if (!rowData) {
      return null;
    }

    // BC has two cell patterns:
    // 1. Nested: rowData.cells = { fieldName: cellValue }
    // 2. Flat: rowData[fieldName] = cellValue (ClientDataRow style)
    const bcRow = rowData as BcRowData;
    const clientRow = rowData as ClientDataRow;

    // Get cells - prefer nested 'cells' property, fall back to flat structure
    const cells = bcRow.cells ?? this.extractFlatCells(clientRow);
    if (!cells || Object.keys(cells).length === 0) {
      return null;
    }

    // Build reverse map: controlId → { semanticName, metadata }
    const controlIdToName = new Map<string, { name: string; visible: boolean; hasCaption: boolean }>();
    if (fieldMetadata) {
      for (const [semanticName, meta] of fieldMetadata.entries()) {
        if (meta.controlId) {
          controlIdToName.set(meta.controlId, {
            name: semanticName,
            visible: meta.visible,
            hasCaption: meta.hasCaption
          });
        }
      }
    }

    const fields: Record<string, FieldValue> = {};

    // Extract cell values with filtering
    let cellIndex = 0;
    for (const [cellKey, cellValue] of Object.entries(cells)) {
      // Extract cell value early to check for GUID pattern
      const extractedValue = this.extractCellValue(cellValue as BcCellValue);

      // POSITIONAL + PATTERN FILTER: Skip first cell if it's a GUID (likely SystemId)
      // This is a pragmatic heuristic since we cannot map control IDs to semantic names
      if (cellIndex === 0 && extractedValue !== null && looksLikeSystemIdGuid(extractedValue.value)) {
        logger.debug(`Filtered SystemId GUID at position 0: ${extractedValue.value}`);
        cellIndex++;
        continue;
      }

      // 1) Prefer columnMappings: runtime ID → semanticName
      let semanticName: string = cellKey;
      let visible = true;
      let hasCaption = true;

      let colMapping: ColumnMapping | undefined;
      if (columnMappings && columnMappings.size > 0) {
        colMapping = columnMappings.get(cellKey);
        if (colMapping) {
          semanticName = colMapping.semanticName || cellKey;
          // We don't have explicit visible/hasCaption here; derive hasCaption from caption presence
          hasCaption = !!(colMapping.caption && colMapping.caption.trim().length > 0);
        }
      }

      // 2) Fallback: old controlId-based mapping using fieldMetadata
      const nameInfo = controlIdToName.get(cellKey);
      if (!colMapping && nameInfo) {
        semanticName = nameInfo.name;
        visible = nameInfo.visible;
        hasCaption = nameInfo.hasCaption;
      }

      // Filter system fields (SystemId, etc.)
      if (SYSTEM_FIELD_BLOCKLIST.includes(semanticName)) {
        logger.debug(`Filtered system field: ${semanticName}`);
        cellIndex++;
        continue;
      }

      // Filter hidden / non-caption fields when we have metadata
      if (nameInfo) {
        if (!visible) {
          logger.debug(`Filtered hidden field: ${semanticName}`);
          cellIndex++;
          continue;
        }
        if (!hasCaption) {
          logger.debug(`Filtered field without caption: ${semanticName}`);
          cellIndex++;
          continue;
        }
      }

      if (extractedValue !== null) {
        fields[semanticName] = extractedValue;
      }

      cellIndex++;
    }

    // Get bookmark - BC uses both lowercase and uppercase
    const bookmark = bcRow.bookmark ?? clientRow.Bookmark;

    return {
      bookmark,
      fields,
    };
  }

  /**
   * Extracts flat cells from ClientDataRow (skipping known metadata fields).
   */
  private extractFlatCells(row: ClientDataRow): Record<string, BcCellValue> {
    const cells: Record<string, BcCellValue> = {};
    const metadataFields = ['Bookmark', 'Selected', 'Draft', 'Expanded', 'CanExpand', 'Depth'];

    for (const [key, value] of Object.entries(row)) {
      // Skip metadata fields
      if (metadataFields.includes(key)) continue;

      // Value could be a cell value object or direct primitive
      if (value && typeof value === 'object') {
        cells[key] = value as BcCellValue;
      } else if (value !== undefined) {
        // Wrap primitive in cell value object
        cells[key] = { sv: String(value) } as BcCellValue;
      }
    }

    return cells;
  }

  /**
   * Extracts field value from a cell (DataRefreshChange pattern).
   */
  private extractCellValue(cell: BcCellValue): FieldValue | null {
    if (!cell || typeof cell !== 'object') {
      return null;
    }

    // BC27+ List Page Format: Check for BC-specific property names first
    // These are used in DataRefreshChange/DataRowInserted for list pages
    if (cell.sv !== undefined) {
      return {
        value: cell.sv,
        type: 'string',
      };
    }

    if (cell.i32v !== undefined) {
      return {
        value: cell.i32v,
        type: 'number',
      };
    }

    if (cell.dcv !== undefined) {
      return {
        value: cell.dcv,
        type: 'number',
      };
    }

    if (cell.bv !== undefined) {
      return {
        value: cell.bv,
        type: 'boolean',
      };
    }

    if (cell.dtv !== undefined) {
      return {
        value: cell.dtv,
        type: 'date',
      };
    }

    // Card Page Format: Check for typed value properties
    if (cell.stringValue !== undefined) {
      return {
        value: cell.stringValue,
        type: 'string',
      };
    }

    if (cell.decimalValue !== undefined) {
      return {
        value: cell.decimalValue,
        type: 'number',
      };
    }

    if (cell.intValue !== undefined) {
      return {
        value: cell.intValue,
        type: 'number',
      };
    }

    if (cell.boolValue !== undefined) {
      return {
        value: cell.boolValue,
        type: 'boolean',
      };
    }

    if (cell.dateTimeValue !== undefined) {
      return {
        value: cell.dateTimeValue,
        type: 'date',
      };
    }

    // Check for objectValue (used in DataRowUpdated)
    if (cell.objectValue !== undefined) {
      // Determine type from objectValue
      if (typeof cell.objectValue === 'boolean') {
        return { value: cell.objectValue, type: 'boolean' };
      } else if (typeof cell.objectValue === 'number') {
        return {
          value: cell.objectValue,
          displayValue: cell.stringValue,
          type: 'number'
        };
      } else if (typeof cell.objectValue === 'string') {
        return { value: cell.objectValue, type: 'string' };
      } else if (cell.objectValue === null) {
        return { value: null, type: 'string' };
      } else {
        // Unknown object type - convert to string
        return { value: String(cell.objectValue), type: 'string' };
      }
    }

    // No value found
    return null;
  }

  /**
   * Finds DataRowUpdated from handlers (drill-down pattern).
   */
  private findDataRowUpdated(handlers: readonly unknown[]): DataRowUpdatedContainer | null {
    logger.info(`findDataRowUpdated: Searching ${handlers.length} handlers...`);
    for (const handler of handlers) {
      const h = handler as HandlerWithParams;
      if (h.handlerType === 'DN.LogicalClientChangeHandler') {
        const changes = h.parameters?.[1];
        if (Array.isArray(changes)) {
          logger.info(`  Checking ${changes.length} changes...`);
          const dataRowUpdated = changes.find((c: { t?: string }) => isDataRowUpdatedType(c.t)) as DataRowUpdatedContainer | undefined;
          if (dataRowUpdated) {
            logger.info(`  Found DataRowUpdated! Keys: ${Object.keys(dataRowUpdated).join(', ')}`);
            return dataRowUpdated;
          }
        }
      }
    }
    logger.info(`  No DataRowUpdated found`);
    return null;
  }

  /**
   * Builds a field metadata map from LogicalForm for visibility filtering.
   *
   * Implements Visibility & Relevance Heuristic:
   * - Checks Visible property (false = hidden field)
   * - Checks Caption presence (no caption = likely internal anchor)
   * - Prioritizes Field controls over Group/Container controls
   */
  private buildFieldMetadataMap(logicalForm: LogicalForm): Map<string, { visible: boolean; hasCaption: boolean; controlId?: string }> {
    const metadata = new Map<string, { visible: boolean; hasCaption: boolean; controlId?: string }>();

    this.walkControls(logicalForm, (control) => {
      const fieldName = this.getFieldName(control);
      if (!fieldName) return;

      // Check visibility (default true if not specified)
      const visible = control.Visible !== false;

      // Check if control has a caption (user-facing fields typically have captions)
      const hasCaption = typeof control.Caption === 'string' && control.Caption.trim().length > 0;

      // Store control ID for mapping cells keys to semantic names
      const controlId = control.ControlIdentifier ? String(control.ControlIdentifier) : undefined;

      metadata.set(fieldName, { visible, hasCaption, controlId });
    });

    logger.debug(`Built field metadata map with ${metadata.size} fields`);
    return metadata;
  }

  /**
   * Extracts runtime cell ID → column metadata mappings from LogicalForm repeater Columns[].
   *
   * Supports both:
   *  - Composite IDs: ColumnBinder.Name = "{controlId}_c{tableFieldNo}"
   *  - Simple IDs: Name = "{tableFieldNo}" or symbolic names ("Icon", "Name")
   *
   * Returns a Map keyed by runtimeId used in DataRowUpdated/DataRowInserted.cells.
   */
  private extractColumnMappings(logicalForm: LogicalForm): Map<string, ColumnMapping> {
    const mappings = new Map<string, ColumnMapping>();

    try {
      // Recursively walk the control tree to find ALL repeaters
      // (not just direct children, as Document pages have nested repeaters)
      const walkControl = (control: WalkableControl): void => {
        if (!control || typeof control !== 'object') return;

        const controlType = control.t as ControlType | undefined;
        const isRepeater =
          controlType === 'rc' ||
          controlType === 'lrc' ||
          Array.isArray(control.Columns);

        // If this is a repeater with columns, extract mappings
        if (isRepeater && Array.isArray(control.Columns)) {
          const columns: RepeaterColumn[] = control.Columns;

          for (let index = 0; index < columns.length; index++) {
            const col = columns[index];
            if (!col || typeof col !== 'object') continue;

            let runtimeId: string | null = null;

            // Pattern 1: Composite ID from ColumnBinder.Name
            if (col.ColumnBinder && typeof col.ColumnBinder.Name === 'string') {
              runtimeId = col.ColumnBinder.Name;
            }
            // Pattern 2: Simple ID from Name
            else if (typeof col.Name === 'string') {
              runtimeId = col.Name;
            }

            if (!runtimeId) {
              // No usable runtime ID - skip
              continue;
            }

            const caption: string | null = typeof col.Caption === 'string' ? col.Caption : null;
            const designName: string | null = typeof col.DesignName === 'string' ? col.DesignName : null;

            // Semantic name: prefer Caption, then DesignName, then Name
            const semanticName =
              caption && caption.trim().length > 0
                ? caption
                : designName && designName.trim().length > 0
                ? designName
                : typeof col.Name === 'string'
                ? col.Name
                : runtimeId;

            const mapping: ColumnMapping = {
              runtimeId,
              semanticName,
              caption,
              designName,
              controlId:
                typeof col.ControlId === 'number'
                  ? col.ControlId
                  : typeof col.ControlID === 'number'
                  ? col.ControlID
                  : null,
              tableFieldNo:
                typeof col.TableFieldNo === 'number'
                  ? col.TableFieldNo
                  : typeof col.FieldNo === 'number'
                  ? col.FieldNo
                  : null,
              columnIndex: Number.isInteger(index) ? index : null,
            };

            // Prefer first-seen mapping; log if overriding (should be rare)
            if (mappings.has(runtimeId)) {
              const existing = mappings.get(runtimeId)!;
              logger.debug(
                `Duplicate column mapping for runtimeId "${runtimeId}".` +
                  ` Keeping existing semanticName="${existing.semanticName}",` +
                  ` ignoring new semanticName="${mapping.semanticName}"`
              );
              continue;
            }

            mappings.set(runtimeId, mapping);
          }
        }

        // Recursively walk children
        if (Array.isArray(control.Children)) {
          for (const child of control.Children) {
            walkControl(child);
          }
        }
      };

      // Start the recursive walk from the LogicalForm root
      walkControl(logicalForm as WalkableControl);

      logger.debug(`Built column mappings map with ${mappings.size} entries from LogicalForm.Columns[]`);
      return mappings;
    } catch (error) {
      logger.warn(
        `Failed to extract column mappings from LogicalForm: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return mappings;
    }
  }

  /**
   * Extracts column mappings from Card page field controls' ColumnBinder.Name properties.
   * Unlike List pages (which use repeater Columns), Card pages have ColumnBinder on individual field controls.
   *
   * @param logicalForm - The Card page LogicalForm
   * @returns Map of runtime ID (from ColumnBinder.Name) to semantic field name
   */
  private extractCardControlColumnMappings(logicalForm: LogicalForm): Map<string, ColumnMapping> {
    const mappings = new Map<string, ColumnMapping>();

    try {
      let index = 0;

      // Walk all controls looking for ColumnBinder.Name properties
      this.walkControls(logicalForm, (control: Control) => {
        const walkable = control as WalkableControl;
        if (walkable.ColumnBinder && typeof walkable.ColumnBinder.Name === 'string') {
          const runtimeId = walkable.ColumnBinder.Name;
          const caption = typeof walkable.Caption === 'string' ? walkable.Caption : null;
          const designName = typeof walkable.DesignName === 'string' ? walkable.DesignName : null;

          // Semantic name: prefer Caption, then DesignName, then Name
          const semanticName =
            (caption && caption.trim().length > 0) ? caption :
            (designName && designName.trim().length > 0) ? designName :
            (typeof walkable.Name === 'string') ? walkable.Name :
            runtimeId;

          const mapping: ColumnMapping = {
            runtimeId,
            semanticName,
            caption,
            designName,
            controlId:
              typeof walkable.ControlId === 'number' ? walkable.ControlId :
              typeof walkable.ControlID === 'number' ? walkable.ControlID :
              null,
            tableFieldNo:
              typeof walkable.TableFieldNo === 'number' ? walkable.TableFieldNo :
              typeof walkable.FieldNo === 'number' ? walkable.FieldNo :
              null,
            columnIndex: index++,
          };

          // Prefer first-seen mapping; skip duplicates
          if (mappings.has(runtimeId)) {
            const existing = mappings.get(runtimeId)!;
            logger.debug(
              `Duplicate ColumnBinder mapping for runtimeId "${runtimeId}".` +
                ` Keeping existing semanticName="${existing.semanticName}",` +
                ` ignoring new semanticName="${mapping.semanticName}"`
            );
            return;
          }

          mappings.set(runtimeId, mapping);
          logger.debug(`  ColumnBinder mapping: ${runtimeId} -> ${semanticName}`);
        }
      });

      logger.info(`Extracted ${mappings.size} Card control ColumnBinder mappings`);
    } catch (error) {
      logger.warn({ error }, 'Failed to extract Card control column mappings');
    }

    return mappings;
  }

  /**
   * Extracts card data from DataRowUpdated (drill-down pattern).
   * Uses the same cell extraction and field mapping logic as list pages.
   */
  private extractFromDataRowUpdated(
    dataRowUpdated: DataRowUpdatedContainer,
    fieldMetadata?: Map<string, { controlId: string; type: string; visible: boolean; hasCaption: boolean }>,
    columnMappings?: Map<string, ColumnMapping> | null
  ): Result<PageDataExtractionResult, BCError> {
    try {
      logger.info(`extractFromDataRowUpdated: dataRowUpdated keys = ${Object.keys(dataRowUpdated).join(', ')}`);
      logger.info(`dataRowUpdated.DataRowUpdated type = ${Array.isArray(dataRowUpdated.DataRowUpdated) ? 'array' : typeof dataRowUpdated.DataRowUpdated}`);
      if (Array.isArray(dataRowUpdated.DataRowUpdated)) {
        logger.info(`dataRowUpdated.DataRowUpdated length = ${dataRowUpdated.DataRowUpdated.length}`);
      }

      // DataRowUpdated structure: [index, rowData]
      const rowData = dataRowUpdated.DataRowUpdated?.[1];
      logger.info(`rowData exists? ${!!rowData}, rowData keys = ${rowData ? Object.keys(rowData).join(', ') : 'N/A'}`);
      logger.info(`rowData.cells exists? ${!!(rowData?.cells)}, cells keys = ${rowData?.cells ? Object.keys(rowData.cells).join(', ').substring(0, 100) : 'N/A'}`);

      if (!rowData || !rowData.cells) {
        logger.info(`No rowData or cells found, returning empty records`);
        return ok({
          pageType: 'card',
          records: [],
          totalCount: 0,
        });
      }

      // Build reverse map: controlId → { semanticName, metadata} (same as List pages)
      const controlIdToName = new Map<string, { name: string; visible: boolean; hasCaption: boolean }>();
      if (fieldMetadata) {
        for (const [semanticName, meta] of fieldMetadata.entries()) {
          if (meta.controlId) {
            controlIdToName.set(meta.controlId, {
              name: semanticName,
              visible: meta.visible,
              hasCaption: meta.hasCaption
            });
          }
        }
      }
      logger.info(`controlIdToName size: ${controlIdToName.size}`);
      if (controlIdToName.size > 0) {
        const first5 = Array.from(controlIdToName.entries()).slice(0, 5);
        logger.info(`First 5 controlIdToName: ${JSON.stringify(first5).substring(0, 200)}`);
      }

      const fields: Record<string, FieldValue> = {};
      logger.info(`Processing ${Object.keys(rowData.cells).length} cells, columnMappings size = ${columnMappings?.size || 0}`);

      for (const [cellKey, cellValue] of Object.entries(rowData.cells)) {
        const extractedValue = this.extractCellValue(cellValue as BcCellValue);
        logger.info(`  Cell ${cellKey}: extractedValue = ${JSON.stringify(extractedValue)?.substring(0, 100)}`);

        if (extractedValue === null) {
          logger.info(`    Skipped (null value)`);
          continue;
        }

        // 1) Prefer columnMappings: runtime ID → semanticName
        let semanticName: string = cellKey;
        let visible = true;
        let hasCaption = true;

        let colMapping: ColumnMapping | undefined;
        if (columnMappings && columnMappings.size > 0) {
          colMapping = columnMappings.get(cellKey);
          if (colMapping) {
            semanticName = colMapping.semanticName || cellKey;
            hasCaption = !!(colMapping.caption && colMapping.caption.trim().length > 0);
            logger.info(`    Mapped to semantic name: ${semanticName}`);
          } else {
            logger.info(`    No columnMapping found for ${cellKey}`);
          }
        } else {
          logger.info(`    No columnMappings available`);
        }

        // 2) Fallback: old metadata map based on ControlIdentifier
        const nameInfo = controlIdToName.get(cellKey);
        if (!colMapping && nameInfo) {
          logger.info(`    Fallback: controlIdToName[${cellKey}] = ${nameInfo.name}`);
          semanticName = nameInfo.name;
          visible = nameInfo.visible;
          hasCaption = nameInfo.hasCaption;
        } else if (!colMapping) {
          logger.info(`    No match in controlIdToName for ${cellKey}`);
        }

        // Filter system fields
        if (SYSTEM_FIELD_BLOCKLIST.includes(semanticName)) {
          logger.debug(`Filtered system field on Card page: ${semanticName}`);
          continue;
        }

        // Filter hidden / caption-less fields when we have metadata
        if (nameInfo) {
          if (!visible) {
            logger.debug(`Filtered hidden field on Card page: ${semanticName}`);
            continue;
          }
          if (!hasCaption) {
            logger.debug(`Filtered field without caption on Card page: ${semanticName}`);
            continue;
          }
        }

        fields[semanticName] = extractedValue;
      }

      return ok({
        pageType: 'card',
        records: [{
          bookmark: rowData.bookmark,
          fields,
        }],
        totalCount: 1,
      });
    } catch (error) {
      return err(
        new LogicalFormParseError(
          `Failed to extract card data from DataRowUpdated: ${error instanceof Error ? error.message : String(error)}`,
          { originalError: error }
        )
      );
    }
  }

  /**
   * Applies PropertyChanges from handlers to a deep-cloned LogicalForm.
   * PropertyChanges contain field values that arrive after the initial LogicalForm.
   *
   * @param logicalForm - Original LogicalForm (will be cloned, not mutated)
   * @param handlers - Handlers potentially containing PropertyChanges
   * @returns Object with cloned+updated form and count of applied changes
   */
  public applyPropertyChangesToLogicalForm(
    logicalForm: LogicalForm,
    handlers: readonly unknown[]
  ): { updatedForm: LogicalForm; appliedCount: number } {
    logger.info(`applyPropertyChangesToLogicalForm called with ${handlers.length} handlers`);

    // Deep clone to avoid mutating cached LogicalForm
    const clonedForm = JSON.parse(JSON.stringify(logicalForm)) as LogicalForm;
    let appliedCount = 0;
    let propertyChangesFound = 0;

    // DIAGNOSTIC: Find all PropertyChanges for Name field
    logger.error(`[READ DIAGNOSTIC] Searching for PropertyChanges with controlPath "server:c[0]/c[1]" (Name field)...`);

    // Find all PropertyChanges in handlers
    for (const handler of handlers) {
      if (typeof handler !== 'object' || handler === null) continue;

      const h = handler as HandlerWithParams;
      if (h.handlerType === 'DN.LogicalClientChangeHandler') {
        const params = h.parameters;
        if (params && params[1] && Array.isArray(params[1])) {
          for (const change of params[1]) {
            const propChange = change as PropertyChangeData;
            // BC uses both full type names and shorthand codes:
            // - "PropertyChanges" / "prc" / "lcpchs" (batch)
            // - "PropertyChange" / "prch" / "lcpch" (single)
            if (propChange && typeof propChange === 'object' && (isPropertyChangesType(propChange.t) || isPropertyChangeType(propChange.t))) {
              propertyChangesFound++;
              logger.info(`   Found ${propChange.t} #${propertyChangesFound}: ControlReference=${JSON.stringify(propChange.ControlReference)}`);
              logger.info(`   Changes keys: ${Object.keys(propChange.Changes || {}).join(', ')}`);

              // DIAGNOSTIC: Log Name field specifically
              if (propChange.ControlReference?.controlPath === 'server:c[0]/c[1]') {
                logger.error(`[READ DIAGNOSTIC] Found Name field: t=${propChange.t}, StringValue="${propChange.Changes?.StringValue}"`);
              }

              // Apply this PropertyChanges/PropertyChange to the cloned form
              const applied = this.applyPropertyChange(clonedForm, propChange);
              if (applied > 0) {
                logger.info(`   Applied ${propChange.t} #${propertyChangesFound}`);
              } else {
                logger.info(`   Failed to apply ${propChange.t} #${propertyChangesFound}`);
              }
              appliedCount += applied;
            }
          }
        }
      }
    }

    logger.info(`PropertyChanges summary: Found ${propertyChangesFound}, Applied ${appliedCount}`);
    return { updatedForm: clonedForm, appliedCount };
  }

  /**
   * Recursively finds the first field control within a control tree.
   * Used to redirect PropertyChanges from group controls to actual field controls.
   */
  private findFirstFieldControl(control: MutableControl): MutableControl | null {
    if (!control || typeof control !== 'object') return null;

    // Check if this control is a field control
    if (this.isFieldControl(control.t as ControlType)) {
      return control;
    }

    // Recursively search children
    if (Array.isArray(control.Children)) {
      for (const child of control.Children) {
        const found = this.findFirstFieldControl(child);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Applies a single PropertyChanges object to a LogicalForm.
   * Resolves the target control by controlPath and sets Properties.Value.
   *
   * @param form - LogicalForm to update (mutated in-place)
   * @param propertyChange - PropertyChanges object containing Changes
   * @returns Number of properties applied (0 or 1)
   */
  private applyPropertyChange(form: LogicalForm, propertyChange: PropertyChangeData): number {
    try {
      // Extract control reference
      const controlRef = propertyChange.ControlReference;
      if (!controlRef || !controlRef.controlPath) {
        logger.info(`     No controlPath in ControlReference`);
        return 0;
      }

      const controlPath = controlRef.controlPath;
      logger.info(`     Resolving controlPath: ${controlPath}`);

      // Resolve target control using path
      const targetControl = this.resolveControlByPath(form, controlPath);
      if (!targetControl) {
        logger.info(`     Could not resolve control path: ${controlPath}`);
        return 0;
      }

      const mutableControl = targetControl as MutableControl;
      const controlInfo = `type=${mutableControl.t}, DesignName=${mutableControl.DesignName}, Caption=${mutableControl.Caption}`;
      logger.info(`     Resolved control: ${controlInfo}`);

      // Extract Changes object
      const changes = propertyChange.Changes;
      if (!changes || typeof changes !== 'object') {
        logger.info(`     No Changes object found`);
        return 0;
      }

      logger.info(`     Applying ${Object.keys(changes).length} properties: ${Object.keys(changes).join(', ')}`);

      // Apply PropertyChanges to target control as-is (don't redirect)
      // BC sends PropertyChanges for both group controls ('gc') and field controls ('sc', 'dc', etc.)

      // Initialize Properties if needed
      if (!mutableControl.Properties) {
        mutableControl.Properties = {};
      }

      // Apply all properties from Changes to control.Properties
      let applied = 0;
      for (const [key, value] of Object.entries(changes)) {
        mutableControl.Properties[key] = value;
        applied++;
        logger.info(
          `       • Applied PropertyChange: Properties.${key}=${JSON.stringify(value)} ` +
          `(t=${mutableControl.t}, DesignName=${mutableControl.DesignName}, Name=${mutableControl.Name}, Caption=${mutableControl.Caption})`
        );
      }

      return applied > 0 ? 1 : 0; // Return 1 if any properties were set
    } catch (error) {
      logger.info(`     Error applying PropertyChange: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  /**
   * Resolves a control by its controlPath (e.g., "server:c[0]/c[1]").
   * Traverses the Children array using c[index] segments.
   *
   * @param form - LogicalForm containing the control tree
   * @param controlPath - Path like "server:c[0]/c[1]"
   * @returns Control if found, null otherwise
   */
  private resolveControlByPath(form: LogicalForm, controlPath: string): Control | null {
    try {
      // Handle root paths: "server" or "server:" → return root form
      if (controlPath === 'server' || controlPath === 'server:') {
        return form;
      }

      // Strip "server:" prefix BEFORE splitting
      // This ensures "server:c[0]/c[1]" becomes "c[0]/c[1]", not ["server:c[0]", "c[1]"]
      const cleanPath = controlPath.replace(/^server:/, '');

      // Handle empty path after stripping prefix
      if (!cleanPath) {
        return form;
      }

      // Parse path segments: "c[0]/c[1]" → ["c[0]", "c[1]"]
      // Filter out empty segments (handles trailing slashes)
      const segments = cleanPath.split('/').filter(s => s);

      let current: MutableControl = form as MutableControl;

      for (const segment of segments) {
        // Match control path pattern with ANY letter prefix: c[...], gc[...], sc[...], dc[...]
        // Changed from /^c\[(\d+)\]$/ to /^\w+\[(\d+)\]$/ to support all control types
        const match = segment.match(/^\w+\[(\d+)\]$/);
        if (!match) {
          // Invalid segment format - return null instead of continuing
          logger.debug(`Invalid segment format: ${segment}`);
          return null;
        }

        const index = parseInt(match[1], 10);

        // Traverse into Children array
        if (!current.Children || !Array.isArray(current.Children)) {
          logger.debug(`No Children array at segment: ${segment}`);
          return null;
        }

        if (index < 0 || index >= current.Children.length) {
          logger.debug(`Index ${index} out of bounds at segment: ${segment}`);
          return null;
        }

        current = current.Children[index];
      }

      return current as Control;
    } catch (error) {
      logger.debug(`Error resolving controlPath: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
