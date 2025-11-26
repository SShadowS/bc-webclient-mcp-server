/**
 * Control Parser Implementation
 *
 * Walks LogicalForm control tree and extracts field/action metadata.
 * Uses visitor pattern for flexible tree traversal.
 */

import type { IControlParser, IControlVisitor, IControlWalker } from '../core/interfaces.js';
import type {
  LogicalForm,
  Control,
  FieldMetadata,
  ActionMetadata,
  ControlType,
  RepeaterMetadata,
  ColumnMetadata,
} from '../types/bc-types.js';
import { logger } from '../core/logger.js';

/**
 * Field control types (editable data fields).
 */
const FIELD_CONTROL_TYPES: readonly ControlType[] = [
  'sc',   // String Control
  'dc',   // Decimal Control
  'bc',   // Boolean Control
  'i32c', // Integer32 Control
  'sec',  // Select/Enum Control
  'dtc',  // DateTime Control
  'pc',   // Percent Control
] as const;

/**
 * Action control types (buttons and menu items).
 */
const ACTION_CONTROL_TYPES: readonly ControlType[] = [
  'ac',  // Action Control
  'arc', // Action Reference Control
  'fla', // File Action
] as const;

/**
 * Implementation of IControlParser.
 * Extracts fields and actions from LogicalForm control tree.
 */
export class ControlParser implements IControlParser {
  private readonly walker: IControlWalker;

  public constructor(walker: IControlWalker = new ControlWalker()) {
    this.walker = walker;
  }

  /**
   * Walks control tree and returns all controls with their paths.
   *
   * @param logicalForm - The form to parse
   * @returns Flat array of all controls with controlPath property
   */
  public walkControls(logicalForm: LogicalForm): readonly (Control & { controlPath?: string })[] {
    const controls: (Control & { controlPath?: string })[] = [];

    const visitor: IControlVisitor = {
      visit: (control: Control, _depth: number, path?: string) => {
        controls.push({ ...control, controlPath: path });
        return true; // Continue visiting children
      },
    };

    this.walker.walk(logicalForm, visitor);

    return controls;
  }

  /**
   * Extracts field metadata from controls.
   *
   * @param controls - Array of controls to parse
   * @returns Array of field metadata
   */
  public extractFields(controls: readonly Control[]): readonly FieldMetadata[] {
    return controls
      .filter(control => this.isFieldControl(control.t as ControlType))
      .map(control => this.controlToFieldMetadata(control));
  }

  /**
   * Extracts action metadata from controls.
   *
   * @param controls - Array of controls to parse
   * @returns Array of action metadata
   */
  public extractActions(controls: readonly Control[]): readonly ActionMetadata[] {
    return controls
      .filter(control => this.isActionControl(control.t as ControlType))
      .map(control => this.controlToActionMetadata(control))
      .filter((action): action is ActionMetadata => action !== null);
  }

  /**
   * Extracts repeater (subpage) metadata from controls.
   * Repeaters contain line items (e.g., Sales Lines on Sales Order).
   *
   * Handles two patterns:
   * 1. fhc-wrapped subpages (Document lines): fhc (Part name) → lf (Subform) → rc/lrc (Grid)
   * 2. Standalone rc/lrc repeaters (List pages)
   *
   * @param controls - Array of controls to parse
   * @returns Array of repeater metadata with column information
   */
  public extractRepeaters(controls: readonly (Control & { controlPath?: string })[]): readonly RepeaterMetadata[] {
    const repeaters: RepeaterMetadata[] = [];
    const processedGridPaths = new Set<string>();

    // First, extract fhc-wrapped subpages (e.g., "SalesLines" on Sales Order)
    for (const control of controls) {
      if (control.t === 'fhc' && control.DesignName) {
        // Find the nested rc/lrc within this fhc's walked children
        // Look for the first rc/lrc that's a child of a child of this fhc
        // Pattern: fhc (control.controlPath) → lf → rc
        const fhcPath = control.controlPath || '';
        const nestedGrid = controls.find(c =>
          (c.t === 'rc' || c.t === 'lrc') &&
          c.controlPath &&
          c.controlPath.startsWith(fhcPath + '/') &&
          c.controlPath.split('/').length === fhcPath.split('/').length + 2
        );

        if (nestedGrid) {
          logger.info(`[extractRepeaters] Found fhc-wrapped grid: fhc.DesignName=${control.DesignName}, grid.controlPath=${nestedGrid.controlPath}`);
          // Use fhc's DesignName (e.g., "SalesLines") but grid's controlPath for routing
          const metadata = this.controlToRepeaterMetadata(nestedGrid);
          repeaters.push({
            ...metadata,
            name: String(control.DesignName), // Override with fhc name
            caption: control.Caption ? String(control.Caption) : metadata.caption,
          });
          // Mark this grid as processed so we don't duplicate it
          if (nestedGrid.controlPath) {
            processedGridPaths.add(nestedGrid.controlPath);
          }
        }
      }
    }

    // Second, extract standalone rc/lrc repeaters not under fhc (e.g., list pages)
    for (const control of controls) {
      if ((control.t === 'rc' || control.t === 'lrc') && !processedGridPaths.has(control.controlPath || '')) {
        repeaters.push(this.controlToRepeaterMetadata(control));
      }
    }

    return repeaters;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Finds the nested grid (rc/lrc) control within an fhc control.
   * BC structure: fhc → lf (with IsPart/IsSubForm) → rc/lrc
   *
   * @param fhcControl - The Form Heading Control (Part wrapper)
   * @returns The nested rc/lrc grid control with controlPath, or undefined
   */
  private findNestedGrid(fhcControl: Control & { controlPath?: string }): (Control & { controlPath?: string }) | undefined {
    if (!fhcControl.Children || !Array.isArray(fhcControl.Children)) {
      return undefined;
    }

    // Look for lf (Logical Form) child with IsPart and IsSubForm
    // LogicalForm can have IsPart/IsSubForm properties from BC protocol
    type LogicalFormWithPart = Control & { IsPart?: boolean; IsSubForm?: boolean };
    for (const child of fhcControl.Children) {
      const childWithPart = child as LogicalFormWithPart;
      if (child.t === 'lf' && childWithPart.IsPart === true && childWithPart.IsSubForm === true) {
        // Now search for rc/lrc within this subform
        return this.findGridInSubtree(child);
      }
    }

    return undefined;
  }

  /**
   * Recursively searches for rc/lrc control in a subtree.
   *
   * @param control - Control to search within
   * @returns First rc/lrc control found with controlPath, or undefined
   */
  private findGridInSubtree(control: Control & { controlPath?: string }): (Control & { controlPath?: string }) | undefined {
    // Check if this control is a grid
    if (control.t === 'rc' || control.t === 'lrc') {
      return control;
    }

    // Recursively search children
    if (control.Children && Array.isArray(control.Children)) {
      for (const child of control.Children) {
        const found = this.findGridInSubtree(child as Control & { controlPath?: string });
        if (found) {
          return found;
        }
      }
    }

    return undefined;
  }

  /**
   * Checks if control type is a field control.
   */
  private isFieldControl(type: ControlType): boolean {
    return FIELD_CONTROL_TYPES.includes(type as typeof FIELD_CONTROL_TYPES[number]);
  }

  /**
   * Checks if control type is an action control.
   */
  private isActionControl(type: ControlType): boolean {
    return ACTION_CONTROL_TYPES.includes(type as typeof ACTION_CONTROL_TYPES[number]);
  }

  /**
   * Converts a control to field metadata.
   */
  private controlToFieldMetadata(control: Control): FieldMetadata {
    // Control may have controlPath added during tree walk
    type ControlWithPath = Control & { controlPath?: string };
    return {
      type: control.t as ControlType,
      caption: control.Caption ? String(control.Caption) : undefined,
      name: control.DesignName ? String(control.DesignName) : (control.Name ? String(control.Name) : undefined),
      controlId: control.ControlIdentifier ? String(control.ControlIdentifier) : undefined,
      controlPath: (control as ControlWithPath).controlPath,  // CRITICAL: needed for cache updates in write_page_data
      enabled: (control.Enabled ?? true) as boolean,
      visible: (control.Visible ?? true) as boolean,
    };
  }

  /**
   * Converts a control to action metadata.
   */
  private controlToActionMetadata(control: Control & { controlPath?: string }): ActionMetadata | null {
    // Skip actions without captions (internal actions)
    if (!control.Caption) {
      return null;
    }

    // Extended control properties for actions
    type ActionControlExt = Control & {
      Icon?: { Identifier?: string };
      Synopsis?: string;
      SystemAction?: number;
      ActionReference?: { TargetId?: number };
    };
    const actionControl = control as ActionControlExt;

    const iconId = actionControl.Icon?.Identifier;
    const synopsis = actionControl.Synopsis;
    // SystemAction can be directly on control OR in ActionReference.TargetId
    let systemAction = actionControl.SystemAction;
    const actionRef = actionControl.ActionReference;
    if (systemAction === undefined && actionRef?.TargetId !== undefined) {
      systemAction = actionRef.TargetId;
    }

    // Debug: Log action with SystemAction to understand the data
    // Note: Real Release action has Caption "Re&lease" (with &)
    const caption = String(control.Caption);
    // TODO: Re-enable for debugging when not using stdio transport
    // if (caption.toLowerCase().replace(/&/g, '').includes('release')) {
    //   console.log(`[ControlParser] Found Release action: type=${control.t}, Caption=${caption}, SystemAction=${systemAction}, controlPath=${control.controlPath}`);
    //   if (actionRef) console.log(`[ControlParser] ActionReference: ${JSON.stringify(actionRef)}`);
    // }

    return {
      caption: String(control.Caption),
      systemAction,
      enabled: (control.Enabled ?? true) as boolean,
      controlId: control.ControlIdentifier ? String(control.ControlIdentifier) : undefined,
      icon: iconId ? String(iconId) : undefined,
      synopsis: synopsis ? String(synopsis) : undefined,
      controlPath: control.controlPath, // Capture the BC control path
    };
  }

  /**
   * Converts a repeater control to repeater metadata with column information.
   * Passive consumer: reads enriched Columns array if present (from cache),
   * otherwise extracts columns from the Children array of the repeater control.
   */
  private controlToRepeaterMetadata(control: Control & { controlPath?: string }): RepeaterMetadata {
    // Extended repeater control with Columns array and FormId
    type RepeaterColumn = {
      Caption?: string;
      DesignName?: string;
      TemplateControlPath?: string;
      ColumnBinder?: { Name?: string };
    };
    type RepeaterControlExt = Control & {
      controlPath?: string;
      Columns?: RepeaterColumn[];
      FormId?: string | number;
    };
    const repeaterControl = control as RepeaterControlExt;
    const columns: ColumnMetadata[] = [];

    // First, check if control has already-enriched Columns array (from cache)
    // This is the "passive consumer" pattern from GPT-5.1
    if (repeaterControl.Columns && Array.isArray(repeaterControl.Columns)) {
      logger.debug(`[ControlParser] Extracting from Columns array (${repeaterControl.Columns.length} columns)`);

      for (let i = 0; i < repeaterControl.Columns.length; i++) {
        const col = repeaterControl.Columns[i];
        // CRITICAL: Only use TemplateControlPath when provided by BC.
        // DO NOT generate synthetic paths - they will be invalid and cause ArgumentOutOfRangeException.
        // When TemplateControlPath is missing, leave controlPath as undefined so BC can resolve it.
        const columnPath = col.TemplateControlPath ? String(col.TemplateControlPath) : undefined;

        columns.push({
          caption: col.Caption ? String(col.Caption) : undefined,
          designName: col.DesignName ? String(col.DesignName) : undefined,
          controlPath: columnPath,
          columnBinderPath: col.ColumnBinder?.Name ? String(col.ColumnBinder.Name) : undefined,
        });
      }
    }
    // NO FALLBACK: BC protocol ALWAYS provides Columns array for rc/lrc controls.
    // Children array contains UI rendering controls, not column metadata.
    // If Columns is missing, the repeater has no column metadata yet (not realized).

    const result = {
      controlPath: control.controlPath || '', // Required field
      caption: control.Caption ? String(control.Caption) : undefined,
      name: control.DesignName ? String(control.DesignName) : (control.Name ? String(control.Name) : undefined),
      formId: repeaterControl.FormId ? String(repeaterControl.FormId) : undefined,  // Extract FormId for RCC linking
      columns,
    };

    // DIAGNOSTIC
    logger.info(`[controlToRepeaterMetadata] Created repeater metadata: controlPath="${result.controlPath}", name="${result.name}", columns=${result.columns.length}`);
    if (result.columns.length > 0) {
      logger.info(`[controlToRepeaterMetadata] First column: caption="${result.columns[0].caption}", controlPath="${result.columns[0].controlPath}"`);
    }

    return result;
  }
}

/**
 * Implementation of IControlWalker.
 * Walks LogicalForm tree using visitor pattern.
 */
export class ControlWalker implements IControlWalker {
  /**
   * Walks control tree with a visitor.
   *
   * @param logicalForm - The form to walk
   * @param visitor - Visitor to apply to each control
   */
  public walk(logicalForm: LogicalForm, visitor: IControlVisitor): void {
    this.walkControl(logicalForm as unknown as Control, visitor, 0, 'server');
  }

  /**
   * Recursively walks a control and its children.
   * Also walks special action arrays: HeaderActions (/ha[N]) and Actions (/a[N]).
   *
   * CRITICAL: Walk HeaderActions/Actions BEFORE Children
   * BC puts canonical action controls in HeaderActions/Actions arrays.
   * The same actions may also appear in Children (for UI layout), but those
   * paths don't trigger navigation. We must find HeaderActions/Actions first.
   */
  private walkControl(
    control: Control,
    visitor: IControlVisitor,
    depth: number,
    currentPath: string
  ): void {
    // DIAGNOSTIC: Log rc controls with their paths
    // Note: Control uses index signature so dynamic properties are accessible via bracket notation
    if (control.t === 'rc' || control.t === 'lrc') {
      logger.info(`[ControlWalker] Walking ${control.t}: DesignName="${control.DesignName || 'none'}", Caption="${control.Caption || 'none'}", path="${currentPath}"`);
    }

    // Visit current control with path
    const continueWalking = visitor.visit(control, depth, currentPath);

    if (!continueWalking) {
      return;
    }

    // WALK ACTIONS FIRST (before Children)
    // HeaderActions/Actions contain canonical control paths that BC expects.
    // Children may contain duplicate actions with wrong paths.

    // BC path format: server:c[0]/c[1]/c[2] - colon after "server", slashes for rest
    const separator = currentPath === 'server' ? ':' : '/';

    // Walk HeaderActions array (e.g., Edit, View, Delete actions)
    // BC uses /ha[N] notation for these
    // Note: HeaderActions and Actions are BC-specific properties accessed via index signature
    const headerActions = control['HeaderActions'];
    if (headerActions && Array.isArray(headerActions)) {
      for (let i = 0; i < headerActions.length; i++) {
        const actionPath = `${currentPath}${separator}ha[${i}]`;
        this.walkControl(headerActions[i] as Control, visitor, depth + 1, actionPath);
      }
    }

    // Walk Actions array (e.g., other actions)
    // BC uses /a[N] notation for these
    const actions = control['Actions'];
    if (actions && Array.isArray(actions)) {
      for (let i = 0; i < actions.length; i++) {
        const actionPath = `${currentPath}${separator}a[${i}]`;
        this.walkControl(actions[i] as Control, visitor, depth + 1, actionPath);
      }
    }

    // Walk children LAST (after HeaderActions/Actions)
    // BC expects paths like server:c[0]/c[1]/c[2] - colon after server, slashes for nested
    if (control.Children && Array.isArray(control.Children)) {
      for (let i = 0; i < control.Children.length; i++) {
        const childPath = `${currentPath}${separator}c[${i}]`;
        this.walkControl(control.Children[i], visitor, depth + 1, childPath);
      }
    }
  }
}

/**
 * Visitor that collects controls of a specific type.
 */
export class TypeFilterVisitor implements IControlVisitor {
  private readonly controls: (Control & { controlPath?: string })[] = [];

  public constructor(private readonly types: readonly ControlType[]) {}

  public visit(control: Control, _depth?: number, path?: string): boolean {
    if (this.types.includes(control.t as ControlType)) {
      // Attach the controlPath to the control so it can be used later
      this.controls.push({ ...control, controlPath: path });
    }
    return true; // Continue visiting
  }

  public getControls(): readonly (Control & { controlPath?: string })[] {
    return this.controls;
  }
}

/**
 * Visitor that finds a control by ID.
 */
export class FindByIdVisitor implements IControlVisitor {
  private foundControl?: Control;

  public constructor(private readonly controlId: string) {}

  public visit(control: Control): boolean {
    if (control.ControlIdentifier === this.controlId) {
      this.foundControl = control;
      return false; // Stop visiting
    }
    return true; // Continue visiting
  }

  public getControl(): Control | undefined {
    return this.foundControl;
  }
}

/**
 * Visitor that collects control statistics.
 */
export class StatisticsVisitor implements IControlVisitor {
  private readonly typeCounts = new Map<ControlType, number>();
  private totalControls = 0;
  private maxDepth = 0;

  public visit(control: Control, depth: number): boolean {
    this.totalControls++;
    this.maxDepth = Math.max(this.maxDepth, depth);

    const controlType = control.t as ControlType;
    const count = this.typeCounts.get(controlType) ?? 0;
    this.typeCounts.set(controlType, count + 1);

    return true; // Continue visiting
  }

  public getStatistics(): {
    totalControls: number;
    maxDepth: number;
    typeCounts: ReadonlyMap<ControlType, number>;
  } {
    return {
      totalControls: this.totalControls,
      maxDepth: this.maxDepth,
      typeCounts: this.typeCounts,
    };
  }
}
