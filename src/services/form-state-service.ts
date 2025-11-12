/**
 * FormState Service
 *
 * Manages BC form metadata, control tree parsing, field indexing,
 * and field/button resolution for CRUD operations.
 *
 * Critical requirements:
 * - LoadForm MUST be called after FormToShow before field interactions
 * - Field resolution uses multi-index (Caption, ScopedCaption, SourceExpr, Name)
 * - oldValue for SaveValue comes from FormState.node.value.formatted
 * - Dialog buttons are resolved semantically by intent (yes/no/ok/cancel)
 */

import {
  FormState,
  ControlNode,
  FieldIndex,
  FieldResolveOptions,
  FieldResolveResult,
  ButtonIntent,
  ButtonSelectResult,
  FormStateCacheConfig,
  normalizeKey,
  parseScopedKey,
  isSourceExprKey
} from '../types/form-state.js';

/**
 * Handler structure from BC protocol
 */
interface Handler {
  handlerType: string;
  parameters?: any[];
}

/**
 * Semantic button caption sets for dialog resolution
 */
const BUTTON_SYNONYMS: Record<ButtonIntent, Set<string>> = {
  yes: new Set([
    'yes', 'ok', 'accept', 'confirm', 'continue', 'proceed', 'apply', 'save',
    'ja', 'oui', 'sí', 'si', 'はい', '확인', 'sim', 'da'
  ]),
  no: new Set([
    'no', 'cancel', 'abort', 'dismiss', 'reject',
    'nej', 'non', 'annuller', 'avbryt', 'キャンセル', '취소', 'não', 'нет'
  ]),
  ok: new Set([
    'ok', 'okay', 'accept', 'confirm', 'done',
    'ja', 'oui', 'vale', 'хорошо', 'تأكيد'
  ]),
  cancel: new Set([
    'cancel', 'abort', 'dismiss', 'close',
    'annuller', 'avbryt', 'キャンセル', '취소', 'cancelar', 'отмена'
  ]),
  close: new Set([
    'close', 'exit', 'dismiss', 'leave',
    'luk', 'fermer', 'cerrar', 'закрыть', 'إغلاق'
  ]),
  accept: new Set([
    'accept', 'agree', 'yes', 'ok', 'confirm',
    'accepter', 'aceptar', 'принять', 'قبول'
  ]),
  reject: new Set([
    'reject', 'decline', 'no', 'refuse',
    'refuser', 'rechazar', 'отклонить', 'رفض'
  ])
};

/**
 * FormState Service - manages form metadata and field resolution
 */
export class FormStateService {
  private formStates = new Map<string, FormState>();
  private config: FormStateCacheConfig;

  constructor(config?: Partial<FormStateCacheConfig>) {
    this.config = {
      maxSize: 50,
      ttl: 30 * 60 * 1000,  // 30 minutes
      autoLoad: true,
      ...config
    };
  }

  /**
   * Create empty FormState for a new form
   */
  createFormState(formId: string): FormState {
    const state: FormState = {
      formId,
      pathIndex: new Map(),
      fieldIndex: {
        byCaption: new Map(),
        byCaptionScoped: new Map(),
        bySourceExpr: new Map(),
        byName: new Map(),
        duplicates: new Map()
      },
      ready: false,
      lastUpdated: new Date()
    };

    this.formStates.set(formId, state);
    this.evictOldEntries();
    return state;
  }

  /**
   * Get FormState for a form
   */
  getFormState(formId: string): FormState | undefined {
    return this.formStates.get(formId);
  }

  /**
   * Get or create FormState
   */
  getOrCreateFormState(formId: string): FormState {
    let state = this.formStates.get(formId);
    if (!state) {
      state = this.createFormState(formId);
    }
    return state;
  }

  /**
   * Delete FormState (e.g., on FormClosed)
   */
  deleteFormState(formId: string): boolean {
    return this.formStates.delete(formId);
  }

  /**
   * Initialize FormState from FormToShow data (from OpenForm response)
   *
   * FormToShow contains the complete form structure in parameters[1]:
   * - ServerId: form ID
   * - Children: array of top-level controls
   * - Caption, DesignName, etc.
   *
   * This must be called BEFORE applyChanges() to establish the control tree.
   */
  initFromFormToShow(formId: string, formToShowData: any): void {
    const state = this.getOrCreateFormState(formId);

    // FormToShow has Children array at the root level
    const children = formToShowData?.Children || formToShowData?.children;
    if (!children || !Array.isArray(children) || children.length === 0) {
      return;
    }

    // Build control tree from Children using existing parseControl logic
    // Each child in FormToShow.Children is a top-level control
    state.root = {
      path: 'server:',
      children: []
    };

    children.forEach((control: any, index: number) => {
      const childPath = `server:c[${index}]`;
      const node = this.parseControl(state, control, childPath);
      if (node) {
        state.root!.children.push(node);
      }
    });

    // Add root to pathIndex
    state.pathIndex.set('server:', state.root);
    state.lastUpdated = new Date();
  }

  /**
   * Clear all FormStates (e.g., on sessionKey rotation)
   */
  clearAll(): void {
    this.formStates.clear();
  }

  /**
   * Apply changes from DN.LogicalClientChangeHandler to FormState
   *
   * This is the critical function that parses LoadForm responses
   * and builds the control tree.
   */
  applyChanges(formId: string, changes: any): void {
    const state = this.getOrCreateFormState(formId);

    if (!changes || typeof changes !== 'object') {
      return;
    }

    // Handle array of changes
    if (Array.isArray(changes)) {
      for (const change of changes) {
        this.applySingleChange(state, change);
      }
    } else {
      this.applySingleChange(state, changes);
    }

    state.lastUpdated = new Date();
  }

  /**
   * Apply a single change object to FormState
   */
  private applySingleChange(state: FormState, change: any): void {
    if (!change || typeof change !== 'object') return;

    const changeType = change.t || change.type;

    switch (changeType) {
      case 'PropertyChanges':
        // Property updates on existing controls
        this.applyPropertyChanges(state, change);
        break;

      case 'ControlChange':
      case 'ControlAdded':
        // New control or control modification
        this.applyControlChange(state, change);
        break;

      case 'DataRefreshChange':
        // Data updates (repeater rows, field values)
        this.applyDataRefresh(state, change);
        break;

      case 'FullUpdate':
      case 'InitialState':
        // Complete form structure (initial LoadForm)
        this.applyFullUpdate(state, change);
        break;

      default:
        // Unknown change type - try to extract controls anyway
        if (change.Controls || change.controls) {
          this.parseControls(state, change.Controls || change.controls, 'server:');
        }
        break;
    }
  }

  /**
   * Apply property changes to existing controls
   */
  private applyPropertyChanges(state: FormState, change: any): void {
    const controlRef = change.ControlReference || change.controlReference;
    if (!controlRef) return;

    const path = this.resolveControlPath(controlRef);
    const node = state.pathIndex.get(path);
    if (!node) return;

    // Update properties
    const props = change.Properties || change.properties || change;
    if (props.Caption !== undefined) node.caption = props.Caption;
    if (props.Name !== undefined) node.name = props.Name;
    if (props.Editable !== undefined) node.editable = props.Editable;
    if (props.Visible !== undefined) node.visible = props.Visible;
    if (props.Value !== undefined) {
      node.value = node.value || {};
      node.value.raw = props.Value;
      node.value.formatted = props.FormattedValue || String(props.Value);
    }
  }

  /**
   * Apply control change (add/modify control)
   */
  private applyControlChange(state: FormState, change: any): void {
    const control = change.Control || change;
    const parentPath = change.ParentPath || 'server:';

    this.parseControl(state, control, parentPath);
  }

  /**
   * Apply data refresh (field values, repeater data)
   */
  private applyDataRefresh(state: FormState, change: any): void {
    const controlRef = change.ControlReference || change.controlReference;
    if (!controlRef) return;

    const path = this.resolveControlPath(controlRef);
    const node = state.pathIndex.get(path);
    if (!node) return;

    // Update row data for repeaters
    if (change.RowChanges || change.rowChanges) {
      // Store repeater data (for future list operations)
      node.metadata = node.metadata || {};
      node.metadata.rowChanges = change.RowChanges || change.rowChanges;
    }

    // Update field value
    if (change.Value !== undefined) {
      node.value = node.value || {};
      node.value.raw = change.Value;
      node.value.formatted = change.FormattedValue || String(change.Value);
    }
  }

  /**
   * Apply full form update (initial structure)
   */
  private applyFullUpdate(state: FormState, change: any): void {
    const controls = change.Controls || change.controls || change.RootControls || change.rootControls;
    if (controls) {
      state.root = this.parseControls(state, controls, 'server:');
    }
  }

  /**
   * Parse array of controls into control tree
   */
  private parseControls(state: FormState, controls: any[], parentPath: string): ControlNode {
    const rootNode: ControlNode = {
      path: parentPath,
      children: []
    };

    if (!Array.isArray(controls)) return rootNode;

    controls.forEach((control, index) => {
      const childPath = `${parentPath}c[${index}]`;
      const node = this.parseControl(state, control, childPath);
      if (node) {
        rootNode.children.push(node);
      }
    });

    return rootNode;
  }

  /**
   * Parse single control into ControlNode
   */
  private parseControl(state: FormState, control: any, path: string): ControlNode | null {
    if (!control || typeof control !== 'object') return null;

    const node: ControlNode = {
      path,
      caption: control.Caption || control.caption,
      name: control.Name || control.name,
      sourceExpr: control.SourceExpr || control.sourceExpr || control.SourceExpression,
      kind: control.Kind || control.kind || control.Type || control.type,
      editable: control.Editable !== false,  // Default true
      visible: control.Visible !== false,    // Default true
      isPrimary: control.IsPrimary || control.isPrimary || control.IsDefault || control.isDefault,
      children: [],
      metadata: {}
    };

    // Parse value if present
    if (control.Value !== undefined) {
      node.value = {
        raw: control.Value,
        formatted: control.FormattedValue || String(control.Value)
      };
    }

    // Store additional metadata
    if (control.Metadata) {
      node.metadata = { ...control.Metadata };
    }

    // Parse children recursively
    const children = control.Controls || control.controls || control.Children || control.children;
    if (Array.isArray(children) && children.length > 0) {
      children.forEach((child, index) => {
        const childPath = `${path}/c[${index}]`;
        const childNode = this.parseControl(state, child, childPath);
        if (childNode) {
          node.children.push(childNode);
        }
      });
    }

    // Add to path index
    state.pathIndex.set(path, node);

    return node;
  }

  /**
   * Resolve control path from ControlReference object
   */
  private resolveControlPath(controlRef: any): string {
    if (typeof controlRef === 'string') return controlRef;
    if (controlRef.controlPath) return controlRef.controlPath;
    if (controlRef.ControlPath) return controlRef.ControlPath;
    return 'server:';
  }

  /**
   * Build field indices after LoadForm completes
   *
   * MUST be called after all DN.LogicalClientChangeHandler messages
   * for the LoadForm request have been processed.
   */
  buildIndices(formId: string): void {
    const state = this.formStates.get(formId);
    if (!state) return;

    // Clear existing indices
    state.fieldIndex.byCaption.clear();
    state.fieldIndex.byCaptionScoped.clear();
    state.fieldIndex.bySourceExpr.clear();
    state.fieldIndex.byName.clear();
    state.fieldIndex.duplicates.clear();

    // Build indices via DFS
    if (state.root) {
      this.indexNode(state, state.root, []);
    }

    state.ready = true;
  }

  /**
   * Index a single control node (recursive DFS)
   */
  private indexNode(state: FormState, node: ControlNode, scopeStack: string[]): void {
    // Index by caption
    if (node.caption) {
      const normCaption = normalizeKey(node.caption);
      this.addToIndex(state.fieldIndex.byCaption, state.fieldIndex.duplicates, normCaption, node.path);

      // Index scoped caption
      if (scopeStack.length > 0) {
        const scopedKey = normalizeKey([...scopeStack, node.caption].join('>'));
        state.fieldIndex.byCaptionScoped.set(scopedKey, node.path);
      }
    }

    // Index by sourceExpr
    if (node.sourceExpr) {
      const normExpr = normalizeKey(node.sourceExpr);
      state.fieldIndex.bySourceExpr.set(normExpr, node.path);
    }

    // Index by name
    if (node.name) {
      const normName = normalizeKey(node.name);
      state.fieldIndex.byName.set(normName, node.path);
    }

    // Extend scope for groups/fasttabs
    const isContainer = node.kind && ['Group', 'FastTab', 'Part', 'Container'].includes(node.kind);
    const nextScope = isContainer && node.caption ? [...scopeStack, node.caption] : scopeStack;

    // Recurse to children
    for (const child of node.children) {
      this.indexNode(state, child, nextScope);
    }
  }

  /**
   * Add to index with duplicate tracking
   */
  private addToIndex(
    index: Map<string, string>,
    duplicates: Map<string, string[]>,
    key: string,
    path: string
  ): void {
    if (index.has(key)) {
      // Duplicate detected
      const existing = index.get(key)!;
      if (!duplicates.has(key)) {
        duplicates.set(key, [existing]);
      }
      duplicates.get(key)!.push(path);
    } else {
      index.set(key, path);
    }
  }

  /**
   * Resolve field name/caption to control path
   *
   * Supports:
   * - Unscoped caption: "Email"
   * - Scoped caption: "General > Name" or "Address/City"
   * - SourceExpr override: "[Customer.Email]"
   * - Control name: field name from metadata
   */
  resolveField(formId: string, userKey: string, options?: FieldResolveOptions): FieldResolveResult | null {
    const state = this.formStates.get(formId);
    if (!state || !state.ready) {
      return null;
    }

    const opts: Required<FieldResolveOptions> = {
      preferEditable: true,
      preferVisible: true,
      requireScoped: false,
      ...options
    };

    // Check for [SourceExpr] override
    const srcExprCheck = isSourceExprKey(userKey);
    if (srcExprCheck.isSourceExpr && srcExprCheck.expr) {
      const path = state.fieldIndex.bySourceExpr.get(normalizeKey(srcExprCheck.expr));
      if (path) {
        const node = state.pathIndex.get(path);
        if (node) {
          return { controlPath: path, node, ambiguous: false };
        }
      }
      return null;
    }

    // Parse scoped key
    const { scoped, parts } = parseScopedKey(userKey);

    // Try scoped caption if applicable
    if (scoped) {
      const scopedKey = normalizeKey(parts.join('>'));
      const path = state.fieldIndex.byCaptionScoped.get(scopedKey);
      if (path) {
        const node = state.pathIndex.get(path);
        if (node) {
          return { controlPath: path, node, ambiguous: false };
        }
      }
      if (opts.requireScoped) {
        return null;  // User required scoped, don't fall back
      }
    }

    // Try unscoped caption
    const normKey = normalizeKey(parts[parts.length - 1]);  // Last part
    let path = state.fieldIndex.byCaption.get(normKey);

    // Check for duplicates
    const duplicatePaths = state.fieldIndex.duplicates.get(normKey);
    if (duplicatePaths && duplicatePaths.length > 1) {
      // Disambiguate
      const candidates = duplicatePaths
        .map(p => state.pathIndex.get(p))
        .filter((n): n is ControlNode => n !== undefined);

      const filtered = this.filterCandidates(candidates, opts);

      if (filtered.length === 1) {
        const node = filtered[0];
        console.warn(
          `[FormStateService] Ambiguous field "${userKey}" resolved to ${node.path} ` +
          `(${candidates.length} candidates: ${duplicatePaths.join(', ')})`
        );
        return { controlPath: node.path, node, ambiguous: true, candidates };
      } else if (filtered.length > 1) {
        // Still ambiguous after filtering - pick first
        const node = filtered[0];
        console.warn(
          `[FormStateService] Multiple matches for "${userKey}" after filtering. ` +
          `Using ${node.path}. Candidates: ${filtered.map(c => c.path).join(', ')}`
        );
        return { controlPath: node.path, node, ambiguous: true, candidates };
      }
    }

    // Single match or no duplicates
    if (path) {
      const node = state.pathIndex.get(path);
      if (node) {
        return { controlPath: path, node, ambiguous: false };
      }
    }

    // Fallback: try by Name
    path = state.fieldIndex.byName.get(normKey);
    if (path) {
      const node = state.pathIndex.get(path);
      if (node) {
        return { controlPath: path, node, ambiguous: false };
      }
    }

    return null;
  }

  /**
   * Filter candidates based on heuristics
   */
  private filterCandidates(candidates: ControlNode[], opts: Required<FieldResolveOptions>): ControlNode[] {
    let filtered = [...candidates];

    if (opts.preferEditable) {
      const editable = filtered.filter(c => c.editable);
      if (editable.length > 0) filtered = editable;
    }

    if (opts.preferVisible) {
      const visible = filtered.filter(c => c.visible);
      if (visible.length > 0) filtered = visible;
    }

    return filtered;
  }

  /**
   * Select a dialog button by semantic intent
   *
   * Used for confirmation dialogs (delete, save, etc.)
   */
  selectDialogButton(formId: string, intent: ButtonIntent): ButtonSelectResult | null {
    const state = this.formStates.get(formId);
    if (!state || !state.ready) {
      return null;
    }

    const synonymSet = BUTTON_SYNONYMS[intent];
    if (!synonymSet) {
      throw new Error(`Unknown button intent: ${intent}`);
    }

    // Find all action buttons
    const buttons: { path: string; caption: string; isPrimary?: boolean }[] = [];
    for (const [path, node] of state.pathIndex) {
      if (node.kind === 'Action' && node.caption) {
        buttons.push({
          path,
          caption: node.caption,
          isPrimary: node.isPrimary
        });
      }
    }

    // Match against synonym set
    const matches = buttons.filter(b => synonymSet.has(normalizeKey(b.caption)));

    if (matches.length === 1) {
      return {
        controlPath: matches[0].path,
        caption: matches[0].caption,
        ambiguous: false
      };
    }

    if (matches.length > 1) {
      // Prefer primary button
      const primary = matches.find(m => m.isPrimary);
      if (primary) {
        console.warn(
          `[FormStateService] Multiple "${intent}" buttons found, using primary: ${primary.caption}`
        );
        return { controlPath: primary.path, caption: primary.caption, ambiguous: true, candidates: matches };
      }

      // Pick first
      const first = matches[0];
      console.warn(
        `[FormStateService] Multiple "${intent}" buttons, using first: ${first.caption}. ` +
        `Candidates: ${matches.map(m => m.caption).join(', ')}`
      );
      return { controlPath: first.path, caption: first.caption, ambiguous: true, candidates: matches };
    }

    // No match - try primary button as fallback
    const primary = buttons.find(b => b.isPrimary);
    if (primary) {
      console.warn(
        `[FormStateService] No "${intent}" button found, using primary: ${primary.caption}`
      );
      return { controlPath: primary.path, caption: primary.caption, ambiguous: false };
    }

    return null;
  }

  /**
   * Evict old FormState entries when cache size exceeds limit
   */
  private evictOldEntries(): void {
    if (this.formStates.size <= this.config.maxSize) return;

    // Sort by lastUpdated, oldest first
    const sorted = Array.from(this.formStates.entries()).sort(
      (a, b) => a[1].lastUpdated.getTime() - b[1].lastUpdated.getTime()
    );

    // Remove oldest entries
    const toRemove = sorted.slice(0, sorted.length - this.config.maxSize);
    for (const [formId] of toRemove) {
      this.formStates.delete(formId);
    }
  }
}
