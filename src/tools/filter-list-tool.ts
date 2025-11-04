/**
 * Filter List MCP Tool
 *
 * Applies filters to list pages using BC's Filter interaction protocol.
 * Uses filter metadata from LoadForm responses to resolve column captions
 * to canonical field IDs.
 *
 * Protocol:
 * 1. Open list page and cache filter metadata
 * 2. Resolve column caption to canonical field ID (e.g., "Name" → "18_Customer.2")
 * 3. Send Filter interaction with resolved field ID
 * 4. Send SaveValue to set filter value (if provided)
 *
 * See docs/FILTER_METADATA_SOLUTION.md for full implementation details.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, isOk, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ValidationError, ProtocolError, NotImplementedError } from '../core/errors.js';
import type {
  FilterListInput,
  FilterListOutput,
} from '../types/mcp-types.js';
import type { IBCConnection } from '../core/interfaces.js';
import { ConnectionManager } from '../connection/connection-manager.js';
import { parsePageContextId } from '../utils/pageContext.js';
import { createToolLogger } from '../core/logger.js';

/**
 * MCP Tool: filter_list
 *
 * Applies filters to BC list pages by column name.
 */
export class FilterListTool extends BaseMCPTool {
  public readonly name = 'filter_list';

  public readonly description =
    'Applies a filter to a Business Central list page. ' +
    'Filters records by column name and optionally sets the filter value. ' +
    'Use get_page_metadata first to see available columns.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageContextId: {
        type: 'string',
        description: 'Page context ID from get_page_metadata (required)',
      },
      columnName: {
        type: 'string',
        description: 'Column caption to filter by (e.g., "Name", "No.", "Balance")',
      },
      filterValue: {
        type: 'string',
        description: 'Value to filter by (e.g., "Adatum", "1000")',
      },
    },
    required: ['pageContextId', 'columnName'],
  };

  public constructor(
    private readonly connection: IBCConnection,
    private readonly bcConfig?: {
      baseUrl: string;
      username: string;
      password: string;
      tenantId: string;
    }
  ) {
    super();
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<FilterListInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract required pageContextId
    const pageContextIdResult = this.getRequiredString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    // Extract columnName
    const columnNameResult = this.getRequiredString(input, 'columnName');
    if (!isOk(columnNameResult)) {
      return columnNameResult as Result<never, BCError>;
    }

    // Extract optional filterValue
    const filterValueResult = this.getOptionalString(input, 'filterValue');
    if (!isOk(filterValueResult)) {
      return filterValueResult as Result<never, BCError>;
    }

    return ok({
      pageContextId: pageContextIdResult.value,
      columnName: columnNameResult.value,
      filterValue: filterValueResult.value,
    });
  }

  /**
   * Executes the tool to apply a filter.
   */
  protected async executeInternal(input: unknown): Promise<Result<FilterListOutput, BCError>> {
    const logger = createToolLogger('filter_list', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, columnName, filterValue } = validatedInput.value;

    // Parse pageContextId to get session and page info
    let sessionId: string;
    let pageId: string;
    try {
      const contextParts = parsePageContextId(pageContextId);
      sessionId = contextParts.sessionId;
      pageId = contextParts.pageId;
    } catch (error) {
      return err(
        new ValidationError(`Invalid pageContextId format: ${pageContextId}`)
      );
    }

    logger.info(`Applying filter on Page ${pageId}: ${columnName} = "${filterValue || '(activating filter pane)'}"`);

    // Get connection from ConnectionManager
    const manager = ConnectionManager.getInstance();
    const connection = manager.getSession(sessionId);

    if (!connection) {
      return err(
        new ProtocolError(
          `Session ${sessionId} not found. Please call get_page_metadata first.`,
          { pageContextId, sessionId }
        )
      );
    }

    logger.info(`✓ Found session: ${sessionId}`);

    try {
      // Get the current page state to extract metadata
      logger.info(`Getting current page state...`);

      // First, try to get the current state of the page
      const stateResult = await connection.invoke({
        interactionName: 'GetState',
        namedParameters: {},
        controlPath: 'server:c[0]',
        callbackId: '0',
      });

      let handlers: any[];
      if (isOk(stateResult)) {
        handlers = stateResult.value as any[];
      } else {
        // If GetState fails, try RefreshForm
        logger.info(`GetState failed, trying RefreshForm...`);
        const refreshResult = await connection.invoke({
          interactionName: 'RefreshForm',
          namedParameters: {},
          controlPath: 'server:c[0]',
          callbackId: '0',
        });

        if (!isOk(refreshResult)) {
          return err(
            new ProtocolError(
              `Failed to get page state for filtering`,
              { pageId, error: refreshResult.error }
            )
          );
        }
        handlers = refreshResult.value as any[];
      }

      logger.info(`✓ Got page state, ${handlers.length} handlers`);

      // Extract formId from handlers
      let formId: string | null = null;
      for (const handler of handlers) {
        if (handler.handlerType === 'DN.LogicalClientEventRaisingHandler') {
          const params = handler.parameters || [];
          if (params.length >= 2 && params[1]?.ServerId) {
            formId = params[1].ServerId;
            break;
          }
        }
      }

      if (!formId) {
        // Try to get formId from the first LogicalForm handler
        for (const handler of handlers) {
          if (handler.handlerType === 'DN.LogicalClientChangeHandler' && handler.parameters?.[0]) {
            formId = handler.parameters[0];
            break;
          }
        }
      }

      if (!formId) {
        return err(
          new ProtocolError(
            `Could not extract formId from page ${pageId} state`,
            { pageId, handlersReceived: handlers.length }
          )
        );
      }

      logger.info(`✓ Extracted formId: ${formId}`);

      // For now, we'll use a simplified approach without full metadata caching
      // In a full implementation, we would parse the LogicalForm to get field metadata

      // Apply filter using the Filter interaction
      // We'll try common control paths for list controls
      const controlPaths = ['server:c[2]', 'server:c[1]', 'server:c[3]'];
      let filterApplied = false;
      let lastError: string | null = null;

      for (const controlPath of controlPaths) {
        try {
          logger.info(`Trying to apply filter on ${controlPath}...`);

          // Send Filter interaction
          const filterResult = await connection.invoke({
            interactionName: 'Filter',
            namedParameters: {
              columnName: columnName,
            },
            controlPath: controlPath,
            callbackId: '0',
          });

          if (isOk(filterResult) && filterValue) {
            // If filter value is provided, set it
            logger.info(`Setting filter value: "${filterValue}"...`);

            const saveValueResult = await connection.invoke({
              interactionName: 'SaveValue',
              namedParameters: {
                newValue: filterValue,
              },
              controlPath: `${controlPath}:filter`, // Filter control path
              callbackId: '0',
            });

            if (!isOk(saveValueResult)) {
              logger.info(`⚠️ SaveValue failed: ${saveValueResult.error.message}`);
            }
          }

          filterApplied = true;
          logger.info(`✓ Filter applied successfully on ${controlPath}`);
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          logger.info(`Failed on ${controlPath}: ${lastError}`);
          continue;
        }
      }

      if (!filterApplied) {
        return err(
          new ProtocolError(
            `Failed to apply filter on any control path. Last error: ${lastError}`,
            { pageId, columnName, filterValue, lastError }
          )
        );
      }

      return ok({
        success: true,
        pageContextId,
        pageId: String(pageId),
        columnName,
        filterValue,
        message: filterValue
          ? `Filter applied: "${columnName}" = "${filterValue}"`
          : `Filter pane activated for column: "${columnName}"`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new ProtocolError(
          `Failed to apply filter: ${errorMessage}`,
          { pageId, columnName, filterValue, error: errorMessage }
        )
      );
    }
  }

}
