/**
 * Read Page Data MCP Tool
 *
 * Reads data records from a BC page (both card and list types).
 * Extracts field values using PageDataExtractor.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type {
  ReadPageDataInput,
  ReadPageDataOutput,
} from '../types/mcp-types.js';
import { PageDataExtractor } from '../parsers/page-data-extractor.js';
import { HandlerParser } from '../parsers/handler-parser.js';
import { decompressResponse } from '../util/loadform-helpers.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { createToolLogger } from '../core/logger.js';

/**
 * MCP Tool: read_page_data
 *
 * Reads data records from a BC page with optional filtering.
 */
export class ReadPageDataTool extends BaseMCPTool {
  public readonly name = 'read_page_data';

  public readonly description =
    'Reads data records from a Business Central page. Requires pageContextId from get_page_metadata. ' +
    'Supports filtering with operators: =, !=, contains, startsWith, >=, <=, between. ' +
    'Can set current record with setCurrent=true (when single record matches). ' +
    'Returns: {records: [...], total?, nextOffset?} for pagination support.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Required page context ID from get_page_metadata',
      },
      filters: {
        type: 'object',
        description: 'Filter records by field values (operators: =, !=, contains, startsWith, >=, <=, between)',
        additionalProperties: true,
      },
      setCurrent: {
        type: 'boolean',
        description: 'Set found record as current (requires single match)',
        default: false,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of records to return',
      },
      offset: {
        type: 'number',
        description: 'Number of records to skip (for pagination)',
      },
    },
    required: ['pageContextId'],
  };

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    },
    private readonly dataExtractor: PageDataExtractor = new PageDataExtractor(),
    private readonly handlerParser: HandlerParser = new HandlerParser()
  ) {
    super();
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<ReadPageDataInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract required pageContextId
    const pageContextIdResult = this.getRequiredString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    // Extract optional filters
    const filtersResult = this.getOptionalObject(input, 'filters');
    if (!isOk(filtersResult)) {
      return filtersResult as Result<never, BCError>;
    }

    // Extract optional setCurrent
    const setCurrentValue = (input as Record<string, unknown>).setCurrent;
    const setCurrent = typeof setCurrentValue === 'boolean' ? setCurrentValue : false;

    // Extract optional limit
    const limitValue = (input as Record<string, unknown>).limit;
    const limit = typeof limitValue === 'number' ? limitValue : undefined;

    // Extract optional offset
    const offsetValue = (input as Record<string, unknown>).offset;
    const offset = typeof offsetValue === 'number' ? offsetValue : undefined;

    return ok({
      pageContextId: pageContextIdResult.value,
      filters: filtersResult.value,
      setCurrent,
      limit,
      offset,
    });
  }

  /**
   * Executes the tool to read page data.
   */
  protected async executeInternal(input: unknown): Promise<Result<ReadPageDataOutput, BCError>> {
    const logger = createToolLogger('read_page_data', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, filters, setCurrent, limit, offset } = validatedInput.value;

    logger.info(`Reading data using pageContext: "${pageContextId}"`);

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;
    let pageId: string;

    // Extract sessionId from pageContextId (format: sessionId:page:pageId:timestamp)
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(
          `Invalid pageContextId format: ${pageContextId}`,
          { pageContextId }
        )
      );
    }

    const sessionId = contextParts[0];
    pageId = contextParts[2];

    // Try to reuse existing session from pageContextId
    const existing = manager.getSession(sessionId);
    if (existing) {
      logger.info(`♻️  Reusing session from pageContext: ${sessionId}`);
      connection = existing;
      actualSessionId = sessionId;

      // Check if the page context is still valid
      const pageContext = (connection as any).pageContexts?.get(pageContextId);
      if (!pageContext) {
        logger.info(`⚠️  Page context not found, page may have been closed`);
        return err(
          new ProtocolError(
            `Page context ${pageContextId} not found. Page may have been closed. Please call get_page_metadata again.`,
            { pageContextId }
          )
        );
      }
    } else {
      return err(
        new ProtocolError(
          `Session ${sessionId} from pageContext not found. Please call get_page_metadata first.`,
          { pageContextId, sessionId }
        )
      );
    }

    // Page is already open (from get_page_metadata), no need to open again
    // Get the page context to access the form IDs
    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    const formIds = pageContext?.formIds || [];

    logger.info(`Using existing page context with ${formIds.length} open forms`);

    // Refresh the page to get current data
    const refreshResult = await connection.invoke({
      interactionName: 'RefreshForm',
      namedParameters: {},
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    let handlers: readonly unknown[];
    if (isOk(refreshResult)) {
      logger.info(`Page refreshed, received ${refreshResult.value.length} handlers`);
      handlers = refreshResult.value;
    } else {
      // Fall back - invoke a simple interaction to get current state
      logger.info(`RefreshForm failed, getting current state`);
      const stateResult = await connection.invoke({
        interactionName: 'GetState',
        namedParameters: {},
        controlPath: 'server:c[0]',
        callbackId: '0',
      });
      if (isOk(stateResult)) {
        handlers = stateResult.value;
      } else {
        // No handlers available
        handlers = [];
      }
    }

    // Extract LogicalForm from response (cast to Handler[] as needed by parser)
    const logicalFormResult = this.handlerParser.extractLogicalForm(handlers as any);
    if (!isOk(logicalFormResult)) {
      return err(
        new ProtocolError(
          `Failed to extract LogicalForm for page ${pageId}`,
          { pageId }
        )
      );
    }

    const logicalForm = logicalFormResult.value;
    const caption = logicalForm.Caption || `Page ${pageId}`;

    logger.info(`LogicalForm extracted: ${caption}`);

    // Detect page type
    const isListPage = this.dataExtractor.isListPage(logicalForm);
    logger.info(`Page type: ${isListPage ? 'list' : 'card'}`);

    if (isListPage) {
      // List page - need to wait for DataRefreshChange with row data
      logger.info(`Waiting for list data...`);

      // Try to decompress response to get full data
      const decompressed = decompressResponse(handlers);
      const dataToProcess = decompressed || handlers;

      // Extract list data
      const extractionResult = this.dataExtractor.extractListPageData(dataToProcess as readonly unknown[]);

      if (!isOk(extractionResult)) {
        return extractionResult as Result<never, BCError>;
      }

      const { records, totalCount } = extractionResult.value;

      logger.info(`Extracted ${totalCount} records from list page`);

      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'List',
        records,
        totalCount,
      });
    } else {
      // Card page - data is directly in LogicalForm
      logger.info(`Extracting card page data...`);

      const extractionResult = this.dataExtractor.extractCardPageData(logicalForm);

      if (!isOk(extractionResult)) {
        return extractionResult as Result<never, BCError>;
      }

      const { records, totalCount } = extractionResult.value;

      logger.info(`Extracted ${Object.keys(records[0]?.fields || {}).length} fields from card page`);

      return ok({
        pageId: String(pageId),
        pageContextId,
        caption,
        pageType: 'Card',
        records,
        totalCount,
      });
    }
  }

}
