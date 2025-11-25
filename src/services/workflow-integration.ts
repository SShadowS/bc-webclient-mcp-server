/**
 * Workflow Integration Helper
 *
 * Provides utilities for tools to automatically participate in workflow tracking.
 * This helper abstracts workflow state updates so tools don't need to know
 * WorkflowStateManager internals.
 *
 * Usage in tools:
 * ```typescript
 * const integration = new WorkflowIntegration(workflowId);
 * integration.recordOperation(toolName, input);
 * integration.updateCurrentPage(pageId);
 * integration.recordError(errorMessage);
 * ```
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ValidationError } from '../core/errors.js';
import { createToolLogger } from '../core/logger.js';
import { WorkflowStateManager } from './workflow-state-manager.js';
import type { WorkflowContext } from './workflow-state-manager.js';

const logger = createToolLogger('workflow-integration', 'helper');

/**
 * Helper class for tools to integrate with workflow tracking.
 * Handles all workflow state updates so tools don't need to know
 * WorkflowStateManager API details.
 */
export class WorkflowIntegration {
  private readonly workflowId: string;
  private readonly manager: WorkflowStateManager;
  private workflow: WorkflowContext | null = null;

  constructor(workflowId: string) {
    this.workflowId = workflowId;
    this.manager = WorkflowStateManager.getInstance();

    // Verify workflow exists and is active
    const wf = this.manager.getWorkflow(workflowId);
    this.workflow = wf || null; // Convert undefined to null
    if (!this.workflow) {
      logger.warn(`[WorkflowIntegration] Workflow not found: ${workflowId}`);
    } else if (this.workflow.status !== 'active') {
      logger.warn(`[WorkflowIntegration] Workflow not active: ${workflowId}, status: ${this.workflow.status}`);
    }
  }

  /**
   * Check if workflow exists and is active.
   * Tools should check this before attempting workflow operations.
   *
   * NOTE: Always fetches fresh state from manager to avoid stale cached status.
   */
  public isActive(): boolean {
    // Always fetch fresh state instead of using cached this.workflow
    // This ensures we detect external workflow status changes (e.g., completion)
    const currentWorkflow = this.manager.getWorkflow(this.workflowId);
    if (!currentWorkflow) {
      return false;
    }
    return currentWorkflow.status === 'active';
  }

  /**
   * Get current workflow context (read-only).
   */
  public getWorkflow(): WorkflowContext | null {
    return this.workflow;
  }

  /**
   * Record a tool operation in the workflow.
   * Call this at the END of tool execution with the result.
   *
   * @param tool - Name of the tool being executed
   * @param parameters - Tool input parameters
   * @param result - Operation result (success/failure with data/error)
   * @returns Result indicating success or failure
   */
  public recordOperation(
    tool: string,
    parameters: Record<string, unknown>,
    result: {
      success: boolean;
      data?: unknown;
      error?: string;
    }
  ): Result<void, BCError> {
    if (!this.isActive()) {
      return err(
        new ValidationError(
          `Cannot record operation: workflow ${this.workflowId} is not active`
        )
      );
    }

    const updated = this.manager.recordOperation(this.workflowId, {
      tool,
      parameters,
      result,
    });

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to record operation in workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Recorded operation: ${tool} in workflow ${this.workflowId}`);
    return ok(undefined);
  }

  /**
   * Update current page in workflow.
   * Call this when a tool opens or switches to a new page.
   *
   * @param pageId - BC page ID
   * @returns Result indicating success or failure
   */
  public updateCurrentPage(pageId: string): Result<void, BCError> {
    if (!this.isActive()) {
      return err(
        new ValidationError(
          `Cannot update page: workflow ${this.workflowId} is not active`
        )
      );
    }

    const updated = this.manager.updateWorkflowState(this.workflowId, {
      currentPageId: pageId,
    });

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to update page in workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Updated current page to ${pageId} in workflow ${this.workflowId}`);
    return ok(undefined);
  }

  /**
   * Update focused record in workflow.
   * Call this when a tool navigates to or focuses a specific record.
   *
   * @param recordKeys - Primary key fields identifying the record
   * @returns Result indicating success or failure
   */
  public updateFocusedRecord(
    recordKeys: Record<string, unknown>
  ): Result<void, BCError> {
    if (!this.isActive()) {
      return err(
        new ValidationError(
          `Cannot update record: workflow ${this.workflowId} is not active`
        )
      );
    }

    const updated = this.manager.updateWorkflowState(this.workflowId, {
      focusedRecordKeys: recordKeys,
    });

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to update record in workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Updated focused record in workflow ${this.workflowId}: ${JSON.stringify(recordKeys)}`);
    return ok(undefined);
  }

  /**
   * Track unsaved changes in workflow.
   * Call this when a tool modifies fields but hasn't saved yet.
   *
   * @param changes - Field names and values that have changed
   * @returns Result indicating success or failure
   */
  public trackUnsavedChanges(
    changes: Record<string, unknown>
  ): Result<void, BCError> {
    if (!this.isActive()) {
      return err(
        new ValidationError(
          `Cannot track changes: workflow ${this.workflowId} is not active`
        )
      );
    }

    // Merge with existing unsaved changes
    const currentChanges = this.workflow?.unsavedChanges || {};
    const mergedChanges = { ...currentChanges, ...changes };

    const updated = this.manager.updateWorkflowState(this.workflowId, {
      unsavedChanges: mergedChanges,
    });

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to track changes in workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Tracked unsaved changes in workflow ${this.workflowId}: ${JSON.stringify(changes)}`);
    return ok(undefined);
  }

  /**
   * Clear unsaved changes in workflow.
   * Call this after successfully saving/posting changes.
   *
   * @returns Result indicating success or failure
   */
  public clearUnsavedChanges(): Result<void, BCError> {
    if (!this.isActive()) {
      return err(
        new ValidationError(
          `Cannot clear changes: workflow ${this.workflowId} is not active`
        )
      );
    }

    const updated = this.manager.updateWorkflowState(this.workflowId, {
      unsavedChanges: {}, // Clear by setting to empty object
    });

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to clear changes in workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Cleared unsaved changes in workflow ${this.workflowId}`);
    return ok(undefined);
  }

  /**
   * Record an error in the workflow.
   * Call this when a tool operation fails.
   *
   * @param errorMessage - Description of the error
   * @returns Result indicating success or failure
   */
  public recordError(errorMessage: string): Result<void, BCError> {
    if (!this.workflow) {
      // Allow error recording even if workflow is not active
      // (we want to capture why workflow failed)
      logger.warn(`[WorkflowIntegration] Recording error in inactive workflow ${this.workflowId}: ${errorMessage}`);
    }

    const updated = this.manager.updateWorkflowState(this.workflowId, {
      appendError: errorMessage,
    });

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to record error in workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Recorded error in workflow ${this.workflowId}: ${errorMessage}`);
    return ok(undefined);
  }

  /**
   * Update multiple workflow fields atomically.
   * Use this when you need to update several fields at once.
   *
   * @param updates - Object with fields to update
   * @returns Result indicating success or failure
   */
  public updateWorkflowState(updates: {
    currentPageId?: string;
    focusedRecordKeys?: Record<string, unknown>;
    unsavedChanges?: Record<string, unknown>;
    appendError?: string;
  }): Result<void, BCError> {
    if (!this.isActive() && !updates.appendError) {
      return err(
        new ValidationError(
          `Cannot update workflow: ${this.workflowId} is not active`
        )
      );
    }

    const updated = this.manager.updateWorkflowState(
      this.workflowId,
      updates
    );

    if (!updated) {
      return err(
        new ValidationError(
          `Failed to update workflow ${this.workflowId}`
        )
      );
    }

    this.workflow = updated;
    logger.debug(`[WorkflowIntegration] Updated workflow state ${this.workflowId}: ${JSON.stringify(updates)}`);
    return ok(undefined);
  }
}

/**
 * Factory function to create WorkflowIntegration if workflowId is provided.
 * Returns null if workflowId is not provided (tool running without workflow).
 *
 * Usage:
 * ```typescript
 * const integration = createWorkflowIntegration(input.workflowId);
 * if (integration) {
 *   integration.recordOperation(toolName, input);
 * }
 * ```
 */
export function createWorkflowIntegration(
  workflowId?: string
): WorkflowIntegration | null {
  if (!workflowId) {
    return null;
  }
  return new WorkflowIntegration(workflowId);
}
