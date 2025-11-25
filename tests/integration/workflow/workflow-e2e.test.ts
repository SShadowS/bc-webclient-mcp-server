/**
 * E2E Integration Tests for Workflow Tool Integration
 *
 * Tests complete workflow lifecycle across multiple tool operations:
 * - Workflow creation and completion
 * - Multi-tool operation tracking
 * - Unsaved changes tracking and clearing
 * - Page navigation tracking
 * - Error tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkflowStateManager } from '../../../src/services/workflow-state-manager.js';
import { SessionStateManager } from '../../../src/services/session-state-manager.js';
import { WorkflowIntegration } from '../../../src/services/workflow-integration.js';

describe('Workflow E2E Integration Tests', () => {
  let workflowManager: WorkflowStateManager;
  let sessionManager: SessionStateManager;
  let workflowId: string;
  let sessionId: string;

  beforeEach(() => {
    // Get fresh singleton instances
    workflowManager = WorkflowStateManager.getInstance();
    sessionManager = SessionStateManager.getInstance();

    // Create session and workflow for each test
    const session = sessionManager.createSession();
    sessionId = session.sessionId;

    const workflow = workflowManager.createWorkflow({
      sessionId,
      goal: 'e2e_test_workflow',
      parameters: { testType: 'integration' },
    });
    workflowId = workflow.workflowId;
  });

  afterEach(() => {
    // Clean up workflows
    const snapshot = workflowManager.getSnapshot();
    for (const workflow of snapshot.workflows) {
      workflowManager.deleteWorkflow(workflow.workflowId);
    }
  });

  describe('Complete Workflow Lifecycle', () => {
    it('should track multi-tool operations with correct interface', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Simulate get_page_metadata operation
      integration.recordOperation(
        'get_page_metadata',
        { pageId: '21', bookmark: undefined },
        { success: true, data: { pageContextId: 'session1:page:21:123', pageType: 'Card' } }
      );

      // Simulate read_page_data operation
      integration.recordOperation(
        'read_page_data',
        { pageContextId: 'session1:page:21:123', filters: undefined },
        { success: true, data: { recordCount: 1, totalCount: 1 } }
      );

      // Simulate write_page_data operation
      integration.recordOperation(
        'write_page_data',
        { pageContextId: 'session1:page:21:123', fields: { Name: 'Test Customer' } },
        { success: true, data: { updatedFields: ['Name'], fieldCount: 1 } }
      );

      // Verify all operations recorded
      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow).toBeTruthy();
      expect(workflow!.operations).toHaveLength(3);

      // Verify operation structure (NEW interface)
      const op1 = workflow!.operations[0];
      expect(op1.tool).toBe('get_page_metadata');
      expect(op1.parameters).toEqual({ pageId: '21', bookmark: undefined });
      expect(op1.result.success).toBe(true);
      expect(op1.result.data).toEqual({ pageContextId: 'session1:page:21:123', pageType: 'Card' });

      const op2 = workflow!.operations[1];
      expect(op2.tool).toBe('read_page_data');
      expect(op2.parameters).toEqual({ pageContextId: 'session1:page:21:123', filters: undefined });
      expect(op2.result.success).toBe(true);

      const op3 = workflow!.operations[2];
      expect(op3.tool).toBe('write_page_data');
      expect(op3.parameters.fields).toEqual({ Name: 'Test Customer' });
      expect(op3.result.success).toBe(true);
      expect(op3.result.data.updatedFields).toContain('Name');
    });

    it('should track complete customer creation workflow', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Step 1: Search for customer page
      integration.recordOperation(
        'search_pages',
        { query: 'customer', type: 'Card' },
        { success: true, data: { resultCount: 1 } }
      );

      // Step 2: Open customer card
      integration.updateCurrentPage('21');
      integration.recordOperation(
        'get_page_metadata',
        { pageId: '21' },
        { success: true, data: { pageContextId: 'session1:page:21:456', pageType: 'Card', fieldCount: 50 } }
      );

      // Step 3: Click "New" action
      integration.recordOperation(
        'execute_action',
        { pageContextId: 'session1:page:21:456', actionName: 'New' },
        { success: true, data: { actionName: 'New', pageId: '21', formId: 'form-123' } }
      );

      // Step 4: Fill in customer fields
      integration.trackUnsavedChanges({ Name: 'Acme Corp', 'E-Mail': 'contact@acme.com' });
      integration.recordOperation(
        'write_page_data',
        { pageContextId: 'session1:page:21:456', fields: { Name: 'Acme Corp', 'E-Mail': 'contact@acme.com' } },
        { success: true, data: { updatedFields: ['Name', 'E-Mail'], fieldCount: 2 } }
      );

      // Step 5: Save (should clear unsaved changes)
      integration.clearUnsavedChanges();
      integration.recordOperation(
        'execute_action',
        { pageContextId: 'session1:page:21:456', actionName: 'Save' },
        { success: true, data: { actionName: 'Save', pageId: '21', formId: 'form-123' } }
      );

      // Verify complete workflow
      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow).toBeTruthy();
      expect(workflow!.operations).toHaveLength(5);
      expect(workflow!.currentPageId).toBe('21');
      expect(workflow!.unsavedChanges).toEqual({});
      expect(workflow!.errors).toHaveLength(0);

      // Verify operation sequence
      expect(workflow!.operations[0].tool).toBe('search_pages');
      expect(workflow!.operations[1].tool).toBe('get_page_metadata');
      expect(workflow!.operations[2].tool).toBe('execute_action');
      expect(workflow!.operations[2].result.data.actionName).toBe('New');
      expect(workflow!.operations[3].tool).toBe('write_page_data');
      expect(workflow!.operations[4].tool).toBe('execute_action');
      expect(workflow!.operations[4].result.data.actionName).toBe('Save');
    });

    it('should handle workflow with dialog interaction', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Open page and trigger action that shows dialog
      integration.recordOperation(
        'get_page_metadata',
        { pageId: '21' },
        { success: true, data: { pageContextId: 'session1:page:21:789' } }
      );

      integration.recordOperation(
        'execute_action',
        { pageContextId: 'session1:page:21:789', actionName: 'New' },
        { success: true, data: { actionName: 'New', dialogTriggered: true } }
      );

      // Handle dialog (template selection)
      integration.recordOperation(
        'handle_dialog',
        { pageContextId: 'session1:page:21:789', action: 'OK', selection: { rowFilter: { Code: 'TEMPLATE01' } } },
        { success: true, data: { dialogId: 'dialog-456', action: 'OK', selectedBookmark: 'bmk-123' } }
      );

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.operations).toHaveLength(3);
      expect(workflow!.operations[2].tool).toBe('handle_dialog');
      expect(workflow!.operations[2].result.data.action).toBe('OK');
    });
  });

  describe('Unsaved Changes Tracking', () => {
    it('should track unsaved changes from write_page_data', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Write multiple fields
      integration.trackUnsavedChanges({ Name: 'Test', Address: '123 Main St' });
      integration.trackUnsavedChanges({ City: 'Seattle' });

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.unsavedChanges).toEqual({
        Name: 'Test',
        Address: '123 Main St',
        City: 'Seattle',
      });
    });

    it('should clear unsaved changes on Save action', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Track changes
      integration.trackUnsavedChanges({ Name: 'Test', Email: 'test@example.com' });
      let workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.unsavedChanges).toEqual({ Name: 'Test', Email: 'test@example.com' });

      // Save should clear
      integration.clearUnsavedChanges();
      workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.unsavedChanges).toEqual({});
    });

    it('should preserve unsaved changes on non-commit actions', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Track changes
      integration.trackUnsavedChanges({ Name: 'Test' });

      // Execute non-commit action (e.g., "Edit")
      integration.recordOperation(
        'execute_action',
        { pageContextId: 'ctx-123', actionName: 'Edit' },
        { success: true, data: { actionName: 'Edit' } }
      );

      // Unsaved changes should still be present
      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.unsavedChanges).toEqual({ Name: 'Test' });
    });
  });

  describe('Page Navigation Tracking', () => {
    it('should track page navigation', () => {
      const integration = new WorkflowIntegration(workflowId);

      integration.updateCurrentPage('21');
      let workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.currentPageId).toBe('21');

      integration.updateCurrentPage('22');
      workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.currentPageId).toBe('22');
    });

    it('should track focused record', () => {
      const integration = new WorkflowIntegration(workflowId);

      integration.updateFocusedRecord({ 'No.': '10000', Name: 'Customer Name' });

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.focusedRecordKeys).toEqual({ 'No.': '10000', Name: 'Customer Name' });
    });
  });

  describe('Error Tracking', () => {
    it('should record operation failures', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Successful operation
      integration.recordOperation(
        'get_page_metadata',
        { pageId: '21' },
        { success: true, data: { pageContextId: 'ctx-123' } }
      );

      // Failed operation
      integration.recordOperation(
        'write_page_data',
        { pageContextId: 'ctx-123', fields: { 'Invalid Field': 'value' } },
        { success: false, error: 'Field validation failed', data: { failedFields: ['Invalid Field'] } }
      );

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.operations).toHaveLength(2);
      expect(workflow!.operations[1].result.success).toBe(false);
      expect(workflow!.operations[1].result.error).toBe('Field validation failed');
    });

    it('should track workflow errors', () => {
      const integration = new WorkflowIntegration(workflowId);

      integration.recordError('Validation error: Field "Name" is required');
      integration.recordError('Validation error: Field "Email" has invalid format');

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.errors).toHaveLength(2);
      expect(workflow!.errors[0]).toContain('Field "Name" is required');
      expect(workflow!.errors[1]).toContain('Field "Email" has invalid format');
    });

    it('should track partial write_page_data failures', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Partial success: some fields updated, some failed
      integration.trackUnsavedChanges({ Name: 'Test Customer' }); // Only successful field
      integration.recordOperation(
        'write_page_data',
        { pageContextId: 'ctx-123', fields: { Name: 'Test Customer', InvalidField: 'value' } },
        {
          success: false,
          error: 'Partially updated 1 field(s), 1 field(s) failed validation',
          data: {
            updatedFields: ['Name'],
            failedFields: [{ field: 'InvalidField', error: 'Field not found' }],
          },
        }
      );
      integration.recordError('Field "InvalidField": Field not found');

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.operations[0].result.success).toBe(false);
      expect(workflow!.operations[0].result.data.updatedFields).toContain('Name');
      expect(workflow!.operations[0].result.data.failedFields).toHaveLength(1);
      expect(workflow!.unsavedChanges).toEqual({ Name: 'Test Customer' });
      expect(workflow!.errors).toHaveLength(1);
    });
  });

  describe('Workflow State Validation', () => {
    it('should maintain workflow status throughout lifecycle', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Active workflow
      let workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.status).toBe('active');
      expect(integration.isActive()).toBe(true);

      // Complete workflow
      workflowManager.completeWorkflow(workflowId);
      workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.status).toBe('completed');
    });

    it('should prevent operations on completed workflow', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Complete workflow
      workflowManager.completeWorkflow(workflowId);

      // Attempt operation on completed workflow
      const result = integration.recordOperation(
        'get_page_metadata',
        { pageId: '21' },
        { success: true, data: {} }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('not active');
      }
    });

    it('should allow error recording on inactive workflow', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Complete workflow
      workflowManager.completeWorkflow(workflowId);

      // Error recording should still work
      const result = integration.recordError('Workflow failed during execution');
      expect(result.ok).toBe(true);

      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.errors).toHaveLength(1);
    });
  });

  describe('Multi-Step Business Process', () => {
    it('should track complete sales order creation workflow', () => {
      const integration = new WorkflowIntegration(workflowId);

      // Step 1: Search for Sales Order page
      integration.recordOperation(
        'search_pages',
        { query: 'sales order', type: 'Document' },
        { success: true, data: { resultCount: 1 } }
      );

      // Step 2: Open Sales Order page
      integration.updateCurrentPage('42');
      integration.recordOperation(
        'get_page_metadata',
        { pageId: '42' },
        { success: true, data: { pageContextId: 'session1:page:42:111', pageType: 'Document' } }
      );

      // Step 3: Create new sales order (New action)
      integration.recordOperation(
        'execute_action',
        { pageContextId: 'session1:page:42:111', actionName: 'New' },
        { success: true, data: { actionName: 'New' } }
      );

      // Step 4: Fill header fields
      integration.trackUnsavedChanges({ 'Sell-to Customer No.': '10000', 'Order Date': '2025-01-22' });
      integration.recordOperation(
        'write_page_data',
        { pageContextId: 'session1:page:42:111', fields: { 'Sell-to Customer No.': '10000', 'Order Date': '2025-01-22' } },
        { success: true, data: { updatedFields: ['Sell-to Customer No.', 'Order Date'], fieldCount: 2 } }
      );

      // Step 5: Add line item
      integration.trackUnsavedChanges({ Type: 'Item', 'No.': '1000', Quantity: 5 });
      integration.recordOperation(
        'write_page_data',
        { pageContextId: 'session1:page:42:111', fields: { Type: 'Item', 'No.': '1000', Quantity: 5 }, subpage: 'SalesLines' },
        { success: true, data: { updatedFields: ['Type', 'No.', 'Quantity'], fieldCount: 3 } }
      );

      // Step 6: Post the sales order
      integration.clearUnsavedChanges();
      integration.recordOperation(
        'execute_action',
        { pageContextId: 'session1:page:42:111', actionName: 'Post' },
        { success: true, data: { actionName: 'Post' } }
      );

      // Verify complete workflow
      const workflow = workflowManager.getWorkflow(workflowId);
      expect(workflow!.operations).toHaveLength(6);
      expect(workflow!.currentPageId).toBe('42');
      expect(workflow!.unsavedChanges).toEqual({});
      expect(workflow!.errors).toHaveLength(0);

      // Verify operation sequence
      const tools = workflow!.operations.map(op => op.tool);
      expect(tools).toEqual([
        'search_pages',
        'get_page_metadata',
        'execute_action',
        'write_page_data',
        'write_page_data',
        'execute_action',
      ]);

      // Verify Post action cleared unsaved changes
      expect(workflow!.operations[5].tool).toBe('execute_action');
      expect(workflow!.operations[5].result.data.actionName).toBe('Post');
    });
  });
});
