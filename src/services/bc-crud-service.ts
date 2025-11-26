/**
 * BC CRUD Service
 *
 * High-level service for Create, Read, Update, Delete operations on BC forms.
 * Implements the complete LoadForm → Field Resolution → SaveValue flow with
 * CompletedInteractions barriers and FormState management.
 *
 * Critical architecture:
 * - Single-flight requests: wait for CompletedInteractions before next request
 * - FormState lifecycle: FormToShow → LoadForm → buildIndices → ready
 * - Field resolution: Use multi-index (Caption, ScopedCaption, SourceExpr, Name)
 * - oldValue: Always from FormState.node.value.formatted
 * - Dialog handling: Semantic button selection (yes/no/ok/cancel)
 */

import { BCRawWebSocketClient } from '../connection/clients/BCRawWebSocketClient.js';
import { FormStateService } from './form-state-service.js';
import { ButtonIntent } from '../types/form-state.js';
import { logger } from '../core/logger.js';

/** Handler type for BC protocol handlers */
interface CrudHandler {
  handlerType: string;
  parameters?: readonly unknown[];
}

/** FormToShow handler data (for checking ServerId) */
interface FormToShowCheck {
  ServerId?: string;
  Children?: readonly unknown[];
}

/**
 * SaveValue options
 */
export interface SaveValueOptions {
  /** Override oldValue (default: read from FormState) */
  oldValueOverride?: string;

  /** Control path of next field to activate (default: same field) */
  nextFieldPath?: string;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * LoadForm options
 */
export interface LoadFormOptions {
  /** Whether to wait for indices to be built (default: true) */
  waitForReady?: boolean;

  /** Retry once if LoadForm incomplete (default: true) */
  retry?: boolean;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Create record options
 */
export interface CreateRecordOptions {
  /** Fields to fill: fieldName/caption → value */
  fields: Record<string, string>;

  /** Form ID of the list to create from (if known) */
  listFormId?: string;

  /** Control path of the "New" button (if known) */
  newButtonPath?: string;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Update field options
 */
export interface UpdateFieldOptions {
  /** Override oldValue (default: read from FormState) */
  oldValueOverride?: string;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Delete record options
 */
export interface DeleteRecordOptions {
  /** Control path of the delete button (if known) */
  deleteButtonPath?: string;

  /** Whether to confirm deletion (default: true) */
  confirm?: boolean;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * BC CRUD Service
 */
export class BCCrudService {
  private client: BCRawWebSocketClient;
  private formStateService: FormStateService;

  /** Whether to enforce single-flight requests (v1: true for safety) */
  private singleFlightMode = true;

  /** In-flight request tracker */
  private inflightRequest: Promise<unknown> | null = null;

  constructor(client: BCRawWebSocketClient, formStateService?: FormStateService) {
    this.client = client;
    this.formStateService = formStateService || new FormStateService();
  }

  /**
   * Single-flight wrapper: ensures only one request in flight at a time
   */
  private async withSingleFlight<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.singleFlightMode) {
      return operation();
    }

    // Wait for any in-flight request to complete
    if (this.inflightRequest) {
      try {
        await this.inflightRequest;
      } catch (error) {
        // Ignore errors from previous requests
      }
    }

    // Execute this request
    const promise = operation();
    this.inflightRequest = promise;

    try {
      const result = await promise;
      return result;
    } finally {
      // Clear in-flight marker
      if (this.inflightRequest === promise) {
        this.inflightRequest = null;
      }
    }
  }

  /**
   * Load form metadata and build field indices
   *
   * CRITICAL: Must be called after FormToShow before field interactions!
   *
   * @param formId - The form ID to load
   * @param options - Load options
   * @param openFormHandlers - Optional: handlers from OpenForm (contains FormToShow with control tree)
   */
  async loadForm(formId: string, options?: LoadFormOptions, openFormHandlers?: unknown[]): Promise<void> {
    const opts: Required<LoadFormOptions> = {
      waitForReady: true,
      retry: true,
      timeoutMs: 10000,
      ...options
    };

    return this.withSingleFlight(async () => {
      logger.info(`[BCCrudService] Loading form metadata for ${formId}...`);

      // Step 1: Invoke LoadForm and collect handlers
      const { immediateHandlers, asyncHandlers } = await this.invokeLoadFormWithListener(formId, opts.timeoutMs);

      // Step 2: Process FormToShow handler if present
      this.processFormShowHandler(formId, openFormHandlers || immediateHandlers);

      // Step 3: Apply all handler changes to FormState
      this.applyHandlerChanges(formId, [...immediateHandlers, ...asyncHandlers]);

      // Step 4: Build indices and validate readiness
      if (opts.waitForReady) {
        await this.finalizeFormState(formId, options, opts);
      }
    });
  }

  /** Invoke LoadForm and collect both immediate and async handlers */
  private async invokeLoadFormWithListener(formId: string, timeoutMs: number): Promise<{
    immediateHandlers: unknown[];
    asyncHandlers: unknown[];
  }> {
    const asyncHandlers: unknown[] = [];
    const unsubscribe = this.client.onHandlers((handlers) => {
      asyncHandlers.push(...handlers);
    });

    try {
      const immediateHandlers = await this.client.invoke({
        interactionName: 'LoadForm',
        namedParameters: { delayed: true, openForm: true, loadData: true },
        formId,
        timeoutMs
      });

      // Wait for CompletedInteractions if not in immediate response
      const hasCompleted = immediateHandlers.find((h) => {
        const handler = h as CrudHandler;
        return handler.handlerType === 'DN.CallbackResponseProperties';
      });

      if (!hasCompleted) {
        await this.client.waitForHandlers(
          (handlers) => {
            const callbackHandler = handlers.find(h => (h as { handlerType?: string }).handlerType === 'DN.CallbackResponseProperties');
            return { matched: !!callbackHandler, data: handlers };
          },
          { timeoutMs }
        );
      }

      // Wait for async handlers to arrive
      await new Promise(resolve => setTimeout(resolve, 300));

      return { immediateHandlers, asyncHandlers };
    } finally {
      unsubscribe();
    }
  }

  /** Process FormToShow handler to initialize FormState */
  private processFormShowHandler(formId: string, handlers: unknown[]): void {
    const formShowHandler = handlers.find((h) => {
      const handler = h as CrudHandler;
      if (handler.handlerType !== 'DN.LogicalClientEventRaisingHandler') return false;
      if (handler.parameters?.[0] !== 'FormToShow') return false;
      const formData = handler.parameters?.[1] as FormToShowCheck | undefined;
      return formData?.ServerId === formId;
    }) as CrudHandler | undefined;

    if (formShowHandler) {
      const formData = formShowHandler.parameters?.[1] as FormToShowCheck | undefined;
      logger.info(`[BCCrudService] Found FormToShow data with ${formData?.Children?.length || 0} top-level controls`);
      // Pass as unknown for compatibility with FormStateService's internal FormToShowData type
      this.formStateService.initFromFormToShow(formId, formShowHandler.parameters?.[1] as never);
      logger.info(`[BCCrudService] FormState initialized from FormToShow`);
    }
  }

  /** Apply LogicalClientChangeHandler changes to FormState */
  private applyHandlerChanges(formId: string, handlers: unknown[]): void {
    for (const h of handlers) {
      const handler = h as CrudHandler;
      if (handler.handlerType === 'DN.LogicalClientChangeHandler') {
        const handlerFormId = handler.parameters?.[0];
        if (handlerFormId === formId) {
          // Pass changes as never for compatibility with FormStateService's BcChange type
          const changes = handler.parameters?.[1];
          this.formStateService.applyChanges(formId, changes as never);
        }
      }
    }
  }

  /** Build indices and validate form readiness, retrying if needed */
  private async finalizeFormState(
    formId: string,
    originalOptions: LoadFormOptions | undefined,
    opts: Required<LoadFormOptions>
  ): Promise<void> {
    this.formStateService.buildIndices(formId);
    const state = this.formStateService.getFormState(formId);

    if (!state || !state.ready) {
      if (opts.retry) {
        logger.warn(`[BCCrudService] FormState not ready after first LoadForm, retrying...`);
        return this.loadForm(formId, { ...originalOptions, retry: false, timeoutMs: opts.timeoutMs * 2 });
      } else {
        throw new Error(`FormState for ${formId} is incomplete after LoadForm`);
      }
    }

    logger.info(`[BCCrudService] Form ${formId} loaded and indexed with ${state.pathIndex.size} controls`);
  }

  /**
   * Save field value using field name/caption resolution
   *
   * Automatically resolves field name to control path and retrieves oldValue from FormState.
   */
  async saveField(
    formId: string,
    fieldKey: string,
    newValue: string,
    options?: SaveValueOptions
  ): Promise<void> {
    const opts: SaveValueOptions = {
      timeoutMs: 5000,
      ...options
    };

    return this.withSingleFlight(async () => {
      logger.info(`[BCCrudService] Saving field "${fieldKey}" = "${newValue}" on form ${formId}...`);

      // Resolve field
      const resolution = this.formStateService.resolveField(formId, fieldKey);
      if (!resolution) {
        throw new Error(`Field "${fieldKey}" not found in form ${formId}`);
      }

      const { controlPath, node, ambiguous, candidates } = resolution;

      if (ambiguous && candidates) {
        logger.warn(
          `[BCCrudService] Ambiguous field "${fieldKey}" resolved to ${controlPath}. ` +
          `Candidates: ${candidates.map(c => c.path).join(', ')}`
        );
      }

      // Get oldValue
      const oldValue = opts.oldValueOverride !== undefined
        ? opts.oldValueOverride
        : (node.value?.formatted || node.value?.raw?.toString() || '');

      logger.info(`[BCCrudService] Resolved "${fieldKey}" → ${controlPath} (oldValue: "${oldValue}")`);

      // Determine next field to activate
      const nextFieldPath = opts.nextFieldPath || controlPath;

      // Send SaveValue + ActivateControl in single request
      await this.client.invoke({
        interactionName: 'SaveValue',
        namedParameters: { oldValue, newValue },
        controlPath,
        formId,
        timeoutMs: opts.timeoutMs
      });

      // Immediately send ActivateControl (same invoke)
      await this.client.invoke({
        interactionName: 'ActivateControl',
        namedParameters: { key: null },
        controlPath: nextFieldPath,
        formId,
        timeoutMs: opts.timeoutMs
      });

      // Wait for CompletedInteractions
      await this.client.waitForHandlers(
        (handlers) => {
          const completed = handlers.find(h => (h as { handlerType?: string }).handlerType === 'DN.CallbackResponseProperties');
          return { matched: !!completed, data: handlers };
        },
        { timeoutMs: opts.timeoutMs }
      );

      logger.info(`[BCCrudService] Field "${fieldKey}" saved successfully`);

      // Update FormState with any changes
      // Type for handlers from waitForHandlers
      interface BcHandler {
        handlerType?: string;
        parameters?: readonly unknown[];
      }
      const rawHandlers = await this.client.waitForHandlers(
        (h) => ({ matched: true, data: h }),
        { timeoutMs: 100 }
      ).catch(() => [] as unknown[]);
      // Cast handlers to typed array for property access
      const handlers = rawHandlers as BcHandler[];

      for (const handler of handlers) {
        if (handler.handlerType === 'DN.LogicalClientChangeHandler' &&
            handler.parameters?.[0] === formId) {
          // Cast changes parameter to expected type (it contains BC change objects)
          this.formStateService.applyChanges(
            formId,
            handler.parameters?.[1] as Parameters<typeof this.formStateService.applyChanges>[1]
          );
        }
      }
    });
  }

  /**
   * Invoke a system action (New, Delete, etc.)
   */
  async invokeSystemAction(
    formId: string,
    systemAction: number,
    controlPath: string,
    options?: { timeoutMs?: number; key?: string }
  ): Promise<unknown[]> {
    const timeoutMs = options?.timeoutMs || 5000;

    return this.withSingleFlight(async () => {
      logger.info(`[BCCrudService] Invoking systemAction ${systemAction} on ${formId}...`);

      await this.client.invoke({
        interactionName: 'InvokeAction',
        namedParameters: {
          systemAction,
          key: options?.key || null,
          repeaterControlTarget: null
        },
        controlPath,
        formId,
        timeoutMs
      });

      // Wait for CompletedInteractions
      const handlers = await this.client.waitForHandlers(
        (handlers) => {
          const completed = handlers.find(h => (h as { handlerType?: string }).handlerType === 'DN.CallbackResponseProperties');
          return { matched: !!completed, data: handlers };
        },
        { timeoutMs }
      );

      logger.info(`[BCCrudService] SystemAction ${systemAction} completed`);

      return handlers;
    });
  }

  /**
   * Handle dialog confirmation by semantic button selection
   */
  async confirmDialog(
    dialogFormId: string,
    intent: ButtonIntent,
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs || 5000;

    return this.withSingleFlight(async () => {
      logger.info(`[BCCrudService] Confirming dialog ${dialogFormId} with intent: ${intent}...`);

      // Load dialog form if not already loaded
      const dialogState = this.formStateService.getFormState(dialogFormId);
      if (!dialogState || !dialogState.ready) {
        await this.loadForm(dialogFormId, { timeoutMs });
      }

      // Select button
      const button = this.formStateService.selectDialogButton(dialogFormId, intent);
      if (!button) {
        throw new Error(`No button found for intent "${intent}" in dialog ${dialogFormId}`);
      }

      logger.info(`[BCCrudService] Selected button: "${button.caption}" at ${button.controlPath}`);

      // Click button (systemAction 380 for dialog confirmation)
      await this.invokeSystemAction(dialogFormId, 380, button.controlPath, { timeoutMs });

      logger.info(`[BCCrudService] Dialog confirmed with "${button.caption}"`);
    });
  }

  /**
   * Close a form
   */
  async closeForm(formId: string, options?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = options?.timeoutMs || 5000;

    return this.withSingleFlight(async () => {
      logger.info(`[BCCrudService] Closing form ${formId}...`);

      await this.client.invoke({
        interactionName: 'CloseForm',
        namedParameters: {},
        controlPath: 'server:',
        formId,
        timeoutMs
      });

      // Wait for confirmation
      await this.client.waitForHandlers(
        (handlers) => {
          const completed = handlers.find(h => (h as { handlerType?: string }).handlerType === 'DN.CallbackResponseProperties');
          return { matched: !!completed, data: handlers };
        },
        { timeoutMs }
      );

      // Remove from FormState cache
      this.formStateService.deleteFormState(formId);

      logger.info(`[BCCrudService] Form ${formId} closed`);
    });
  }

  /**
   * Get FormStateService for advanced operations
   */
  getFormStateService(): FormStateService {
    return this.formStateService;
  }

  /**
   * Get underlying client for advanced operations
   */
  getClient(): BCRawWebSocketClient {
    return this.client;
  }
}
