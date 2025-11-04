/**
 * MCP Tools Index
 *
 * Exports all available MCP tools for Business Central integration.
 */

export { BaseMCPTool } from './base-tool.js';
export { GetPageMetadataTool } from './get-page-metadata-tool.js';
export { SearchPagesTool } from './search-pages-tool.js';
export { ReadPageDataTool } from './read-page-data-tool.js';
export { WritePageDataTool } from './write-page-data-tool.js';
export { ExecuteActionTool } from './execute-action-tool.js';
export { FilterListTool } from './filter-list-tool.js';
export { CreateRecordTool } from './create-record-tool.js';
export { UpdateRecordTool } from './update-record-tool.js';
export { FindRecordTool } from './find-record-tool.js';
// update_field removed - functionality merged into write_page_data with immediateValidation and controlPath support
// HandleDialogTool removed - was stub implementation violating NO STUBS policy
// Dialog handling requires complex event-driven detection, structure parsing, and control path resolution
// Use execute_action + write_page_data as workaround until proper implementation available

/**
 * Tool registry for easy initialization.
 */
export const TOOL_NAMES = {
  GET_PAGE_METADATA: 'get_page_metadata',
  SEARCH_PAGES: 'search_pages',
  READ_PAGE_DATA: 'read_page_data',
  WRITE_PAGE_DATA: 'write_page_data',
  EXECUTE_ACTION: 'execute_action',
  FILTER_LIST: 'filter_list',
  CREATE_RECORD: 'create_record',
  UPDATE_RECORD: 'update_record',
  FIND_RECORD: 'find_record',
  // UPDATE_FIELD removed - merged into write_page_data
  // HANDLE_DIALOG removed - see comment above
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];
