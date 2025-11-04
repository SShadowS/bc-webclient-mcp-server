/**
 * Create Record MCP Tool
 *
 * Convenience helper that combines get_page_metadata, execute_action("New"),
 * and write_page_data to create a new record in a single call.
 *
 * This is a composite tool that simplifies common workflows.
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type {
  CreateRecordInput,
  CreateRecordOutput,
  GetPageMetadataOutput,
  ExecuteActionOutput,
  WritePageDataOutput,
} from '../types/mcp-types.js';
import { GetPageMetadataTool } from './get-page-metadata-tool.js';
import { ExecuteActionTool } from './execute-action-tool.js';
import { WritePageDataTool } from './write-page-data-tool.js';
import { ensurePageIdentifiers } from '../utils/pageContext.js';
import { createToolLogger } from '../core/logger.js';

/**
 * MCP Tool: create_record
 *
 * Creates a new record by combining page opening, New action, and field setting.
 */
export class CreateRecordTool extends BaseMCPTool {
  public readonly name = 'create_record';

  public readonly description =
    'Creates a new Business Central record. Convenience helper that automates: get_page_metadata → execute_action("New") → write_page_data → save. ' +
    'Inputs: pageId|pageName OR pageContextId, fields object, autoOpen (default true), save (default TRUE). ' +
    'Behavior: Opens page if needed, switches to New mode, sets all fields, saves record. ' +
    'Returns: {record (with systemId), pageContextId} for the newly created record. ' +
    'Errors: ValidationError if fields invalid, PermissionDenied if cannot create.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (e.g., "21" for Customer Card)',
      },
      fields: {
        type: 'object',
        description: 'Field values for the new record (key: field name, value: field value)',
        additionalProperties: true,
      },
    },
    required: ['pageId', 'fields'],
  };

  private readonly getPageMetadataTool: GetPageMetadataTool;
  private readonly executeActionTool: ExecuteActionTool;
  private readonly writePageDataTool: WritePageDataTool;

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
    this.getPageMetadataTool = new GetPageMetadataTool(connection, bcConfig);
    this.executeActionTool = new ExecuteActionTool(connection, bcConfig);
    this.writePageDataTool = new WritePageDataTool(connection, bcConfig);
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<CreateRecordInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract pageId
    if (!this.hasProperty(input, 'pageId')) {
      return this.getRequiredString(input, 'pageId') as Result<never, BCError>;
    }

    const pageIdValue = (input as Record<string, unknown>).pageId;
    let pageId: string;

    if (typeof pageIdValue === 'string') {
      pageId = pageIdValue;
    } else if (typeof pageIdValue === 'number') {
      pageId = String(pageIdValue);
    } else {
      return this.getRequiredString(input, 'pageId') as Result<never, BCError>;
    }

    // Extract required fields
    const fieldsResult = this.getOptionalObject(input, 'fields');
    if (!isOk(fieldsResult)) {
      return fieldsResult as Result<never, BCError>;
    }

    if (!fieldsResult.value || Object.keys(fieldsResult.value).length === 0) {
      return err(
        new ProtocolError('No fields provided for new record', { pageId })
      );
    }

    return ok({
      pageId,
      fields: fieldsResult.value,
    });
  }

  /**
   * Executes the tool to create a new record.
   */
  protected async executeInternal(input: unknown): Promise<Result<CreateRecordOutput, BCError>> {
    const logger = createToolLogger('create_record', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { fields, pageId } = validatedInput.value;

    logger.info(`Creating new record on Page ${pageId}...`);

    try {
      // Step 1: Open page (get metadata) to establish session and open form
      logger.info(`Opening page ${pageId}...`);

      const metadataResult = await this.getPageMetadataTool.execute({
        pageId,
      });

      if (!isOk(metadataResult)) {
        return err(metadataResult.error);
      }

      // Extract sessionId from pageContextId (format: sessionId:page:pageId:timestamp)
      const pageContextId = (metadataResult.value as GetPageMetadataOutput).pageContextId;
      const [actualSessionId] = pageContextId.split(':');
      logger.info(`✓ Page opened, sessionId: ${actualSessionId}`);

      // Step 2: Execute "New" action to create blank record
      logger.info(`Executing "New" action...`);

      const newActionResult = await this.executeActionTool.execute({
        pageId,
        sessionId: actualSessionId,
        actionName: 'New',
      });

      if (!isOk(newActionResult)) {
        return err(newActionResult.error);
      }

      logger.info(`✓ New record created`);

      // Step 3: Write field values to the new record
      logger.info(`Setting ${Object.keys(fields).length} field(s)...`);

      const writeResult = await this.writePageDataTool.execute({
        pageId,
        sessionId: actualSessionId,
        fields,
      });

      if (!isOk(writeResult)) {
        return err(writeResult.error);
      }

      logger.info(`✓ Fields set successfully`);

      const writeOutput = writeResult.value as WritePageDataOutput;
      return ok({
        success: writeOutput.success,
        pageContextId: writeOutput.pageContextId,
        pageId: String(pageId),
        record: writeOutput.record,
        saved: writeOutput.saved,
        setFields: writeOutput.updatedFields || Object.keys(fields),
        failedFields: writeOutput.failedFields,
        message: `Successfully created new record on page ${pageId} with ${Object.keys(fields).length} field(s)`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new ProtocolError(
          `Failed to create record: ${errorMessage}`,
          { pageId, fields, error: errorMessage }
        )
      );
    }
  }
}
