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
} from '../types/bc-types.js';

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

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

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
    return {
      type: control.t as ControlType,
      caption: control.Caption ? String(control.Caption) : undefined,
      name: control.DesignName ? String(control.DesignName) : (control.Name ? String(control.Name) : undefined),
      controlId: control.ControlIdentifier ? String(control.ControlIdentifier) : undefined,
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

    const iconId = (control as { Icon?: { Identifier?: string } }).Icon?.Identifier;
    const synopsis = (control as { Synopsis?: string }).Synopsis;

    return {
      caption: String(control.Caption),
      systemAction: (control as { SystemAction?: number }).SystemAction,
      enabled: (control.Enabled ?? true) as boolean,
      controlId: control.ControlIdentifier ? String(control.ControlIdentifier) : undefined,
      icon: iconId ? String(iconId) : undefined,
      synopsis: synopsis ? String(synopsis) : undefined,
      controlPath: control.controlPath, // Capture the BC control path
    };
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
   * ⚠️ CRITICAL: Walk HeaderActions/Actions BEFORE Children
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
    // Visit current control with path
    const continueWalking = visitor.visit(control, depth, currentPath);

    if (!continueWalking) {
      return;
    }

    // ⚠️ WALK ACTIONS FIRST (before Children)
    // HeaderActions/Actions contain canonical control paths that BC expects.
    // Children may contain duplicate actions with wrong paths.

    // Walk HeaderActions array (e.g., Edit, View, Delete actions)
    // BC uses /ha[N] notation for these
    const headerActions = (control as any).HeaderActions;
    if (headerActions && Array.isArray(headerActions)) {
      for (let i = 0; i < headerActions.length; i++) {
        const actionPath = `${currentPath}/ha[${i}]`;
        this.walkControl(headerActions[i], visitor, depth + 1, actionPath);
      }
    }

    // Walk Actions array (e.g., other actions)
    // BC uses /a[N] notation for these
    const actions = (control as any).Actions;
    if (actions && Array.isArray(actions)) {
      for (let i = 0; i < actions.length; i++) {
        const actionPath = `${currentPath}/a[${i}]`;
        this.walkControl(actions[i], visitor, depth + 1, actionPath);
      }
    }

    // Walk children LAST (after HeaderActions/Actions)
    if (control.Children && Array.isArray(control.Children)) {
      for (let i = 0; i < control.Children.length; i++) {
        const childPath = `${currentPath}:c[${i}]`;
        this.walkControl(control.Children[i], visitor, depth + 1, childPath);
      }
    }
  }
}

/**
 * Visitor that collects controls of a specific type.
 */
export class TypeFilterVisitor implements IControlVisitor {
  private readonly controls: Control[] = [];

  public constructor(private readonly types: readonly ControlType[]) {}

  public visit(control: Control, _depth?: number, _path?: string): boolean {
    if (this.types.includes(control.t as ControlType)) {
      this.controls.push(control);
    }
    return true; // Continue visiting
  }

  public getControls(): readonly Control[] {
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
