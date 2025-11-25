/**
 * Start Workflow Tool
 *
 * Creates a new workflow context for tracking multi-step business processes.
 * Use this at the beginning of complex BC workflows to maintain state across operations.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ValidationError } from '../core/errors.js';
import { createToolLogger } from '../core/logger.js';

import { BaseMCPTool } from './base-tool.js';
import { WorkflowStateManager } from '../services/workflow-state-manager.js';
import { SessionStateManager } from '../services/session-state-manager.js';

/**
 * Input schema for start_workflow tool.
 */
export interface StartWorkflowInput {
  readonly goal: string;
  readonly parameters?: Record<string, unknown>;
  readonly sessionId?: string; // Optional: link to existing session, otherwise creates new one
}

/**
 * StartWorkflowTool creates a new workflow context.
 *
 * Workflows track:
 * - Goal and input parameters
 * - Current page and record position
 * - Operation history (all tool calls)
 * - Pending changes and errors
 *
 * Example goals:
 * - "create_sales_invoice"
 * - "post_sales_order"
 * - "update_customer_credit_limit"
 */
export class StartWorkflowTool extends BaseMCPTool {
  public readonly name = 'start_workflow';
  public readonly description =
    'Start a new workflow to track a multi-step business process. Returns a workflowId for state tracking across operations.';

  public readonly inputSchema = {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'Description of the workflow goal (e.g., "create_sales_invoice", "post_sales_order")',
      },
      parameters: {
        type: 'object',
        description: 'Optional workflow parameters (inputs like customer number, amounts, dates)',
        additionalProperties: true,
      },
      sessionId: {
        type: 'string',
        description: 'Optional BC session ID to link workflow to. If not provided, creates a new session.',
      },
    },
    required: ['goal'],
  } as const;

  protected async executeInternal(
    input: unknown
  ): Promise<Result<unknown, BCError>> {
    const { goal, parameters, sessionId: inputSessionId } = input as StartWorkflowInput;
    const logger = createToolLogger('start_workflow', goal);

    logger.info(`[StartWorkflow] Starting new workflow: ${goal}`);

    try {
      // Validate input
      if (!goal || typeof goal !== 'string') {
        return err(
          new ValidationError('goal must be a non-empty string')
        );
      }

      // Get or create session
      const sessionManager = SessionStateManager.getInstance();
      let sessionId = inputSessionId;

      if (!sessionId) {
        // Create new session
        const session = sessionManager.createSession();
        sessionId = session.sessionId;
        logger.debug(`[StartWorkflow] Created new session: ${sessionId}`);
      } else {
        // Verify session exists
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          return err(
            new ValidationError(`Session not found: ${sessionId}`)
          );
        }
      }

      // Create workflow
      const workflowManager = WorkflowStateManager.getInstance();
      const workflow = workflowManager.createWorkflow({
        sessionId,
        goal,
        parameters,
      });

      logger.info(`[StartWorkflow] Workflow created: ${workflow.workflowId}, session: ${workflow.sessionId}, goal: ${workflow.goal}`);

      return ok({
        workflowId: workflow.workflowId,
        sessionId: workflow.sessionId,
        goal: workflow.goal,
        status: workflow.status,
        createdAt: workflow.createdAt,
        message: `Workflow started: ${workflow.goal}`,
      });
    } catch (error) {
      logger.error(`[StartWorkflow] Failed to start workflow: ${goal}, error: ${String(error)}`);

      return err(
        new ValidationError(`Failed to start workflow: ${String(error)}`)
      );
    }
  }
}
