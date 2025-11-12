/**
 * Handler Parser Implementation
 *
 * Parses BC JSON-RPC responses and extracts handlers.
 * Handles decompression, validation, and LogicalForm extraction.
 */

import { gunzipSync } from 'zlib';
import { logger } from '../core/logger.js';
import type { IHandlerParser } from '../core/interfaces.js';
import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type {
  JsonRpcResponse,
  Handler,
  LogicalForm,
  LogicalClientEventRaisingHandler,
} from '../types/bc-types.js';
import {
  ProtocolError,
  DecompressionError,
  InvalidResponseError,
  LogicalFormParseError,
  JsonRpcError,
} from '../core/errors.js';

/**
 * Implementation of IHandlerParser.
 * Parses BC WebSocket responses and extracts handlers.
 */
export class HandlerParser implements IHandlerParser {
  /**
   * Parses handlers from a JSON-RPC response.
   * Handles both compressed and uncompressed responses.
   *
   * @param response - Raw response from BC WebSocket
   * @returns Result containing handlers array or error
   */
  public parse(response: unknown): Result<readonly Handler[], ProtocolError> {
    // Validate response is an object
    if (!this.isObject(response)) {
      return err(
        new InvalidResponseError('Response must be an object', {
          receivedType: typeof response,
        })
      );
    }

    const jsonRpcResponse = response as unknown as JsonRpcResponse;

    // Check for JSON-RPC error
    if (jsonRpcResponse.error) {
      return err(
        new JsonRpcError(
          jsonRpcResponse.error.message,
          jsonRpcResponse.error.code,
          { error: jsonRpcResponse.error }
        )
      );
    }

    // Handle compressed result
    if ('compressedResult' in jsonRpcResponse && jsonRpcResponse.compressedResult) {
      return this.parseCompressedResult(jsonRpcResponse.compressedResult);
    }

    // Handle uncompressed result
    if ('result' in jsonRpcResponse && jsonRpcResponse.result) {
      return this.parseHandlers(jsonRpcResponse.result);
    }

    return err(
      new InvalidResponseError('Response missing both result and compressedResult')
    );
  }

  /**
   * Extracts formId from CallbackResponseProperties in handlers.
   * The formId is returned by BC after OpenForm and identifies which form was opened.
   *
   * @param handlers - Array of handlers to search
   * @returns FormId string if found, undefined otherwise
   */
  public extractFormId(handlers: readonly Handler[]): string | undefined {
    // Find CallbackResponseProperties handler
    const callbackHandler = handlers.find(
      (h): h is import('../types/bc-types.js').CallbackResponseProperties =>
        h.handlerType === 'DN.CallbackResponseProperties'
    );

    if (!callbackHandler) {
      logger.error('[HandlerParser] No CallbackResponseProperties handler found');
      return undefined;
    }

    // Extract formId from CompletedInteractions[0].Result.value
    const completedInteractions = callbackHandler.parameters?.[0]?.CompletedInteractions;
    if (!completedInteractions || completedInteractions.length === 0) {
      logger.error('[HandlerParser] No CompletedInteractions found');
      return undefined;
    }

    const result = completedInteractions[0]?.Result as { reason?: number; value?: string } | undefined;
    const formId = result?.value;
    logger.error({ formId }, '[HandlerParser] Extracted formId from callback');
    return formId;
  }

  /**
   * Extracts LogicalForm from FormToShow event in handlers.
   * If formId is provided, filters to the specific form by ServerId.
   *
   * @param handlers - Array of handlers to search
   * @param formId - Optional formId to filter by (from OpenForm callback)
   * @returns Result containing LogicalForm or error
   */
  public extractLogicalForm(
    handlers: readonly Handler[],
    formId?: string
  ): Result<LogicalForm, LogicalFormParseError> {
    // Find FormToShow handlers
    const formToShowHandlers = handlers.filter(
      (h): h is LogicalClientEventRaisingHandler =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow'
    );

    if (formToShowHandlers.length === 0) {
      // Check if there's a DialogToShow event instead (indicates page requires setup/configuration)
      const dialogHandler = handlers.find(
        (h): h is LogicalClientEventRaisingHandler =>
          h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          h.parameters?.[0] === 'DialogToShow'
      );

      if (dialogHandler) {
        const dialogData = dialogHandler.parameters?.[1];
        const message = dialogData?.Message || dialogData?.message || 'Unknown dialog';
        const caption = dialogData?.Caption || dialogData?.caption || 'Dialog';

        return err(
          new LogicalFormParseError(
            `Page cannot be opened: ${caption} - ${message}`,
            {
              handlerCount: handlers.length,
              handlerTypes: handlers.map(h => h.handlerType),
              dialogCaption: caption,
              dialogMessage: message,
            }
          )
        );
      }

      return err(
        new LogicalFormParseError('No FormToShow event found in handlers', {
          handlerCount: handlers.length,
          handlerTypes: handlers.map(h => h.handlerType),
        })
      );
    }

    // If formId provided, filter by ServerId
    let formToShowHandler: LogicalClientEventRaisingHandler | undefined;

    logger.error({ count: formToShowHandlers.length }, '[HandlerParser] Found FormToShow handlers');
    logger.error({ formId }, '[HandlerParser] FormId for filtering');

    if (formId) {
      // Log all available ServerIds
      formToShowHandlers.forEach((h, idx) => {
        const logicalForm = h.parameters?.[1] as LogicalForm | undefined;
        logger.error(`[HandlerParser]   Handler ${idx}: ServerId="${logicalForm?.ServerId}", Caption="${logicalForm?.Caption}"`);
      });

      formToShowHandler = formToShowHandlers.find(h => {
        const logicalForm = h.parameters?.[1] as LogicalForm | undefined;
        const matches = logicalForm?.ServerId === formId;
        logger.error(`[HandlerParser]   Checking ServerId="${logicalForm?.ServerId}" === formId="${formId}": ${matches}`);
        return matches;
      });

      if (!formToShowHandler) {
        logger.error('[HandlerParser] No match found, falling back to first handler');
        // Fallback to first handler if no match found
        // (This handles edge cases where formId doesn't match ServerId format)
        formToShowHandler = formToShowHandlers[0];
      } else {
        const selectedForm = formToShowHandler.parameters?.[1] as LogicalForm | undefined;
        logger.error(`[HandlerParser] ✓ Matched handler: ServerId="${selectedForm?.ServerId}", Caption="${selectedForm?.Caption}"`);
      }
    } else {
      logger.error('[HandlerParser] No formId provided, using first handler (old behavior)');
      // No formId provided, use first handler (old behavior)
      formToShowHandler = formToShowHandlers[0];
    }

    if (!formToShowHandler) {
      return err(
        new LogicalFormParseError('No FormToShow event found in handlers', {
          handlerCount: handlers.length,
          handlerTypes: handlers.map(h => h.handlerType),
        })
      );
    }

    // Extract LogicalForm from parameters[1]
    const logicalForm = formToShowHandler.parameters?.[1] as LogicalForm | undefined;

    if (!logicalForm) {
      return err(
        new LogicalFormParseError('FormToShow event missing LogicalForm in parameters[1]', {
          handler: formToShowHandler,
          parametersLength: formToShowHandler.parameters?.length ?? 0,
        })
      );
    }

    // Validate LogicalForm structure
    if (!this.isValidLogicalForm(logicalForm)) {
      return err(
        new LogicalFormParseError('Invalid LogicalForm structure', {
          missingFields: this.getMissingLogicalFormFields(logicalForm),
        })
      );
    }

    return ok(logicalForm);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Parses compressed result from base64 gzipped data.
   */
  private parseCompressedResult(
    compressedResult: string
  ): Result<readonly Handler[], ProtocolError> {
    try {
      // Decode base64
      const buffer = Buffer.from(compressedResult, 'base64');

      // Decompress gzip
      const decompressed = gunzipSync(buffer);

      // Parse JSON
      const json = JSON.parse(decompressed.toString('utf8'));

      return this.parseHandlers(json);
    } catch (error) {
      if (error instanceof Error) {
        return err(
          new DecompressionError(
            `Failed to decompress response: ${error.message}`,
            { originalError: error.message }
          )
        );
      }
      return err(
        new DecompressionError('Failed to decompress response (unknown error)')
      );
    }
  }

  /**
   * Parses handlers from decompressed result.
   */
  private parseHandlers(result: unknown): Result<readonly Handler[], ProtocolError> {
    // Result should be an array
    if (!Array.isArray(result)) {
      return err(
        new InvalidResponseError('Result must be an array', {
          receivedType: typeof result,
        })
      );
    }

    // Validate each handler has a type
    const handlers: Handler[] = [];

    for (let i = 0; i < result.length; i++) {
      const item = result[i];

      if (!this.isObject(item)) {
        return err(
          new InvalidResponseError(`Handler at index ${i} is not an object`, {
            index: i,
            receivedType: typeof item,
          })
        );
      }

      if (!('handlerType' in item) || typeof item.handlerType !== 'string') {
        return err(
          new InvalidResponseError(`Handler at index ${i} missing 'handlerType' property`, {
            index: i,
            handler: item,
          })
        );
      }

      handlers.push(item as unknown as Handler);
    }

    return ok(handlers);
  }

  /**
   * Validates that LogicalForm has required properties.
   */
  private isValidLogicalForm(form: unknown): form is LogicalForm {
    if (!this.isObject(form)) {
      return false;
    }

    const requiredFields = ['ServerId', 'Caption', 'CacheKey'];

    for (const field of requiredFields) {
      if (!(field in form) || typeof (form as Record<string, unknown>)[field] !== 'string') {
        return false;
      }
    }

    return true;
  }

  /**
   * Gets list of missing required fields from LogicalForm.
   */
  private getMissingLogicalFormFields(form: unknown): readonly string[] {
    if (!this.isObject(form)) {
      return ['<not an object>'];
    }

    const requiredFields = ['ServerId', 'Caption', 'CacheKey'];
    const missing: string[] = [];

    for (const field of requiredFields) {
      if (!(field in form) || typeof (form as Record<string, unknown>)[field] !== 'string') {
        missing.push(field);
      }
    }

    return missing;
  }

  /**
   * Type guard for checking if value is an object.
   */
  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
