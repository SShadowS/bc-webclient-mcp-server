/**
 * Tell Me Parser
 *
 * Parses Business Central Tell Me search results from handler responses.
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import {
  extractTellMeResults,
  extractTellMeResultsFromChangeHandler,
  type TellMeSearchResultRow,
} from './logical-form-parser.js';

export interface TellMePage {
  id: string;
  caption: string;
  tooltip?: string;
  badges?: string[];
}

/**
 * Handler structure for type checking
 */
interface BcHandler {
  handlerType: string;
  parameters?: readonly unknown[];
  LogicalForm?: unknown;
}

/**
 * Parser for Tell Me search results
 */
export class TellMeParser {
  /**
   * Parse Tell Me results from handler responses
   */
  parseTellMeResults(handlers: readonly unknown[]): Result<TellMePage[], BCError> {
    try {
      // Cast to handler array for type checking
      const typedHandlers = handlers as readonly BcHandler[];

      // Try BC27+ format first (DataRefreshChange)
      const changeHandler = typedHandlers.find((h) =>
        h?.handlerType === 'DN.LogicalClientChangeHandler'
      );

      if (changeHandler) {
        // Create mutable array for extractTellMeResultsFromChangeHandler
        const handlersArray = [changeHandler] as unknown as Parameters<typeof extractTellMeResultsFromChangeHandler>[0];
        const resultsResult = extractTellMeResultsFromChangeHandler(handlersArray);
        if (isOk(resultsResult)) {
          const results = resultsResult.value;
          if (results && results.length > 0) {
            return ok(results.map(this.transformResult));
          }
        }
      }

      // Fall back to legacy format
      const legacyInput = handlers as unknown as Parameters<typeof extractTellMeResults>[0];
      const resultsResult = extractTellMeResults(legacyInput);
      if (isOk(resultsResult)) {
        const results = resultsResult.value;
        if (results && results.length > 0) {
          return ok(results.map(this.transformResult));
        }
      }

      return ok([]); // No results found, but not an error
    } catch (error) {
      return err(
        new ProtocolError(
          `Failed to parse Tell Me results: ${String(error)}`,
          { error: String(error) }
        )
      );
    }
  }

  /**
   * Transform raw result to TellMePage format
   */
  private transformResult(result: TellMeSearchResultRow): TellMePage {
    return {
      id: String(result.objectId || ''),
      caption: String(result.name || ''),
      tooltip: result.tooltip || result.context,
      badges: undefined, // TellMeSearchResultRow doesn't have badges
    };
  }
}