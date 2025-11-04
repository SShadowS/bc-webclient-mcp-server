/**
 * Update Record MCP Tool
 *
 * Convenience helper that combines get_page_metadata and write_page_data
 * to update a record in a single call.
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
  UpdateRecordInput,
  UpdateRecordOutput,
  GetPageMetadataOutput,
  WritePageDataOutput,
} from '../types/mcp-types.js';
import { GetPageMetadataTool } from './get-page-metadata-tool.js';
import { WritePageDataTool } from './write-page-data-tool.js';
import { ensurePageIdentifiers } from '../utils/pageContext.js';
import { createToolLogger } from '../core/logger.js';

/**
 * MCP Tool: update_record
 *
 * Updates a record by combining page opening and field updates in one call.
 */
export class UpdateRecordTool extends BaseMCPTool {
  public readonly name = 'update_record';

  public readonly description =
    'Updates an existing Business Central record. Convenience helper that ensures edit mode and applies fields. ' +
    'Inputs: pageId|pageName OR pageContextId, recordSelector|filter, fields, autoEdit (default TRUE), save (default TRUE). ' +
    'Behavior: Opens page if needed, finds record, switches to Edit mode automatically, applies all fields, saves. ' +
    'Returns: {record, saved: boolean} indicating update success. ' +
    'Handles Edit mode automatically unlike write_page_data which requires manual execute_action("Edit").';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'The BC page ID (e.g., "21" for Customer Card)',
      },
      fields: {
        type: 'object',
        description: 'Field values to update (key: field name, value: field value)',
        additionalProperties: true,
      },
    },
    required: ['pageId', 'fields'],
  };

  private readonly getPageMetadataTool: GetPageMetadataTool;
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
    this.writePageDataTool = new WritePageDataTool(connection, bcConfig);
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<UpdateRecordInput, BCError> {
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
        new ProtocolError('No fields provided to update', { pageId })
      );
    }

    return ok({
      pageId,
      fields: fieldsResult.value,
    });
  }

  /**
   * Executes the tool to update a record.
   */
  protected async executeInternal(input: unknown): Promise<Result<UpdateRecordOutput, BCError>> {
    const logger = createToolLogger('update_record', (input as any)?.pageContextId);
    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { fields, pageId } = validatedInput.value;

    logger.info(`Updating record on Page ${pageId}...`);

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

      // Step 2: Write field values
      logger.info(`Updating ${Object.keys(fields).length} field(s)...`);

      const writeResult = await this.writePageDataTool.execute({
        pageId,
        sessionId: actualSessionId,
        fields,
      });

      if (!isOk(writeResult)) {
        return err(writeResult.error);
      }

      logger.info(`✓ Record updated successfully`);

      const writeOutput = writeResult.value as WritePageDataOutput;
      return ok({
        success: writeOutput.success,
        pageContextId: writeOutput.pageContextId,
        pageId: String(pageId),
        record: writeOutput.record,
        saved: writeOutput.saved,
        updatedFields: writeOutput.updatedFields || Object.keys(fields),
        failedFields: writeOutput.failedFields,
        message: `Successfully updated ${Object.keys(fields).length} field(s) on page ${pageId}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new ProtocolError(
          `Failed to update record: ${errorMessage}`,
          { pageId, fields, error: errorMessage }
        )
      );
    }
  }
}
