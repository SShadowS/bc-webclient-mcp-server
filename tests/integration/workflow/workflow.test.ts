/**
 * Integration Tests for Workflow State Tracking
 *
 * Tests WorkflowStateManager, workflow tools, and workflow resource.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowStateManager } from '../../../src/services/workflow-state-manager.js';
import { SessionStateManager } from '../../../src/services/session-state-manager.js';
import { StartWorkflowTool } from '../../../src/tools/start-workflow-tool.js';
import { GetWorkflowStateTool } from '../../../src/tools/get-workflow-state-tool.js';
import { EndWorkflowTool } from '../../../src/tools/end-workflow-tool.js';
import { BCWorkflowAllResource } from '../../../src/resources/workflow-all-resource.js';
import { MCPServer } from '../../../src/services/mcp-server.js';
import { logger } from '../../../src/core/logger.js';
import { isOk } from '../../../src/core/result.js';

describe('Workflow State Tracking Integration', () => {
  let workflowManager: WorkflowStateManager;
  let sessionManager: SessionStateManager;

  beforeEach(() => {
    // Reset singletons for test isolation (consistent with resources tests)
    WorkflowStateManager.resetInstance();
    SessionStateManager.resetInstance();
    workflowManager = WorkflowStateManager.getInstance();
    sessionManager = SessionStateManager.getInstance();
  });

  describe('WorkflowStateManager', () => {
    it('should create a new workflow', () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
        parameters: { test: 'value' },
      });

      expect(workflow.workflowId).toBeTruthy();
      expect(workflow.sessionId).toBe(session.sessionId);
      expect(workflow.goal).toBe('test_workflow');
      expect(workflow.status).toBe('active');
      expect(workflow.parameters).toEqual({ test: 'value' });
      expect(workflow.operations).toHaveLength(0);
      expect(workflow.errors).toHaveLength(0);
    });

    it('should retrieve a workflow by ID', () => {
      const session = sessionManager.createSession();
      const created = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const retrieved = workflowManager.getWorkflow(created.workflowId);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.workflowId).toBe(created.workflowId);
      expect(retrieved?.goal).toBe('test_workflow');
    });

    it('should return undefined for non-existent workflow', () => {
      const workflow = workflowManager.getWorkflow('non-existent-id');
      expect(workflow).toBeUndefined();
    });

    it('should record operations', () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      workflowManager.recordOperation(workflow.workflowId, {
        tool: 'test_tool',
        parameters: { foo: 'bar' },
        result: { success: true, data: {} },
      });

      const updated = workflowManager.getWorkflow(workflow.workflowId);
      expect(updated?.operations).toHaveLength(1);
      expect(updated?.operations[0].tool).toBe('test_tool');
      expect(updated?.operations[0].parameters).toEqual({ foo: 'bar' });
    });

    it('should complete a workflow', () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const completed = workflowManager.completeWorkflow(workflow.workflowId);

      expect(completed).toBeTruthy();
      expect(completed?.status).toBe('completed');
    });

    it('should fail a workflow with error message', () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const failed = workflowManager.failWorkflow(workflow.workflowId, 'Test error');

      expect(failed).toBeTruthy();
      expect(failed?.status).toBe('failed');
      expect(failed?.errors).toContain('Test error');
      expect(failed?.lastError).toBe('Test error');
    });

    it('should cancel a workflow', () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const cancelled = workflowManager.cancelWorkflow(workflow.workflowId);

      expect(cancelled).toBeTruthy();
      expect(cancelled?.status).toBe('cancelled');
    });

    it('should get active workflows', () => {
      const session = sessionManager.createSession();
      const workflow1 = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'workflow1',
      });
      const workflow2 = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'workflow2',
      });

      workflowManager.completeWorkflow(workflow2.workflowId);

      const activeWorkflows = workflowManager.getActiveWorkflows();

      expect(activeWorkflows).toHaveLength(1);
      expect(activeWorkflows[0].workflowId).toBe(workflow1.workflowId);
      expect(activeWorkflows[0].status).toBe('active');
    });

    it('should get workflow count', () => {
      const session = sessionManager.createSession();

      expect(workflowManager.getWorkflowCount()).toBe(0);

      workflowManager.createWorkflow({ sessionId: session.sessionId, goal: 'workflow1' });
      expect(workflowManager.getWorkflowCount()).toBe(1);

      workflowManager.createWorkflow({ sessionId: session.sessionId, goal: 'workflow2' });
      expect(workflowManager.getWorkflowCount()).toBe(2);
    });

    it('should update workflow state with page context', () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const updated = workflowManager.updateWorkflowState(workflow.workflowId, {
        currentPageContextId: 'session:page:21:123',
        currentPageId: '21',
        focusedRecordKeys: { No: '10000' },
      });

      expect(updated?.currentPageContextId).toBe('session:page:21:123');
      expect(updated?.currentPageId).toBe('21');
      expect(updated?.focusedRecordKeys).toEqual({ No: '10000' });
    });
  });

  describe('StartWorkflowTool', () => {
    it('should create a new workflow', async () => {
      const tool = new StartWorkflowTool();

      const result = await tool.execute({
        goal: 'create_sales_invoice',
        parameters: { customerNo: '10000' },
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.workflowId).toBeTruthy();
      expect(result.value.sessionId).toBeTruthy();
      expect(result.value.goal).toBe('create_sales_invoice');
      expect(result.value.status).toBe('active');
    });

    it('should link to existing session if provided', async () => {
      const session = sessionManager.createSession();
      const tool = new StartWorkflowTool();

      const result = await tool.execute({
        goal: 'test_workflow',
        sessionId: session.sessionId,
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.sessionId).toBe(session.sessionId);
    });

    it('should fail with invalid goal', async () => {
      const tool = new StartWorkflowTool();

      const result = await tool.execute({
        goal: '',
      });

      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;

      expect(result.error.message).toContain('goal must be a non-empty string');
    });

    it('should fail with non-existent session', async () => {
      const tool = new StartWorkflowTool();

      const result = await tool.execute({
        goal: 'test_workflow',
        sessionId: 'non-existent-session',
      });

      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;

      expect(result.error.message).toContain('Session not found');
    });
  });

  describe('GetWorkflowStateTool', () => {
    it('should retrieve workflow state', async () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const tool = new GetWorkflowStateTool();
      const result = await tool.execute({
        workflowId: workflow.workflowId,
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.workflow.workflowId).toBe(workflow.workflowId);
      expect(result.value.workflow.goal).toBe('test_workflow');
      expect(result.value.summary.status).toBe('active');
      expect(result.value.summary.operationsCompleted).toBe(0);
      expect(result.value.summary.hasErrors).toBe(false);
    });

    it('should fail with non-existent workflow', async () => {
      const tool = new GetWorkflowStateTool();

      const result = await tool.execute({
        workflowId: 'non-existent-id',
      });

      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;

      expect(result.error.message).toContain('Workflow not found');
    });
  });

  describe('EndWorkflowTool', () => {
    it('should complete a workflow', async () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const tool = new EndWorkflowTool();
      const result = await tool.execute({
        workflowId: workflow.workflowId,
        status: 'completed',
        message: 'Success',
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.status).toBe('completed');
      expect(result.value.message).toBe('Success');
    });

    it('should fail a workflow', async () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const tool = new EndWorkflowTool();
      const result = await tool.execute({
        workflowId: workflow.workflowId,
        status: 'failed',
        message: 'Error occurred',
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.status).toBe('failed');
      expect(result.value.errors).toContain('Error occurred');
    });

    it('should cancel a workflow', async () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      const tool = new EndWorkflowTool();
      const result = await tool.execute({
        workflowId: workflow.workflowId,
        status: 'cancelled',
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.status).toBe('cancelled');
    });

    it('should fail if workflow already terminated', async () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
      });

      workflowManager.completeWorkflow(workflow.workflowId);

      const tool = new EndWorkflowTool();
      const result = await tool.execute({
        workflowId: workflow.workflowId,
        status: 'completed',
      });

      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;

      expect(result.error.message).toContain('already terminated');
    });
  });

  describe('BCWorkflowAllResource', () => {
    it('should return all workflows as JSON', async () => {
      const session = sessionManager.createSession();
      workflowManager.createWorkflow({ sessionId: session.sessionId, goal: 'workflow1' });
      workflowManager.createWorkflow({ sessionId: session.sessionId, goal: 'workflow2' });

      const resource = new BCWorkflowAllResource(logger);
      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const data = JSON.parse(result.value);
      expect(data.workflowCount).toBe(2);
      expect(data.activeWorkflows).toBe(2);
      expect(data.workflows).toHaveLength(2);
    });

    it('should include workflow details', async () => {
      const session = sessionManager.createSession();
      const workflow = workflowManager.createWorkflow({
        sessionId: session.sessionId,
        goal: 'test_workflow',
        parameters: { test: 'value' },
      });

      const resource = new BCWorkflowAllResource(logger);
      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const data = JSON.parse(result.value);
      const found = data.workflows.find((w: any) => w.workflowId === workflow.workflowId);

      expect(found).toBeTruthy();
      expect(found.goal).toBe('test_workflow');
      expect(found.status).toBe('active');
      expect(found.parameters).toEqual({ test: 'value' });
    });
  });

  describe('Complete Workflow Scenario', () => {
    it('should handle full workflow lifecycle', async () => {
      const startTool = new StartWorkflowTool();
      const getStateTool = new GetWorkflowStateTool();
      const endTool = new EndWorkflowTool();

      // Start workflow
      const startResult = await startTool.execute({
        goal: 'create_sales_order',
        parameters: { customerNo: '10000', items: [{ itemNo: '1000', quantity: 5 }] },
      });

      expect(isOk(startResult)).toBe(true);
      if (!isOk(startResult)) return;

      const workflowId = startResult.value.workflowId;

      // Simulate workflow operations
      workflowManager.recordOperation(workflowId, {
        tool: 'get_page_metadata',
        parameters: { pageId: '42' },
        result: { success: true, data: { pageContextId: 'session1:page:42:123' } },
      });

      workflowManager.recordOperation(workflowId, {
        tool: 'write_page_data',
        parameters: { fields: { CustomerNo: '10000' } },
        result: { success: true, data: { saved: false, updatedFields: ['CustomerNo'] } },
      });

      // Get state mid-workflow
      const stateResult = await getStateTool.execute({ workflowId });

      expect(isOk(stateResult)).toBe(true);
      if (!isOk(stateResult)) return;

      expect(stateResult.value.workflow.status).toBe('active');
      expect(stateResult.value.summary.operationsCompleted).toBe(2);

      // Complete workflow
      const endResult = await endTool.execute({
        workflowId,
        status: 'completed',
        message: 'Sales order created successfully',
      });

      expect(isOk(endResult)).toBe(true);
      if (!isOk(endResult)) return;

      expect(endResult.value.status).toBe('completed');
      expect(endResult.value.operationsCompleted).toBe(2);

      // Verify final state
      const finalState = await getStateTool.execute({ workflowId });
      expect(isOk(finalState)).toBe(true);
      if (!isOk(finalState)) return;

      expect(finalState.value.workflow.status).toBe('completed');
    });
  });

  describe('MCPServer Integration', () => {
    let server: MCPServer;

    beforeEach(async () => {
      server = new MCPServer(logger);
      await server.initialize();

      // Register workflow tools
      server.registerTool(new StartWorkflowTool());
      server.registerTool(new GetWorkflowStateTool());
      server.registerTool(new EndWorkflowTool());

      // Register workflow resource
      server.registerResource(new BCWorkflowAllResource(logger));
    });

    it('should list workflow tools', async () => {
      const listResult = await server.handleToolsList();

      expect(isOk(listResult)).toBe(true);
      if (!isOk(listResult)) return;

      const toolNames = listResult.value.tools.map((t) => t.name);
      expect(toolNames).toContain('start_workflow');
      expect(toolNames).toContain('get_workflow_state');
      expect(toolNames).toContain('end_workflow');
    });

    it('should list workflow resource', async () => {
      const listResult = await server.handleResourcesList();

      expect(isOk(listResult)).toBe(true);
      if (!isOk(listResult)) return;

      const uris = listResult.value.resources.map((r) => r.uri);
      expect(uris).toContain('bc://workflow/all');
    });

    it('should execute workflow tools via server', async () => {
      // Start workflow via server
      const startResult = await server.handleToolCall({
        name: 'start_workflow',
        arguments: { goal: 'test_via_server' },
      });

      expect(isOk(startResult)).toBe(true);
      if (!isOk(startResult)) {
        console.error('Start workflow failed:', startResult.error);
        return;
      }

      const workflowId = startResult.value.content[0].text ? JSON.parse(startResult.value.content[0].text).workflowId : startResult.value.workflowId;

      // Get state via server
      const stateResult = await server.handleToolCall({
        name: 'get_workflow_state',
        arguments: { workflowId },
      });

      expect(isOk(stateResult)).toBe(true);
      if (!isOk(stateResult)) {
        console.error('Get state failed:', stateResult.error);
        return;
      }

      const stateData = stateResult.value.content[0].text ? JSON.parse(stateResult.value.content[0].text) : stateResult.value;
      expect(stateData.workflow.goal).toBe('test_via_server');

      // End workflow via server
      const endResult = await server.handleToolCall({
        name: 'end_workflow',
        arguments: { workflowId, status: 'completed' },
      });

      expect(isOk(endResult)).toBe(true);
    });

    it('should read workflow resource via server', async () => {
      // Create some workflows first
      const session = sessionManager.createSession();
      workflowManager.createWorkflow({ sessionId: session.sessionId, goal: 'workflow1' });

      const readResult = await server.handleResourceRead({
        uri: 'bc://workflow/all',
      });

      expect(isOk(readResult)).toBe(true);
      if (!isOk(readResult)) {
        console.error('Resource read failed:', readResult.error);
        return;
      }

      expect(readResult.value.contents[0].mimeType).toBe('application/json');
      const data = JSON.parse(readResult.value.contents[0].text);
      expect(data.workflowCount).toBeGreaterThan(0);
    });
  });
});
