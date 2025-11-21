/**
 * Page Metadata Parser Implementation
 *
 * Combines handler parsing and control parsing to produce complete page metadata.
 * Orchestrates the parsing pipeline with Result<T, E> error handling.
 */

import type { IPageMetadataParser, IHandlerParser, IControlParser } from '../core/interfaces.js';
import type { Result } from '../core/result.js';
import { ok, andThen, map } from '../core/result.js';
import type { Handler, PageMetadata, LogicalClientEventRaisingHandler } from '../types/bc-types.js';
import type { BCError } from '../core/errors.js';
import { HandlerParser } from './handler-parser.js';
import { ControlParser } from './control-parser.js';
import { logger } from '../core/logger.js';

/**
 * Implementation of IPageMetadataParser.
 * Orchestrates handler and control parsing to produce page metadata.
 */
export class PageMetadataParser implements IPageMetadataParser {
  private readonly handlerParser: IHandlerParser;
  private readonly controlParser: IControlParser;

  public constructor(
    handlerParser: IHandlerParser = new HandlerParser(),
    controlParser: IControlParser = new ControlParser()
  ) {
    this.handlerParser = handlerParser;
    this.controlParser = controlParser;
  }

  /**
   * Parses complete page metadata from handlers.
   *
   * Pipeline:
   * 1. Extract formId from callback (identifies which form was opened)
   * 2. Extract LogicalForm from handlers (filtered by formId if available)
   * 3. Walk control tree
   * 4. Extract fields
   * 5. Extract actions
   * 6. Build PageMetadata
   *
   * @param handlers - Response handlers from OpenForm
   * @returns Result containing page metadata or error
   */
  public parse(handlers: readonly Handler[]): Result<PageMetadata, BCError> {
    // DEBUG: Log ALL handler types to understand what BC is sending
    logger.debug({ count: handlers.length }, '[PageMetadataParser] Received handlers');
    handlers.forEach((h, i) => {
      logger.debug(`[PageMetadataParser]   Handler ${i}: ${h.handlerType}`);
      if (h.handlerType === 'DN.LogicalClientEventRaisingHandler') {
        const eventHandler = h as LogicalClientEventRaisingHandler;
        logger.debug(`[PageMetadataParser]     Event: ${eventHandler.parameters?.[0]}`);
      }
    });

    // Extract formId from CallbackResponseProperties (identifies which form was opened)
    const formId = this.handlerParser.extractFormId(handlers);
    logger.debug({ formId }, '[PageMetadataParser] Extracted formId');

    // Extract LogicalForm from FormToShow event (filtered by formId to get correct page)
    const logicalFormResult = this.handlerParser.extractLogicalForm(handlers, formId);
    if (logicalFormResult.ok) {
      logger.debug({ ServerId: logicalFormResult.value.ServerId, Caption: logicalFormResult.value.Caption }, '[PageMetadataParser] Selected form');
    }

    // Chain parsing operations using Result's andThen
    return andThen(logicalFormResult, logicalForm => {
      // Walk control tree
      const controls = this.controlParser.walkControls(logicalForm);

      // Extract fields and actions
      const fields = this.controlParser.extractFields(controls);
      const actions = this.controlParser.extractActions(controls);

      // Build page metadata
      const metadata: PageMetadata = {
        pageId: this.extractPageId(logicalForm.CacheKey),
        caption: logicalForm.Caption,
        cacheKey: logicalForm.CacheKey,
        appName: logicalForm.AppName,
        appPublisher: logicalForm.AppPublisher,
        appVersion: logicalForm.AppVersion,
        fields,
        actions,
        controlCount: controls.length,
      };

      return ok(metadata);
    });
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Extracts page ID from cache key.
   * Cache key format: "{pageId}:pagemode({mode}):embedded({bool})"
   *
   * @param cacheKey - The CacheKey from LogicalForm
   * @returns Extracted page ID
   */
  private extractPageId(cacheKey: string): string {
    // Cache key examples:
    // "21:embedded(False)"
    // "21:pagemode(Edit):embedded(False)"
    const match = cacheKey.match(/^(\d+)/);
    return match?.[1] ?? cacheKey;
  }
}
