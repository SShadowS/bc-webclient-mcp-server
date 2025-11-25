/**
 * RCC (Repeater Column Control) Extractor
 *
 * Extracts column metadata from BC WebSocket responses containing 'rcc' messages.
 * Columns appear when BC realizes a repeater as an active grid (systemAction 40/120, Navigate, etc.)
 *
 * See: COLUMN_METADATA_DISCOVERY.md for full analysis
 */

import { createToolLogger } from '../core/logger.js';
import type { RepeaterColumnDescription } from '../types/mcp-types.js';

const logger = createToolLogger('RccExtractor');

/**
 * Raw RCC message from BC WebSocket protocol
 */
export interface RawRccMessage {
  t: 'rcc';
  Caption: string;
  DesignName?: string;
  Editable?: boolean;
  TableEditable?: boolean;
  ColumnBinder?: {
    Name: string;
  };
  Formatter?: {
    HorizontalAlignment?: 'Left' | 'Right' | 'Center';
  };
  ControlIdentifier?: string;
  TemplateControlPath?: string;
}

/**
 * Repeater with columns found in a BC response
 */
export interface DiscoveredRepeater {
  formId: string;
  controlPath: string;
  caption: string;
  columns: RepeaterColumnDescription[];
}

/**
 * Check if an object is an RCC message
 */
function isRccMessage(obj: any): obj is RawRccMessage {
  return obj && typeof obj === 'object' && obj.t === 'rcc' && typeof obj.Caption === 'string';
}

/**
 * Convert raw RCC message to RepeaterColumnDescription
 */
function convertRccToColumn(rcc: RawRccMessage): RepeaterColumnDescription {
  return {
    name: rcc.DesignName || rcc.Caption,
    caption: rcc.Caption,
    columnBinder: rcc.ColumnBinder?.Name,
    editable: rcc.Editable,
    tableEditable: rcc.TableEditable,
    horizontalAlignment: rcc.Formatter?.HorizontalAlignment,
    controlIdentifier: rcc.ControlIdentifier,
    controlPath: rcc.TemplateControlPath
  };
}

/**
 * Extract columns from a Columns array in LogicalForm structure
 */
function extractColumnsFromArray(columnsArray: any[]): RepeaterColumnDescription[] {
  const columns: RepeaterColumnDescription[] = [];

  for (const item of columnsArray) {
    if (isRccMessage(item)) {
      columns.push(convertRccToColumn(item));
    }
  }

  return columns;
}

/**
 * Find all repeaters with Columns in a LogicalForm tree
 */
function findRepeatersWithColumns(obj: any, path = '', formId = ''): DiscoveredRepeater[] {
  const discovered: DiscoveredRepeater[] = [];

  if (!obj || typeof obj !== 'object') {
    return discovered;
  }

  // Check if this is a repeater control with Columns
  if (obj.t === 'rc' && Array.isArray(obj.Columns) && obj.Columns.length > 0) {
    const firstCol = obj.Columns[0];

    // Only process if Columns contains rcc messages
    if (isRccMessage(firstCol)) {
      const columns = extractColumnsFromArray(obj.Columns);

      if (columns.length > 0) {
        discovered.push({
          formId,
          controlPath: path,
          caption: obj.Caption || obj.DesignName || 'Unknown',
          columns
        });

        logger.debug(`Found repeater with ${columns.length} columns at ${path} (formId: ${formId})`);
      }
    }
  }

  // Recurse into children
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      discovered.push(...findRepeatersWithColumns(item, `${path}[${i}]`, formId));
    });
  } else {
    for (const key in obj) {
      const newPath = key === 'Children' ? path : `${path}.${key}`;
      discovered.push(...findRepeatersWithColumns(obj[key], newPath, formId));
    }
  }

  return discovered;
}

/**
 * Extract column metadata from BC WebSocket response handlers
 *
 * Looks for handlers containing LogicalForm structures with repeater Columns (rcc messages).
 *
 * @param handlers - Array of handler objects from BC response
 * @returns Array of discovered repeaters with their column metadata
 */
export function extractColumnsFromHandlers(handlers: any[]): DiscoveredRepeater[] {
  const discovered: DiscoveredRepeater[] = [];

  if (!Array.isArray(handlers)) {
    return discovered;
  }

  for (const handler of handlers) {
    // Look for handlers with parameters containing LogicalForm-like structures
    if (handler.parameters && Array.isArray(handler.parameters)) {
      const [formId, logicalForm] = handler.parameters;

      if (typeof formId === 'string' && logicalForm && typeof logicalForm === 'object') {
        // Search for repeaters with Columns in the LogicalForm tree
        const found = findRepeatersWithColumns(logicalForm, '', formId);
        discovered.push(...found);
      }
    }
  }

  if (discovered.length > 0) {
    const summary = discovered.map(r => `${r.caption} (${r.columns.length} cols)`).join(', ');
    logger.info(`Extracted columns from ${discovered.length} repeater(s): ${summary}`);
  }

  return discovered;
}

/**
 * Extract columns from a complete BC WebSocket response
 *
 * @param response - JsonRpcResponse or raw response object
 * @returns Array of discovered repeaters with columns
 */
export function extractColumnsFromResponse(response: any): DiscoveredRepeater[] {
  // Handle both wrapped and unwrapped responses
  const result = response?.result || response;

  if (!result) {
    return [];
  }

  // Check for handlers array
  if (Array.isArray(result.handlers)) {
    return extractColumnsFromHandlers(result.handlers);
  }

  // Check if result itself is an array of handlers
  if (Array.isArray(result)) {
    return extractColumnsFromHandlers(result);
  }

  return [];
}

/**
 * Merge new columns with existing columns, preferring new values
 *
 * @param existing - Existing column metadata (may be empty)
 * @param discovered - Newly discovered column metadata
 * @returns Merged column array
 */
export function mergeColumns(
  existing: readonly RepeaterColumnDescription[],
  discovered: RepeaterColumnDescription[]
): RepeaterColumnDescription[] {
  if (!existing || existing.length === 0) {
    return discovered;
  }

  // Build map of existing columns by name
  const existingMap = new Map<string, RepeaterColumnDescription>();
  for (const col of existing) {
    existingMap.set(col.name, col);
  }

  // Merge: discovered columns override existing
  const merged: RepeaterColumnDescription[] = [];

  for (const newCol of discovered) {
    merged.push(newCol);
    existingMap.delete(newCol.name);
  }

  // Add any existing columns not in discovered set
  for (const existingCol of existingMap.values()) {
    merged.push(existingCol);
  }

  return merged;
}
