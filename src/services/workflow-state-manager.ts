/**
 * Workflow State Manager
 *
 * Tracks business workflow execution state across BC sessions.
 * This provides a higher-level abstraction on top of SessionStateManager
 * to track multi-step business processes like "create_sales_invoice" or "post_sales_order".
 *
 * Architecture:
 * - WorkflowStateManager: Manages workflow instances (this file)
 * - SessionStateManager: Manages BC sessions and pages
 * - WorkflowContext: Tracks current state, history, errors for a workflow
 *
 * NOTE: This is ephemeral (in-memory) and will reset when the process restarts.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../core/interfaces.js';

/**
 * Record of a single operation executed within a workflow.
 */
export interface WorkflowOperation {
  readonly operationId: string;
  readonly tool: string; // MCP tool name (get_page_metadata, write_page_data, etc.)
  readonly timestamp: string; // ISO 8601
  readonly parameters: Record<string, unknown>; // Tool inputs
  readonly result: {
    readonly success: boolean;
    readonly data?: unknown;
    readonly error?: string;
  };
}

/**
 * Workflow execution context.
 *
 * Tracks the state of a multi-step business process across BC sessions.
 * Updated by MCP tools as they execute operations.
 */
export interface WorkflowContext {
  readonly workflowId: string;
  readonly sessionId: string; // Linked BC session from SessionStateManager
  readonly goal: string; // Workflow goal (e.g., "create_sales_invoice", "post_sales_order")
  readonly parameters: Record<string, unknown>; // Workflow input parameters
  readonly status: 'active' | 'completed' | 'failed' | 'cancelled';
  readonly createdAt: string; // ISO 8601
  readonly updatedAt: string; // ISO 8601

  // Current navigation state
  readonly currentPageContextId?: string;
  readonly currentPageId?: string;
  readonly focusedRecordKeys?: Record<string, unknown>; // Current record (e.g., { "No.": "10000" })
  readonly lastOperation?: WorkflowOperation;

  // Operation history
  readonly operations: readonly WorkflowOperation[];

  // Pending state
  readonly unsavedChanges?: Record<string, unknown>; // Field changes not yet committed to BC

  // Error state
  readonly errors: readonly string[];
  readonly lastError?: string;
}

/**
 * Input for creating a new workflow.
 */
export interface CreateWorkflowInput {
  readonly sessionId: string;
  readonly goal: string;
  readonly parameters?: Record<string, unknown>;
}

/**
 * Input for updating workflow state.
 */
export interface UpdateWorkflowStateInput {
  readonly status?: 'active' | 'completed' | 'failed' | 'cancelled';
  readonly currentPageContextId?: string;
  readonly currentPageId?: string;
  readonly focusedRecordKeys?: Record<string, unknown>;
  readonly unsavedChanges?: Record<string, unknown>;
  readonly appendError?: string; // Add error to errors array
  readonly clearErrors?: boolean; // Clear all errors
}

/**
 * Snapshot of all workflows.
 */
export interface WorkflowStateSnapshot {
  readonly workflows: readonly WorkflowContext[];
}

/**
 * WorkflowStateManager tracks business workflow execution state.
 *
 * This is a singleton to maintain consistent state across the application.
 * Provides higher-level workflow tracking on top of SessionStateManager.
 */
export class WorkflowStateManager {
  private static instance: WorkflowStateManager | undefined;

  /**
   * Gets the singleton instance.
   * @param logger - Optional logger for debug logging
   */
  public static getInstance(logger?: ILogger): WorkflowStateManager {
    if (!WorkflowStateManager.instance) {
      WorkflowStateManager.instance = new WorkflowStateManager(logger);
    }
    return WorkflowStateManager.instance;
  }

  /**
   * Resets the singleton instance (primarily for testing).
   */
  public static resetInstance(): void {
    WorkflowStateManager.instance = undefined;
  }

  private readonly workflows = new Map<string, WorkflowContext>();

  private constructor(private readonly logger?: ILogger) {}

  /**
   * Creates a new workflow.
   * @param input - Workflow creation parameters
   * @returns The newly created workflow context
   */
  public createWorkflow(input: CreateWorkflowInput): WorkflowContext {
    const workflowId = uuidv4();
    const now = new Date().toISOString();

    const workflow: WorkflowContext = {
      workflowId,
      sessionId: input.sessionId,
      goal: input.goal,
      parameters: input.parameters || {},
      status: 'active',
      createdAt: now,
      updatedAt: now,
      operations: [],
      errors: [],
    };

    this.workflows.set(workflowId, workflow);
    this.logger?.debug('Created new workflow', { workflowId, goal: input.goal, sessionId: input.sessionId });

    return workflow;
  }

  /**
   * Gets a workflow by ID.
   * @param workflowId - The workflow ID
   * @returns The workflow context or undefined
   */
  public getWorkflow(workflowId: string): WorkflowContext | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * Gets all workflows for a session.
   * @param sessionId - The session ID
   * @returns Array of workflows in the session
   */
  public getWorkflowsBySession(sessionId: string): WorkflowContext[] {
    return Array.from(this.workflows.values()).filter((w) => w.sessionId === sessionId);
  }

  /**
   * Gets all active workflows (status = 'active').
   * @returns Array of active workflows
   */
  public getActiveWorkflows(): WorkflowContext[] {
    return Array.from(this.workflows.values()).filter((w) => w.status === 'active');
  }

  /**
   * Updates workflow state.
   * Creates a new immutable workflow context with updated fields.
   * @param workflowId - The workflow ID
   * @param update - State updates to apply
   * @returns The updated workflow context or undefined if not found
   */
  public updateWorkflowState(
    workflowId: string,
    update: UpdateWorkflowStateInput
  ): WorkflowContext | undefined {
    const existing = this.workflows.get(workflowId);
    if (!existing) {
      this.logger?.warn('Workflow not found for update', { workflowId });
      return undefined;
    }

    // Build updated errors array
    let errors = existing.errors;
    if (update.clearErrors) {
      errors = [];
    } else if (update.appendError) {
      errors = [...existing.errors, update.appendError];
    }

    // Create updated workflow (immutable pattern)
    const updated: WorkflowContext = {
      ...existing,
      status: update.status ?? existing.status,
      currentPageContextId: update.currentPageContextId ?? existing.currentPageContextId,
      currentPageId: update.currentPageId ?? existing.currentPageId,
      focusedRecordKeys: update.focusedRecordKeys ?? existing.focusedRecordKeys,
      unsavedChanges: update.unsavedChanges ?? existing.unsavedChanges,
      errors,
      lastError: errors.length > 0 ? errors[errors.length - 1] : existing.lastError,
      updatedAt: new Date().toISOString(),
    };

    this.workflows.set(workflowId, updated);

    this.logger?.debug('Updated workflow state', { workflowId, update });

    return updated;
  }

  /**
   * Records a completed operation in the workflow history.
   * @param workflowId - The workflow ID
   * @param operation - Operation details (without operationId and timestamp - will be auto-generated)
   * @returns The updated workflow context or undefined if not found
   */
  public recordOperation(
    workflowId: string,
    operation: Omit<WorkflowOperation, 'operationId' | 'timestamp'>
  ): WorkflowContext | undefined {
    const existing = this.workflows.get(workflowId);
    if (!existing) {
      this.logger?.warn('Workflow not found for operation recording', { workflowId });
      return undefined;
    }

    // Create operation with ID and timestamp
    const completedOperation: WorkflowOperation = {
      operationId: uuidv4(),
      timestamp: new Date().toISOString(),
      ...operation,
    };

    // Create updated workflow with new operation
    const updated: WorkflowContext = {
      ...existing,
      operations: [...existing.operations, completedOperation],
      lastOperation: completedOperation,
      updatedAt: new Date().toISOString(),
    };

    this.workflows.set(workflowId, updated);

    this.logger?.debug('Recorded workflow operation', {
      workflowId,
      tool: operation.tool,
      success: operation.result.success,
    });

    return updated;
  }

  /**
   * Completes a workflow successfully.
   * @param workflowId - The workflow ID
   * @returns The updated workflow context or undefined if not found
   */
  public completeWorkflow(workflowId: string): WorkflowContext | undefined {
    return this.updateWorkflowState(workflowId, { status: 'completed' });
  }

  /**
   * Fails a workflow with an error message.
   * @param workflowId - The workflow ID
   * @param error - Error message
   * @returns The updated workflow context or undefined if not found
   */
  public failWorkflow(workflowId: string, error: string): WorkflowContext | undefined {
    const updated = this.updateWorkflowState(workflowId, {
      status: 'failed',
      appendError: error,
    });

    this.logger?.warn('Workflow failed', { workflowId, error });

    return updated;
  }

  /**
   * Cancels a workflow.
   * @param workflowId - The workflow ID
   * @returns The updated workflow context or undefined if not found
   */
  public cancelWorkflow(workflowId: string): WorkflowContext | undefined {
    return this.updateWorkflowState(workflowId, { status: 'cancelled' });
  }

  /**
   * Deletes a workflow.
   * @param workflowId - The workflow ID
   * @returns True if deleted, false if not found
   */
  public deleteWorkflow(workflowId: string): boolean {
    const deleted = this.workflows.delete(workflowId);
    if (deleted) {
      this.logger?.debug('Deleted workflow', { workflowId });
    } else {
      this.logger?.debug('Workflow not found for deletion', { workflowId });
    }
    return deleted;
  }

  /**
   * Gets a snapshot of all workflows.
   * @returns Immutable snapshot of current workflow state
   */
  public getSnapshot(): WorkflowStateSnapshot {
    return {
      workflows: Array.from(this.workflows.values()),
    };
  }

  /**
   * Gets the number of workflows.
   */
  public getWorkflowCount(): number {
    return this.workflows.size;
  }

  /**
   * Clears all workflows (primarily for testing).
   */
  public clear(): void {
    this.workflows.clear();
    this.logger?.debug('Cleared all workflows');
  }
}
