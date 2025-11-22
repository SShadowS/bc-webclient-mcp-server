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
 * Requires AT LEAST ONE of pageId or pageContextId.
 */
const GetPageMetadataInputZodSchema = z.object({
  pageId: PageIdSchema.optional(),
  pageContextId: PageContextIdSchema.optional(),
  bookmark: z.string().optional(),
  filters: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
}).refine(
  (data) => data.pageId !== undefined || data.pageContextId !== undefined,
  {
    message: "At least one of 'pageId' or 'pageContextId' must be provided",
  }
);

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
    'Opens a Business Central page and retrieves its metadata, creating or refreshing a pageContextId for subsequent stateful operations. ' +
    'EITHER pageId OR pageContextId is required (not both): ' +
    'pageId: The BC page ID (e.g., 21 for Customer Card, 22 for Customer List) - opens a new page. ' +
    'pageContextId: Existing page context ID from previous get_page_metadata or drill-down - retrieves cached metadata for already-open page. ' +
    'bookmark (optional, RECOMMENDED): BC bookmark string for direct record navigation (e.g., "1D_JAAAAACLAQAAAAJ7BjEAMAAxADAAMAAwADEA"). ' +
    'Bookmarks provide the native BC pattern for opening pages at specific records. Get bookmarks from read_page_data results. ' +
    'CRITICAL: After state-changing actions (like Release, Post, Delete), use bookmark to open a fresh page session at the updated record. ' +
    'filters (optional, LEGACY): Navigate using field filters (e.g., {"No.": "10000"}). Only works on List pages. Use bookmark instead for Card/Document pages. ' +
    'Returns: pageContextId (use with read_page_data, write_page_data, execute_action), ' +
    'pageType ("List"|"Card"|"Document"|"Worksheet"), ' +
    'fields array with metadata (name, caption, type, editable, required), ' +
    'actions array (available buttons/operations), and page structure information. ' +
    'Side effects: Creates a new page context bound to the underlying BC session. ' +
    'When bookmark provided, BC creates a fresh session positioned at that specific record (always returns current data). ' +
    'Context may expire if session ends or navigation leaves the page. ' +
    'Typical workflow: search_pages → get_page_metadata → read_page_data (save bookmark) → execute_action → get_page_metadata with bookmark.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (e.g., "21" for Customer Card) - use to open a new page',
      },
      pageContextId: {
        type: 'string',
        description: 'Existing page context ID to retrieve cached metadata (from drill-down or previous get_page_metadata)',
      },
      bookmark: {
        type: 'string',
        description: 'BC bookmark for direct record navigation (RECOMMENDED). Get bookmarks from read_page_data results. ' +
          'Example: "1D_JAAAAACLAQAAAAJ7BjEAMAAxADAAMAAwADEA". Use this for refreshing data after actions.',
      },
      filters: {
        type: 'object',
        description: 'LEGACY: Optional filters to open a specific record (e.g., {"No.": "10000"}). ' +
          'Only works on List pages. Prefer using bookmark instead for reliable navigation.',
        additionalProperties: {
          type: ['string', 'number'],
        },
      },
    },
    // At least one of pageId or pageContextId is required
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
    let { pageId, pageContextId: inputPageContextId, filters, bookmark } = input as GetPageMetadataInputValidated;

    // Track existing formIds from pageContext to preserve them (avoid overwriting with getAllOpenFormIds)
    let existingFormIds: string[] | null = null;

    // If pageId not provided but pageContextId is, extract pageId from pageContextId
    // Format: sessionId:page:pageId:timestamp
    if (!pageId && inputPageContextId) {
      const parts = inputPageContextId.split(':');
      if (parts.length >= 3 && parts[1] === 'page') {
        pageId = parts[2];
      } else {
        return err(
          new ProtocolError(
            `Invalid pageContextId format: ${inputPageContextId}. Expected format: sessionId:page:pageId:timestamp`,
            { pageContextId: inputPageContextId }
          )
        );
      }
    }

    // At this point, pageId must be defined (either provided directly or extracted from pageContextId)
    if (!pageId) {
      return err(
        new ProtocolError(
          `pageId could not be determined. Provide either pageId or pageContextId.`,
          { input }
        )
      );
    }

    // Create logger for this execution
    const logger = createToolLogger('GetPageMetadata', inputPageContextId);
    logger.info(`Requesting metadata for BC Page: "${pageId}"${inputPageContextId ? ` (from pageContextId: ${inputPageContextId})` : ''}`);

    // REMOVED: Card→List navigation delegation
    // We now use BC's native bookmark-based navigation pattern instead
    // See docs/BOOKMARK_NAVIGATION.md for details

    const manager = ConnectionManager.getInstance();
    let connection: IBCConnection;
    let actualSessionId: string;

    // Try to reuse existing session if pageContextId provided
    if (inputPageContextId) {
      // Extract sessionId from pageContextId (format: sessionId:page:pageId:timestamp)
      const [extractedSessionId] = inputPageContextId.split(':');
      const existing = manager.getSession(extractedSessionId);
      if (existing) {
        logger.info(`Reusing session from pageContext: ${extractedSessionId}`);
        connection = existing;
        actualSessionId = extractedSessionId;
      } else {
        logger.info(`Session ${extractedSessionId} not found, will create new session`);
        if (!this.bcConfig) {
          if (!this.connection) {
            return err(
              new ProtocolError(
                `Session ${extractedSessionId} not found and no BC config or fallback connection available`,
                { sessionId: extractedSessionId, pageId }
              )
            );
          }
          logger.info(`No BC config, using injected connection`);
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
            `${sessionResult.value.isNewSession ? 'New' : 'Reused'} session: ${actualSessionId}`
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
        logger.info(`No BC config, using injected connection`);
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
          `${sessionResult.value.isNewSession ? 'New' : 'Reused'} session: ${actualSessionId}`
        );
      }
    }

    // If caller provided an existing pageContextId, try to reuse cached metadata instead of reopening the page
    let allHandlers: Handler[] = [];
    let reusedFromContext = false;
    let reusedLogicalForm: any | null = null;
    let reusedPageType: 'Card' | 'List' | 'Document' | 'Worksheet' | 'Report' | undefined;

    if (inputPageContextId) {
      const contextParts = inputPageContextId.split(':');
      if (contextParts.length < 3) {
        return err(
          new ProtocolError(
            `Invalid pageContextId format: ${inputPageContextId}`,
            { pageContextId: inputPageContextId }
          )
        );
      }

      const contextSessionId = contextParts[0];
      const contextPageId = contextParts[2];

      // Sanity check: pageId consistency (only warn, don't hard-fail)
      if (String(contextPageId) !== String(pageId)) {
        logger.warn(
          `pageContextId pageId (${contextPageId}) does not match requested pageId (${pageId}). ` +
          `Continuing but results may be unexpected.`
        );
      }

      if (contextSessionId !== actualSessionId) {
        // This should not normally happen because we resolved connection from the same pageContextId
        logger.warn(
          `pageContextId sessionId (${contextSessionId}) does not match active session (${actualSessionId}). ` +
          `Treating pageContext as stale.`
        );
      } else {
        // Try in-memory context first
        let pageContext = (connection as any).pageContexts?.get(inputPageContextId);

        // If not in memory, try persistent cache
        if (!pageContext) {
          logger.info(`Page context not in memory, checking persistent cache...`);
          try {
            const cache = PageContextCache.getInstance();
            const cachedContext = await cache.load(inputPageContextId);
            if (cachedContext) {
              logger.info(`Restored pageContext from cache: ${inputPageContextId}`);
              if (!(connection as any).pageContexts) {
                (connection as any).pageContexts = new Map();
              }
              (connection as any).pageContexts.set(inputPageContextId, cachedContext);
              pageContext = cachedContext;
            }
          } catch (error) {
            logger.warn(`Failed to load pageContext from cache: ${error}`);
          }
        }

        if (pageContext) {
          // CRITICAL: Preserve existing formIds to avoid overwriting with getAllOpenFormIds()
          // This prevents execute_action from using wrong formId after drill-down
          if (Array.isArray(pageContext.formIds) && pageContext.formIds.length > 0) {
            existingFormIds = pageContext.formIds;
            logger.info(`Preserving existing formIds from pageContext: ${JSON.stringify(existingFormIds)}`);
          }

          // Reuse cached handlers + metadata
          const cachedHandlers = pageContext.handlers as Handler[] | undefined;
          if (cachedHandlers && cachedHandlers.length > 0) {
            logger.info(
              `Reusing ${cachedHandlers.length} cached handlers from pageContext ` +
              `"${inputPageContextId}" - skipping OpenForm/LoadForm`
            );
            allHandlers = cachedHandlers;
            reusedFromContext = true;
            reusedLogicalForm = pageContext.logicalForm ?? null;
            reusedPageType = pageContext.pageType;
          } else {
            logger.info(
              `Page context "${inputPageContextId}" has no cached handlers. ` +
              `Treating as stale and requiring fresh OpenForm.`
            );
          }
        } else {
          // Mirror read_page_data behavior: explicit context not found → error, not implicit reopen
          logger.info(`Page context not found in memory or cache`);
          return err(
            new ProtocolError(
              `Page context ${inputPageContextId} not found. Page may have been closed. Please call get_page_metadata again.`,
              { pageContextId: inputPageContextId }
            )
          );
        }
      }
    }

    // From here on, if reusedFromContext is true, we must NOT call OpenForm/LoadForm
    const pageIdStr = String(pageId); // Ensure pageId is always a string

    if (!reusedFromContext) {
      // REMOVED: Aggressive form closing logic was causing OpenForm failures for Pages 22 & 30
      // BC can handle multiple open forms - let it manage form lifecycle naturally
      // The close logic with manual tracking manipulation was corrupting session state
      logger.info(`Skipping form close - BC will manage form lifecycle`);

      // Always open fresh forms to avoid BC caching issues
      logger.info(`Opening new BC Page: "${pageIdStr}" (using LoadForm solution)`);

    // Generate unique startTraceId for this request (prevents BC form caching)
    const startTraceId = newId();
    const dc = Date.now(); // Timestamp to ensure uniqueness

    // Build proper namedParameters as query string (matching real BC client)
    // This ensures BC treats each page request as unique
    const company = connection.getCompanyName() || 'CRONUS International Ltd.';
    const tenant = connection.getTenantId() || 'default';

    // Step 1: OpenForm to create shell/container form with complete parameters
    // BC expects namedParameters as JSON string with a "query" property containing URL-encoded parameters

    // Build bookmark or filter parameters for the URL
    // PRIORITY: bookmark > filters (bookmark is BC's native navigation pattern)
    let navigationParams = '';

    if (bookmark) {
      // Use bookmark-based navigation (BC native pattern)
      navigationParams = `&bookmark=${encodeURIComponent(bookmark)}`;
      logger.info(`Using bookmark navigation: ${bookmark}`);

      if (filters && Object.keys(filters).length > 0) {
        logger.warn('Both bookmark and filters provided - bookmark takes priority, ignoring filters');
      }
    } else if (filters && Object.keys(filters).length > 0) {
      // Fallback to filter-based navigation (only works on List pages)
      // BC URL filter format uses individual field=value parameters, not a "filter" parameter
      const filterParts = Object.entries(filters).map(([field, value]) => {
        // BC URL format: field=value (URL encoded)
        return `${encodeURIComponent(field)}=${encodeURIComponent(String(value))}`;
      });
      navigationParams = '&' + filterParts.join('&') + '&bookmark=';
      logger.info(`Using filter navigation: ${JSON.stringify(filters)}`);
    } else {
      // No navigation parameters - open page at default position
      navigationParams = '&bookmark=';
    }

    const queryString = `tenant=${encodeURIComponent(tenant)}&company=${encodeURIComponent(company)}&page=${String(pageId)}&runinframe=1&dc=${String(dc)}&startTraceId=${startTraceId}${navigationParams}`;

    logger.info(`OpenForm query string: ${queryString}`);

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

    logger.info(`OpenForm created shell for Page "${pageIdStr}"`);

    // Accumulate shell handlers
    allHandlers = Array.from(shellResult.value) as Handler[];
    logger.info(`OpenForm returned ${allHandlers.length} handlers`);

    // Step 2: Decompress response if needed (BC may compress responses)
    const decompressed = decompressResponse(shellResult.value);

    if (decompressed) {
      logger.info(`Decompressed server response`);
    } else {
      logger.info(`Response not compressed, processing raw handlers`);
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
        logger.info(`Found ${formsToLoad.length} child form(s) requiring LoadForm`);

        // Set up listener for async Message events BEFORE calling LoadForm
        // BC sends list data in Message events, not in LoadForm responses
        const hasListData = (handlers: Handler[]): { matched: boolean; data?: Handler[] } => {
          const matched = handlers.some((h: any) =>
            h.handlerType === 'DN.LogicalClientChangeHandler' &&
            Array.isArray(h.parameters?.[1]) &&
            h.parameters[1].some((change: any) =>
              (change.t === 'DataRefreshChange' || change.t === 'InitializeChange') && Array.isArray(change.RowChanges)
            )
          );
          return matched ? { matched: true, data: handlers } : { matched: false };
        };

        const asyncHandlersPromise = connection.waitForHandlers(hasListData, { timeoutMs: 5000 });

        // Call LoadForm for each child form (web client pattern)
        for (let i = 0; i < formsToLoad.length; i++) {
          const child = formsToLoad[i];
          const interaction = createLoadFormInteraction(child.serverId, String(i));

          logger.info(`Calling LoadForm for: ${child.serverId}`);
          const loadResult = await connection.invoke(interaction);

          if (!isOk(loadResult)) {
            logger.info(`LoadForm failed for ${child.serverId}: ${loadResult.error.message}`);
            continue;
          }

          logger.info(`LoadForm sent for: ${child.serverId}`);
        }

        // Wait for async data (if LoadForm was called)
        if (formsToLoad.length > 0) {
          try {
            const asyncHandlers = await asyncHandlersPromise;
            if (asyncHandlers && Array.isArray(asyncHandlers)) {
              logger.info(`Received ${asyncHandlers.length} async handlers with list data`);
              allHandlers.push(...asyncHandlers);
            } else {
              logger.info(`No async list data received (predicate returned no data)`);
            }
          } catch (err) {
            logger.info(`No async list data received (timeout or no data): ${String(err)}`);
          }
        }
      } else {
        logger.info(`No child forms requiring LoadForm (Card page or no delayed controls)`);
      }
    } catch (err) {
      logger.info(`LoadForm extraction/call failed: ${String(err)} - continuing with OpenForm data only`);
    }
    } // End if (!reusedFromContext)

    // Parse metadata from accumulated handlers (now includes LoadForm data if available)
    logger.info(`Total handlers before parsing: ${allHandlers.length}`);
    const metadataResult = this.metadataParser.parse(allHandlers);

    if (!isOk(metadataResult)) {
      return metadataResult as Result<never, BCError>;
    }

    const metadata = metadataResult.value;

    // Generate unique pageContextId that combines session + form instance
    const pageContextId = `${actualSessionId}:page:${metadata.pageId}:${Date.now()}`;

    // Determine page type from ViewMode/FormStyle (accurate) or caption (fallback)
    // Reuse cached values if available from existing pageContext
    const pageType =
      reusedPageType ??
      this.inferPageType(allHandlers, metadata.caption);

    // Extract LogicalForm from handlers for caching
    // Reuse cached values if available from existing pageContext
    const logicalForm =
      reusedLogicalForm ??
      this.extractLogicalFormFromHandlers(allHandlers);

    // Prepare page context data
    const pageContextData = {
      sessionId: actualSessionId,
      pageId: metadata.pageId,
      formIds: existingFormIds || connection.getAllOpenFormIds(),
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

    // PERSIST to disk (survives MCP server restarts)
    try {
      const cache = PageContextCache.getInstance();
      await cache.save(pageContextId, pageContextData);
      logger.debug(`Persisted pageContext to cache: ${pageContextId}`);
    } catch (error) {
      // Non-fatal: continue even if cache save fails
      logger.warn(`Failed to persist pageContext: ${error}`);
    }

    // NOTE: Filter-based navigation for Card/Document pages is now handled by
    // navigateToRecordViaList helper (see early delegation logic above).
    // List pages use read_page_data with setCurrent for navigation.

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
        controlPath: action.controlPath, // Required for InvokeAction
        systemAction: action.systemAction, // BC numeric action code
      })),
    };

    logger.info(`Parsed metadata for Page "${pageIdStr}": caption="${metadata.caption}", pageId="${metadata.pageId}"`);
    logger.info(`Generated pageContextId: ${pageContextId}`);

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
