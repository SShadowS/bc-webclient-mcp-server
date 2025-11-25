/**
 * PageState Architecture - Type Definitions
 *
 * Stateful, message-driven UI representation for Business Central WebSocket protocol.
 * See: PageState.md v2.0 for full architecture documentation
 *
 * Key Principles:
 * - MUTABLE state (all reducers mutate in-place)
 * - Protocol-driven (no hardcoded structure assumptions)
 * - Map-based collections (fully dynamic)
 * - Bookmark-centric row tracking
 * - Virtualization support (totalRowCount vs rows.size)
 */

// ============================================================================
// Core PageState Types
// ============================================================================

/**
 * Root PageState interface - represents the complete UI state of a BC page
 *
 * Design Notes:
 * - All collections use Maps for dynamic structure
 * - Keys from BC protocol (controlId, formId, name)
 * - No hardcoded assumptions about page structure
 * - Can handle 0-N repeaters, 0-N factboxes
 */
export interface PageState {
  /** Page metadata from LoadForm/OpenForm */
  pageMetadata: PageMetadata;

  /** Top-level fields (header fields for document pages, all fields for card pages) */
  fields: Map<string, FieldState>;

  /** Page actions (Release, Post, New, etc.) */
  actions: Map<string, ActionState>;

  /** Subpages/grids (e.g., SalesLines, ShipmentLines, DimensionLines) */
  repeaters: Map<string, RepeaterState>;

  /** Factbox panels (future Phase 2) */
  factboxes: Map<string, FactboxState>;

  /** Page-level status */
  status: 'Ready' | 'Loading' | 'Saving' | 'Error';

  /** Validation errors, dialogs shown to user */
  globalErrors: string[];
}

/**
 * Page metadata extracted from LoadForm response
 */
export interface PageMetadata {
  /** BC page ID (e.g., "42" for Sales Order) */
  pageId: string;

  /** Page type */
  pageType: 'Card' | 'List' | 'Document';

  /** Page caption (if available) */
  caption?: string;

  /** BC Form ID for this page */
  formId?: string;
}

// ============================================================================
// Field State
// ============================================================================

/**
 * Represents a single field (top-level or in factbox)
 *
 * Design Notes:
 * - controlPath may be undefined until BC realizes the control
 * - Boolean flags default to true if not specified (applied in initFromLoadForm)
 */
export interface FieldState {
  /** Field caption (user-visible label) */
  caption?: string;

  /** Design name (stable identifier, language-independent) */
  designName?: string;

  /** BC control path (e.g., "server:c[0]") - may be undefined until realized */
  controlPath?: string;

  /** Current field value */
  value?: any;

  /** Whether field is enabled */
  enabled: boolean;

  /** Whether field is visible */
  visible: boolean;

  /** Whether field is editable */
  editable: boolean;

  /** BC Control GUID (stable identifier, preferred over designName) */
  controlId?: string;
}

// ============================================================================
// Action State
// ============================================================================

/**
 * Represents a page action (button, menu item)
 */
export interface ActionState {
  /** Action caption (user-visible label) */
  caption: string;

  /** BC SystemAction enum (e.g., 123 = Release, 456 = Post) */
  systemAction?: number;

  /** Whether action is enabled (critical for validation) */
  enabled: boolean;

  /** Whether action is visible */
  visible: boolean;

  /** BC control path (if available) */
  controlPath?: string;

  /** BC Control GUID */
  controlId?: string;

  /** Action icon identifier */
  icon?: string;

  /** Action synopsis/tooltip */
  synopsis?: string;
}

// ============================================================================
// Repeater State (The Core Innovation)
// ============================================================================

/**
 * Represents a repeater control (grid/subpage)
 *
 * CRITICAL DESIGN DECISIONS:
 *
 * 1. Dual Data Structure (rows + rowOrder):
 *    - rows Map: O(1) lookup by bookmark
 *    - rowOrder Array: Maintains BC's display order
 *    - BC grids are ordered lists, not just sets
 *
 * 2. Virtualization Support:
 *    - totalRowCount: Full grid size from BC
 *    - rows.size: ONLY loaded rows (in/near viewport)
 *    - Tools MUST use totalRowCount, not rows.size
 *
 * 3. Concurrency State:
 *    - pendingOperations: Counter for in-flight operations
 *    - Better than single boolean for parallel operations
 *    - isDirty: Tracks unsaved changes
 *    - lastError: Captures validation errors
 */
export interface RepeaterState {
  /** Repeater name (e.g., "SalesLines", "ShipmentLines") */
  name: string;

  /** Repeater caption (e.g., "Lines") */
  caption?: string;

  /** BC control path (e.g., "server:c[2]") */
  controlPath: string;

  /** BC Form ID for RCC message linking */
  formId?: string;

  // --- Metadata ---

  /** Column metadata - Key: designName (stable identifier) */
  columns: Map<string, ColumnState>;

  /** Ordered column keys for maintaining column order */
  orderedColumnKeys?: string[];

  // --- Data ---

  /** Row data - Key: bookmark (random access O(1)) */
  rows: Map<string, RowState>;

  /** Bookmark array (display order) - ONLY loaded rows */
  rowOrder: string[];

  // --- Viewport (Virtualization) ---

  /** Currently loaded viewport range (if virtualized) */
  viewport?: {
    firstVisibleIndex: number;
    lastVisibleIndex: number;
  };

  // --- State ---

  /** Currently active row bookmark */
  cursorBookmark?: string;

  /** Full grid size (NOT just loaded rows) - CRITICAL for tools */
  totalRowCount?: number;

  /** True if local changes haven't been confirmed by DataRefresh */
  isDirty: boolean;

  /** Latest validation error from this repeater */
  lastError?: string;

  /** Count of in-flight SaveValue/actions (better than boolean) */
  pendingOperations: number;
}

// ============================================================================
// Column State
// ============================================================================

/**
 * Represents a column in a repeater
 *
 * CRITICAL: controlPath is undefined until RCC enrichment arrives!
 *
 * Design Notes:
 * - designName is the stable identifier (language-independent)
 * - controlPath comes from RCC messages (progressive enrichment)
 * - index maintains column order
 */
export interface ColumnState {
  /** Column caption (user-visible label) */
  caption?: string;

  /** Design name (stable identifier, use for RowState.values keys) */
  designName?: string;

  /** BC control path - ONLY set when RCC enrichment received */
  controlPath?: string;

  /** Column binder path for filtering (e.g., "36_Sales Line.5054") */
  columnBinderPath?: string;

  /** Column order (0-based) */
  index: number;

  /** BC Control GUID (if available) */
  controlId?: string;

  /** Whether column is visible */
  visible: boolean;

  /** Whether column is editable */
  editable: boolean;
}

// ============================================================================
// Row State
// ============================================================================

/**
 * Represents a single row in a repeater
 *
 * Design Notes:
 * - bookmark is BC's stable row identifier (survives sorts/filters)
 * - values keyed by designName (matches column Map keys)
 * - isNew rows often have temporary bookmarks until saved
 * - Bookmark changes (temp → permanent) handled by remapBookmark reducer
 */
export interface RowState {
  /** BC bookmark (unique row identifier, stable across sorts/filters) */
  bookmark: string;

  /** Cell values - Key: column designName, Value: cell value */
  values: Map<string, any>;

  /** Newly created, not yet saved (may have temp bookmark) */
  isNew?: boolean;

  /** Changed since last load */
  isModified?: boolean;

  /** Field-level validation errors - Key: field designName, Value: error message */
  validationErrors?: Map<string, string>;
}

// ============================================================================
// Factbox State (Future Phase 2)
// ============================================================================

/**
 * Represents a factbox panel
 *
 * Phase 1: Not implemented (focus on repeaters)
 * Phase 2: Add factbox support for complete UI state
 */
export interface FactboxState {
  /** Factbox caption */
  caption?: string;

  /** Factbox fields */
  fields: Map<string, FieldState>;

  /** Whether factbox is visible */
  visible: boolean;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Tri-state return type for getRow() virtualization helper
 *
 * CRITICAL: Distinguish "Data Missing" from "Data Empty"
 * - RowState: Row exists and is loaded
 * - undefined: Row genuinely doesn't exist
 * - 'NOT_LOADED': Row exists but is outside loaded viewport
 */
export type RowLookupResult = RowState | undefined | 'NOT_LOADED';

/**
 * BC Handler Message envelope (from protocol)
 */
export interface BcHandlerMessage {
  handlerType: string;
  parameters: any[];
}
