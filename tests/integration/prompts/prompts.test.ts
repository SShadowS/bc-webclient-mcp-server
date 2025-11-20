/**
 * Integration Tests for MCP Prompts
 *
 * Tests prompt registry, rendering, and MCPServer prompt handlers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MCPServer } from '../../../src/services/mcp-server.js';
import {
  listPrompts,
  getPromptByName,
  renderPrompt,
  buildPromptResult,
} from '../../../src/prompts/index.js';
import { logger } from '../../../src/core/logger.js';
import { isOk } from '../../../src/core/result.js';

describe('MCP Prompts Integration', () => {
  describe('Prompt Registry', () => {
    it('should list all prompts', () => {
      const prompts = listPrompts();

      expect(prompts).toHaveLength(2);

      const names = prompts.map((p) => p.name);
      expect(names).toContain('create_bc_customer');
      expect(names).toContain('update_bc_record');
    });

    it('should get prompt by name', () => {
      const prompt = getPromptByName('create_bc_customer');

      expect(prompt).toBeDefined();
      expect(prompt!.name).toBe('create_bc_customer');
      expect(prompt!.description).toContain('creating a new Business Central customer');
      expect(prompt!.arguments).toHaveLength(3);
    });

    it('should return undefined for non-existent prompt', () => {
      const prompt = getPromptByName('non_existent_prompt');
      expect(prompt).toBeUndefined();
    });
  });

  describe('Prompt Rendering', () => {
    it('should replace {{key}} placeholders', () => {
      const template = 'Hello {{name}}, your email is {{email}}';
      const args = { name: 'Alice', email: 'alice@example.com' };

      const result = renderPrompt(template, args);

      expect(result).toBe('Hello Alice, your email is alice@example.com');
    });

    it('should leave unmatched placeholders as-is', () => {
      const template = 'Hello {{name}}, your {{unknown}} is here';
      const args = { name: 'Bob' };

      const result = renderPrompt(template, args);

      expect(result).toBe('Hello Bob, your {{unknown}} is here');
    });

    it('should handle empty args', () => {
      const template = 'No placeholders here';
      const args = {};

      const result = renderPrompt(template, args);

      expect(result).toBe('No placeholders here');
    });

    it('should handle whitespace in placeholders', () => {
      const template = 'Value: {{ key }}';
      const args = { key: 'test' };

      const result = renderPrompt(template, args);

      expect(result).toBe('Value: test');
    });
  });

  describe('buildPromptResult', () => {
    it('should build complete GetPromptResult', () => {
      const template = getPromptByName('create_bc_customer')!;
      const args = {
        customerName: 'Acme Corp',
        email: 'contact@acme.com',
        phone: '555-1234',
      };

      const result = buildPromptResult(template, args);

      expect(result.name).toBe('create_bc_customer');
      expect(result.description).toContain('creating a new Business Central customer');
      expect(result.arguments).toHaveLength(3);
      expect(result.prompt).toContain('Acme Corp');
      expect(result.prompt).toContain('contact@acme.com');
      expect(result.prompt).toContain('555-1234');
    });
  });

  describe('create_bc_customer Prompt', () => {
    it('should have required arguments', () => {
      const prompt = getPromptByName('create_bc_customer')!;

      const customerName = prompt.arguments.find((a) => a.name === 'customerName');
      expect(customerName).toBeDefined();
      expect(customerName!.required).toBe(true);

      const email = prompt.arguments.find((a) => a.name === 'email');
      expect(email).toBeDefined();
      expect(email!.required).toBe(false);

      const phone = prompt.arguments.find((a) => a.name === 'phone');
      expect(phone).toBeDefined();
      expect(phone!.required).toBe(false);
    });

    it('should include workflow steps', () => {
      const prompt = getPromptByName('create_bc_customer')!;

      expect(prompt.template).toContain('search_pages');
      expect(prompt.template).toContain('get_page_metadata');
      expect(prompt.template).toContain('execute_action');
      expect(prompt.template).toContain('write_page_data');
      expect(prompt.template).toContain('Step 1');
      expect(prompt.template).toContain('Step 2');
    });
  });

  describe('update_bc_record Prompt', () => {
    it('should have required arguments', () => {
      const prompt = getPromptByName('update_bc_record')!;

      const pageId = prompt.arguments.find((a) => a.name === 'pageId');
      expect(pageId).toBeDefined();
      expect(pageId!.required).toBe(true);

      const recordFilter = prompt.arguments.find((a) => a.name === 'recordFilter');
      expect(recordFilter).toBeDefined();
      expect(recordFilter!.required).toBe(true);

      const updates = prompt.arguments.find((a) => a.name === 'updates');
      expect(updates).toBeDefined();
      expect(updates!.required).toBe(true);
    });

    it('should include safety considerations', () => {
      const prompt = getPromptByName('update_bc_record')!;

      expect(prompt.template).toContain('Safety Considerations');
      expect(prompt.template).toContain('verify');
      expect(prompt.template).toContain('read_page_data');
    });
  });

  describe('MCPServer Prompt Handlers', () => {
    let server: MCPServer;

    beforeEach(async () => {
      server = new MCPServer(logger);
      await server.initialize();
    });

    it('should list prompts', async () => {
      const result = await server.handlePromptsList();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.prompts).toHaveLength(2);

      const names = result.value.prompts.map((p) => p.name);
      expect(names).toContain('create_bc_customer');
      expect(names).toContain('update_bc_record');
    });

    it('should get create_bc_customer prompt with arguments', async () => {
      const result = await server.handlePromptGet({
        name: 'create_bc_customer',
        arguments: {
          customerName: 'Test Corp',
          email: 'test@example.com',
          phone: '555-9999',
        },
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.name).toBe('create_bc_customer');
      expect(result.value.prompt).toContain('Test Corp');
      expect(result.value.prompt).toContain('test@example.com');
      expect(result.value.prompt).toContain('555-9999');
    });

    it('should get update_bc_record prompt with arguments', async () => {
      const result = await server.handlePromptGet({
        name: 'update_bc_record',
        arguments: {
          pageId: '21',
          recordFilter: '{"No.": "10000"}',
          updates: '{"Name": "Updated Name"}',
        },
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.name).toBe('update_bc_record');
      expect(result.value.prompt).toContain('21');
      expect(result.value.prompt).toContain('{"No.": "10000"}');
      expect(result.value.prompt).toContain('{"Name": "Updated Name"}');
    });

    it('should handle prompt with missing optional arguments', async () => {
      const result = await server.handlePromptGet({
        name: 'create_bc_customer',
        arguments: {
          customerName: 'Minimal Corp',
        },
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      expect(result.value.prompt).toContain('Minimal Corp');
      expect(result.value.prompt).toContain('{{email}}'); // Unrendered placeholder
      expect(result.value.prompt).toContain('{{phone}}'); // Unrendered placeholder
    });

    it('should return error for non-existent prompt', async () => {
      const result = await server.handlePromptGet({
        name: 'non_existent_prompt',
      });

      expect(isOk(result)).toBe(false);
      if (isOk(result)) return;

      expect(result.error.code).toBe('BC_INTERNAL_ERROR');
      expect(result.error.message).toContain('non_existent_prompt');
      // Verify specific error context
      expect(result.error.context?.code).toBe('PROMPT_NOT_FOUND');
    });

    it('should handle prompts with no arguments', async () => {
      const result = await server.handlePromptGet({
        name: 'create_bc_customer',
      });

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      // All placeholders should remain unrendered
      expect(result.value.prompt).toContain('{{customerName}}');
      expect(result.value.prompt).toContain('{{email}}');
      expect(result.value.prompt).toContain('{{phone}}');
    });
  });

  describe('Protocol Capabilities', () => {
    it('should advertise prompts capability', async () => {
      const server = new MCPServer(logger);
      await server.initialize();

      const initResult = await server.handleInitialize({
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      expect(isOk(initResult)).toBe(true);
      if (!isOk(initResult)) return;

      expect(initResult.value.protocolVersion).toBe('2025-06-18');
      expect(initResult.value.capabilities.prompts).toBeDefined();
    });
  });
});
