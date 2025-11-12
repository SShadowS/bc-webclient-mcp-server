/**
 * FormState management types for Business Central forms
 *
 * These types support the LoadForm → Parse → Index → Resolve flow
 * required for field name-based addressing in CRUD operations.
 */

/**
 * Single control/field node in the form's control tree
 */
export interface ControlNode {
  /** Control path (e.g., "server:c[2]/c[1]") */
  path: string;

  /** Control name property if present */
  name?: string;

  /** Localized caption (display name) */
  caption?: string;

  /** AL source expression/field binding (e.g., "Customer.Name") */
  sourceExpr?: string;

  /** Control kind/type (Field, Action, Group, Repeater, FastTab, etc.) */
  kind?: string;

  /** Whether the control is editable */
  editable?: boolean;

  /** Whether the control is visible */
  visible?: boolean;

  /** Whether this is a primary/default action (for buttons) */
  isPrimary?: boolean;

  /** Child controls */
  children: ControlNode[];

  /** Current value if applicable */
  value?: {
    /** Raw value from server */
    raw?: any;
    /** Formatted display string (use this for oldValue!) */
    formatted?: string;
  };

  /** Additional metadata from BC */
  metadata?: Record<string, any>;
}

/**
 * Multi-index for fast field resolution by various keys
 */
export interface FieldIndex {
  /** Normalized caption → controlPath */
  byCaption: Map<string, string>;

  /** Scoped caption "Group>Field" → controlPath */
  byCaptionScoped: Map<string, string>;

  /** Normalized sourceExpr → controlPath */
  bySourceExpr: Map<string, string>;

  /** Normalized name → controlPath */
  byName: Map<string, string>;

  /** Track duplicate captions for disambiguation warnings */
  duplicates: Map<string, string[]>;
}

/**
 * Complete state for a single BC form
 */
export interface FormState {
  /** Form ID from FormToShow event */
  formId: string;

  /** Root control node (optional, may be empty until LoadForm completes) */
  root?: ControlNode;

  /** Fast lookup: controlPath → node */
  pathIndex: Map<string, ControlNode>;

  /** Multi-index for field name resolution */
  fieldIndex: FieldIndex;

  /** Repeater metadata (for list forms) */
  repeater?: {
    /** Column definitions: key → caption/binding */
    columns: Record<string, string>;
  };

  /** Whether LoadForm has completed and indices are built */
  ready: boolean;

  /** Timestamp of last update (for cache invalidation) */
  lastUpdated: Date;
}

/**
 * Field resolution options
 */
export interface FieldResolveOptions {
  /** Prefer editable fields over read-only when disambiguating */
  preferEditable?: boolean;

  /** Prefer visible fields over hidden when disambiguating */
  preferVisible?: boolean;

  /** Require scoped match (don't fall back to unscoped caption) */
  requireScoped?: boolean;
}

/**
 * Field resolution result
 */
export interface FieldResolveResult {
  /** Resolved control path */
  controlPath: string;

  /** The resolved control node */
  node: ControlNode;

  /** Whether this was an ambiguous match (multiple candidates found) */
  ambiguous: boolean;

  /** All matching candidates if ambiguous */
  candidates?: ControlNode[];
}

/**
 * Semantic button intent for dialog interactions
 */
export type ButtonIntent = 'yes' | 'no' | 'ok' | 'cancel' | 'close' | 'accept' | 'reject';

/**
 * Button selection result
 */
export interface ButtonSelectResult {
  /** Control path of the selected button */
  controlPath: string;

  /** Caption of the selected button */
  caption: string;

  /** Whether the selection was ambiguous */
  ambiguous: boolean;

  /** All matching buttons if ambiguous */
  candidates?: { path: string; caption: string }[];
}

/**
 * FormState cache configuration
 */
export interface FormStateCacheConfig {
  /** Maximum number of forms to cache */
  maxSize: number;

  /** Time-to-live in milliseconds (0 = never expire) */
  ttl: number;

  /** Whether to auto-LoadForm on FormToShow */
  autoLoad: boolean;
}

/**
 * Normalize string for case-insensitive, accent-insensitive comparison
 */
export function normalizeKey(s: string | undefined): string {
  if (!s) return '';
  return s
    .trim()
    .toLowerCase()
    .normalize('NFKD')  // Decompose accents
    .replace(/[\u0300-\u036f]/g, '');  // Remove combining marks
}

/**
 * Parse scoped field key (e.g., "Group > Field" or "Group/Field")
 */
export function parseScopedKey(key: string): { scoped: boolean; parts: string[] } {
  const delimiters = [' > ', '>', ' / ', '/'];

  for (const delimiter of delimiters) {
    if (key.includes(delimiter)) {
      const parts = key.split(delimiter).map(p => p.trim()).filter(Boolean);
      return { scoped: true, parts };
    }
  }

  return { scoped: false, parts: [key.trim()] };
}

/**
 * Check if a key uses sourceExpression override syntax ([SourceExpr])
 */
export function isSourceExprKey(key: string): { isSourceExpr: boolean; expr?: string } {
  const match = key.match(/^\[(.+)\]$/);
  if (match) {
    return { isSourceExpr: true, expr: match[1] };
  }
  return { isSourceExpr: false };
}
