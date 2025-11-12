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
} from './logical-form-parser.js';

export interface TellMePage {
  id: string;
  caption: string;
  tooltip?: string;
  badges?: string[];
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
      // Try BC27+ format first (DataRefreshChange)
      const changeHandler = handlers.find((h: any) =>
        h?.handlerType === 'DN.LogicalClientChangeHandler'
      );

      if (changeHandler) {
        const resultsResult = extractTellMeResultsFromChangeHandler([changeHandler]);
        if (isOk(resultsResult)) {
          const results = resultsResult.value;
          if (results && results.length > 0) {
            return ok(results.map(this.transformResult));
          }
        }
      }

      // Fall back to legacy format
      const resultsResult = extractTellMeResults(handlers);
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
  private transformResult(result: any): TellMePage {
    return {
      id: String(result.objectId || result.id || result.PageId || ''),
      caption: String(result.name || result.caption || result.Caption || ''),
      tooltip: result.tooltip || result.context || result.Tooltip,
      badges: result.badges || result.Badges,
    };
  }
}