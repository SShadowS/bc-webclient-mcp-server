/**
 * MCP Tools Index
 *
 * Exports all available MCP tools for Business Central integration.
 */

export { BaseMCPTool } from './base-tool.js';

// Core MCP Tools (5) - Default tool registry
export { GetPageMetadataTool } from './get-page-metadata-tool.js';
export { SearchPagesTool } from './search-pages-tool.js';
export { ReadPageDataTool } from './read-page-data-tool.js';
export { WritePageDataTool } from './write-page-data-tool.js';
export { ExecuteActionTool } from './execute-action-tool.js';

// Optional/Advanced Tools
export { CreateRecordByFieldNameTool } from './create-record-by-field-name-tool.js';

// Convenience tools moved to optional/ (use at your own discretion)
export { CreateRecordTool } from './optional/create-record-tool.js';
export { UpdateRecordTool } from './optional/update-record-tool.js';

// Removed tools (consolidated):
// - FilterListTool: Functionality merged into read_page_data.filters
// - FindRecordTool: Thin wrapper - compose read_page_data with filters directly
// - update_field: Merged into write_page_data with immediateValidation and controlPath support
// - HandleDialogTool: Was stub implementation violating NO STUBS policy

/**
 * Tool registry for easy initialization.
 *
 * Core tools (5): Essential primitives for BC interaction
 * Optional tools: Convenience wrappers and advanced patterns
 */
export const TOOL_NAMES = {
  // Core tools
  GET_PAGE_METADATA: 'get_page_metadata',
  SEARCH_PAGES: 'search_pages',
  READ_PAGE_DATA: 'read_page_data',
  WRITE_PAGE_DATA: 'write_page_data',
  EXECUTE_ACTION: 'execute_action',

  // Optional/Advanced tools
  CREATE_RECORD_BY_FIELD_NAME: 'create_record_by_field_name',
  CREATE_RECORD: 'create_record',
  UPDATE_RECORD: 'update_record',
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];
