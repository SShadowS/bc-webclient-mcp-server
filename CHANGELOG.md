# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2025-11-21

### Fixed

- **Cached handlers validation**: Added `hasDataHandlers` check to verify cached handlers contain actual data (DataRefreshChange/PropertyChanges), not just metadata
- **Card page PropertyChanges**: Now calls `applyPropertyChangesToLogicalForm()` before extracting card data to ensure field values are populated
- **Record flattening**: Fixed record structure to return plain `{fieldName: value}` instead of `{fields: {fieldName: FieldValue}}` for both Card and List pages

### Changed

- **Improved cache usage logic**: `read_page_data` now calls LoadForm when cached handlers lack data, even if not marked for refresh
- **Better logging**: Added descriptive messages for cache hit/miss scenarios

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
