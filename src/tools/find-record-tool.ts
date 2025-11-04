/**
 * Find Record MCP Tool
 *
 * Convenience helper that combines filter_list and read_page_data
 * to find and retrieve a specific record.
 *
 * This is a composite tool that simplifies common workflows.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError, NotImplementedError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type {
  FindRecordInput,
  FindRecordOutput,
  FilterListOutput,
  ReadPageDataOutput,
} from '../types/mcp-types.js';
import { ReadPageDataTool } from './read-page-data-tool.js';
import { FilterListTool } from './filter-list-tool.js';
import { ensurePageIdentifiers } from '../utils/pageContext.js';
import { createToolLogger } from '../core/logger.js';

/**
 * MCP Tool: find_record
 *
 * Finds a record by filtering and reading the result.
 */
export class FindRecordTool extends BaseMCPTool {
  public readonly name = 'find_record';

  public readonly description =
    'Finds a Business Central record by filter and optionally sets it as current. ' +
    'Convenience helper that uses filter_list and read_page_data internally. ' +
    'Inputs: pageContextId, filter expression (columnName=value), setCurrent (default TRUE), requireUnique (default TRUE). ' +
    'Returns: {record} if unique match found, error on NotFound or MultipleMatches (when requireUnique=true). ' +
    'Side effect: Sets found record as current by default for subsequent operations.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (must be a list page)',
      },
      filterField: {
        type: 'string',
        description: 'Field/column name to filter by (e.g., "Name", "No.")',
      },
      filterValue: {
        type: 'string',
        description: 'Value to search for',
      },
    },
    required: ['pageId', 'filterField', 'filterValue'],
  };

  private readonly readPageDataTool: ReadPageDataTool;
  private readonly filterListTool: FilterListTool;

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

    // Create tool instances for composition
    this.readPageDataTool = new ReadPageDataTool(connection, bcConfig);
    this.filterListTool = new FilterListTool(connection, bcConfig);
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<FindRecordInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract required pageContextId
    const pageContextIdResult = this.getRequiredString(input, 'pageContextId');
    if (!isOk(pageContextIdResult)) {
      return pageContextIdResult as Result<never, BCError>;
    }

    // Extract required filter
    const filterResult = this.getRequiredString(input, 'filter');
    if (!isOk(filterResult)) {
      return filterResult as Result<never, BCError>;
    }

    // Extract optional setCurrent
    const setCurrentValue = (input as Record<string, unknown>).setCurrent;
    const setCurrent = typeof setCurrentValue === 'boolean' ? setCurrentValue : true;

    // Extract optional requireUnique
    const requireUniqueValue = (input as Record<string, unknown>).requireUnique;
    const requireUnique = typeof requireUniqueValue === 'boolean' ? requireUniqueValue : true;

    return ok({
      pageContextId: pageContextIdResult.value,
      filter: filterResult.value,
      setCurrent,
      requireUnique,
    });
  }

  /**
   * Executes the tool to find a record.
   */
  protected async executeInternal(input: unknown): Promise<Result<FindRecordOutput, BCError>> {
    const logger = createToolLogger('find_record', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageContextId, filter, setCurrent, requireUnique } = validatedInput.value;

    logger.info(`Finding record using filter: "${filter}"...`);

    // Parse the filter expression (format: "columnName=value" or "columnName:value")
    let columnName: string;
    let filterValue: string;

    const filterMatch = filter.match(/^([^=:]+)[=:](.*)$/);
    if (!filterMatch) {
      return err(
        new ProtocolError(
          `Invalid filter format. Expected "columnName=value" or "columnName:value", got: "${filter}"`,
          { filter }
        )
      );
    }

    columnName = filterMatch[1].trim();
    filterValue = filterMatch[2].trim();

    logger.info(`Parsed filter - Column: "${columnName}", Value: "${filterValue}"`);

    try {
      // Step 1: Apply filter using the migrated FilterListTool
      logger.info(`Applying filter...`);

      const filterResult = await this.filterListTool.execute({
        pageContextId,
        columnName,
        filterValue,
      });

      if (!isOk(filterResult)) {
        logger.info(`Filter failed: ${filterResult.error.message}`);
        return err(filterResult.error);
      }

      const filterOutput = filterResult.value as FilterListOutput;
      logger.info(`✓ Filter applied successfully`);

      // Step 2: Read filtered data
      logger.info(`Reading filtered data...`);

      const readResult = await this.readPageDataTool.execute({
        pageContextId: filterOutput.pageContextId, // Use the pageContextId from filter result
      });

      if (!isOk(readResult)) {
        logger.info(`Read failed: ${readResult.error.message}`);
        return err(readResult.error);
      }

      const readOutput = readResult.value as ReadPageDataOutput;
      logger.info(`✓ Read completed, found ${readOutput.records.length} records`);

      // Step 3: Check results based on requirements
      if (readOutput.records.length === 0) {
        return err(
          new ProtocolError(
            `No record found matching filter: ${columnName}="${filterValue}"`,
            { pageContextId, columnName, filterValue }
          )
        );
      }

      if (requireUnique && readOutput.records.length > 1) {
        return err(
          new ProtocolError(
            `Multiple records (${readOutput.records.length}) found matching filter: ${columnName}="${filterValue}". ` +
            `Set requireUnique=false to return all matches.`,
            { pageContextId, columnName, filterValue, matchCount: readOutput.records.length }
          )
        );
      }

      // Step 4: Set current if requested (default true)
      if (setCurrent && readOutput.records.length === 1) {
        // The first record should already be current after filtering
        logger.info(`Record set as current`);
      }

      // Return results
      if (requireUnique) {
        // Return single record
        const result: FindRecordOutput = {
          success: true,
          pageContextId: readOutput.pageContextId,
          pageId: readOutput.pageId,
          record: readOutput.records[0],
          totalMatches: readOutput.records.length,
          message: `Found ${readOutput.records.length} record(s) matching ${columnName}="${filterValue}"`,
        };
        logger.info(`✓ Successfully found record`);
        return ok(result);
      } else {
        // Return all matches
        const result: FindRecordOutput = {
          success: true,
          pageContextId: readOutput.pageContextId,
          pageId: readOutput.pageId,
          records: readOutput.records,
          totalMatches: readOutput.records.length,
          message: `Found ${readOutput.records.length} record(s) matching ${columnName}="${filterValue}"`,
        };
        logger.info(`✓ Successfully found ${readOutput.records.length} record(s)`);
        return ok(result);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new ProtocolError(
          `Failed to find record: ${errorMessage}`,
          { pageContextId, filter, error: errorMessage }
        )
      );
    }
  }
}
