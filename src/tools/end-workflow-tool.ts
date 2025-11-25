/**
 * End Workflow Tool
 *
 * Completes, fails, or cancels a workflow.
 * Use this when a workflow reaches a terminal state (success, failure, or cancellation).
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ValidationError } from '../core/errors.js';
import { createToolLogger } from '../core/logger.js';

import { BaseMCPTool } from './base-tool.js';
import { WorkflowStateManager } from '../services/workflow-state-manager.js';

/**
 * Input schema for end_workflow tool.
 */
export interface EndWorkflowInput {
  readonly workflowId: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly message?: string; // Optional completion/error message
}

/**
 * EndWorkflowTool terminates a workflow with a final status.
 *
 * Terminal states:
 * - completed: Workflow succeeded
 * - failed: Workflow encountered errors
 * - cancelled: Workflow was explicitly cancelled
 *
 * The workflow context is retained for introspection but no longer active.
 */
export class EndWorkflowTool extends BaseMCPTool {
  public readonly name = 'end_workflow';
  public readonly description =
    'End a workflow with a final status (completed, failed, or cancelled). The workflow state is retained for history but marked as inactive.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'The workflow ID to end',
      },
      status: {
        type: 'string',
        enum: ['completed', 'failed', 'cancelled'],
        description: 'Final workflow status',
      },
      message: {
        type: 'string',
        description: 'Optional completion or error message',
      },
    },
    required: ['workflowId', 'status'],
  } as const;

  protected async executeInternal(
    input: unknown
  ): Promise<Result<unknown, BCError>> {
    const { workflowId, status, message } = input as EndWorkflowInput;
    const logger = createToolLogger('end_workflow', workflowId);

    logger.info(`[EndWorkflow] Ending workflow ${workflowId} with status ${status}`);

    try {
      // Validate input
      if (!workflowId || typeof workflowId !== 'string') {
        return err(
          new ValidationError('workflowId must be a non-empty string')
        );
      }

      if (!['completed', 'failed', 'cancelled'].includes(status)) {
        return err(
          new ValidationError('status must be completed, failed, or cancelled')
        );
      }

      // Get workflow manager
      const manager = WorkflowStateManager.getInstance();
      const workflow = manager.getWorkflow(workflowId);

      if (!workflow) {
        return err(
          new ValidationError(`Workflow not found: ${workflowId}`)
        );
      }

      // Check if already terminated
      if (['completed', 'failed', 'cancelled'].includes(workflow.status)) {
        return err(
          new ValidationError(
            `Workflow already terminated with status: ${workflow.status}`
          )
        );
      }

      // Update workflow status
      let updatedWorkflow;
      if (status === 'completed') {
        updatedWorkflow = manager.completeWorkflow(workflowId);
      } else if (status === 'failed') {
        const errorMessage = message || 'Workflow failed';
        updatedWorkflow = manager.failWorkflow(workflowId, errorMessage);
      } else {
        // cancelled
        updatedWorkflow = manager.cancelWorkflow(workflowId);
        if (updatedWorkflow && message) {
          // Add cancellation message as error
          updatedWorkflow = manager.updateWorkflowState(workflowId, {
            appendError: message,
          });
        }
      }

      if (!updatedWorkflow) {
        return err(
          new ValidationError(`Failed to update workflow: ${workflowId}`)
        );
      }

      logger.info(`[EndWorkflow] Workflow ended: ${workflowId}, status: ${updatedWorkflow.status}, operations: ${updatedWorkflow.operations.length}, errors: ${updatedWorkflow.errors.length}`);

      return ok({
        workflowId: updatedWorkflow.workflowId,
        goal: updatedWorkflow.goal,
        status: updatedWorkflow.status,
        operationsCompleted: updatedWorkflow.operations.length,
        errors: updatedWorkflow.errors,
        updatedAt: updatedWorkflow.updatedAt,
        message: message || `Workflow ${status}`,
      });
    } catch (error) {
      logger.error(`[EndWorkflow] Failed to end workflow: ${workflowId}, error: ${String(error)}`);

      return err(
        new ValidationError(`Failed to end workflow: ${String(error)}`)
      );
    }
  }
}
