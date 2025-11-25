/**
 * Page Service
 *
 * Handles all Business Central page operations including metadata retrieval,
 * data reading/writing, and page lifecycle management.
 *
 * This service layer abstracts the business logic from the MCP tool adapters.
 */

import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { PageMetadataParser } from '../parsers/page-metadata-parser.js';
import { PageDataExtractor } from '../parsers/page-data-extractor.js';
import { HandlerParser } from '../parsers/handler-parser.js';
import { newId } from '../core/id.js';
import { createConnectionLogger } from '../core/logger.js';
import {
  decompressResponse,
  extractServerIds,
  filterFormsToLoad,
} from '../util/loadform-helpers.js';
import type { Handler } from '../types/bc-types.js';

export interface PageMetadata {
  pageId: string;
  pageContextId: string;
  caption: string;
  description: string;
  pageType: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report';
  fields: Array<{
    name: string;
    caption: string;
    type: string;
    required: boolean;
    editable: boolean;
  }>;
  actions: Array<{
    name: string;
    caption: string;
    enabled: boolean;
    description?: string;
  }>;
}

export interface PageData {
  pageId: string;
  pageContextId: string;
  sessionId: string;
  caption: string;
  pageType: string;
  records: Array<{
    fields: Record<string, unknown>;
    primaryKey?: Record<string, unknown>;
  }>;
  totalCount: number;
}

export interface PageWriteResult {
  success: boolean;
  pageContextId: string;
  updatedFields: Record<string, unknown>;
  validationErrors?: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * Service for managing Business Central page operations
 */
export class PageService {
  private readonly metadataParser: PageMetadataParser;
  private readonly dataExtractor: PageDataExtractor;
  private readonly handlerParser: HandlerParser;

  constructor() {
    this.metadataParser = new PageMetadataParser();
    this.dataExtractor = new PageDataExtractor();
    this.handlerParser = new HandlerParser();
  }

  /** Close all open forms on a connection */
  private async closeExistingForms(connection: IBCConnection, logger: ReturnType<typeof createConnectionLogger>): Promise<void> {
    const allOpenForms = connection.getAllOpenFormIds();
    if (allOpenForms.length === 0) return;

    logger.debug({ count: allOpenForms.length }, 'Closing existing forms');
    for (const formId of allOpenForms) {
      try {
        await connection.invoke({
          interactionName: 'CloseForm',
          namedParameters: { FormId: formId },
          controlPath: 'server:',
          callbackId: '0',
        });
      } catch (error) {
        logger.warn({ formId, error }, 'Failed to close form');
      }
    }
  }

  /** Build query string for OpenForm */
  private buildOpenFormQuery(connection: IBCConnection, pageIdStr: string): string {
    const company = connection.getCompanyName() || 'CRONUS International Ltd.';
    const tenant = connection.getTenantId() || 'default';
    return `tenant=${encodeURIComponent(tenant)}&company=${encodeURIComponent(company)}&page=${pageIdStr}&runinframe=1&dc=${Date.now()}&startTraceId=${newId()}&bookmark=`;
  }

  /** Load child forms and accumulate handlers */
  private async loadChildFormHandlers(
    connection: IBCConnection,
    dataToProcess: unknown,
    pageIdStr: string,
    logger: ReturnType<typeof createConnectionLogger>
  ): Promise<Handler[]> {
    const additionalHandlers: Handler[] = [];
    try {
      const { shellFormId, childFormIds } = extractServerIds(dataToProcess as any[]);
      const formsToLoad = filterFormsToLoad(childFormIds);

      if (shellFormId) {
        connection.trackOpenForm(pageIdStr, shellFormId);
      }

      if (formsToLoad.length > 0) {
        const childHandlersResult = await connection.loadChildForms(formsToLoad);
        if (isOk(childHandlersResult)) {
          additionalHandlers.push(...(Array.from(childHandlersResult.value) as Handler[]));
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to extract ServerIds, continuing with shell handlers');
    }
    return additionalHandlers;
  }

  /** Store page context for later use */
  private storePageContext(connection: IBCConnection, pageContextId: string, sessionId: string, pageId: string): void {
    if (!(connection as any).pageContexts) {
      (connection as any).pageContexts = new Map();
    }
    (connection as any).pageContexts.set(pageContextId, {
      sessionId,
      pageId,
      formIds: connection.getAllOpenFormIds(),
      openedAt: Date.now(),
    });
  }

  /** Determine page type from caption */
  private determinePageType(caption: string | undefined): PageMetadata['pageType'] {
    const captionLower = caption?.toLowerCase() || '';
    if (captionLower.includes('list')) return 'List';
    if (captionLower.includes('document')) return 'Document';
    if (captionLower.includes('worksheet')) return 'Worksheet';
    if (captionLower.includes('report')) return 'Report';
    return 'Card';
  }

  /**
   * Get metadata for a Business Central page
   */
  async getMetadata(
    pageId: string | number,
    bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    }
  ): Promise<Result<PageMetadata, BCError>> {
    const pageIdStr = String(pageId);
    const logger = createConnectionLogger('PageService', 'getMetadata');
    logger.info({ pageId: pageIdStr }, 'Retrieving page metadata');

    // Get or create connection
    if (!bcConfig) {
      return err(new ProtocolError('No BC configuration provided', { pageId: pageIdStr }));
    }

    const sessionResult = await ConnectionManager.getInstance().getOrCreateSession(bcConfig);
    if (!isOk(sessionResult)) {
      return err(sessionResult.error);
    }
    const { connection, sessionId } = sessionResult.value;

    // Close existing forms and open the page
    await this.closeExistingForms(connection, logger);

    const shellResult = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: { query: this.buildOpenFormQuery(connection, pageIdStr) },
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    if (!isOk(shellResult)) {
      return shellResult as Result<never, BCError>;
    }

    // Process response and load child forms
    let allHandlers = Array.from(shellResult.value) as Handler[];
    const decompressed = decompressResponse(shellResult.value);
    const childHandlers = await this.loadChildFormHandlers(connection, decompressed || shellResult.value, pageIdStr, logger);
    allHandlers.push(...childHandlers);

    // Parse metadata
    const metadataResult = this.metadataParser.parse(allHandlers);
    if (!isOk(metadataResult)) {
      return metadataResult as Result<never, BCError>;
    }

    const metadata = metadataResult.value;
    const pageContextId = `${sessionId}:page:${metadata.pageId}:${Date.now()}`;
    this.storePageContext(connection, pageContextId, sessionId, metadata.pageId);

    return ok({
      pageId: metadata.pageId,
      pageContextId,
      caption: metadata.caption,
      description: this.generateDescription(metadata),
      pageType: this.determinePageType(metadata.caption),
      fields: metadata.fields.map(field => ({
        name: field.name ?? field.caption ?? 'Unnamed',
        caption: field.caption ?? field.name ?? 'No caption',
        type: this.controlTypeToFieldType(field.type),
        required: false,
        editable: field.enabled,
      })),
      actions: metadata.actions.map(action => ({
        name: action.caption ?? 'Unnamed',
        caption: action.caption ?? 'No caption',
        enabled: action.enabled,
        description: action.synopsis,
      })),
    });
  }

  /**
   * Read data from a Business Central page
   */
  async readData(
    pageContextId: string,
    filters?: Record<string, unknown>,
    options?: {
      limit?: number;
      offset?: number;
      setCurrent?: boolean;
    }
  ): Promise<Result<PageData, BCError>> {
    const logger = createConnectionLogger('PageService', 'readData');
    logger.info({ pageContextId, filters, options }, 'Reading page data');

    // Step 1: Validate and get connection
    const contextResult = this.validatePageContext(pageContextId);
    if (!isOk(contextResult)) return contextResult;
    const { sessionId, pageId, connection } = contextResult.value;

    // Step 2: Refresh page and get handlers
    const handlers = await this.refreshPageData(connection);

    // Step 3: Extract records from handlers
    const extractResult = this.extractPageRecords(handlers, pageId);
    if (!isOk(extractResult)) return extractResult;
    const { records, caption, isListPage } = extractResult.value;

    // Step 4: Apply filters and pagination
    const filteredRecords = this.applyFiltersAndPagination(records, filters, options);

    return ok({
      pageId: String(pageId),
      pageContextId,
      sessionId,
      caption,
      pageType: isListPage ? 'List' : 'Card',
      records: filteredRecords,
      totalCount: filteredRecords.length,
    });
  }

  /** Validate pageContextId and get connection */
  private validatePageContext(pageContextId: string): Result<{
    sessionId: string;
    pageId: string;
    connection: IBCConnection;
  }, BCError> {
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(`Invalid pageContextId format: ${pageContextId}`, { pageContextId })
      );
    }

    const [sessionId, , pageId] = contextParts;
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(sessionId);

    if (!connection) {
      return err(
        new ProtocolError(
          `Session ${sessionId} not found. Please call getMetadata first.`,
          { pageContextId, sessionId }
        )
      );
    }

    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    if (!pageContext) {
      return err(
        new ProtocolError(
          `Page context ${pageContextId} not found. Page may have been closed.`,
          { pageContextId }
        )
      );
    }

    return ok({ sessionId, pageId, connection });
  }

  /** Refresh page and get current handlers */
  private async refreshPageData(connection: IBCConnection): Promise<readonly unknown[]> {
    const refreshResult = await connection.invoke({
      interactionName: 'RefreshForm',
      namedParameters: {},
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    if (isOk(refreshResult)) {
      return refreshResult.value;
    }

    // Fall back to getting current state
    const stateResult = await connection.invoke({
      interactionName: 'GetState',
      namedParameters: {},
      controlPath: 'server:c[0]',
      callbackId: '0',
    });
    return isOk(stateResult) ? stateResult.value : [];
  }

  /** Extract records from handlers based on page type */
  private extractPageRecords(handlers: readonly unknown[], pageId: string): Result<{
    records: Array<{ fields: Record<string, unknown>; primaryKey?: Record<string, unknown> }>;
    caption: string;
    isListPage: boolean;
  }, BCError> {
    const logicalFormResult = this.handlerParser.extractLogicalForm(handlers as any);
    if (!isOk(logicalFormResult)) {
      return err(
        new ProtocolError(`Failed to extract LogicalForm for page ${pageId}`, { pageId })
      );
    }

    const logicalForm = logicalFormResult.value;
    const caption = logicalForm.Caption || `Page ${pageId}`;
    const isListPage = this.dataExtractor.isListPage(logicalForm);

    let extractionResult;
    if (isListPage) {
      const decompressed = decompressResponse(handlers);
      const dataToProcess = decompressed || handlers;
      extractionResult = this.dataExtractor.extractListPageData(
        dataToProcess as readonly unknown[],
        logicalForm
      );
    } else {
      extractionResult = this.dataExtractor.extractCardPageData(logicalForm);
    }

    if (!isOk(extractionResult)) {
      return extractionResult as Result<never, BCError>;
    }

    return ok({
      records: extractionResult.value.records,
      caption,
      isListPage,
    });
  }

  /** Apply filters and pagination to records */
  private applyFiltersAndPagination(
    records: Array<{ fields: Record<string, unknown>; primaryKey?: Record<string, unknown> }>,
    filters?: Record<string, unknown>,
    options?: { limit?: number; offset?: number }
  ): Array<{ fields: Record<string, unknown>; primaryKey?: Record<string, unknown> }> {
    let result = records;

    // Apply filters
    if (filters && Object.keys(filters).length > 0) {
      result = result.filter(record =>
        Object.entries(filters).every(([field, value]) => record.fields[field] === value)
      );
    }

    // Apply pagination
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit || result.length;
      result = result.slice(offset, offset + limit);
    }

    return result;
  }

  /**
   * Write data to a Business Central page
   */
  async writeData(
    pageContextId: string,
    fields: Record<string, unknown>
  ): Promise<Result<PageWriteResult, BCError>> {
    const logger = createConnectionLogger('PageService', 'writeData');
    logger.info({ pageContextId, fields }, 'Writing page data');

    // Extract sessionId from pageContextId
    const contextParts = pageContextId.split(':');
    if (contextParts.length < 3) {
      return err(
        new ProtocolError(`Invalid pageContextId format: ${pageContextId}`, { pageContextId })
      );
    }

    const [sessionId] = contextParts;
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(sessionId);

    if (!connection) {
      return err(
        new ProtocolError(
          `Session ${sessionId} not found. Please call getMetadata first.`,
          { pageContextId, sessionId }
        )
      );
    }

    // Check if page context is still valid
    const pageContext = (connection as any).pageContexts?.get(pageContextId);
    if (!pageContext) {
      return err(
        new ProtocolError(
          `Page context ${pageContextId} not found. Page may have been closed.`,
          { pageContextId }
        )
      );
    }

    const updatedFields: Record<string, unknown> = {};
    const validationErrors: Array<{ field: string; message: string }> = [];

    // Update each field
    for (const [fieldName, value] of Object.entries(fields)) {
      const saveResult = await connection.invoke({
        interactionName: 'SaveValue',
        namedParameters: {
          controlId: fieldName,
          newValue: String(value),
        },
        controlPath: 'server:c[0]',
        callbackId: '0',
      });

      if (isOk(saveResult)) {
        updatedFields[fieldName] = value;
      } else {
        validationErrors.push({
          field: fieldName,
          message: saveResult.error.message,
        });
      }
    }

    return ok({
      success: validationErrors.length === 0,
      pageContextId,
      updatedFields,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    });
  }

  /**
   * Generate a natural language description of the page
   */
  private generateDescription(metadata: {
    caption: string;
    fields: readonly { type: string }[];
    actions: readonly { enabled: boolean }[];
    controlCount: number;
  }): string {
    const fieldCount = metadata.fields.length;
    const enabledActions = metadata.actions.filter(a => a.enabled).length;
    const totalActions = metadata.actions.length;

    return `${metadata.caption}\n\n` +
           `This page contains ${fieldCount} data fields and ${totalActions} actions.\n` +
           `${enabledActions} actions are currently enabled.\n` +
           `Total UI controls: ${metadata.controlCount}`;
  }

  /**
   * Convert BC control type to user-friendly field type
   */
  private controlTypeToFieldType(controlType: string): string {
    const typeMap: Record<string, string> = {
      sc: 'text',
      dc: 'decimal',
      bc: 'boolean',
      i32c: 'integer',
      sec: 'option',
      dtc: 'datetime',
      pc: 'percentage',
    };
    return typeMap[controlType] ?? controlType;
  }
}