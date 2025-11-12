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

/**
 * MCP Tool: create_record_by_field_name
 *
 * Creates a new record using field names/captions for addressing.
 * Demonstrates the full BCCrudService flow with LoadForm and field resolution.
 */
export class CreateRecordByFieldNameTool extends BaseMCPTool {
  public readonly name = 'create_record_by_field_name';

  public readonly description =
    'Creates a new Business Central record using field names/captions (e.g., "Name", "Address", "Email"). ' +
    'Automatically resolves field names to control paths using FormState metadata. ' +
    'Inputs: pageId (number|string), fields (object with field names as keys). ' +
    'Supports scoped fields like "General > Name" or "Address/City". ' +
    'Use [SourceExpr] syntax to target specific AL fields. ' +
    'Returns: {success, formId, setFields, failedFields}. ' +
    'More robust than create_record with automatic field resolution and proper oldValue handling.';

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

    // Validate input
    const validatedInput = this.validateInput(input);
    if (!isOk(validatedInput)) {
      return validatedInput as Result<never, BCError>;
    }

    const { pageId, fields, formId: listFormId, newButtonPath } = validatedInput.value;

    logger.info(`Creating record on Page ${pageId} with field names: ${Object.keys(fields).join(', ')}`);

    // Initialize CRUD service
    const crudServiceResult = this.initCrudService();
    if (!isOk(crudServiceResult)) {
      return err(crudServiceResult.error);
    }

    const crudService = crudServiceResult.value;
    const client = crudService.getClient();

    try {
      // Step 1: Open page if not already open
      let actualListFormId = listFormId;
      if (!actualListFormId) {
        logger.info(`Opening page ${pageId}...`);

        // Use OpenForm or Navigate to open the list page
        await client.invoke({
          interactionName: 'OpenForm',
          namedParameters: {
            query: `tenant=default&page=${pageId}`
          },
          timeoutMs: 10000
        });

        // Wait for FormToShow to get the list formId
        const formToShowData = await client.waitForHandlers(
          (handlers) => {
            const formShowHandler = handlers.find(
              h =>
                h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
                h.parameters?.[0] === 'FormToShow'
            );
            if (formShowHandler) {
              return { matched: true, data: formShowHandler.parameters?.[1]?.ServerId };
            }
            return { matched: false };
          },
          { timeoutMs: 5000 }
        );

        actualListFormId = formToShowData;
        logger.info(`✓ List form opened: ${actualListFormId}`);
      }

      // Ensure we have a list form ID
      if (!actualListFormId) {
        return err(new ProtocolError('Failed to determine list form ID', { pageId }));
      }

      // Step 2: Click "New" button (systemAction 10)
      logger.info(`Clicking "New" button...`);

      const newButtonControlPath = newButtonPath || 'server:c[1]/c[0]/c[0]/c[0]'; // Typical New button path
      await crudService.invokeSystemAction(actualListFormId, 10, newButtonControlPath, {
        timeoutMs: 5000
      });

      // Step 3: Wait for new card FormToShow
      const cardFormId = await client.waitForHandlers(
        (handlers) => {
          const formShowHandler = handlers.find(
            h =>
              h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
              h.parameters?.[0] === 'FormToShow' &&
              h.parameters?.[1]?.ServerId !== actualListFormId // New form, not the list
          );
          if (formShowHandler) {
            return { matched: true, data: formShowHandler.parameters?.[1]?.ServerId };
          }
          return { matched: false };
        },
        { timeoutMs: 5000 }
      );

      logger.info(`✓ Card form opened: ${cardFormId}`);

      // Step 4: Load form metadata
      logger.info(`Loading form metadata...`);
      await crudService.loadForm(cardFormId, { timeoutMs: 10000 });

      // Step 5: Set fields using field names
      const setFields: string[] = [];
      const failedFields: Array<{ field: string; error: string }> = [];

      for (const [fieldKey, value] of Object.entries(fields)) {
        try {
          logger.info(`Setting field "${fieldKey}" = "${value}"...`);
          await crudService.saveField(cardFormId, fieldKey, value, { timeoutMs: 5000 });
          setFields.push(fieldKey);
          logger.info(`✓ Field "${fieldKey}" set successfully`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn(`✗ Failed to set field "${fieldKey}": ${errorMsg}`);
          failedFields.push({ field: fieldKey, error: errorMsg });
        }
      }

      // Step 6: Close form (auto-saves)
      logger.info(`Closing and saving record...`);
      await crudService.closeForm(cardFormId, { timeoutMs: 5000 });

      logger.info(`✓ Record created successfully with ${setFields.length}/${Object.keys(fields).length} fields set`);

      return ok({
        success: failedFields.length === 0,
        formId: cardFormId,
        pageId,
        setFields,
        failedFields: failedFields.length > 0 ? failedFields : undefined,
        message:
          failedFields.length === 0
            ? `Successfully created record with ${setFields.length} field(s)`
            : `Created record with ${setFields.length}/${Object.keys(fields).length} field(s) (${failedFields.length} failed)`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create record: ${errorMessage}`);
      return err(
        new ProtocolError(`Failed to create record: ${errorMessage}`, {
          pageId,
          fields,
          error: errorMessage,
        })
      );
    }
  }
}
