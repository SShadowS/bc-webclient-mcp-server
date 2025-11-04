/**
 * Get Page Metadata MCP Tool
 *
 * Opens a BC page and extracts complete metadata:
 * - Available fields with types
 * - Available actions with enabled states
 * - Page structure and capabilities
 *
 * This tool gives Claude "vision" into BC pages.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, andThen, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import type {
  IBCConnection,
  IPageMetadataParser,
} from '../core/interfaces.js';
import type {
  GetPageMetadataInput,
  GetPageMetadataOutput,
} from '../types/mcp-types.js';
import type { Handler } from '../types/bc-types.js';
import { PageMetadataParser } from '../parsers/page-metadata-parser.js';
import {
  decompressResponse,
  extractServerIds,
  filterFormsToLoad,
} from '../util/loadform-helpers.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { ProtocolError } from '../core/errors.js';
import { newId } from '../core/id.js';
import { createToolLogger } from '../core/logger.js';
import { z } from 'zod';
import { PageIdSchema, PageContextIdSchema } from '../validation/schemas.js';

/**
 * Zod schema for get_page_metadata tool input.
 * Handles mixed types (string|number for pageId) via type coercion.
 */
const GetPageMetadataInputZodSchema = z.object({
  pageId: PageIdSchema,
  pageContextId: PageContextIdSchema.optional(),
});

type GetPageMetadataInputValidated = z.infer<typeof GetPageMetadataInputZodSchema>;

/**
 * MCP Tool: get_page_metadata
 *
 * Retrieves comprehensive metadata about a BC page including
 * all fields, actions, and their current states.
 */
export class GetPageMetadataTool extends BaseMCPTool {
  public readonly name = 'get_page_metadata';

  public readonly description =
    'Retrieves metadata for a Business Central page and initializes a page context for subsequent operations. ' +
    'Returns pageContextId (required for stateful operations), page type (List/Card/Document/Worksheet), ' +
    'fields with metadata (id, caption, dataType, editable, required), actions, and page structure. ' +
    'Side effects: Creates a short-lived pageContextId for maintaining state across operations.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (e.g., "21" for Customer Card)',
      },
      pageContextId: {
        type: 'string',
        description: 'Optional existing page context ID to reuse',
      },
    },
    required: ['pageId'],
  };

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    },
    private readonly metadataParser: IPageMetadataParser = new PageMetadataParser()
  ) {
    // Pass Zod schema to BaseMCPTool for automatic validation
    super({ inputZod: GetPageMetadataInputZodSchema });
  }

  /**
   * Executes the tool to get page metadata.
   * Input is pre-validated by BaseMCPTool using Zod schema.
   */
  protected async executeInternal(input: unknown): Promise<Result<GetPageMetadataOutput, BCError>> {
    // Input is already validated by BaseMCPTool with Zod
    const { pageId, pageContextId: inputPageContextId } = input as GetPageMetadataInputValidated;

    // Create logger for this execution
    const logger = createToolLogger('GetPageMetadata', inputPageContextId);
    logger.info(`Requesting metadata for BC Page: "${pageId}"`);

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;

    // Try to reuse existing session if pageContextId provided
    if (inputPageContextId) {
      // Extract sessionId from pageContextId (format: sessionId:page:pageId:timestamp)
      const [extractedSessionId] = inputPageContextId.split(':');
      const existing = manager.getSession(extractedSessionId);
      if (existing) {
        logger.info(`♻️  Reusing session from pageContext: ${extractedSessionId}`);
        connection = existing;
        actualSessionId = extractedSessionId;
      } else {
        logger.info(`⚠️  Session ${extractedSessionId} not found, will create new session`);
        if (!this.bcConfig) {
          if (!this.connection) {
            return err(
              new ProtocolError(
                `Session ${extractedSessionId} not found and no BC config or fallback connection available`,
                { sessionId: extractedSessionId, pageId }
              )
            );
          }
          logger.info(`⚠️  No BC config, using injected connection`);
          connection = this.connection;
          actualSessionId = 'legacy-session';
        } else {
          const sessionResult = await manager.getOrCreateSession(this.bcConfig);
          if (sessionResult.ok === false) {
            return err(sessionResult.error);
          }
          connection = sessionResult.value.connection;
          actualSessionId = sessionResult.value.sessionId;
          logger.info(
            `${sessionResult.value.isNewSession ? '🆕 New' : '♻️  Reused'} session: ${actualSessionId}`
          );
        }
      }
    } else {
      if (!this.bcConfig) {
        if (!this.connection) {
          return err(
            new ProtocolError(
              `No sessionId provided and no BC config or fallback connection available`,
              { pageId }
            )
          );
        }
        logger.info(`⚠️  No BC config, using injected connection`);
        connection = this.connection;
        actualSessionId = 'legacy-session';
      } else {
        const sessionResult = await manager.getOrCreateSession(this.bcConfig);
        if (sessionResult.ok === false) {
          return err(sessionResult.error);
        }
        connection = sessionResult.value.connection;
        actualSessionId = sessionResult.value.sessionId;
        logger.info(
          `${sessionResult.value.isNewSession ? '🆕 New' : '♻️  Reused'} session: ${actualSessionId}`
        );
      }
    }

    // Check if page is already open in the session (true user simulation)
    let allHandlers: Handler[] = [];
    const pageIdStr = String(pageId); // Ensure pageId is always a string

    // ALWAYS close ALL forms before opening a new page to prevent BC caching
    // This ensures BC creates a fresh form for each page request
    const allOpenForms = connection.getAllOpenFormIds();
    if (allOpenForms.length > 0) {
      logger.info(`🧹 Closing ALL ${allOpenForms.length} open forms to prevent BC caching`);
      for (const formId of allOpenForms) {
        try {
          await connection.invoke({
            interactionName: 'CloseForm',
            namedParameters: {
              FormId: formId,
            },
            controlPath: 'server:',
            callbackId: '0',
          });
          logger.info(`  ✓ Closed form ${formId}`);
          // Untrack the form
          connection.getAllOpenFormIds().forEach(id => {
            if (id === formId) {
              // Clear tracking for this form
              for (const [pageId] of (connection as any).openForms?.entries() || []) {
                if ((connection as any).openForms?.get(pageId) === formId) {
                  (connection as any).openForms?.delete(pageId);
                }
              }
            }
          });
        } catch (error) {
          logger.info(`  ⚠️  Failed to close form ${formId}: ${String(error)}`);
        }
      }
      // Clear all form tracking after closing
      if ((connection as any).openForms) {
        (connection as any).openForms.clear();
      }
    }

    // Always open fresh forms to avoid BC caching issues
    logger.info(`🆕 Opening new BC Page: "${pageIdStr}" (using LoadForm solution)`);

    // Generate unique startTraceId for this request (prevents BC form caching)
    const startTraceId = newId();
    const dc = Date.now(); // Timestamp to ensure uniqueness

    // Build proper namedParameters as query string (matching real BC client)
    // This ensures BC treats each page request as unique
    const company = connection.getCompanyName() || 'CRONUS International Ltd.';
    const tenant = connection.getTenantId() || 'default';

    // Step 1: OpenForm to create shell/container form with complete parameters
    // BC expects namedParameters as JSON string with a "query" property containing URL-encoded parameters
    const queryString = `tenant=${encodeURIComponent(tenant)}&company=${encodeURIComponent(company)}&page=${String(pageId)}&runinframe=1&dc=${String(dc)}&startTraceId=${startTraceId}&bookmark=`;

    logger.info(`📝 OpenForm query string: ${queryString}`);

    const shellResult = await connection.invoke({
      interactionName: 'OpenForm',
      namedParameters: {
        query: queryString,  // BC protocol: query string format in "query" property
      },
      controlPath: 'server:c[0]',
      callbackId: '0',
    });

    if (!isOk(shellResult)) {
      return shellResult as Result<never, BCError>;
    }

    logger.info(`✓ OpenForm created shell for Page "${pageIdStr}"`);

    // Accumulate shell handlers
    allHandlers = Array.from(shellResult.value) as Handler[];

    // Step 2: Decompress response if needed (BC may compress responses)
    const decompressed = decompressResponse(shellResult.value);

    if (decompressed) {
      logger.info(`✓ Decompressed server response`);
    } else {
      logger.info(`ℹ️  Response not compressed, processing raw handlers`);
    }

    // Use decompressed data if available, otherwise use original response (which is already an array of handlers)
    const dataToProcess = decompressed || (shellResult.value as unknown[]);

    try {
      // Step 3: Extract ServerIds from form structure
      const { shellFormId, childFormIds } = extractServerIds(dataToProcess as any[]);
      logger.info(`✓ Extracted ServerIds: shell=${shellFormId}, children=${childFormIds.length}`);

      // Step 4: Filter child forms by LoadForm criteria (100% validated pattern)
      const formsToLoad = filterFormsToLoad(childFormIds);
      logger.info(`✓ Filtered forms to load: ${formsToLoad.length}/${childFormIds.length}`);

      // Track the shell form
      if (shellFormId) {
        connection.trackOpenForm(pageIdStr, shellFormId);
      }

      // Step 5: LoadForm each child form
      if (formsToLoad.length > 0) {
        const childHandlersResult = await connection.loadChildForms(formsToLoad);

        if (isOk(childHandlersResult)) {
          // Accumulate child form handlers
          allHandlers.push(...(Array.from(childHandlersResult.value) as Handler[]));
          logger.info(`✓ Loaded ${formsToLoad.length} child forms, total handlers: ${allHandlers.length}`);
        } else {
          logger.info(`⚠️  LoadForm failed for child forms: ${childHandlersResult.error.message}`);
          // Continue with shell handlers only
        }
      } else {
        logger.info(`ℹ️  No child forms to load for Page "${pageIdStr}"`);
      }
    } catch (error) {
      logger.info(`⚠️  ServerIds extraction failed: ${String(error)}`);
      logger.info(`ℹ️  Continuing with shell handlers only`);
      // Continue with shell handlers
    }

    // Parse metadata from accumulated handlers
    const metadataResult = this.metadataParser.parse(allHandlers);

    if (!isOk(metadataResult)) {
      return metadataResult as Result<never, BCError>;
    }

    const metadata = metadataResult.value;

    // Generate unique pageContextId that combines session + form instance
    const pageContextId = `${actualSessionId}:page:${metadata.pageId}:${Date.now()}`;

    // Store page context in ConnectionManager for later retrieval
    if ((connection as any).pageContexts) {
      (connection as any).pageContexts.set(pageContextId, {
        sessionId: actualSessionId,
        pageId: metadata.pageId,
        formIds: connection.getAllOpenFormIds(),
        openedAt: Date.now(),
      });
    } else {
      (connection as any).pageContexts = new Map();
      (connection as any).pageContexts.set(pageContextId, {
        sessionId: actualSessionId,
        pageId: metadata.pageId,
        formIds: connection.getAllOpenFormIds(),
        openedAt: Date.now(),
      });
    }

    // Determine page type from metadata
    let pageType: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report' = 'Card';
    if (metadata.caption?.toLowerCase().includes('list')) {
      pageType = 'List';
    } else if (metadata.caption?.toLowerCase().includes('document')) {
      pageType = 'Document';
    } else if (metadata.caption?.toLowerCase().includes('worksheet')) {
      pageType = 'Worksheet';
    } else if (metadata.caption?.toLowerCase().includes('report')) {
      pageType = 'Report';
    }

    // Format output for Claude
    const output: GetPageMetadataOutput = {
      pageId: metadata.pageId,
      pageContextId,
      caption: metadata.caption,
      description: this.generateDescription(metadata),
      pageType,
      fields: metadata.fields.map(field => ({
        name: field.name ?? field.caption ?? 'Unnamed',
        caption: field.caption ?? field.name ?? 'No caption',
        type: this.controlTypeToFieldType(field.type),
        required: false, // We'd need additional logic to determine this
        editable: field.enabled,
      })),
      actions: metadata.actions.map(action => ({
        name: action.caption ?? 'Unnamed',
        caption: action.caption ?? 'No caption',
        enabled: action.enabled,
        description: action.synopsis,
      })),
    };

    logger.info(`✓ Parsed metadata for Page "${pageIdStr}": caption="${metadata.caption}", pageId="${metadata.pageId}"`);
    logger.info(`✓ Generated pageContextId: ${pageContextId}`);

    // DON'T close forms - keep them open for true user simulation!
    // Forms stay open across requests, just like a real BC user session
    return ok(output);
  }


  /**
   * Generates a natural language description of the page.
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

    let description = `${metadata.caption}\n\n`;
    description += `This page contains ${fieldCount} data fields and ${totalActions} actions.\n`;
    description += `${enabledActions} actions are currently enabled.\n`;
    description += `Total UI controls: ${metadata.controlCount}`;

    return description;
  }

  /**
   * Converts BC control type to user-friendly field type.
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

  /**
   * Extracts formId from CallbackResponseProperties in handlers.
   * Used to close forms after extracting metadata.
   */
  private extractFormIdFromHandlers(handlers: readonly unknown[]): string | undefined {
    // Find CallbackResponseProperties handler
    const callbackHandler = handlers.find((h: unknown) => {
      const handler = h as Record<string, unknown>;
      return handler.handlerType === 'DN.CallbackResponseProperties';
    }) as Record<string, unknown> | undefined;

    if (!callbackHandler) {
      return undefined;
    }

    // Extract formId from CompletedInteractions[0].Result.value
    const parameters = callbackHandler.parameters as unknown[] | undefined;
    if (!parameters || parameters.length === 0) {
      return undefined;
    }

    const firstParam = parameters[0] as Record<string, unknown> | undefined;
    const completedInteractions = firstParam?.CompletedInteractions as unknown[] | undefined;
    if (!completedInteractions || completedInteractions.length === 0) {
      return undefined;
    }

    const firstInteraction = completedInteractions[0] as Record<string, unknown> | undefined;
    const result = firstInteraction?.Result as { reason?: number; value?: string } | undefined;
    return result?.value;
  }
}
