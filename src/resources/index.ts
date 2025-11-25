/**
 * Resource Registry
 *
 * Centralized registry for all MCP resources.
 * Provides factory function to build the list of resources for MCPServer.
 */

import type { IMCPResource, ILogger } from '../core/interfaces.js';
import { WorkflowPatternsDocResource } from './docs-workflow-patterns-resource.js';
import { BCSchemaPagesResource } from './schema-pages-resource.js';
import { BCSessionStateResource } from './session-current-resource.js';
import { BCWorkflowAllResource } from './workflow-all-resource.js';

/**
 * Context for resource factory.
 */
export interface ResourceFactoryContext {
  readonly logger?: ILogger;
}

/**
 * Builds the list of resources to register with MCPServer.
 *
 * This function creates all available MCP resources with the provided context.
 * Resources are stateless and can be safely shared across requests.
 *
 * @param ctx - Optional context with logger
 * @returns Array of IMCPResource implementations
 */
export function buildResources(ctx: ResourceFactoryContext = {}): IMCPResource[] {
  const resources: IMCPResource[] = [];

  // Documentation resources
  resources.push(new WorkflowPatternsDocResource());

  // Schema resources
  resources.push(new BCSchemaPagesResource(ctx.logger));

  // Session introspection resources
  resources.push(new BCSessionStateResource(ctx.logger));

  // Workflow introspection resources
  resources.push(new BCWorkflowAllResource(ctx.logger));

  return resources;
}

// Re-export resource classes for direct usage if needed
export { WorkflowPatternsDocResource } from './docs-workflow-patterns-resource.js';
export { BCSchemaPagesResource } from './schema-pages-resource.js';
export { BCSessionStateResource } from './session-current-resource.js';
export { BCWorkflowAllResource } from './workflow-all-resource.js';
