/**
 * Integration Tests for MCP Resources
 *
 * Tests all MCP resources (workflow docs, page schema, session state).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MCPServer } from '../../../src/services/mcp-server.js';
import { buildResources } from '../../../src/resources/index.js';
import { WorkflowPatternsDocResource } from '../../../src/resources/docs-workflow-patterns-resource.js';
import { BCSchemaPagesResource } from '../../../src/resources/schema-pages-resource.js';
import { BCSessionStateResource } from '../../../src/resources/session-current-resource.js';
import { SessionStateManager } from '../../../src/services/session-state-manager.js';
import { logger } from '../../../src/core/logger.js';
import { isOk } from '../../../src/core/result.js';

describe('MCP Resources Integration', () => {
  describe('buildResources', () => {
    it('should return all three resources', () => {
      const resources = buildResources({ logger });

      expect(resources).toHaveLength(3);

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('bc://docs/workflow-patterns');
      expect(uris).toContain('bc://schema/pages');
      expect(uris).toContain('bc://session/current');
    });
  });

  describe('MCPServer Resource Handling', () => {
    let server: MCPServer;

    beforeEach(async () => {
      server = new MCPServer(logger);
      await server.initialize();

      // Register all resources
      for (const resource of buildResources({ logger })) {
        server.registerResource(resource);
      }
    });

    it('should list all registered resources', async () => {
      const listResult = await server.handleResourcesList();

      expect(isOk(listResult)).toBe(true);
      if (!isOk(listResult)) return;

      expect(listResult.value.resources).toHaveLength(3);

      const uris = listResult.value.resources.map((r) => r.uri);
      expect(uris).toContain('bc://docs/workflow-patterns');
      expect(uris).toContain('bc://schema/pages');
      expect(uris).toContain('bc://session/current');
    });

    it('should read workflow patterns resource', async () => {
      const readResult = await server.handleResourceRead({
        uri: 'bc://docs/workflow-patterns',
      });

      expect(isOk(readResult)).toBe(true);
      if (!isOk(readResult)) return;

      expect(readResult.value.contents).toContain('BC MCP Workflow Patterns');
      expect(readResult.value.contents).toContain('Creating a New Customer');
      expect(readResult.value.contents).toContain('search_pages');
      expect(readResult.value.contents).toContain('get_page_metadata');
    });

    it('should read page schema resource', async () => {
      const readResult = await server.handleResourceRead({ uri: 'bc://schema/pages' });

      expect(isOk(readResult)).toBe(true);
      if (!isOk(readResult)) return;

      const data = JSON.parse(readResult.value.contents);

      expect(data.pages).toBeDefined();
      expect(Array.isArray(data.pages)).toBe(true);
      expect(data.pages.length).toBeGreaterThan(0);

      // Check for common pages
      const customerCard = data.pages.find((p: any) => p.pageId === '21');
      expect(customerCard).toBeDefined();
      expect(customerCard.name).toBe('Customer Card');
      expect(customerCard.type).toBe('Card');

      const customerList = data.pages.find((p: any) => p.pageId === '22');
      expect(customerList).toBeDefined();
      expect(customerList.name).toBe('Customer List');
      expect(customerList.type).toBe('List');
    });

    it('should read session state resource', async () => {
      const readResult = await server.handleResourceRead({ uri: 'bc://session/current' });

      expect(isOk(readResult)).toBe(true);
      if (!isOk(readResult)) return;

      const data = JSON.parse(readResult.value.contents);

      expect(data.timestamp).toBeDefined();
      expect(data.sessionCount).toBeDefined();
      expect(data.totalOpenPages).toBeDefined();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it('should return error for non-existent resource', async () => {
      const readResult = await server.handleResourceRead({ uri: 'bc://invalid/resource' });

      expect(isOk(readResult)).toBe(false);
      if (isOk(readResult)) return;

      expect(readResult.error.message).toContain('not found');
    });
  });

  describe('WorkflowPatternsDocResource', () => {
    it('should return markdown documentation', async () => {
      const resource = new WorkflowPatternsDocResource();

      expect(resource.uri).toBe('bc://docs/workflow-patterns');
      expect(resource.mimeType).toBe('text/markdown');

      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const content = result.value;
      expect(content).toContain('# BC MCP Workflow Patterns');
      expect(content).toContain('Creating a New Customer');
      expect(content).toContain('Reading List Data');
      expect(content).toContain('Best Practices');
    });
  });

  describe('BCSchemaPagesResource', () => {
    it('should return JSON page schema', async () => {
      const resource = new BCSchemaPagesResource(logger);

      expect(resource.uri).toBe('bc://schema/pages');
      expect(resource.mimeType).toBe('application/json');

      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const data = JSON.parse(result.value);
      expect(data.version).toBe('1.0');
      expect(data.pageCount).toBeGreaterThan(0);
      expect(data.pages).toBeDefined();
    });

    it('should include customer, item, and vendor pages', async () => {
      const resource = new BCSchemaPagesResource(logger);
      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const data = JSON.parse(result.value);
      const pages = data.pages;

      const pageIds = pages.map((p: any) => p.pageId);

      expect(pageIds).toContain('21'); // Customer Card
      expect(pageIds).toContain('22'); // Customer List
      expect(pageIds).toContain('30'); // Item Card
      expect(pageIds).toContain('31'); // Item List
      expect(pageIds).toContain('26'); // Vendor Card
      expect(pageIds).toContain('27'); // Vendor List
    });
  });

  describe('BCSessionStateResource', () => {
    beforeEach(() => {
      // Reset session manager before each test
      SessionStateManager.resetInstance();
    });

    it('should return empty sessions initially', async () => {
      const resource = new BCSessionStateResource(logger);

      expect(resource.uri).toBe('bc://session/current');
      expect(resource.mimeType).toBe('application/json');

      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const data = JSON.parse(result.value);
      expect(data.sessionCount).toBe(0);
      expect(data.totalOpenPages).toBe(0);
      expect(data.sessions).toEqual([]);
    });

    it('should reflect sessions added to SessionStateManager', async () => {
      const manager = SessionStateManager.getInstance(logger);
      const resource = new BCSessionStateResource(logger);

      // Create a session and add a page
      const session = manager.createSession();
      manager.addOpenPage(session.sessionId, 'ctx-123', '21', 'Card');

      const result = await resource.read();

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const data = JSON.parse(result.value);
      expect(data.sessionCount).toBe(1);
      expect(data.totalOpenPages).toBe(1);
      expect(data.sessions).toHaveLength(1);

      const returnedSession = data.sessions[0];
      expect(returnedSession.sessionId).toBe(session.sessionId);
      expect(returnedSession.openPages).toHaveLength(1);
      expect(returnedSession.openPages[0].pageContextId).toBe('ctx-123');
      expect(returnedSession.openPages[0].pageId).toBe('21');
      expect(returnedSession.openPages[0].pageType).toBe('Card');
    });
  });

  describe('SessionStateManager', () => {
    beforeEach(() => {
      SessionStateManager.resetInstance();
    });

    it('should create sessions with unique IDs', () => {
      const manager = SessionStateManager.getInstance(logger);

      const session1 = manager.createSession();
      const session2 = manager.createSession();

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(manager.getSessionCount()).toBe(2);
    });

    it('should track open pages', () => {
      const manager = SessionStateManager.getInstance(logger);
      const session = manager.createSession();

      manager.addOpenPage(session.sessionId, 'ctx-1', '21', 'Card');
      manager.addOpenPage(session.sessionId, 'ctx-2', '22', 'List');

      const snapshot = manager.getSnapshot();
      expect(snapshot.sessions).toHaveLength(1);
      expect(snapshot.sessions[0].openPages).toHaveLength(2);
    });

    it('should close pages', () => {
      const manager = SessionStateManager.getInstance(logger);
      const session = manager.createSession();

      manager.addOpenPage(session.sessionId, 'ctx-1', '21', 'Card');
      manager.addOpenPage(session.sessionId, 'ctx-2', '22', 'List');

      manager.closePage('ctx-1');

      const snapshot = manager.getSnapshot();
      expect(snapshot.sessions[0].openPages).toHaveLength(1);
      expect(snapshot.sessions[0].openPages[0].pageContextId).toBe('ctx-2');
    });

    it('should close sessions', () => {
      const manager = SessionStateManager.getInstance(logger);
      const session = manager.createSession();

      manager.addOpenPage(session.sessionId, 'ctx-1', '21', 'Card');
      expect(manager.getSessionCount()).toBe(1);

      manager.closeSession(session.sessionId);
      expect(manager.getSessionCount()).toBe(0);
    });

    it('should get all open pages across sessions', () => {
      const manager = SessionStateManager.getInstance(logger);

      const session1 = manager.createSession();
      const session2 = manager.createSession();

      manager.addOpenPage(session1.sessionId, 'ctx-1', '21', 'Card');
      manager.addOpenPage(session2.sessionId, 'ctx-2', '22', 'List');

      const allPages = manager.getAllOpenPages();
      expect(allPages).toHaveLength(2);
    });
  });
});
