/**
 * Business Central WebSocket Protocol Types
 *
 * Precise TypeScript interfaces derived from decompiled BC .NET assemblies.
 * TypeAlias annotations in C# define the JSON `t` discriminator values.
 *
 * @see Microsoft.Dynamics.Framework.UI.Client namespace in decompiled code
 */

import {
  isPropertyChangesType,
  isPropertyChangeType,
  isDataRefreshChangeType,
  isDataRowInsertedType,
  isFormToShowChangeType,
  isDialogToShowChangeType,
  isMessageToShowChangeType,
  isDataRowUpdatedType,
  isDataRowRemovedType,
  BC_CHANGE_TYPES,
} from './bc-type-discriminators.js';

// ============================================================================
// Control Reference (used by all control changes)
// ============================================================================

/**
 * Reference to a control within a form.
 * @see ClientLogicalControlReference.cs
 */
export interface ControlReference {
  /** Form ID containing the control */
  readonly FormId?: string;
  /** Form ID (BC27 sends lowercase 'formId') */
  readonly formId?: string;
  /** Path to the control (e.g., "server:c[1]/rc[1]") */
  readonly ControlPath?: string;
  /** Path to the control - BC27 sends lowercase 'controlPath' */
  readonly controlPath?: string;
}

// ============================================================================
// Data Row Types
// ============================================================================

/**
 * Row data in a repeater/list control.
 * @see ClientDataRow.cs
 */
export interface ClientDataRow {
  /** Bookmark for record positioning */
  readonly Bookmark?: string;
  /** Whether the row is selected */
  readonly Selected?: boolean;
  /** Whether the row is in draft mode (unsaved changes) */
  readonly Draft?: boolean;
  /** Whether the row is expanded (for hierarchical data) */
  readonly Expanded?: boolean;
  /** Whether the row can be expanded */
  readonly CanExpand?: boolean;
  /** Depth in hierarchical data */
  readonly Depth?: number;
  /** Cell values - indexed by column position or property name */
  readonly [key: string]: unknown;
}

// ============================================================================
// Change Type Discriminators (TypeAlias values)
// ============================================================================

/**
 * All change type discriminator values.
 *
 * NOTE: BC uses TWO formats depending on context:
 * - TypeAlias shorthand codes (defined in decompiled .NET assemblies): 'drch', 'lcpchs', etc.
 * - Full type names (used by BC Web Client protocol): 'DataRefreshChange', 'PropertyChanges', etc.
 *
 * Our code must handle BOTH formats for compatibility.
 */
export type ChangeTypeId =
  // Control property changes
  | 'lcpch'    // TypeAlias for PropertyChange
  | 'prch'     // Alternative shorthand for PropertyChange
  | 'lcpchs'   // TypeAlias for PropertyChanges (batch)
  | 'prc'      // Alternative shorthand for PropertyChanges
  | 'PropertyChange'   // BC Web Client full name
  | 'PropertyChanges'  // BC Web Client full name
  // Control structure changes
  | 'cich'     // TypeAlias for ChildInsertedChange
  | 'crch'     // TypeAlias for ChildRemovedChange
  | 'cmch'     // TypeAlias for ChildMovedChange
  | 'ChildInserted'    // BC Web Client full name
  | 'ChildRemoved'     // BC Web Client full name
  | 'ChildMoved'       // BC Web Client full name
  // Data row changes
  | 'drich'    // TypeAlias for DataRowInsertedChange
  | 'drrch'    // TypeAlias for DataRowRemovedChange
  | 'druch'    // TypeAlias for DataRowUpdatedChange
  | 'drch'     // TypeAlias for DataRefreshChange
  | 'drpch'    // TypeAlias for DataRowPropertyChange
  | 'drbch'    // TypeAlias for DataRowBookmarkChange
  | 'DataRowInserted'  // BC Web Client full name
  | 'DataRowRemoved'   // BC Web Client full name
  | 'DataRowUpdated'   // BC Web Client full name
  | 'DataRefreshChange' // BC Web Client full name
  | 'DataRowPropertyChange'  // BC Web Client full name
  | 'DataRowBookmarkChange'  // BC Web Client full name
  // Event changes
  | 'lcerch'   // TypeAlias for EventRaisedChange
  | 'mich'     // TypeAlias for MethodInvokedChange
  | 'EventRaisedChange'      // BC Web Client full name
  | 'MethodInvokedChange'    // BC Web Client full name
  // Session event changes
  | 'ftserc'   // TypeAlias for FormToShowEventRaisedChange
  | 'dtserc'   // TypeAlias for DialogToShowEventRaisedChange
  | 'mtserc'   // TypeAlias for MessageToShowEventRaisedChange
  | 'lftserc'  // TypeAlias for LookupFormToShowEventRaisedChange
  | 'utserc'   // TypeAlias for UriToShowEventRaisedChange
  | 'spch'     // TypeAlias for SessionPropertyChange
  | 'settc'    // TypeAlias for SessionSettingsChangedEventRaisedChange
  // Extension object changes
  | 'eocch'    // TypeAlias for ExtensionObjectCreatedChange
  | 'eodch'    // TypeAlias for ExtensionObjectDisposedChange
  | 'eomich'   // TypeAlias for ExtensionObjectMethodInvokedChange
  | 'ExtensionObjectCreatedChange'       // BC Web Client full name
  | 'ExtensionObjectDisposedChange'      // BC Web Client full name
  | 'ExtensionObjectMethodInvokedChange' // BC Web Client full name
  // Navigation changes
  | 'cnsp'     // NavigationServicePropertyChange
  | 'cnni'     // NavigationNodeInsertedChange
  | 'cnnm'     // NavigationNodeMovedChange
  | 'cnnr'     // NavigationNodeRemovedChange
  | 'cnnp'     // NavigationNodePropertyChange
  // Change set
  | 'chs';     // LogicalChangeSet

// ============================================================================
// Base Change Types
// ============================================================================

/**
 * Base interface for all logical changes.
 * @see ClientLogicalChange.cs
 */
export interface BaseChange {
  readonly t: ChangeTypeId;
}

/**
 * Base interface for control-specific changes.
 * @see ClientLogicalControlChange.cs
 */
export interface ControlChange extends BaseChange {
  readonly ControlReference?: ControlReference;
}

// ============================================================================
// Property Changes
// ============================================================================

/**
 * Single property change on a control.
 * TypeAlias: "lcpch" (shorthand) or "PropertyChange" (BC Web Client)
 * @see ClientLogicalControlPropertyChange.cs
 */
export interface PropertyChange extends ControlChange {
  readonly t: 'lcpch' | 'prch' | 'PropertyChange';
  readonly PropertyName: string;
  readonly PropertyValue: unknown;
}

/**
 * Multiple property changes on a control (batch).
 * TypeAlias: "lcpchs" (shorthand) or "PropertyChanges" (BC Web Client)
 * @see ClientLogicalControlPropertyChanges.cs
 */
export interface PropertyChanges extends ControlChange {
  readonly t: 'lcpchs' | 'prc' | 'PropertyChanges';
  readonly Changes: readonly PropertyChange[];
}

// ============================================================================
// Data Row Changes (for repeater/list controls)
// ============================================================================

/**
 * New row inserted into a data control.
 * TypeAlias: "drich" (shorthand) or "DataRowInserted" (BC Web Client)
 * @see ClientLogicalControlDataRowInsertedChange.cs
 */
export interface DataRowInsertedChange extends ControlChange {
  readonly t: 'drich' | 'DataRowInserted';
  /** Index where row was inserted */
  readonly Index: number;
  /** The inserted row data */
  readonly Row: ClientDataRow;
}

/**
 * Row removed from a data control.
 * TypeAlias: "drrch"
 * @see ClientLogicalControlDataRowRemovedChange.cs
 */
export interface DataRowRemovedChange extends ControlChange {
  readonly t: 'drrch';
  /** Index of removed row */
  readonly Index: number;
}

/**
 * Row updated in a data control.
 * TypeAlias: "druch" (shorthand) or "DataRowUpdated" (BC Web Client)
 * @see ClientLogicalControlDataRowUpdatedChange.cs
 */
export interface DataRowUpdatedChange extends ControlChange {
  readonly t: 'druch' | 'DataRowUpdated';
  /** Index of updated row */
  readonly Index: number;
  /** Updated row data */
  readonly Row: ClientDataRow;
}

/**
 * Data refresh for a data control (replaces all rows).
 * TypeAlias: "drch" (shorthand) or "DataRefreshChange" (BC Web Client)
 * @see ClientLogicalControlDataRefreshChange.cs
 */
export interface DataRefreshChange extends ControlChange {
  readonly t: 'drch' | 'DataRefreshChange';
  /** Whether sorting has changed */
  readonly HasSortingChanged?: boolean;
  /** Whether refresh is for current row only */
  readonly CurrentRowOnly?: boolean;
  /** Array of inserted rows */
  readonly RowChanges?: readonly DataRowInsertedChange[];
}

/**
 * Property change on a data row.
 * TypeAlias: "drpch"
 * @see ClientLogicalControlDataRowPropertyChange.cs
 */
export interface DataRowPropertyChange extends ControlChange {
  readonly t: 'drpch';
  readonly Index: number;
  readonly PropertyName: string;
  readonly PropertyValue: unknown;
}

/**
 * Bookmark change on a data row.
 * TypeAlias: "drbch"
 * @see ClientLogicalControlDataRowBookmarkChange.cs
 */
export interface DataRowBookmarkChange extends ControlChange {
  readonly t: 'drbch';
  readonly Index: number;
  readonly Bookmark: string;
}

// ============================================================================
// Control Structure Changes
// ============================================================================

/**
 * Child control inserted.
 * TypeAlias: "cich"
 * @see ClientLogicalControlChildInsertedChange.cs
 */
export interface ChildInsertedChange extends ControlChange {
  readonly t: 'cich';
  readonly Index: number;
  readonly Child: unknown; // Control structure
}

/**
 * Child control removed.
 * TypeAlias: "crch"
 * @see ClientLogicalControlChildRemovedChange.cs
 */
export interface ChildRemovedChange extends ControlChange {
  readonly t: 'crch';
  readonly Index: number;
}

/**
 * Child control moved.
 * TypeAlias: "cmch"
 * @see ClientLogicalControlChildMovedChange.cs
 */
export interface ChildMovedChange extends ControlChange {
  readonly t: 'cmch';
  readonly OldIndex: number;
  readonly NewIndex: number;
}

// ============================================================================
// Event Changes
// ============================================================================

/**
 * Event raised on a control.
 * TypeAlias: "lcerch"
 * @see ClientLogicalControlEventRaisedChange.cs
 */
export interface EventRaisedChange extends ControlChange {
  readonly t: 'lcerch';
  readonly EventName: string;
  readonly EventArgs?: unknown;
}

/**
 * Method invoked on a control.
 * TypeAlias: "mich"
 * @see ClientLogicalControlMethodInvokedChange.cs
 */
export interface MethodInvokedChange extends ControlChange {
  readonly t: 'mich';
  readonly MethodName: string;
  readonly Arguments?: readonly unknown[];
  readonly Result?: unknown;
}

// ============================================================================
// Session Event Changes
// ============================================================================

/**
 * Form to show event.
 * TypeAlias: "ftserc"
 * @see ClientUISessionFormToShowEventRaisedChange.cs
 */
export interface FormToShowChange extends BaseChange {
  readonly t: 'ftserc';
  readonly Form?: unknown; // LogicalForm structure
}

/**
 * Dialog to show event.
 * TypeAlias: "dtserc"
 * @see ClientUISessionDialogToShowEventRaisedChange.cs
 */
export interface DialogToShowChange extends BaseChange {
  readonly t: 'dtserc';
  readonly Dialog?: unknown; // Dialog structure
}

/**
 * Message to show event.
 * TypeAlias: "mtserc"
 * @see ClientUISessionMessageToShowEventRaisedChange.cs
 */
export interface MessageToShowChange extends BaseChange {
  readonly t: 'mtserc';
  readonly Message?: string;
  readonly MessageType?: string;
}

/**
 * Lookup form to show event.
 * TypeAlias: "lftserc"
 * @see ClientUISessionLookupFormToShowEventRaisedChange.cs
 */
export interface LookupFormToShowChange extends BaseChange {
  readonly t: 'lftserc';
  readonly Form?: unknown; // Lookup form structure
}

/**
 * URI to show event.
 * TypeAlias: "utserc"
 * @see ClientUISessionUriToShowEventRaisedChange.cs
 */
export interface UriToShowChange extends BaseChange {
  readonly t: 'utserc';
  readonly Uri?: string;
}

/**
 * Session property change.
 * TypeAlias: "spch"
 * @see ClientSessionPropertyChange.cs
 */
export interface SessionPropertyChange extends BaseChange {
  readonly t: 'spch';
  readonly PropertyName: string;
  readonly PropertyValue: unknown;
}

/**
 * Session settings change.
 * TypeAlias: "settc"
 * @see ClientUISessionSettingsChangedEventRaisedChange.cs
 */
export interface SessionSettingsChange extends BaseChange {
  readonly t: 'settc';
  readonly Settings?: unknown;
}

// ============================================================================
// Navigation Changes
// ============================================================================

/**
 * Navigation service property change.
 * TypeAlias: "cnsp"
 * @see ClientNavigationServicePropertyChange.cs
 */
export interface NavigationServicePropertyChange extends BaseChange {
  readonly t: 'cnsp';
  readonly PropertyName: string;
  readonly PropertyValue: unknown;
}

/**
 * Navigation node inserted.
 * TypeAlias: "cnni"
 * @see ClientNavigationNodeInsertedChange.cs
 */
export interface NavigationNodeInsertedChange extends BaseChange {
  readonly t: 'cnni';
  readonly ParentId?: string;
  readonly Index: number;
  readonly Node: unknown;
}

/**
 * Navigation node moved.
 * TypeAlias: "cnnm"
 * @see ClientNavigationNodeMovedChange.cs
 */
export interface NavigationNodeMovedChange extends BaseChange {
  readonly t: 'cnnm';
  readonly NodeId: string;
  readonly OldParentId?: string;
  readonly NewParentId?: string;
  readonly OldIndex: number;
  readonly NewIndex: number;
}

/**
 * Navigation node removed.
 * TypeAlias: "cnnr"
 * @see ClientNavigationNodeRemovedChange.cs
 */
export interface NavigationNodeRemovedChange extends BaseChange {
  readonly t: 'cnnr';
  readonly NodeId: string;
}

/**
 * Navigation node property change.
 * TypeAlias: "cnnp"
 * @see ClientNavigationNodePropertyChange.cs
 */
export interface NavigationNodePropertyChange extends BaseChange {
  readonly t: 'cnnp';
  readonly NodeId: string;
  readonly PropertyName: string;
  readonly PropertyValue: unknown;
}

// ============================================================================
// Extension Object Changes
// ============================================================================

/**
 * Extension object created.
 * TypeAlias: "eocch"
 * @see ClientExtensionObjectCreatedChange.cs
 */
export interface ExtensionObjectCreatedChange extends BaseChange {
  readonly t: 'eocch';
  readonly ObjectId: string;
  readonly ObjectType: string;
}

/**
 * Extension object disposed.
 * TypeAlias: "eodch"
 * @see ClientExtensionObjectDisposedChange.cs
 */
export interface ExtensionObjectDisposedChange extends BaseChange {
  readonly t: 'eodch';
  readonly ObjectId: string;
}

/**
 * Extension object method invoked.
 * TypeAlias: "eomich"
 * @see ClientExtensionObjectMethodInvokedChange.cs
 */
export interface ExtensionObjectMethodInvokedChange extends BaseChange {
  readonly t: 'eomich';
  readonly ObjectId: string;
  readonly MethodName: string;
  readonly Arguments?: readonly unknown[];
  readonly Result?: unknown;
}

// ============================================================================
// Change Set
// ============================================================================

/**
 * Logical change set (batch of changes).
 * TypeAlias: "chs"
 * @see ClientLogicalChangeSet.cs
 */
export interface LogicalChangeSet extends BaseChange {
  readonly t: 'chs';
  readonly Changes: readonly Change[];
}

// ============================================================================
// Discriminated Union of All Changes
// ============================================================================

/**
 * Discriminated union of all possible change types.
 * Use the `t` field to discriminate between types.
 */
export type Change =
  // Property changes
  | PropertyChange
  | PropertyChanges
  // Data row changes
  | DataRowInsertedChange
  | DataRowRemovedChange
  | DataRowUpdatedChange
  | DataRefreshChange
  | DataRowPropertyChange
  | DataRowBookmarkChange
  // Control structure changes
  | ChildInsertedChange
  | ChildRemovedChange
  | ChildMovedChange
  // Event changes
  | EventRaisedChange
  | MethodInvokedChange
  // Session event changes
  | FormToShowChange
  | DialogToShowChange
  | MessageToShowChange
  | LookupFormToShowChange
  | UriToShowChange
  | SessionPropertyChange
  | SessionSettingsChange
  // Navigation changes
  | NavigationServicePropertyChange
  | NavigationNodeInsertedChange
  | NavigationNodeMovedChange
  | NavigationNodeRemovedChange
  | NavigationNodePropertyChange
  // Extension object changes
  | ExtensionObjectCreatedChange
  | ExtensionObjectDisposedChange
  | ExtensionObjectMethodInvokedChange
  // Change set
  | LogicalChangeSet;

// ============================================================================
// Control Type Discriminators (TypeAlias values)
// ============================================================================

/**
 * All control type discriminator values from TypeAlias attributes.
 * Used in the `t` field to identify control type.
 */
export type ControlTypeId =
  // Action controls
  | 'ac'       // ActionControl
  | 'alc'      // ActionListControl
  | 'arc'      // ActionReferenceControl
  | 'ca'       // CustomActionControl
  | 'fla'      // FileUploadActionControl
  // Data controls
  | 'bc'       // BooleanControl
  | 'byc'      // ByteControl
  | 'chc'      // CharControl
  | 'dc'       // DecimalControl
  | 'dtc'      // DateTimeControl
  | 'douc'     // DoubleControl
  | 'fpc'      // FloatingPointControl
  | 'guc'      // GuidControl
  | 'i16c'     // Int16Control
  | 'i32c'     // Int32Control
  | 'i64c'     // Int64Control
  | 'ic'       // IntegerControl
  | 'nuc'      // NumberControl
  | 'pc'       // ProgressControl
  | 'sbyc'     // SByteControl
  | 'sc'       // StringControl
  | 'sec'      // SelectionControl
  | 'sinc'     // SingleControl
  | 'ssc'      // StaticStringControl
  | 'tsc'      // TimeSpanControl
  | 'ui16c'    // UInt16Control
  | 'ui32c'    // UInt32Control
  | 'ui64c'    // UInt64Control
  // Container controls
  | 'gc'       // GroupControl
  | 'stackc'   // StackControl
  | 'stackgc'  // StackGroupControl
  | 'fhc'      // FormHostControl
  // List controls
  | 'rc'       // RepeaterControl
  | 'rcc'      // RepeaterColumnControl
  | 'rrc'      // RepeaterRowControl
  | 'matrixc'  // MatrixControl
  // Filter controls
  | 'filc'     // FilterLogicalControl
  | 'flc'      // FilterLineControl
  | 'fvc'      // FilterValueControl
  | 'fsec'     // FilterValueSelectionControl
  | 'sfcl'     // SearchFilterLineControl
  // Other controls
  | 'agc'      // AgentControl
  | 'blobc'    // BlobControl
  | 'cssc'     // ClickableStringControl
  | 'edc'      // EditLogicalControl
  | 'imgc'     // ImageControl
  | 'lc'       // LogicalControl (base)
  | 'mtc'      // MediaThumbnailControl
  | 'nlc'      // NotificationLogicalControl
  | 'repc'     // ReportControl
  | 'tnc'      // TreeNodeControl
  // Form types
  | 'lf'       // LogicalForm
  | 'lmd';     // LogicalMessageDialog

// ============================================================================
// Action Type Discriminators
// ============================================================================

/**
 * Action type discriminator values.
 */
export type ActionTypeId =
  | 'clact'    // LogicalAction
  | 'clactr'   // LogicalActionReference
  | 'clfact'   // FileUploadLogicalAction
  | 'lookac'   // LookupAction
  | 'nvact'    // NavigateToFormAction
  | 'ofact';   // OpenFormAction

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for DataRefreshChange.
 * Uses centralized BC_CHANGE_TYPES mapping to handle all variants.
 */
export function isDataRefreshChange(change: Change): change is DataRefreshChange {
  return isDataRefreshChangeType(change.t);
}

/**
 * Type guard for DataRowInsertedChange.
 * Uses centralized BC_CHANGE_TYPES mapping to handle all variants.
 */
export function isDataRowInsertedChange(change: Change): change is DataRowInsertedChange {
  return isDataRowInsertedType(change.t);
}

/**
 * Type guard for PropertyChange.
 * Uses centralized BC_CHANGE_TYPES mapping to handle all variants (lcpch, prch, PropertyChange).
 */
export function isPropertyChange(change: Change): change is PropertyChange {
  return isPropertyChangeType(change.t);
}

/**
 * Type guard for PropertyChanges (batch).
 * Uses centralized BC_CHANGE_TYPES mapping to handle all variants (lcpchs, prc, PropertyChanges).
 */
export function isPropertyChanges(change: Change): change is PropertyChanges {
  return isPropertyChangesType(change.t);
}

/**
 * Type guard for FormToShowChange.
 * Uses centralized BC_CHANGE_TYPES mapping.
 */
export function isFormToShowChange(change: Change): change is FormToShowChange {
  return isFormToShowChangeType(change.t);
}

/**
 * Type guard for DialogToShowChange.
 * Uses centralized BC_CHANGE_TYPES mapping.
 */
export function isDialogToShowChange(change: Change): change is DialogToShowChange {
  return isDialogToShowChangeType(change.t);
}

/**
 * Type guard for MessageToShowChange.
 * Uses centralized BC_CHANGE_TYPES mapping.
 */
export function isMessageToShowChange(change: Change): change is MessageToShowChange {
  return isMessageToShowChangeType(change.t);
}

/**
 * Type guard for control changes (has ControlReference).
 */
export function isControlChange(change: Change): change is Change & ControlChange {
  return 'ControlReference' in change;
}

/**
 * Type guard for data row changes.
 * Uses centralized BC_CHANGE_TYPES mapping to handle all variants.
 */
export function isDataRowChange(change: Change): change is
  | DataRowInsertedChange
  | DataRowRemovedChange
  | DataRowUpdatedChange
  | DataRefreshChange
  | DataRowPropertyChange
  | DataRowBookmarkChange {
  // Use centralized mapping for all data row change types
  return isDataRowInsertedType(change.t) ||
    isDataRowRemovedType(change.t) ||
    isDataRowUpdatedType(change.t) ||
    isDataRefreshChangeType(change.t) ||
    // These types don't have separate matchers yet, check directly against mapping
    BC_CHANGE_TYPES.DataRowPropertyChange.includes(change.t as 'drpch' | 'DataRowPropertyChange') ||
    BC_CHANGE_TYPES.DataRowBookmarkChange.includes(change.t as 'drbch' | 'DataRowBookmarkChange');
}

// ============================================================================
// Form Style / State Enums
// ============================================================================

/**
 * Form style (page type).
 * @see ClientFormStyle enum
 */
export type FormStyle =
  | 'Card'
  | 'Document'
  | 'List'
  | 'RoleCenter'
  | 'Worksheet'
  | 'ListPlus'
  | 'CardPart'
  | 'ListPart'
  | 'HeadlinePart'
  | 'StandardDialog'
  | 'ConfirmationDialog'
  | 'NavigatePage'
  | 'API'
  | 'ReportPreview'
  | 'ReportRequest'
  | 'XmlPort'
  | 'PromptDialog';

/**
 * Form state.
 * @see ClientLogicalFormState enum
 */
export type FormState =
  | 'Open'
  | 'Closed'
  | 'InError';

/**
 * View mode for forms.
 * @see ClientViewMode enum
 */
export type ViewMode =
  | 'NotSet'
  | 'View'
  | 'Edit'
  | 'Create';

/**
 * Page mode.
 * @see ClientPageMode enum
 */
export type PageMode =
  | 'View'
  | 'Edit'
  | 'Create';

/**
 * Control importance level.
 * @see ClientImportance enum
 */
export type Importance =
  | 'Standard'
  | 'Promoted'
  | 'Additional'
  | 'Typical';

// ============================================================================
// Logical Control (Base for all controls)
// ============================================================================

/**
 * Base interface for all logical controls.
 * TypeAlias: "lc"
 * @see ClientLogicalControl.cs
 */
export interface LogicalControlBase {
  /** Control type discriminator */
  readonly t: ControlTypeId;
  /** Control name */
  readonly Name?: string;
  /** Display caption */
  readonly Caption?: string;
  /** Whether caption is shown */
  readonly ShowCaption?: boolean;
  /** Whether control is visible */
  readonly Visible?: boolean;
  /** Whether control is enabled */
  readonly Enabled?: boolean;
  /** Whether control is editable */
  readonly Editable?: boolean;
  /** Control importance level */
  readonly Importance?: Importance;
  /** Unique control identifier */
  readonly ControlIdentifier?: string;
  /** Design-time name */
  readonly DesignName?: string;
  /** Mapping hint for automation */
  readonly MappingHint?: string;
  /** Synopsis/tooltip text */
  readonly Synopsis?: string;
  /** Instructional text */
  readonly InstructionalText?: string;
  /** About title */
  readonly AboutTitle?: string;
  /** About text */
  readonly AboutText?: string;
  /** Current string value */
  readonly StringValue?: string;
  /** Current object value */
  readonly ObjectValue?: unknown;
  /** Child controls */
  readonly Children?: readonly LogicalControlBase[];
  /** Action controls */
  readonly Actions?: readonly LogicalControlBase[];
  /** Notification controls */
  readonly Notifications?: readonly LogicalControlBase[];
  /** Control add-in name */
  readonly ControlAddIn?: string;
  /** Whether control is big/large */
  readonly IsBig?: boolean;
  /** Height specification */
  readonly Height?: unknown;
  /** Width specification */
  readonly Width?: unknown;
  /** Formatter for display */
  readonly Formatter?: unknown;
  /** Validation results */
  readonly ValidationResults?: readonly unknown[];
  /** Custom attributes */
  readonly Attributes?: Readonly<Record<string, unknown>>;
  /** Additional properties */
  readonly [key: string]: unknown;
}

// ============================================================================
// Logical Form (Page/Dialog)
// ============================================================================

/**
 * Logical form representing a BC page or dialog.
 * TypeAlias: "lf"
 * @see ClientLogicalForm.cs
 */
export interface LogicalForm extends LogicalControlBase {
  readonly t: 'lf';
  /** Server-side form ID */
  readonly ServerId: string;
  /** View mode (View/Edit/Create) */
  readonly ViewMode?: ViewMode;
  /** Whether form has unsaved changes */
  readonly Dirty?: boolean;
  /** Whether form is unsaved (draft) */
  readonly Draft?: boolean;
  /** Whether form is a task dialog */
  readonly IsTaskDialog?: boolean;
  /** Whether form is a logical dialog */
  readonly IsLogicalDialog?: boolean;
  /** Whether form is modal */
  readonly IsModal?: boolean;
  /** Whether form is a part (embedded) */
  readonly IsPart?: boolean;
  /** Whether form is a system page */
  readonly IsSystemPage?: boolean;
  /** Whether form is a subform */
  readonly IsSubForm?: boolean;
  /** Whether to query before close */
  readonly QueryClose?: boolean;
  /** Whether form is embedded */
  readonly IsEmbedded?: boolean;
  /** Whether form is a side form */
  readonly IsSideForm?: boolean;
  /** Main caption */
  readonly MainCaption?: string;
  /** Caption with mnemonic */
  readonly FormCaptionWithMnemonic?: string;
  /** Whether to show title */
  readonly ShowTitle?: boolean;
  /** Default action control path */
  readonly DefaultActionControlPath?: string;
  /** Form state (Open/Closed/InError) */
  readonly State?: FormState;
  /** Form style (Card/Document/List/etc.) */
  readonly FormStyle?: FormStyle;
  /** Page mode */
  readonly PageMode?: PageMode;
  /** Query string */
  readonly Query?: string;
  /** Designer levels */
  readonly DesignerLevels?: unknown;
  /** Whether advanced filtering is supported */
  readonly SupportsAdvancedFiltering?: boolean;
  /** Help URL */
  readonly HelpUrl?: string;
  /** Personalization help URL */
  readonly PersonalizationHelpUrl?: string;
  /** Sub caption */
  readonly SubCaption?: string;
  /** Whether form is bookmarked */
  readonly IsBookmarked?: boolean;
  /** Whether bookmarking is supported */
  readonly SupportsIsBookmarked?: boolean;
  /** Work date */
  readonly WorkDate?: string;
  /** Server form handle */
  readonly ServerFormHandle?: string;
  /** Whether filters are applied */
  readonly HasFiltersApplied?: boolean;
  /** Whether form has delayed controls */
  readonly HasDelayedControls?: boolean;
  /** Current record bookmark */
  readonly Bookmark?: string;
  /** System ID (GUID) */
  readonly SystemId?: string;
  /** Page usage state */
  readonly PageUsageState?: unknown;
  /** Whether form has user tour */
  readonly HasUserTour?: boolean;
  /** Whether synopsis hint can be shown */
  readonly CanShowSynopsisHint?: boolean;
  /** Whether opened from invited tour */
  readonly IsOpenedFromInvitedTour?: boolean;
  /** Auto start user tour setting */
  readonly AutoStartUserTour?: unknown;
  /** Whether in review mode */
  readonly InReview?: boolean;
  /** Associated agent ID */
  readonly AssociatedAgentId?: string;
  /** Associated agent type ID */
  readonly AssociatedAgentTypeId?: string;
  /** Whether to open form in popout */
  readonly OpenFormInPopout?: boolean;
  /** App ID */
  readonly AppId?: string;
  /** App name */
  readonly AppName?: string;
  /** App publisher */
  readonly AppPublisher?: string;
  /** App version */
  readonly AppVersion?: string;
  /** ISV Application Insights connection string */
  readonly IsvApplicationInsightsConnectionString?: string;
  /** Page help info */
  readonly PageHelpInfo?: unknown;
  /** Form metadata */
  readonly Metadata?: unknown;
  /** Delayed controls to load */
  readonly DelayedControls?: readonly unknown[];
  /** Expression properties for dynamic evaluation */
  readonly ExpressionProperties?: unknown;
  /** Cache key for form reuse */
  readonly CacheKey?: string;
}

// ============================================================================
// Specific Control Types
// ============================================================================

/**
 * Repeater control (list/grid).
 * TypeAlias: "rc"
 * @see ClientRepeaterControl.cs
 */
export interface RepeaterControl extends LogicalControlBase {
  readonly t: 'rc';
  /** Form ID for linked data */
  readonly FormId?: string;
  /** Data binding information */
  readonly Data?: {
    readonly Rows?: readonly ClientDataRow[];
    readonly LoadedRows?: number;
    readonly CanReadRowsForward?: boolean;
    readonly CanReadRowsBackward?: boolean;
    readonly UnreadRowsForward?: number;
    readonly UnreadRowsBackward?: number;
    readonly MaxNumberOfDraftRows?: number;
    readonly CurrentBookmark?: string;
  };
  /** Column binder path for filtering */
  readonly ColumnBinderPath?: string;
}

/**
 * Repeater column control.
 * TypeAlias: "rcc"
 * @see ClientRepeaterColumnControl.cs
 */
export interface RepeaterColumnControl extends LogicalControlBase {
  readonly t: 'rcc';
  /** Column binder path for filtering */
  readonly ColumnBinderPath?: string;
}

/**
 * Action control.
 * TypeAlias: "ac"
 * @see ClientActionControl.cs
 */
export interface ActionControl extends LogicalControlBase {
  readonly t: 'ac';
  /** System action code */
  readonly SystemAction?: number;
  /** Icon reference */
  readonly Icon?: unknown;
  /** Large icon reference */
  readonly LargeIcon?: unknown;
  /** Action definition */
  readonly Action?: unknown;
}

/**
 * String control.
 * TypeAlias: "sc"
 * @see ClientStringControl.cs
 */
export interface StringControl extends LogicalControlBase {
  readonly t: 'sc';
}

/**
 * Boolean control.
 * TypeAlias: "bc"
 * @see ClientBooleanControl.cs
 */
export interface BooleanControl extends LogicalControlBase {
  readonly t: 'bc';
}

/**
 * Decimal control.
 * TypeAlias: "dc"
 * @see ClientDecimalControl.cs
 */
export interface DecimalControl extends LogicalControlBase {
  readonly t: 'dc';
}

/**
 * Integer control.
 * TypeAlias: "i32c"
 * @see ClientInt32Control.cs
 */
export interface Int32Control extends LogicalControlBase {
  readonly t: 'i32c';
}

/**
 * DateTime control.
 * TypeAlias: "dtc"
 * @see ClientDateTimeControl.cs
 */
export interface DateTimeControl extends LogicalControlBase {
  readonly t: 'dtc';
}

/**
 * Selection/enum control.
 * TypeAlias: "sec"
 * @see ClientSelectionControl.cs
 */
export interface SelectionControl extends LogicalControlBase {
  readonly t: 'sec';
  /** Available options */
  readonly Options?: readonly string[];
}

/**
 * Group control (container).
 * TypeAlias: "gc"
 * @see ClientGroupControl.cs
 */
export interface GroupControl extends LogicalControlBase {
  readonly t: 'gc';
}

/**
 * Form host control (subpage container).
 * TypeAlias: "fhc"
 * @see ClientFormHostControl.cs
 */
export interface FormHostControl extends LogicalControlBase {
  readonly t: 'fhc';
}

/**
 * Stack control.
 * TypeAlias: "stackc"
 * @see ClientStackControl.cs
 */
export interface StackControl extends LogicalControlBase {
  readonly t: 'stackc';
}

/**
 * Stack group control.
 * TypeAlias: "stackgc"
 * @see ClientStackGroupControl.cs
 */
export interface StackGroupControl extends LogicalControlBase {
  readonly t: 'stackgc';
}

// ============================================================================
// Union Types for Controls
// ============================================================================

/**
 * Discriminated union of all logical controls.
 */
export type LogicalControl =
  | LogicalForm
  | RepeaterControl
  | RepeaterColumnControl
  | ActionControl
  | StringControl
  | BooleanControl
  | DecimalControl
  | Int32Control
  | DateTimeControl
  | SelectionControl
  | GroupControl
  | FormHostControl
  | StackControl
  | StackGroupControl
  | LogicalControlBase;

// ============================================================================
// Control Type Guards
// ============================================================================

/**
 * Type guard for LogicalForm.
 */
export function isLogicalForm(control: LogicalControlBase): control is LogicalForm {
  return control.t === 'lf';
}

/**
 * Type guard for RepeaterControl.
 */
export function isRepeaterControl(control: LogicalControlBase): control is RepeaterControl {
  return control.t === 'rc';
}

/**
 * Type guard for RepeaterColumnControl.
 */
export function isRepeaterColumnControl(control: LogicalControlBase): control is RepeaterColumnControl {
  return control.t === 'rcc';
}

/**
 * Type guard for ActionControl.
 */
export function isActionControl(control: LogicalControlBase): control is ActionControl {
  return control.t === 'ac';
}

/**
 * Type guard for container controls.
 */
export function isContainerControl(control: LogicalControlBase): boolean {
  return ['gc', 'stackc', 'stackgc', 'fhc', 'lf'].includes(control.t);
}

/**
 * Type guard for data entry controls.
 */
export function isDataEntryControl(control: LogicalControlBase): boolean {
  return ['sc', 'bc', 'dc', 'i32c', 'dtc', 'sec', 'i16c', 'i64c', 'nuc', 'pc'].includes(control.t);
}
