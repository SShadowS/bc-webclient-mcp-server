# Changelog

All notable changes to this project will be documented in this file.

## [2.5.2]

### Fixed

- **handle_dialog Cancel button**: Fixed Cancel/Abbrechen button not working on BC dialogs
  - Cancel now uses `CloseForm` interaction instead of `DialogCancel` (more reliable for dialog dismissal)
  - Works correctly with German localized dialogs ("Abbrechen")

- **handle_dialog OK button**: Fixed OK/Yes/Ja button not working on BC dialogs
  - OK now uses `InvokeAction` with `systemAction: 380` (bc-crud-service pattern)
  - Previously used dynamic `systemAction` extraction which was inconsistent

### Technical Details

- Dialog button click strategies:
  - **Cancel/Abbrechen/No/Nein**: Uses `CloseForm` with `formId: dialogFormId`
  - **OK/Yes/Ja**: Uses `InvokeAction` with `systemAction: 380`, `controlPath: 'dialog:c[0]'`
- Added unit tests documenting the dialog button strategies
- Fallback chain: bc-crud-service pattern → DialogOK/DialogCancel → InvokeAction with dynamic systemAction

## [2.5.1]

### Fixed

- **RCC column TemplateControlPath enrichment**: Fixed extraction of `TemplateControlPath` for repeater columns
  - BC stores `TemplateControlPath` on `CurrentRow.Children` (dc/sc/lc data cells), NOT on rcc column definitions
  - Added `extractTemplateControlPaths()` to build caption→path map from CurrentRow.Children
  - Modified `extractColumnsFromArray()` to enrich columns with paths when CurrentRow is available
  - Verified: 95/101 columns enriched when CurrentRow exists (e.g., after row selection)

### Changed

- **TypeScript type safety**: Replaced `any` types with `unknown` in `rcc-extractor.ts`
  - `isRccMessage()` now uses proper type guards with `unknown` input
  - All internal functions use explicit type assertions

### Technical Details

- Enrichment occurs when BC sends `CurrentRow` (e.g., systemAction 40 "Drill Down")
- Fresh page opens don't have CurrentRow, so enrichment cannot happen initially
- SaveValue operations work via fallback Caption matching when controlPath unavailable

## [2.5.0]

### Added

- **Workflow lifecycle tools**: New tools for tracking multi-step business processes
  - `start_workflow` - Begin tracking a workflow with metadata
  - `get_workflow_state` - Query workflow state, history, and unsaved changes
  - `end_workflow` - Complete workflow with final status (completed/failed/cancelled)
  - Workflow integration across tools via optional `workflowId` parameter

- **Handle Dialog Tool**: Full implementation for BC dialog interactions
  - Template selection dialogs with row filtering (`selection` parameter)
  - Confirmation dialogs with OK/Cancel actions
  - Wait modes: `appear` (wait for dialog) or `existing` (use open dialog)
  - Row selection via bookmark, rowNumber, or rowFilter

- **Subpage/Line operations in `write_page_data`**: Support for document line items
  - `subpage` parameter for targeting repeaters (e.g., "SalesLines")
  - `lineBookmark` for precise line targeting (most reliable)
  - `lineNo` for 1-based line number access
  - Creates new lines when neither lineBookmark nor lineNo provided

- **MCP Resource**: `bc://workflow/all` for workflow introspection
  - Lists all active and recent workflows with state

- **Auto-resolve action controlPath**: `execute_action` auto-lookups controlPath from cached metadata when not provided

### Changed

- **Logging alignment**: Migrated remaining `console.error` in `BCHandlerEventEmitter.ts` to use structured `logger.error`
  - All production code now uses the pino-based logger
  - Ensures clean stdout for MCP JSON-RPC communication

- **Tool count**: Core tools increased from 6 to 10 (7 core + 3 workflow)

## [2.4.0]

### Added

- **Server-side list filtering**: Full implementation of two-step filter protocol (Filter AddLine + SaveValue)
  - Filters execute at database level via BC's ExecuteFilter() → BindingManager.Fill() flow
  - Async DataRefreshChange handlers deliver already-filtered datasets
  - Support for equality, range, contains, startsWith operators
  - Filter state caching to prevent redundant operations
  - Pre-formatted filterColumnId extraction from LogicalForm ColumnBinderPath

### Fixed

- **Critical async timing bug**: Set up `waitForHandlers` promise BEFORE triggering Filter/SaveValue interactions (not after)
  - Previous implementation missed DataRefreshChange events by setting up listener too late
  - Now correctly captures filtered data by establishing listener first
- **TypeScript type error**: Fixed `waitForHandlers` predicate to return `{ matched: boolean; data?: unknown }` instead of boolean

### Changed

- **FieldMetadata interface**: Added `filterColumnId` field for filter column identification
- **extractFieldMetadata()**: Now extracts from repeater control (`t: 'rc'`) Columns array with ColumnBinderPath
- **applyFilters()**: Complete refactor with proper async timing and two-step protocol implementation

### Documentation

- **BC_PROTOCOL_PATTERNS.md**: Added Pattern 7 - List Filtering with Server-Side Execution
- **CLAUDE.md**: Updated Pattern #6 with implementation status and correct async timing examples
- **FILTER_IMPLEMENTATION_SUMMARY.md**: New comprehensive implementation summary

### Testing

- **test-filter-execution-flow.ts**: Comprehensive filter testing (4/4 tests passing)
  - Equality filters: "No." = "101002", "No." = "101005"
  - Range filter: "No." >= "101007"
- **Integration tests**: Phase 1 tests pass (10/10) with no regressions

## [2.2.0]

### Fixed

- **Cached handlers validation**: Added `hasDataHandlers` check to verify cached handlers contain actual data (DataRefreshChange/PropertyChanges), not just metadata
- **Card page PropertyChanges**: Now calls `applyPropertyChangesToLogicalForm()` before extracting card data to ensure field values are populated
- **Record flattening**: Fixed record structure to return plain `{fieldName: value}` instead of `{fields: {fieldName: FieldValue}}` for both Card and List pages

### Changed

- **Improved cache usage logic**: `read_page_data` now calls LoadForm when cached handlers lack data, even if not marked for refresh
- **Fixed logging levels**: Changed misused `logger.error` calls to appropriate levels (`info`/`debug`/`warn`) in BCPageConnection, LoadFormHelpers, and PageMetadataParser
- **Removed emojis from logs**: Replaced emojis with plain text to fix encoding issues on Windows

## [2.1.0]

### Added

- **`systemAction` support in `execute_action` tool**: Execute system-level actions like "Release", "Post", "New" that are not bound to specific controls
- **Filter support in `read_page_data` tool**: Apply filters when reading page data to retrieve specific records
- **Page refresh after actions**: `read_page_data` automatically refreshes data when called after action execution via `needsRefresh` flag
- **Enhanced async handler accumulation**: Improved WebSocket client to properly accumulate handlers from multiple async Message events

### Changed

- **Improved action execution flow**: Better handling of action responses and async handlers
- **Enhanced page data extraction**: More robust parsing of BC response handlers
- **Control parser improvements**: Better resolution of control paths and action bindings

### Fixed

- **TypeScript error**: Added missing `callbackId` property to LoadForm interaction call

## [2.0.0]

### Added

- **MCP Resources**: Three read-only contextual resources for AI assistants
  - `bc://docs/workflow-patterns` - Workflow documentation
  - `bc://schema/pages` - BC page catalog (16+ pages)
  - `bc://session/current` - Real-time session state

- **MCP Prompts**: Parameterized workflow templates
  - `create_bc_customer` - Customer creation workflow
  - `update_bc_record` - Safe record update workflow

- **Comprehensive test suite**: Unit and integration tests for all major components
- **MIT License**: Open source licensing

### Changed

- Project renamed to "BC WebClient MCP"
- Updated to MCP protocol version 2025-06-18
- Improved README with Version 2 highlights

### Tools

Full MCP tool suite:
- `search_pages` - Tell Me search functionality
- `get_page_metadata` - Page structure and field discovery
- `read_page_data` - Read records from BC pages
- `write_page_data` - Update field values with validation
- `execute_action` - Execute page actions
- `select_and_drill_down` - Navigate between pages
- `close_page` - Clean up page sessions
