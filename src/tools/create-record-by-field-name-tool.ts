/**
 * Create Record By Field Name MCP Tool
 *
 * NEW implementation using BCCrudService with automatic field name resolution.
 * This tool demonstrates the complete LoadForm → Field Resolution → SaveValue flow.
 *
 * Advantages over create_record:
 * - Uses field names/captions instead of internal identifiers
 * - Automatic LoadForm and field metadata parsing
 * - Proper oldValue handling from FormState
 * - Single-flight request safety with CompletedInteractions barriers
 * - Multi-index field resolution (Caption, ScopedCaption, SourceExpr, Name)
 */

import { BaseMCPTool } from './base-tool.js';
import type { Result } from '../core/result.js';
import { ok, err, isOk } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ProtocolError, ConnectionError } from '../core/errors.js';
import type { IBCConnection } from '../core/interfaces.js';
import type { BCRawWebSocketClient } from '../connection/clients/BCRawWebSocketClient.js';
import { BCCrudService } from '../services/bc-crud-service.js';
import { FormStateService } from '../services/form-state-service.js';
import { createToolLogger } from '../core/logger.js';
import type { AuditLogger } from '../services/audit-logger.js';

/**
 * Input schema for create_record_by_field_name
 */
interface CreateRecordByFieldNameInput {
  /** Page ID to open */
  pageId: string;

  /** Fields to set: fieldName/caption → value */
  fields: Record<string, string>;

  /** Form ID if already open (optional) */
  formId?: string;

  /** Control path of New button (optional, will use systemAction 10 if not provided) */
  newButtonPath?: string;
}

/**
 * Output schema
 */
interface CreateRecordByFieldNameOutput {
  success: boolean;
  formId: string;
  pageId: string;
  setFields: string[];
  failedFields?: Array<{ field: string; error: string }>;
  message: string;
}

/** Result of opening a page */
interface OpenPageResult {
  listFormId: string;
}

/** Result of field setting operation */
interface FieldSetResults {
  setFields: string[];
  failedFields: Array<{ field: string; error: string }>;
}

/**
 * MCP Tool: create_record_by_field_name
 *
 * Creates a new record using field names/captions for addressing.
 * Demonstrates the full BCCrudService flow with LoadForm and field resolution.
 */
export class CreateRecordByFieldNameTool extends BaseMCPTool {
  public readonly name = 'create_record_by_field_name';

  public readonly description =
    'Convenience helper that creates a new Business Central record in a single operation using field names/captions. ' +
    'Alternative to the stateful workflow: get_page_metadata → execute_action("New") → write_page_data → execute_action("Post/Save"). ' +
    'pageId (required): Target page for creation (e.g., 21 for Customer Card, 22 for Customer List). ' +
    'fields (required): Object where keys are field names/captions (e.g., "Name", "Email", "Credit Limit (LCY)") and values are strings. ' +
    'Supports scoped field identifiers like "General > Name", "Address/City", or "[SourceExpr]" for AL field targeting. ' +
    'formId (optional): Reuse an already-open list page form context if available. ' +
    'newButtonPath (optional): Control path of specific "New" button; defaults to systemAction 10. ' +
    'Returns: {success, formId, setFields, failedFields: [{field, error}]}. ' +
    'Behavior: Automatically resolves field identifiers to controls, enters create mode, sets fields with validation, and saves. ' +
    'Use this for simple record creation; use the stateful pageContext workflow for complex scenarios requiring additional logic.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      pageId: {
        type: ['string', 'number'],
        description: 'BC page ID (e.g., 21 for Customer Card, 22 for Customer List)',
      },
      fields: {
        type: 'object',
        description:
          'Fields to set. Keys are field names/captions (e.g., "Name", "Email"), values are strings. ' +
          'Supports scoped names like "General > Address" and SourceExpr override like "[Customer.Name]".',
        additionalProperties: { type: 'string' },
      },
      formId: {
        type: 'string',
        description: 'Optional: Form ID if list page is already open',
      },
      newButtonPath: {
        type: 'string',
        description: 'Optional: Control path of New button (default: uses systemAction 10)',
      },
    },
    required: ['pageId', 'fields'],
  };

  // Consent configuration
  public readonly requiresConsent = true;
  public readonly sensitivityLevel = 'medium' as const;
  public readonly consentPrompt =
    'Create a new record in Business Central using field name addressing? ' +
    'This will add data to your BC database.';

  private crudService: BCCrudService | null = null;

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
  }

  /**
   * Initialize BCCrudService lazily
   */
  private initCrudService(): Result<BCCrudService, BCError> {
    if (this.crudService) {
      return ok(this.crudService);
    }

    const rawClient = this.connection.getRawClient() as BCRawWebSocketClient | null;
    if (!rawClient) {
      return err(
        new ConnectionError('Connection not established. Call connect() first.')
      );
    }

    this.crudService = new BCCrudService(rawClient, new FormStateService());
    return ok(this.crudService);
  }

  /**
   * Validates input
   */
  protected override validateInput(
    input: unknown
  ): Result<CreateRecordByFieldNameInput, BCError> {
    const baseResult = super.validateInput(input);
    if (!isOk(baseResult)) {
      return baseResult;
    }

    // Extract pageId
    if (!this.hasProperty(input, 'pageId')) {
      return err(new ProtocolError('Missing required field: pageId'));
    }

    const pageIdValue = (input as Record<string, unknown>).pageId;
    let pageId: string;

    if (typeof pageIdValue === 'string') {
      pageId = pageIdValue;
    } else if (typeof pageIdValue === 'number') {
      pageId = String(pageIdValue);
    } else {
      return err(new ProtocolError('pageId must be a string or number'));
    }

    // Extract fields
    const fieldsResult = this.getOptionalObject(input, 'fields');
    if (!isOk(fieldsResult)) {
      return fieldsResult as Result<never, BCError>;
    }

    const fields = fieldsResult.value;
    if (!fields || Object.keys(fields).length === 0) {
      return err(new ProtocolError('No fields provided', { pageId }));
    }

    // Convert all field values to strings
    const stringFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      stringFields[key] = String(value);
    }

    // Extract optional parameters
    const formId = this.hasProperty(input, 'formId')
      ? String((input as Record<string, unknown>).formId)
      : undefined;

    const newButtonPath = this.hasProperty(input, 'newButtonPath')
      ? String((input as Record<string, unknown>).newButtonPath)
      : undefined;

    return ok({
      pageId,
      fields: stringFields,
      formId,
      newButtonPath,
    });
  }

  /**
   * Executes the tool
   */
  protected async executeInternal(
    input: unknown
  ): Promise<Result<CreateRecordByFieldNameOutput, BCError>> {
    const logger = createToolLogger('create_record_by_field_name');

    // Step 1: Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageId, fields, formId: listFormId, newButtonPath } = validatedInput.value;
    logger.info(`Creating record on Page ${pageId} with field names: ${Object.keys(fields).join(', ')}`);

    // Step 2: Initialize CRUD service
    const crudServiceResult = this.initCrudService();
    if (!isOk(crudServiceResult)) {
      return err(crudServiceResult.error);
    }
    const crudService = crudServiceResult.value;

    try {
      // Step 3: Open page and get list form ID
      const listResult = await this.ensurePageOpen(crudService, pageId, listFormId, logger);
      if (!isOk(listResult)) return listResult;
      const actualListFormId = listResult.value.listFormId;

      // Step 4: Create new record (click "New" and wait for card form)
      const cardFormId = await this.createNewRecord(crudService, actualListFormId, newButtonPath, logger);

      // Step 5: Load metadata and set fields
      logger.info(`Loading form metadata...`);
      await crudService.loadForm(cardFormId, { timeoutMs: 10000 });

      const fieldResults = await this.setFieldValues(crudService, cardFormId, fields, logger);

      // Step 6: Close form (auto-saves)
      logger.info(`Closing and saving record...`);
      await crudService.closeForm(cardFormId, { timeoutMs: 5000 });

      // Step 7: Build result
      return ok(this.buildSuccessResult(pageId, cardFormId, fields, fieldResults));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.info(`Failed to create record: ${errorMessage}`);
      return err(new ProtocolError(`Failed to create record: ${errorMessage}`, {
        pageId,
        fields,
        error: errorMessage,
      }));
    }
  }

  // ============================================================================
  // Helper Methods - Extracted from executeInternal for reduced complexity
  // ============================================================================

  /** Ensure page is open and return list form ID */
  private async ensurePageOpen(
    crudService: BCCrudService,
    pageId: string,
    existingFormId: string | undefined,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<Result<OpenPageResult, BCError>> {
    if (existingFormId) {
      return ok({ listFormId: existingFormId });
    }

    logger.info(`Opening page ${pageId}...`);
    const client = crudService.getClient();

    await client.invoke({
      interactionName: 'OpenForm',
      namedParameters: { query: `tenant=default&page=${pageId}` },
      timeoutMs: 10000
    });

    const listFormId = await client.waitForHandlers(
      this.createFormToShowPredicate(),
      { timeoutMs: 5000 }
    );

    if (!listFormId) {
      return err(new ProtocolError('Failed to determine list form ID', { pageId }));
    }

    logger.info(`List form opened: ${listFormId}`);
    return ok({ listFormId });
  }

  /** Handler structure for predicate type safety */
  private static isFormToShowHandler(h: unknown): h is { handlerType: string; parameters?: readonly unknown[] } {
    return h !== null && typeof h === 'object' && 'handlerType' in h;
  }

  /** Create predicate for FormToShow detection */
  private createFormToShowPredicate(): (handlers: unknown[]) => { matched: boolean; data?: string } {
    return (handlers) => {
      const formShowHandler = handlers.find((h) => {
        if (!CreateRecordByFieldNameTool.isFormToShowHandler(h)) return false;
        return h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
          h.parameters?.[0] === 'FormToShow';
      });
      if (formShowHandler && CreateRecordByFieldNameTool.isFormToShowHandler(formShowHandler)) {
        const formData = formShowHandler.parameters?.[1] as { ServerId?: string } | undefined;
        return { matched: true, data: formData?.ServerId };
      }
      return { matched: false };
    };
  }

  /** Click New button and wait for card form */
  private async createNewRecord(
    crudService: BCCrudService,
    listFormId: string,
    newButtonPath: string | undefined,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<string> {
    logger.info(`Clicking "New" button...`);
    const client = crudService.getClient();

    const controlPath = newButtonPath || 'server:c[1]/c[0]/c[0]/c[0]';
    await crudService.invokeSystemAction(listFormId, 10, controlPath, { timeoutMs: 5000 });

    const cardFormId = await client.waitForHandlers(
      this.createCardFormPredicate(listFormId),
      { timeoutMs: 5000 }
    );

    logger.info(`Card form opened: ${cardFormId}`);
    return cardFormId;
  }

  /** Create predicate for new card form detection */
  private createCardFormPredicate(listFormId: string): (handlers: unknown[]) => { matched: boolean; data?: string } {
    return (handlers) => {
      const formShowHandler = handlers.find((h) => {
        if (!CreateRecordByFieldNameTool.isFormToShowHandler(h)) return false;
        if (h.handlerType !== 'DN.LogicalClientEventRaisingHandler') return false;
        if (h.parameters?.[0] !== 'FormToShow') return false;
        const formData = h.parameters?.[1] as { ServerId?: string } | undefined;
        return formData?.ServerId !== listFormId;
      });
      if (formShowHandler && CreateRecordByFieldNameTool.isFormToShowHandler(formShowHandler)) {
        const formData = formShowHandler.parameters?.[1] as { ServerId?: string } | undefined;
        return { matched: true, data: formData?.ServerId };
      }
      return { matched: false };
    };
  }

  /** Set field values and collect results */
  private async setFieldValues(
    crudService: BCCrudService,
    cardFormId: string,
    fields: Record<string, string>,
    logger: ReturnType<typeof createToolLogger>
  ): Promise<FieldSetResults> {
    const setFields: string[] = [];
    const failedFields: Array<{ field: string; error: string }> = [];

    for (const [fieldKey, value] of Object.entries(fields)) {
      try {
        logger.info(`Setting field "${fieldKey}" = "${value}"...`);
        await crudService.saveField(cardFormId, fieldKey, value, { timeoutMs: 5000 });
        setFields.push(fieldKey);
        logger.info(`Field "${fieldKey}" set successfully`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to set field "${fieldKey}": ${errorMsg}`);
        failedFields.push({ field: fieldKey, error: errorMsg });
      }
    }

    return { setFields, failedFields };
  }

  /** Build success result object */
  private buildSuccessResult(
    pageId: string,
    cardFormId: string,
    fields: Record<string, string>,
    fieldResults: FieldSetResults
  ): CreateRecordByFieldNameOutput {
    const { setFields, failedFields } = fieldResults;
    const totalFields = Object.keys(fields).length;

    return {
      success: failedFields.length === 0,
      formId: cardFormId,
      pageId,
      setFields,
      failedFields: failedFields.length > 0 ? failedFields : undefined,
      message:
        failedFields.length === 0
          ? `Successfully created record with ${setFields.length} field(s)`
          : `Created record with ${setFields.length}/${totalFields} field(s) (${failedFields.length} failed)`,
    };
  }
}
