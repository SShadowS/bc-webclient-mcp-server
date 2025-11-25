/**
 * All Workflows Resource
 *
 * Provides introspection into all active and completed workflows.
 * This resource helps AI assistants discover workflows and understand workflow state.
 *
 * For accessing a specific workflow by ID, use the get_workflow_state tool instead.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { InternalError } from '../core/errors.js';
import type { IMCPResource, ILogger } from '../core/interfaces.js';
import { WorkflowStateManager } from '../services/workflow-state-manager.js';

/**
 * BCWorkflowAllResource exposes all workflows in the system.
 */
export class BCWorkflowAllResource implements IMCPResource {
  public readonly uri = 'bc://workflow/all';
  public readonly name = 'All BC Workflows';
  public readonly description =
    'All active and completed workflows with their current state, operations, and errors.';
  public readonly mimeType = 'application/json';

  public constructor(private readonly logger?: ILogger) {}

  /**
   * Reads all workflows.
   * @returns JSON snapshot of all workflows
   */
  public async read(): Promise<Result<string, BCError>> {
    try {
      this.logger?.debug('Reading all BC workflows');

      const manager = WorkflowStateManager.getInstance(this.logger);
      const snapshot = manager.getSnapshot();

      // Add metadata
      const result = {
        timestamp: new Date().toISOString(),
        workflowCount: manager.getWorkflowCount(),
        activeWorkflows: manager.getActiveWorkflows().length,
        workflows: snapshot.workflows,
      };

      const json = JSON.stringify(result, null, 2);

      this.logger?.debug('Returning all BC workflows', {
        workflowCount: result.workflowCount,
        activeWorkflows: result.activeWorkflows,
      });

      return ok(json);
    } catch (error) {
      this.logger?.error('Failed to read BCWorkflowAllResource', {
        error: String(error),
      });

      return err(
        new InternalError('Failed to read all workflows resource', {
          code: 'READ_WORKFLOWS_FAILED',
          error: String(error),
        })
      );
    }
  }
}
