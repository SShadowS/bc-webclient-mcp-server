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
    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let sessionId: string;

    if (bcConfig) {
      const sessionResult = await manager.getOrCreateSession(bcConfig);
      if (!isOk(sessionResult)) {
        return err(sessionResult.error);
      }
      connection = sessionResult.value.connection;
      sessionId = sessionResult.value.sessionId;
    } else {
      return err(
        new ProtocolError('No BC configuration provided', { pageId: pageIdStr })
      );
    }

    // Close existing forms to ensure fresh page load
    const allOpenForms = connection.getAllOpenFormIds();
    if (allOpenForms.length > 0) {
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

    // Open the page
    const company = connection.getCompanyName() || 'CRONUS International Ltd.';
    const tenant = connection.getTenantId() || 'default';
    const startTraceId = newId();
    const dc = Date.now();

    const queryString = `tenant=${encodeURIComponent(tenant)}&company=${encodeURIComponent(company)}&page=${pageIdStr}&runinframe=1&dc=${dc}&startTraceId=${startTraceId}&bookmark=`;

    const shellResult = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: { query: queryString },
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    if (!isOk(shellResult)) {
      return shellResult as Result<never, BCError>;
    }

    // Process response and load child forms
    let allHandlers = Array.from(shellResult.value) as Handler[];
    const decompressed = decompressResponse(shellResult.value);
    const dataToProcess = decompressed || shellResult.value;

    try {
      const { shellFormId, childFormIds } = extractServerIds(dataToProcess as any[]);
      const formsToLoad = filterFormsToLoad(childFormIds);

      if (shellFormId) {
        connection.trackOpenForm(pageIdStr, shellFormId);
      }

      if (formsToLoad.length > 0) {
        const childHandlersResult = await connection.loadChildForms(formsToLoad);
        if (isOk(childHandlersResult)) {
          allHandlers.push(...(Array.from(childHandlersResult.value) as Handler[]));
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to extract ServerIds, continuing with shell handlers');
    }

    // Parse metadata
    const metadataResult = this.metadataParser.parse(allHandlers);
    if (!isOk(metadataResult)) {
      return metadataResult as Result<never, BCError>;
    }

    const metadata = metadataResult.value;
    const pageContextId = `${sessionId}:page:${metadata.pageId}:${Date.now()}`;

    // Store page context for later use
    if (!(connection as any).pageContexts) {
      (connection as any).pageContexts = new Map();
    }
    (connection as any).pageContexts.set(pageContextId, {
      sessionId,
      pageId: metadata.pageId,
      formIds: connection.getAllOpenFormIds(),
      openedAt: Date.now(),
    });

    // Determine page type
    let pageType: PageMetadata['pageType'] = 'Card';
    const captionLower = metadata.caption?.toLowerCase() || '';
    if (captionLower.includes('list')) pageType = 'List';
    else if (captionLower.includes('document')) pageType = 'Document';
    else if (captionLower.includes('worksheet')) pageType = 'Worksheet';
    else if (captionLower.includes('report')) pageType = 'Report';

    return ok({
      pageId: metadata.pageId,
      pageContextId,
      caption: metadata.caption,
      description: this.generateDescription(metadata),
      pageType,
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

    // Extract sessionId and pageId from pageContextId
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

    // Refresh the page to get current data
    const refreshResult = await connection.invoke({
      interactionName: 'RefreshForm',
      namedParameters: {},
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    let handlers: readonly unknown[];
    if (isOk(refreshResult)) {
      handlers = refreshResult.value;
    } else {
      // Fall back to getting current state
      const stateResult = await connection.invoke({
        interactionName: 'GetState',
        namedParameters: {},
        controlPath: 'server:c[0]',
        callbackId: '0',
      });
      handlers = isOk(stateResult) ? stateResult.value : [];
    }

    // Extract LogicalForm
    const logicalFormResult = this.handlerParser.extractLogicalForm(handlers as any);
    if (!isOk(logicalFormResult)) {
      return err(
        new ProtocolError(`Failed to extract LogicalForm for page ${pageId}`, { pageId })
      );
    }

    const logicalForm = logicalFormResult.value;
    const caption = logicalForm.Caption || `Page ${pageId}`;
    const isListPage = this.dataExtractor.isListPage(logicalForm);

    // Extract data based on page type
    let extractionResult;
    if (isListPage) {
      const decompressed = decompressResponse(handlers);
      const dataToProcess = decompressed || handlers;
      extractionResult = this.dataExtractor.extractListPageData(
        dataToProcess as readonly unknown[],
        logicalForm  // Pass LogicalForm for visibility filtering
      );
    } else {
      extractionResult = this.dataExtractor.extractCardPageData(logicalForm);
    }

    if (!isOk(extractionResult)) {
      return extractionResult as Result<never, BCError>;
    }

    const { records, totalCount } = extractionResult.value;

    // Apply filters if provided
    let filteredRecords = records;
    if (filters && Object.keys(filters).length > 0) {
      filteredRecords = records.filter(record => {
        return Object.entries(filters).every(([field, value]) => {
          return record.fields[field] === value;
        });
      });
    }

    // Apply pagination if provided
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit || filteredRecords.length;
      filteredRecords = filteredRecords.slice(offset, offset + limit);
    }

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