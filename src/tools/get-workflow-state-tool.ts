/**
 * Get Workflow State Tool
 *
 * Retrieves the current state of a workflow by ID.
 * Use this to inspect workflow progress, operations, errors, and current position.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ValidationError } from '../core/errors.js';
import { createToolLogger } from '../core/logger.js';

import { BaseMCPTool } from './base-tool.js';
import { WorkflowStateManager } from '../services/workflow-state-manager.js';

/**
 * Input schema for get_workflow_state tool.
 */
export interface GetWorkflowStateInput {
  readonly workflowId: string;
}

/**
 * GetWorkflowStateTool retrieves workflow state by ID.
 *
 * This tool provides access to:
 * - Workflow metadata (goal, status, timestamps)
 * - Current navigation state (page, record)
 * - Operation history
 * - Pending changes and errors
 */
export class GetWorkflowStateTool extends BaseMCPTool {
  public readonly name = 'get_workflow_state';
  public readonly description =
    'Get the current state of a workflow by ID. Returns workflow metadata, current position, operation history, and errors.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      workflowId: {
        type: 'string',
        description: 'The workflow ID to retrieve state for',
      },
    },
    required: ['workflowId'],
  } as const;

  protected async executeInternal(
    input: unknown
  ): Promise<Result<unknown, BCError>> {
    const { workflowId } = input as GetWorkflowStateInput;
    const logger = createToolLogger('get_workflow_state', workflowId);

    logger.info(`[GetWorkflowState] Getting workflow state: ${workflowId}`);

    try {
      // Validate input
      if (!workflowId || typeof workflowId !== 'string') {
        return err(
          new ValidationError('workflowId must be a non-empty string')
        );
      }

      // Get workflow from state manager
      const manager = WorkflowStateManager.getInstance();
      const workflow = manager.getWorkflow(workflowId);

      if (!workflow) {
        return err(
          new ValidationError(`Workflow not found: ${workflowId}`)
        );
      }

      logger.info(`[GetWorkflowState] Retrieved workflow state: ${workflowId}, status: ${workflow.status}, operations: ${workflow.operations.length}, errors: ${workflow.errors.length}`);

      // Return workflow context
      return ok({
        workflow,
        summary: {
          status: workflow.status,
          operationsCompleted: workflow.operations.length,
          hasErrors: workflow.errors.length > 0,
          currentPage: workflow.currentPageId || null,
          currentRecord: workflow.focusedRecordKeys || null,
        },
      });
    } catch (error) {
      logger.error(`[GetWorkflowState] Failed to get workflow state: ${workflowId}, error: ${String(error)}`);

      return err(
        new ValidationError(`Failed to get workflow state: ${String(error)}`)
      );
    }
  }
}
