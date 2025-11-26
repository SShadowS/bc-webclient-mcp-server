/**
 * RCC (Repeater Column Control) Extractor
 *
 * Extracts column metadata from BC WebSocket responses containing 'rcc' messages.
 * Columns appear when BC realizes a repeater as an active grid (systemAction 40/120, Navigate, etc.)
 *
 * KEY INSIGHT: BC stores TemplateControlPath on CurrentRow.Children (dc/sc/lc controls),
 * NOT on the rcc column definitions. This module enriches rcc columns with TemplateControlPath
 * from CurrentRow when available.
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
 * CurrentRow child control (dc/sc/lc types) that contains TemplateControlPath
 * BC stores actual TemplateControlPath on data cells in CurrentRow.Children, not on rcc column definitions
 */
interface CurrentRowChild {
  t?: string;
  Caption?: string;
  DesignName?: string;
  TemplateControlPath?: string;
}

/**
 * Check if an object is an RCC message
 */
function isRccMessage(obj: unknown): obj is RawRccMessage {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    't' in obj &&
    (obj as Record<string, unknown>).t === 'rcc' &&
    'Caption' in obj &&
    typeof (obj as Record<string, unknown>).Caption === 'string'
  );
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
 * Build a map of TemplateControlPath by caption/designName from CurrentRow.Children
 * These are the actual data cells which have the TemplateControlPath that rcc columns lack
 */
function extractTemplateControlPaths(currentRowChildren: unknown[]): Map<string, string> {
  const pathMap = new Map<string, string>();

  for (const child of currentRowChildren) {
    const typedChild = child as CurrentRowChild;
    // CurrentRow children have t: 'dc', 'sc', or 'lc' and may contain TemplateControlPath
    if (typedChild.TemplateControlPath && (typedChild.Caption || typedChild.DesignName)) {
      // Use both caption and designName as keys to maximize matching
      const caption = typedChild.Caption?.toLowerCase();
      const designName = typedChild.DesignName?.toLowerCase();
      if (caption) {
        pathMap.set(caption, typedChild.TemplateControlPath);
      }
      if (designName && designName !== caption) {
        pathMap.set(designName, typedChild.TemplateControlPath);
      }
    }
  }

  return pathMap;
}

/**
 * Extract columns from a Columns array in LogicalForm structure
 * Optionally enriches with TemplateControlPath from CurrentRow.Children
 */
function extractColumnsFromArray(
  columnsArray: unknown[],
  templatePathMap?: Map<string, string>
): RepeaterColumnDescription[] {
  const columns: RepeaterColumnDescription[] = [];

  for (const item of columnsArray) {
    if (isRccMessage(item)) {
      let col = convertRccToColumn(item);

      // Enrich with TemplateControlPath from CurrentRow if available and column doesn't have one
      if (templatePathMap && !col.controlPath) {
        const captionKey = item.Caption?.toLowerCase();
        const designNameKey = item.DesignName?.toLowerCase();
        const templatePath = (captionKey && templatePathMap.get(captionKey)) ||
                            (designNameKey && templatePathMap.get(designNameKey));
        if (templatePath) {
          // Create new object with enriched controlPath (readonly property)
          col = { ...col, controlPath: templatePath };
          logger.debug(`[RCC] Enriched "${col.caption}" with TemplateControlPath from CurrentRow: ${templatePath}`);
        }
      }

      columns.push(col);
    }
  }

  return columns;
}

/**
 * Find all repeaters with Columns in a LogicalForm tree
 */
function findRepeatersWithColumns(obj: unknown, path = '', formId = ''): DiscoveredRepeater[] {
  const discovered: DiscoveredRepeater[] = [];

  if (!obj || typeof obj !== 'object') {
    return discovered;
  }

  const record = obj as Record<string, unknown>;

  // Check if this is a repeater control with Columns
  if (record.t === 'rc' && Array.isArray(record.Columns) && record.Columns.length > 0) {
    const firstCol = record.Columns[0];

    // Only process if Columns contains rcc messages
    if (isRccMessage(firstCol)) {
      // Check for CurrentRow.Children to extract TemplateControlPath
      let templatePathMap: Map<string, string> | undefined;
      const currentRow = record.CurrentRow as Record<string, unknown> | undefined;
      if (currentRow && Array.isArray(currentRow.Children) && currentRow.Children.length > 0) {
        templatePathMap = extractTemplateControlPaths(currentRow.Children);
        if (templatePathMap.size > 0) {
          logger.debug(`[RCC] Found ${templatePathMap.size} TemplateControlPaths in CurrentRow.Children`);
        }
      }

      const columns = extractColumnsFromArray(record.Columns as unknown[], templatePathMap);

      if (columns.length > 0) {
        discovered.push({
          formId,
          controlPath: path,
          caption: (record.Caption as string) || (record.DesignName as string) || 'Unknown',
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
    for (const key in record) {
      const newPath = key === 'Children' ? path : `${path}.${key}`;
      discovered.push(...findRepeatersWithColumns(record[key], newPath, formId));
    }
  }

  return discovered;
}

/** Handler structure for type-safe access */
interface ExtractorHandler {
  parameters?: readonly unknown[];
}

/**
 * Extract column metadata from BC WebSocket response handlers
 *
 * Looks for handlers containing LogicalForm structures with repeater Columns (rcc messages).
 *
 * @param handlers - Array of handler objects from BC response
 * @returns Array of discovered repeaters with their column metadata
 */
export function extractColumnsFromHandlers(handlers: unknown[]): DiscoveredRepeater[] {
  const discovered: DiscoveredRepeater[] = [];

  if (!Array.isArray(handlers)) {
    return discovered;
  }

  for (const h of handlers) {
    const handler = h as ExtractorHandler;
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

/** Response structure for type-safe access */
interface ExtractorResponse {
  result?: {
    handlers?: unknown[];
  };
}

/**
 * Extract columns from a complete BC WebSocket response
 *
 * @param response - JsonRpcResponse or raw response object
 * @returns Array of discovered repeaters with columns
 */
export function extractColumnsFromResponse(response: unknown): DiscoveredRepeater[] {
  const typedResponse = response as ExtractorResponse | unknown[] | null;

  // Handle both wrapped and unwrapped responses
  const result = (typedResponse && typeof typedResponse === 'object' && 'result' in typedResponse)
    ? (typedResponse as ExtractorResponse).result
    : typedResponse;

  if (!result) {
    return [];
  }

  // Check for handlers array
  if (result && typeof result === 'object' && 'handlers' in result && Array.isArray(result.handlers)) {
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
