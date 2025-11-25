/**
 * Update Record MCP Tool
 *
 * Convenience helper that combines get_page_metadata and write_page_data
 * to update a record in a single call.
 *
 * This is a composite tool that simplifies common workflows.
 */

import { BaseMCPTool } from '../base-tool.js';
import type { Result } from '../../core/result.js';
import { ok, err, isOk } from '../../core/result.js';
import type { BCError } from '../../core/errors.js';
import { ProtocolError } from '../../core/errors.js';
import type { IBCConnection } from '../../core/interfaces.js';
import type {
  UpdateRecordInput,
  UpdateRecordOutput,
  GetPageMetadataOutput,
  WritePageDataOutput,
} from '../../types/mcp-types.js';
import { GetPageMetadataTool } from '../get-page-metadata-tool.js';
import { WritePageDataTool } from '../write-page-data-tool.js';
import { ExecuteActionTool } from '../execute-action-tool.js';
import { createToolLogger } from '../../core/logger.js';
import type { AuditLogger } from '../../services/audit-logger.js';

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
        description: 'The BC page ID (e.g., "21" for Customer Card). Optional if pageContextId provided.',
      },
      pageContextId: {
        type: 'string',
        description: 'Optional: Reuse existing page context instead of opening new page',
      },
      fields: {
        type: 'object',
        description: 'Field values to update (key: field name, value: field value)',
        additionalProperties: true,
      },
    },
    required: ['fields'],
  };

  // Consent configuration - Write operation requiring user approval
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'medium' as const;
  public readonly consentPrompt =
    'Update an existing record in Business Central? This will modify data in your Business Central database.';

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
    },
    auditLogger?: AuditLogger
  ) {
    super({ auditLogger });

    // Create tool instances for composition
    // Pass audit logger to write operations
    this.getPageMetadataTool = new GetPageMetadataTool(connection, bcConfig);
    this.writePageDataTool = new WritePageDataTool(connection, bcConfig, auditLogger);
    this.executeActionTool = new ExecuteActionTool(connection, bcConfig, auditLogger);
  }

  /**
   * Validates and extracts input.
   */
  protected override validateInput(input: unknown): Result<UpdateRecordInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract pageId (optional if pageContextId provided)
    const pageIdValue = (input as Record<string, unknown>).pageId;
    const pageContextIdValue = (input as Record<string, unknown>).pageContextId;

    // Must have either pageId or pageContextId
    if (!pageIdValue && !pageContextIdValue) {
      return err(
        new ProtocolError(
          'Must provide either pageId or pageContextId',
          { input }
        )
      );
    }

    let pageId: string | undefined;
    if (pageIdValue) {
      if (typeof pageIdValue === 'string') {
        pageId = pageIdValue;
      } else if (typeof pageIdValue === 'number') {
        pageId = String(pageIdValue);
      } else {
        return err(
          new ProtocolError(
            'pageId must be string or number',
            { pageIdValue }
          )
        );
      }
    }

    const pageContextId = typeof pageContextIdValue === 'string' ? pageContextIdValue : undefined;

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
      pageContextId,
      fields: fieldsResult.value,
    });
  }

  /**
   * Executes the tool to update a record.
   */
  protected async executeInternal(input: unknown): Promise<Result<UpdateRecordOutput, BCError>> {
    const logger = createToolLogger('update_record', (input as any)?.pageContextId);

    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { fields, pageId, pageContextId: existingPageContextId } = validatedInput.value;
    const options = this.extractOptions(input);

    logger.info(`Updating record...`);
    logger.info(existingPageContextId ? `Using existing page context: ${existingPageContextId}` : `Page: ${pageId}`);
    logger.info(`Options: autoEdit=${options.autoEdit}, save=${options.save}, stopOnError=${options.stopOnError}`);

    try {
      // Step 1: Get or open page
      const pageContextResult = await this.getOrOpenPage(existingPageContextId, pageId, logger);
      if (!isOk(pageContextResult)) return pageContextResult;
      const pageContextId = pageContextResult.value;

      // Step 2: Activate edit mode if needed
      if (options.autoEdit) {
        await this.activateEditMode(pageId, pageContextId, logger);
      }

      // Step 3: Write field values
      const writeResult = await this.writeFieldValues(pageContextId, fields, options.stopOnError, logger);
      if (!isOk(writeResult)) return writeResult;
      const writeOutput = writeResult.value;

      // Step 4: Save changes if needed
      const saved = await this.saveChangesIfNeeded(pageId, pageContextId, writeOutput, options.save, logger);

      // Build result
      return this.buildUpdateResult(pageId, pageContextId, fields, writeOutput, saved);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(
        new ProtocolError(`Failed to update record: ${errorMessage}`, {
          pageId, pageContextId: existingPageContextId, fields, error: errorMessage
        })
      );
    }
  }

  /** Extract options with defaults */
  private extractOptions(input: unknown): { autoEdit: boolean; save: boolean; stopOnError: boolean } {
    return {
      autoEdit: (input as any).autoEdit !== false,
      save: (input as any).save !== false,
      stopOnError: (input as any).stopOnError !== false,
    };
  }

  /** Get existing page context or open new page */
  private async getOrOpenPage(
    existingPageContextId: string | undefined,
    pageId: string | undefined,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<string, BCError>> {
    if (existingPageContextId) {
      logger.info(`Step 1: Reusing existing page context (skipping open)`);
      return ok(existingPageContextId);
    }

    logger.info(`Step 1: Opening page ${pageId}...`);
    const metadataResult = await this.getPageMetadataTool.execute({ pageId: pageId! });

    if (!isOk(metadataResult)) {
      return err(metadataResult.error);
    }

    const pageContextId = (metadataResult.value as GetPageMetadataOutput).pageContextId;
    logger.info(`Page opened with context: ${pageContextId}`);
    return ok(pageContextId);
  }

  /** Activate edit mode on the page */
  private async activateEditMode(
    pageId: string | undefined,
    pageContextId: string,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<void> {
    logger.info(`Step 2: Executing Edit action...`);
    const editResult = await this.executeActionTool.execute({
      pageId: pageId || pageContextId.split(':')[2],
      actionName: 'Edit',
    });

    if (!isOk(editResult)) {
      logger.info(`Edit action failed: ${editResult.error.message}`);
      // Don't fail - page might already be in edit mode
    } else {
      logger.info(`Edit mode activated`);
    }
  }

  /** Write field values to the page */
  private async writeFieldValues(
    pageContextId: string,
    fields: Record<string, unknown>,
    stopOnError: boolean,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<WritePageDataOutput, BCError>> {
    logger.info(`Step 3: Updating ${Object.keys(fields).length} field(s)...`);

    const writeResult = await this.writePageDataTool.execute({
      pageContextId,
      fields,
      stopOnError,
      immediateValidation: true,
    });

    if (!isOk(writeResult)) {
      return err(writeResult.error);
    }

    const writeOutput = writeResult.value as WritePageDataOutput;
    logger.info(`Fields updated: ${writeOutput.updatedFields?.length || 0} succeeded, ${writeOutput.failedFields?.length || 0} failed`);
    return ok(writeOutput);
  }

  /** Save changes if save is enabled and fields were updated */
  private async saveChangesIfNeeded(
    pageId: string | undefined,
    pageContextId: string,
    writeOutput: WritePageDataOutput,
    save: boolean,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<boolean> {
    const anyUpdated = (writeOutput.updatedFields?.length ?? 0) > 0;
    if (!save || !anyUpdated) {
      return false;
    }

    logger.info(`Step 4: Executing Save action...`);
    const saveResult = await this.executeActionTool.execute({
      pageId: pageId || pageContextId.split(':')[2],
      actionName: 'Save',
    });

    if (!isOk(saveResult)) {
      logger.info(`Save action failed: ${saveResult.error.message}`);
      return false;
    }

    logger.info(`Changes saved`);
    return true;
  }

  /** Build the final update result */
  private buildUpdateResult(
    pageId: string | undefined,
    pageContextId: string,
    fields: Record<string, unknown>,
    writeOutput: WritePageDataOutput,
    saved: boolean
  ): Result<UpdateRecordOutput, BCError> {
    const finalPageId = pageId || pageContextId.split(':')[2];
    return ok({
      success: writeOutput.success,
      pageContextId: writeOutput.pageContextId,
      pageId: String(finalPageId),
      record: writeOutput.record,
      saved,
      updatedFields: writeOutput.updatedFields || Object.keys(fields),
      failedFields: writeOutput.failedFields,
      message: `Successfully updated ${writeOutput.updatedFields?.length || Object.keys(fields).length} field(s)${saved ? ' (saved)' : ''}`,
    });
  }
}
