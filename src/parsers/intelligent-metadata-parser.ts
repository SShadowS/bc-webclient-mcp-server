/**
 * Intelligent Metadata Parser
 *
 * Reduces BC response from ~729KB to ~15-20KB by:
 * 1. Filtering non-essential fields (system fields, hidden controls)
 * 2. Summarizing actions into simple enabled/disabled lists
 * 3. Extracting semantic meaning and key information
 * 4. Removing redundant metadata
 *
 * Goal: Give LLMs only the actionable, semantic data they need.
 */

import type { Result } from '../core/result.js';
import { ok, andThen } from '../core/result.js';
import type { Handler, PageMetadata, FieldMetadata, ActionMetadata } from '../types/bc-types.js';
import type { BCError } from '../core/errors.js';
import { PageMetadataParser } from './page-metadata-parser.js';

// ============================================================================
// Optimized Types for LLM Consumption
// ============================================================================

/**
 * Minimal field metadata optimized for LLM understanding.
 */
export interface OptimizedField {
  /** Field name (e.g., "No.") */
  readonly name: string;
  /** User-friendly type (text, number, date, boolean, option) */
  readonly type: string;
  /** Whether field can be edited */
  readonly editable: boolean;
  /** Optional: For option/enum fields */
  readonly options?: readonly string[];
}

/**
 * Simplified action groups.
 */
export interface OptimizedActions {
  /** Actions currently enabled */
  readonly enabled: readonly string[];
  /** Actions currently disabled (useful for context) */
  readonly disabled: readonly string[];
}

/**
 * Semantic page summary for LLM understanding.
 */
export interface PageSummary {
  /** What this page does in plain language */
  readonly purpose: string;
  /** Key capabilities (create, read, update, delete, post, etc.) */
  readonly capabilities: readonly string[];
  /** Most important fields users typically interact with */
  readonly keyFields: readonly string[];
}

/**
 * Optimized page metadata - 90%+ smaller than raw BC response.
 */
export interface OptimizedPageMetadata {
  /** Page ID */
  readonly pageId: string;
  /** Page title */
  readonly title: string;
  /** Semantic summary of the page */
  readonly summary: PageSummary;
  /** Essential visible fields only */
  readonly fields: readonly OptimizedField[];
  /** Simplified action lists */
  readonly actions: OptimizedActions;
  /** Total field/action counts for reference */
  readonly stats: {
    readonly totalFields: number;
    readonly visibleFields: number;
    readonly totalActions: number;
    readonly enabledActions: number;
  };
}

// ============================================================================
// System Field Patterns to Filter Out
// ============================================================================

/** Fields that are system-managed and rarely needed by LLMs */
const SYSTEM_FIELD_PATTERNS = [
  /^SystemId$/i,
  /^SystemCreatedAt$/i,
  /^SystemCreatedBy$/i,
  /^SystemModifiedAt$/i,
  /^SystemModifiedBy$/i,
  /^timestamp$/i,
  /^Last Date Modified$/i,
  /^Last Modified Date Time$/i,
  /^Id$/i,
  /GUID$/i,
];

/** Control types to exclude (internal/system controls) */
const EXCLUDED_CONTROL_TYPES = new Set([
  'fhc', // FormHostControl
  'stackc', // StackLogicalControl
  'stackgc', // StackGroupLogicalControl
  'gc', // GroupControl (layout only)
  'ssc', // StaticStringControl (labels)
]);

// ============================================================================
// Page Type to Capability Mapping
// ============================================================================

/** Maps page types to their typical capabilities */
const PAGE_CAPABILITIES: Record<string, string[]> = {
  'Card': ['read', 'update', 'create', 'delete'],
  'List': ['read', 'browse', 'filter', 'sort'],
  'Document': ['read', 'update', 'post', 'print'],
  'Worksheet': ['read', 'update', 'calculate'],
  'ListPlus': ['read', 'browse', 'drill-down'],
};

// ============================================================================
// Intelligent Metadata Parser
// ============================================================================

/**
 * Parses BC metadata and optimizes it for LLM consumption.
 * Dramatically reduces size while preserving semantic meaning.
 */
export class IntelligentMetadataParser {
  private readonly baseParser: PageMetadataParser;

  public constructor(baseParser: PageMetadataParser = new PageMetadataParser()) {
    this.baseParser = baseParser;
  }

  /**
   * Parses and optimizes page metadata.
   */
  public parse(handlers: readonly Handler[]): Result<OptimizedPageMetadata, BCError> {
    // Use base parser to extract raw metadata
    const rawResult = this.baseParser.parse(handlers);

    // Transform to optimized format
    return andThen(rawResult, raw => {
      const optimized: OptimizedPageMetadata = {
        pageId: raw.pageId,
        title: raw.caption,
        summary: this.generateSummary(raw),
        fields: this.optimizeFields(raw.fields),
        actions: this.optimizeActions(raw.actions),
        stats: {
          totalFields: raw.fields.length,
          visibleFields: this.optimizeFields(raw.fields).length,
          totalActions: raw.actions.length,
          enabledActions: raw.actions.filter(a => a.enabled).length,
        },
      };

      return ok(optimized);
    });
  }

  // ============================================================================
  // Field Optimization
  // ============================================================================

  /**
   * Filters and optimizes fields for LLM consumption.
   * Removes ONLY fields the user cannot see or interact with:
   * - System fields (SystemId, timestamps, etc.)
   * - Hidden/disabled fields (enabled=false)
   * - Internal controls (groups, containers, layout)
   *
   * Keeps ALL fields a user can see in the BC UI.
   * Agent must have same capabilities as human user.
   */
  private optimizeFields(fields: readonly FieldMetadata[]): OptimizedField[] {
    return fields
      .filter(field => this.isEssentialField(field))
      .map(field => this.toOptimizedField(field));
      // NO arbitrary limit - keep all visible fields
  }

  /**
   * Determines if a field is essential (not system/hidden).
   */
  private isEssentialField(field: FieldMetadata): boolean {
    // Must have a name
    if (!field.name && !field.caption) {
      return false;
    }

    const fieldName = field.name || field.caption || '';

    // Filter out system fields
    if (SYSTEM_FIELD_PATTERNS.some(pattern => pattern.test(fieldName))) {
      return false;
    }

    // Filter out internal control types
    if (EXCLUDED_CONTROL_TYPES.has(field.type)) {
      return false;
    }

    // Filter out disabled/hidden fields (usually not relevant)
    if (!field.enabled) {
      return false;
    }

    return true;
  }

  /**
   * Converts raw field metadata to optimized format.
   */
  private toOptimizedField(field: FieldMetadata): OptimizedField {
    const baseOptimized: OptimizedField = {
      name: field.caption || field.name || 'Unnamed',
      type: this.simplifyFieldType(field.type),
      editable: field.enabled && !field.readonly,
    };

    // Include options for selection fields
    if (field.options && field.options.length > 0 && field.options.length <= 20) {
      return {
        ...baseOptimized,
        options: field.options,
      };
    }

    return baseOptimized;
  }

  /**
   * Converts BC control type to user-friendly type.
   */
  private simplifyFieldType(controlType: string): string {
    const typeMap: Record<string, string> = {
      'sc': 'text',
      'dc': 'number',
      'bc': 'boolean',
      'i32c': 'number',
      'i64c': 'number',
      'sec': 'option',
      'dtc': 'date',
      'pc': 'number',
      'nuc': 'number',
      'ic': 'number',
      'chc': 'text',
    };

    return typeMap[controlType] || 'text';
  }

  // ============================================================================
  // Action Optimization
  // ============================================================================

  /**
   * Simplifies actions into enabled/disabled lists.
   * Much more concise than full action metadata.
   * Keeps ALL actions visible to user (no arbitrary limits).
   */
  private optimizeActions(actions: readonly ActionMetadata[]): OptimizedActions {
    const enabled: string[] = [];
    const disabled: string[] = [];

    for (const action of actions) {
      const name = action.caption || 'Unnamed';

      // Skip internal/empty actions
      if (!name || name.trim() === '') {
        continue;
      }

      if (action.enabled) {
        enabled.push(name);
      } else {
        disabled.push(name);
      }
    }

    return {
      enabled,   // All enabled actions user can see
      disabled,  // All disabled actions (for context)
    };
  }

  // ============================================================================
  // Semantic Summary Generation
  // ============================================================================

  /**
   * Generates semantic summary of the page.
   * Helps LLMs understand the page's purpose and capabilities.
   */
  private generateSummary(metadata: PageMetadata): PageSummary {
    // Infer page type from caption and ID
    const pageType = this.inferPageType(metadata.caption, metadata.pageId);

    // Get capabilities for this page type
    const capabilities = PAGE_CAPABILITIES[pageType] || ['read', 'update'];

    // Identify key fields (first 5 editable fields)
    const keyFields = metadata.fields
      .filter(f => f.enabled && !f.readonly)
      .slice(0, 5)
      .map(f => f.caption || f.name || '')
      .filter(name => name !== '');

    return {
      purpose: this.generatePurpose(metadata.caption, pageType),
      capabilities,
      keyFields,
    };
  }

  /**
   * Infers page type from caption and ID.
   */
  private inferPageType(caption: string, pageId: string): string {
    const lower = caption.toLowerCase();

    if (lower.includes('card')) return 'Card';
    if (lower.includes('list')) return 'List';
    if (lower.includes('document') || lower.includes('order') || lower.includes('invoice')) return 'Document';
    if (lower.includes('worksheet') || lower.includes('journal')) return 'Worksheet';

    // Infer from page ID ranges (BC convention)
    const id = parseInt(pageId, 10);
    if (id >= 20 && id < 50) return 'Card';
    if (id >= 1 && id < 20) return 'List';

    return 'Card'; // Default
  }

  /**
   * Generates a purpose description.
   */
  private generatePurpose(caption: string, pageType: string): string {
    const verbMap: Record<string, string> = {
      'Card': 'View and edit',
      'List': 'Browse and select',
      'Document': 'Create and process',
      'Worksheet': 'Enter and calculate',
    };

    const verb = verbMap[pageType] || 'Manage';

    return `${verb} ${caption.replace(/(Card|List|Document|Worksheet)/gi, '').trim()}`;
  }
}
