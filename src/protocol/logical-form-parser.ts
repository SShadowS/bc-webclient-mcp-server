/**
 * Business Central LogicalForm Parser
 *
 * Parses BC WebSocket LogicalForm structures to extract search results,
 * form data, and control values.
 *
 * Based on protocol analysis - see docs/tell-me-search-protocol.md
 *
 * NOTE: BC27+ uses LogicalClientChangeHandler with DataRefreshChange for search results,
 * not the original LogicalForm Value array approach.
 */

import { LogicalFormParseError } from '../core/errors.js';
import { ok, err, type Result } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import type { PageSearchResult } from '../types/mcp-types.js';

/**
 * Tell Me search result row structure.
 * Based on captured protocol, each result is an array:
 * [name, category, objectId, objectType, key, context?, action?, actionKey?]
 */
export interface TellMeSearchResultRow {
  /** Page/Report name (e.g., "Customer List") */
  name: string;
  /** Category (e.g., "List", "Report and analysis") */
  category: string;
  /** Page/Report ID (e.g., "22") */
  objectId: string;
  /** Object type (e.g., "Page", "Report") */
  objectType: string;
  /** Unique key for selection (GUID) */
  key: string;
  /** Optional contextual description */
  context?: string;
  /** Optional tooltip/description */
  tooltip?: string;
  /** Optional action type */
  action?: string;
  /** Optional action key (GUID) */
  actionKey?: string;
}

/**
 * Extracts Tell Me search results from a decompressed LogicalForm.
 *
 * Search results are in a Repeater control (Type 11) at Controls[1].
 * Each result is an array with structure: [name, category, id, type, key, ...]
 *
 * @param logicalForm - Decompressed LogicalForm object
 * @returns Array of search result rows
 */
export function extractTellMeResults(
  handlersOrForm: any
): Result<TellMeSearchResultRow[], BCError> {
  try {
    // Handle both array of handlers and single form object
    let form: any;
    const isArrayInput = Array.isArray(handlersOrForm);

    if (isArrayInput) {
      // Search for handler with LogicalForm
      const handler = handlersOrForm.find((h: any) => h?.LogicalForm);
      form = handler?.LogicalForm;

      if (!form) {
        return ok([]); // No legacy format found in array, return empty (not an error)
      }
    } else {
      // Single object with LogicalForm property (legacy format for single object input)
      form = handlersOrForm?.LogicalForm;

      if (!form) {
        return err(
          new LogicalFormParseError(
            'Response does not contain LogicalForm',
            { logicalForm: handlersOrForm }
          )
        );
      }
    }

    // BC uses either "Children" or "Controls" depending on context
    const controls = form.Children || form.Controls;
    if (!Array.isArray(controls) || controls.length < 2) {
      return err(
        new LogicalFormParseError(
          'LogicalForm does not have expected control structure',
          {
            hasChildren: Array.isArray(form.Children),
            hasControls: Array.isArray(form.Controls),
            childrenLength: form.Children?.length,
            controlsLength: form.Controls?.length,
          }
        )
      );
    }

    // Get repeater control at index 1
    // In Tell Me search, this is the search results repeater (t: "rc")
    const repeaterControl = controls[1];
    if (!repeaterControl || (repeaterControl.Type !== 11 && repeaterControl.t !== 'rc')) {
      return err(
        new LogicalFormParseError(
          `Expected repeater control (Type 11 or t='rc'), got Type ${repeaterControl?.Type || repeaterControl?.t}`,
          { repeaterControl }
        )
      );
    }

    // Extract results from repeater value
    // BC can store results in either:
    // - repeaterControl.Value (direct property)
    // - repeaterControl.Properties.Value (nested in Properties)
    const resultsArray = repeaterControl.Value || repeaterControl.Properties?.Value;
    if (!Array.isArray(resultsArray)) {
      return ok([]); // No results found
    }

    // Parse each result row
    const results: TellMeSearchResultRow[] = resultsArray.map((row: any[]) => ({
      name: String(row[0] || ''),
      category: String(row[1] || ''),
      objectId: String(row[2] || ''),
      objectType: String(row[3] || ''),
      key: String(row[4] || ''),
      context: row[5] || undefined,
      action: row[6],
      actionKey: row[7],
    }));

    return ok(results);
  } catch (error) {
    return err(
      new LogicalFormParseError(
        `Failed to parse LogicalForm: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      )
    );
  }
}

/**
 * Converts Tell Me search results to MCP PageSearchResult format.
 *
 * @param tellMeResults - Parsed Tell Me results
 * @returns Array of PageSearchResult objects
 */
export function convertToPageSearchResults(
  tellMeResults: TellMeSearchResultRow[]
): PageSearchResult[] {
  return tellMeResults
    .filter(result => result.objectType === 'Page') // Only include pages (not reports)
    .filter(result => result.objectId && result.objectId.trim() !== '') // Exclude actions from "On current page" (empty pageId)
    .map(result => ({
      pageId: result.objectId,
      caption: result.name,
      type: mapCategoryToPageType(result.category),
      appName: 'Base Application', // BC doesn't provide app name in search
    }));
}

/**
 * Maps BC Tell Me category to MCP page type.
 *
 * @param category - BC category (e.g., "Liste", "Rapport og analyse")
 * @returns MCP page type
 */
function mapCategoryToPageType(category: string): string {
  const lowerCategory = category.toLowerCase();

  if (lowerCategory.includes('list')) return 'List';
  if (lowerCategory.includes('card')) return 'Card';
  if (lowerCategory.includes('document')) return 'Document';
  if (lowerCategory.includes('worksheet')) return 'Worksheet';
  if (lowerCategory.includes('report')) return 'Report';
  if (lowerCategory.includes('role')) return 'RoleCenter';

  // Unknown category - return as-is
  return category || 'Unknown';
}

/**
 * Gets the form ID from a LogicalForm.
 *
 * @param logicalForm - Decompressed LogicalForm
 * @returns Form ID or undefined
 */
export function getFormId(logicalForm: any): string | undefined {
  return logicalForm?.LogicalForm?.Id;
}

/**
 * Gets the search query value from a Tell Me LogicalForm.
 * The search input is at Controls[0]/Controls[0].
 *
 * @param logicalForm - Decompressed LogicalForm
 * @returns Search query string or undefined
 */
export function getSearchQuery(logicalForm: any): string | undefined {
  try {
    const form = logicalForm?.LogicalForm;
    const searchControl = form?.Controls?.[0]?.Controls?.[0];
    return searchControl?.Properties?.Value;
  } catch {
    return undefined;
  }
}

/**
 * Extracts Tell Me search results from BC27+ LogicalClientChangeHandler format.
 *
 * In BC27+, search results are sent as DataRefreshChange, InitializeChange, or
 * ControlAddChange updates instead of being embedded in the LogicalForm's Value property.
 *
 * @param handlers - Array of handlers from decompressed response
 * @returns Array of search result rows
 */
export function extractTellMeResultsFromChangeHandler(
  handlers: any[]
): Result<TellMeSearchResultRow[], BCError> {
  try {
    if (!Array.isArray(handlers)) {
      return err(
        new LogicalFormParseError('Handlers is not an array', { handlers })
      );
    }

    // Find LogicalClientChangeHandler
    const changeHandler = handlers.find(
      (h: any) => h.handlerType === 'DN.LogicalClientChangeHandler'
    );

    if (!changeHandler) {
      return ok([]); // No results - empty search
    }

    // Get changes array (parameters[1])
    const changes = changeHandler.parameters?.[1];
    if (!Array.isArray(changes)) {
      return ok([]); // No changes
    }

    // Find change for pages repeater (c[1]) - can be DataRefreshChange, InitializeChange, or ControlAddChange
    const pagesDataChange = changes.find(
      (c: any) =>
        (c.t === 'DataRefreshChange' || c.t === 'InitializeChange' || c.t === 'ControlAddChange') &&
        c.ControlReference?.controlPath === 'server:c[1]'
    );

    if (!pagesDataChange || !Array.isArray(pagesDataChange.RowChanges)) {
      return ok([]); // No page results
    }

    // Extract results from row changes
    const results: TellMeSearchResultRow[] = pagesDataChange.RowChanges
      .filter((row: any) => row.t === 'DataRowInserted')
      .map((row: any) => {
        const rowData = row.DataRowInserted?.[1];
        const cells = rowData?.cells;

        if (!cells) {
          return null;
        }

        // Extract page ID from CacheKey (format: "pageId:pagemode(...)...")
        const cacheKey = cells.CacheKey?.stringValue || '';
        const pageIdMatch = cacheKey.match(/^(\d+):/);
        const pageId = pageIdMatch ? pageIdMatch[1] : '';

        // Extract page name
        const name = cells.Name?.stringValue || '';

        // Extract category
        const category = cells.DepartmentCategory?.stringValue || '';

        // Use bookmark as key
        const key = rowData.bookmark || '';

        return {
          name,
          category,
          objectId: pageId,
          objectType: 'Page',
          key,
          context: cells.DepartmentPath?.stringValue,
          tooltip: cells.Description?.stringValue,
          action: undefined,
          actionKey: undefined,
        };
      })
      .filter((r: any) => r !== null);

    return ok(results);
  } catch (error) {
    return err(
      new LogicalFormParseError(
        `Failed to parse LogicalClientChangeHandler: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      )
    );
  }
}
