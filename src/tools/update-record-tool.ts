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
import { ExecuteActionTool } from './execute-action-tool.js';
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
    'Updates an existing Business Central record. High-level convenience wrapper that orchestrates page opening, edit mode, field updates, and saving. ' +
    'Inputs: pageId, fields, autoEdit (default TRUE), save (default TRUE), stopOnError (default TRUE). ' +
    'Behavior: Opens page if needed, executes Edit action if autoEdit=true, applies all fields, executes Save action if save=true. ' +
    'Returns: {success, updatedFields, failedFields, saved}. ' +
    'Use this for simple "update a record" workflows. Use write_page_data for more control.';

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
  private readonly executeActionTool: ExecuteActionTool;

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
    this.executeActionTool = new ExecuteActionTool(connection, bcConfig);
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
    // Extract options from input
    const autoEdit = (input as any).autoEdit !== false; // Default: true
    const save = (input as any).save !== false; // Default: true
    const stopOnError = (input as any).stopOnError !== false; // Default: true

    logger.info(`Updating record on Page ${pageId}...`);
    logger.info(`Options: autoEdit=${autoEdit}, save=${save}, stopOnError=${stopOnError}`);

    try {
      // Step 1: Open page (get metadata) to establish session and open form
      logger.info(`Step 1: Opening page ${pageId}...`);

      const metadataResult = await this.getPageMetadataTool.execute({
        pageId,
      });

      if (!isOk(metadataResult)) {
        return err(metadataResult.error);
      }

      const pageContextId = (metadataResult.value as GetPageMetadataOutput).pageContextId;
      logger.info(`✓ Page opened with context: ${pageContextId}`);

      // Step 2: Execute Edit action if autoEdit is enabled
      if (autoEdit) {
        logger.info(`Step 2: Executing Edit action...`);

        const editResult = await this.executeActionTool.execute({
          pageId,
          actionName: 'Edit',
        });

        if (!isOk(editResult)) {
          logger.info(`⚠️  Edit action failed: ${editResult.error.message}`);
          // Don't fail - page might already be in edit mode
        } else {
          logger.info(`✓ Edit mode activated`);
        }
      }

      // Step 3: Write field values
      logger.info(`Step 3: Updating ${Object.keys(fields).length} field(s)...`);

      // Convert simple fields map to internal format expected by write_page_data
      const fieldsForWrite: Record<string, { value: unknown; controlPath?: string }> = {};
      for (const [name, value] of Object.entries(fields)) {
        fieldsForWrite[name] = { value };
      }

      const writeResult = await this.writePageDataTool.execute({
        pageContextId,
        fields: fieldsForWrite,
        stopOnError,
        immediateValidation: true,
      });

      if (!isOk(writeResult)) {
        return err(writeResult.error);
      }

      const writeOutput = writeResult.value as WritePageDataOutput;
      logger.info(`✓ Fields updated: ${writeOutput.updatedFields?.length || 0} succeeded, ${writeOutput.failedFields?.length || 0} failed`);

      // Step 4: Execute Save action if save is enabled and fields were updated
      let saved = false;
      if (save && writeOutput.success) {
        logger.info(`Step 4: Executing Save action...`);

        const saveResult = await this.executeActionTool.execute({
          pageId,
          actionName: 'Save',
        });

        if (!isOk(saveResult)) {
          logger.info(`⚠️  Save action failed: ${saveResult.error.message}`);
          // Don't fail completely - fields were updated
        } else {
          saved = true;
          logger.info(`✓ Changes saved`);
        }
      }

      logger.info(`✓ Record update completed`);

      return ok({
        success: writeOutput.success,
        pageContextId: writeOutput.pageContextId,
        pageId: String(pageId),
        record: writeOutput.record,
        saved,
        updatedFields: writeOutput.updatedFields || Object.keys(fields),
        failedFields: writeOutput.failedFields,
        message: `Successfully updated ${writeOutput.updatedFields?.length || Object.keys(fields).length} field(s) on page ${pageId}${saved ? ' (saved)' : ''}`,
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
