# Changelog

All notable changes to this project will be documented in this file.

## [2.4.0] - 2025-01-22

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

## [2.2.0] - 2025-11-21

### Fixed

- **Cached handlers validation**: Added `hasDataHandlers` check to verify cached handlers contain actual data (DataRefreshChange/PropertyChanges), not just metadata
- **Card page PropertyChanges**: Now calls `applyPropertyChangesToLogicalForm()` before extracting card data to ensure field values are populated
- **Record flattening**: Fixed record structure to return plain `{fieldName: value}` instead of `{fields: {fieldName: FieldValue}}` for both Card and List pages

### Changed

- **Improved cache usage logic**: `read_page_data` now calls LoadForm when cached handlers lack data, even if not marked for refresh
- **Fixed logging levels**: Changed misused `logger.error` calls to appropriate levels (`info`/`debug`/`warn`) in BCPageConnection, LoadFormHelpers, and PageMetadataParser
- **Removed emojis from logs**: Replaced emojis with plain text to fix encoding issues on Windows

## [2.1.0] - 2025-11-21

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

## [2.0.0] - 2025-11-20

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
