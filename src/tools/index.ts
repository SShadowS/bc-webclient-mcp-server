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
export { UpdateFieldTool } from './update-field-tool.js';
export { FilterListTool } from './filter-list-tool.js';
export { CreateRecordTool } from './create-record-tool.js';
export { UpdateRecordTool } from './update-record-tool.js';
export { FindRecordTool } from './find-record-tool.js';
// HandleDialogTool removed - was stub implementation violating NO STUBS policy
// Dialog handling requires complex event-driven detection, structure parsing, and control path resolution
// Use execute_action + update_field as workaround until proper implementation available
// export { HandleDialogTool } from './handle-dialog-tool.js';

/**
 * Tool registry for easy initialization.
 */
export const TOOL_NAMES = {
  GET_PAGE_METADATA: 'get_page_metadata',
  SEARCH_PAGES: 'search_pages',
  READ_PAGE_DATA: 'read_page_data',
  WRITE_PAGE_DATA: 'write_page_data',
  EXECUTE_ACTION: 'execute_action',
  UPDATE_FIELD: 'update_field',
  FILTER_LIST: 'filter_list',
  CREATE_RECORD: 'create_record',
  UPDATE_RECORD: 'update_record',
  FIND_RECORD: 'find_record',
  // HANDLE_DIALOG removed - see comment above
  // HANDLE_DIALOG: 'handle_dialog',
} as const;

export type ToolName = typeof TOOL_NAMES[keyof typeof TOOL_NAMES];
