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
import { decompressResponse, extractServerIds, filterFormsToLoad, createLoadFormInteraction } from '../util/loadform-helpers.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { ProtocolError } from '../core/errors.js';
import { newId } from '../core/id.js';
import { createToolLogger } from '../core/logger.js';
import { PageContextCache } from '../services/page-context-cache.js';
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

  // Consent configuration - Read-only metadata operation, no consent needed
  public readonly requiresConsent = false;
  public readonly sensitivityLevel = 'low' as const;

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

    // REMOVED: Aggressive form closing logic was causing OpenForm failures for Pages 22 & 30
    // BC can handle multiple open forms - let it manage form lifecycle naturally
    // The close logic with manual tracking manipulation was corrupting session state
    logger.info(`ℹ️  Skipping form close - BC will manage form lifecycle`);

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

    // Step 3: Extract child forms and call LoadForm for list pages
    // Based on WebSocket capture: web client calls LoadForm with loadData:true after OpenForm
    // This triggers BC to send list data via async Message events
    try {
      const { childFormIds } = extractServerIds(allHandlers);
      const formsToLoad = filterFormsToLoad(childFormIds);

      if (formsToLoad.length > 0) {
        logger.info(`📋 Found ${formsToLoad.length} child form(s) requiring LoadForm`);

        // Set up listener for async Message events BEFORE calling LoadForm
        // BC sends list data in Message events, not in LoadForm responses
        const hasListData = (handlers: Handler[]): { matched: boolean; data?: Handler[] } => {
          const matched = handlers.some((h: any) =>
            h.handlerType === 'DN.LogicalClientChangeHandler' &&
            Array.isArray(h.parameters?.[1]) &&
            h.parameters[1].some((change: any) =>
              change.t === 'DataRefreshChange' && Array.isArray(change.RowChanges)
            )
          );
          return matched ? { matched: true, data: handlers } : { matched: false };
        };

        const asyncHandlersPromise = connection.waitForHandlers(hasListData, { timeoutMs: 5000 });

        // Call LoadForm for each child form (web client pattern)
        for (let i = 0; i < formsToLoad.length; i++) {
          const child = formsToLoad[i];
          const interaction = createLoadFormInteraction(child.serverId, String(i));

          logger.info(`📤 Calling LoadForm for: ${child.serverId}`);
          const loadResult = await connection.invoke(interaction);

          if (!isOk(loadResult)) {
            logger.info(`⚠️  LoadForm failed for ${child.serverId}: ${loadResult.error.message}`);
            continue;
          }

          logger.info(`✓ LoadForm sent for: ${child.serverId}`);
        }

        // Wait for async data (if LoadForm was called)
        if (formsToLoad.length > 0) {
          try {
            const asyncHandlers = await asyncHandlersPromise;
            if (asyncHandlers && Array.isArray(asyncHandlers)) {
              logger.info(`✓ Received ${asyncHandlers.length} async handlers with list data`);
              allHandlers.push(...asyncHandlers);
            } else {
              logger.info(`ℹ️  No async list data received (predicate returned no data)`);
            }
          } catch (err) {
            logger.info(`ℹ️  No async list data received (timeout or no data): ${String(err)}`);
          }
        }
      } else {
        logger.info(`ℹ️  No child forms requiring LoadForm (Card page or no delayed controls)`);
      }
    } catch (err) {
      logger.info(`⚠️  LoadForm extraction/call failed: ${String(err)} - continuing with OpenForm data only`);
    }

    // Parse metadata from accumulated handlers (now includes LoadForm data if available)
    const metadataResult = this.metadataParser.parse(allHandlers);

    if (!isOk(metadataResult)) {
      return metadataResult as Result<never, BCError>;
    }

    const metadata = metadataResult.value;

    // Generate unique pageContextId that combines session + form instance
    const pageContextId = `${actualSessionId}:page:${metadata.pageId}:${Date.now()}`;

    // Determine page type from ViewMode/FormStyle (accurate) or caption (fallback)
    const pageType = this.inferPageType(allHandlers, metadata.caption);

    // Extract LogicalForm from handlers for caching
    const logicalForm = this.extractLogicalFormFromHandlers(allHandlers);

    // Prepare page context data
    const pageContextData = {
      sessionId: actualSessionId,
      pageId: metadata.pageId,
      formIds: connection.getAllOpenFormIds(),
      openedAt: Date.now(),
      pageType, // Cache page type
      logicalForm, // Cache LogicalForm for read_page_data
      handlers: allHandlers, // Cache all handlers (including LoadForm data) for list extraction
    };

    // Store page context in memory (ConnectionManager)
    if ((connection as any).pageContexts) {
      (connection as any).pageContexts.set(pageContextId, pageContextData);
    } else {
      (connection as any).pageContexts = new Map();
      (connection as any).pageContexts.set(pageContextId, pageContextData);
    }

    // 💾 PERSIST to disk (survives MCP server restarts)
    try {
      const cache = PageContextCache.getInstance();
      await cache.save(pageContextId, pageContextData);
      logger.debug(`💾 Persisted pageContext to cache: ${pageContextId}`);
    } catch (error) {
      // Non-fatal: continue even if cache save fails
      logger.error(`⚠️  Failed to persist pageContext: ${error}`);
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

  /**
   * Infers page type from BC metadata.
   *
   * Uses ViewMode and FormStyle from LogicalForm (most accurate).
   * Falls back to caption heuristics if metadata unavailable.
   *
   * ViewMode values:
   * - 1 = List/Worksheet (multiple records)
   * - 2 = Card/Document (single record)
   *
   * FormStyle values (when ViewMode=2):
   * - 1 = Document
   * - undefined/absent = Card
   */
  private inferPageType(
    handlers: readonly Handler[],
    caption: string
  ): 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report' {
    // Extract LogicalForm from handlers
    const logicalForm = this.extractLogicalFormFromHandlers(handlers);
    const viewMode = logicalForm?.ViewMode;
    const formStyle = logicalForm?.FormStyle;

    // Primary detection: Use BC's ViewMode and FormStyle metadata
    if (viewMode !== undefined) {
      if (viewMode === 1) {
        // List-style pages (multiple records)
        const lower = caption.toLowerCase();
        if (lower.includes('worksheet') || lower.includes('journal')) {
          return 'Worksheet';
        }
        return 'List';
      }

      if (viewMode === 2) {
        // Detail-style pages (single record)
        if (formStyle === 1) {
          return 'Document';
        }
        return 'Card';
      }
    }

    // Fallback: Heuristic detection (less reliable)
    const lower = caption.toLowerCase();
    if (lower.includes('list')) return 'List';
    if (lower.includes('document')) return 'Document';
    if (lower.includes('worksheet')) return 'Worksheet';
    if (lower.includes('report')) return 'Report';

    return 'Card';
  }

  /**
   * Extracts LogicalForm from handlers (finds FormToShow handler).
   */
  private extractLogicalFormFromHandlers(handlers: readonly Handler[]): any | null {
    for (const handler of handlers) {
      if (
        handler.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        handler.parameters?.[0] === 'FormToShow'
      ) {
        return handler.parameters[1]; // LogicalForm object
      }
    }
    return null;
  }
}
