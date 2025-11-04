/**
 * Page Data Extractor
 *
 * Extracts actual data records from BC pages (both card and list types).
 * Uses patterns from Tell Me search for list data extraction.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { LogicalFormParseError } from '../core/errors.js';
import type { LogicalForm, Control, ControlType } from '../types/bc-types.js';
import { logger } from '../core/logger.js';

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
  pageType: 'card' | 'list';
  records: PageRecord[];
  totalCount: number;
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
  private hasTopLevelRepeater(logicalForm: any): boolean {
    if (!logicalForm.Children || !Array.isArray(logicalForm.Children)) {
      return false;
    }

    // Check only immediate children (top-level controls)
    for (const child of logicalForm.Children) {
      if (this.isRepeaterControl(child.t as ControlType)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extracts data from a card page (single record).
   * Data is available directly in the LogicalForm controls.
   */
  public extractCardPageData(logicalForm: LogicalForm): Result<PageDataExtractionResult, BCError> {
    try {
      const fields: Record<string, FieldValue> = {};

      // Walk control tree and extract field values
      this.walkControls(logicalForm, (control) => {
        if (this.isFieldControl(control.t as ControlType)) {
          const fieldName = this.getFieldName(control);
          if (fieldName) {
            const fieldValue = this.extractFieldValueFromControl(control);
            if (fieldValue !== null) {
              fields[fieldName] = fieldValue;
            }
          }
        }
      });

      const record: PageRecord = { fields };

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
   */
  public extractListPageData(handlers: readonly unknown[]): Result<PageDataExtractionResult, BCError> {
    try {
      // Find LogicalClientChangeHandler with DataRefreshChange
      const changeHandler = (handlers as any[]).find(
        (h: any) => h.handlerType === 'DN.LogicalClientChangeHandler'
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
      const changes = changeHandler.parameters?.[1];
      if (!Array.isArray(changes)) {
        return ok({
          pageType: 'list',
          records: [],
          totalCount: 0,
        });
      }

      // Find DataRefreshChange for main repeater
      const dataChange = changes.find(
        (c: any) => c.t === 'DataRefreshChange' && c.ControlReference?.controlPath
      );

      if (!dataChange || !Array.isArray(dataChange.RowChanges)) {
        return ok({
          pageType: 'list',
          records: [],
          totalCount: 0,
        });
      }

      // Extract records from row changes
      const records: PageRecord[] = dataChange.RowChanges
        .filter((row: any) => row.t === 'DataRowInserted')
        .map((row: any) => this.extractRecordFromRow(row.DataRowInserted?.[1]))
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
  private walkControls(control: any, visitor: (control: Control) => void): void {
    if (!control || typeof control !== 'object') {
      return;
    }

    // Visit current control
    visitor(control as Control);

    // Walk children
    if (Array.isArray(control.Children)) {
      for (const child of control.Children) {
        this.walkControls(child, visitor);
      }
    }
  }

  /**
   * Gets the field name from a control.
   * Prefers DesignName, falls back to Caption or Name.
   */
  private getFieldName(control: Control): string | null {
    if (typeof control.DesignName === 'string') return control.DesignName;
    if (typeof control.Name === 'string') return control.Name;
    if (typeof control.Caption === 'string') return control.Caption;
    return null;
  }

  /**
   * Extracts field value from a LogicalForm control (card page pattern).
   */
  private extractFieldValueFromControl(control: any): FieldValue | null {
    const type = control.t as ControlType;

    try {
      switch (type) {
        case 'bc': // Boolean
          return {
            value: control.ObjectValue ?? false,
            type: 'boolean',
          };

        case 'dc': // Decimal
        case 'pc': // Percent
          return {
            value: parseFloat(control.StringValue || '0'),
            displayValue: control.StringValue,
            type: 'number',
          };

        case 'i32c': // Integer
          return {
            value: parseInt(control.StringValue || '0', 10),
            displayValue: control.StringValue,
            type: 'number',
          };

        case 'sec': // Select/Enum
          return this.extractSelectValue(control);

        case 'dtc': // DateTime
          return {
            value: control.StringValue || null,
            type: 'date',
          };

        case 'sc': // String
        default:
          return {
            value: control.StringValue ?? control.ObjectValue ?? null,
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
  private extractSelectValue(control: any): FieldValue | null {
    const currentIndex = control.CurrentIndex;
    const items = control.Items;

    if (currentIndex === undefined || !Array.isArray(items)) {
      return {
        value: control.StringValue || null,
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
      value: selectedItem.Value ?? selectedItem,
      displayValue: selectedItem.Caption ?? String(selectedItem),
      type: 'string',
    };
  }

  /**
   * Extracts a record from a DataRowInserted row (list page pattern).
   */
  private extractRecordFromRow(rowData: any): PageRecord | null {
    if (!rowData || !rowData.cells) {
      return null;
    }

    const fields: Record<string, FieldValue> = {};

    // Extract all cell values
    for (const [fieldName, cellValue] of Object.entries(rowData.cells)) {
      const extractedValue = this.extractCellValue(cellValue as any);
      if (extractedValue !== null) {
        fields[fieldName] = extractedValue;
      }
    }

    return {
      bookmark: rowData.bookmark,
      fields,
    };
  }

  /**
   * Extracts field value from a cell (DataRefreshChange pattern).
   */
  private extractCellValue(cell: any): FieldValue | null {
    if (!cell || typeof cell !== 'object') {
      return null;
    }

    // Check for typed value properties
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

    // No value found
    return null;
  }
}
