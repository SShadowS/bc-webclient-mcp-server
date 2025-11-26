/**
 * BC Protocol Type Discriminator Mapping
 *
 * This module provides a single source of truth for all BC protocol type discriminators.
 * BC uses both shorthand codes (from .NET TypeAlias) and full type names (BC Web Client).
 * Some types have MULTIPLE shorthand variants.
 *
 * Usage:
 *   import { matchesBcType, isPropertyChangesType } from './bc-type-discriminators.js';
 *
 *   // Generic matcher
 *   if (matchesBcType(change.t, 'PropertyChanges')) { ... }
 *
 *   // Pre-built matcher
 *   if (isPropertyChangesType(change.t)) { ... }
 */

// ============================================================================
// Change Type Mappings
// ============================================================================

/**
 * BC Change Type Discriminator Mapping
 *
 * Maps canonical type names to all known discriminator values.
 * First value is the full type name, followed by shorthand codes.
 */
export const BC_CHANGE_TYPES = {
  // Property Changes
  PropertyChanges: ['PropertyChanges', 'lcpchs', 'prc'],
  PropertyChange: ['PropertyChange', 'lcpch', 'prch'],

  // Data Row Changes
  DataRefreshChange: ['DataRefreshChange', 'drch'],
  DataRowInserted: ['DataRowInserted', 'drich'],
  DataRowUpdated: ['DataRowUpdated', 'druch'],
  DataRowRemoved: ['DataRowRemoved', 'drrch'],
  DataRowPropertyChange: ['DataRowPropertyChange', 'drpch'],
  DataRowBookmarkChange: ['DataRowBookmarkChange', 'drbch'],

  // Control Structure Changes
  ChildInserted: ['ChildInserted', 'cich'],
  ChildRemoved: ['ChildRemoved', 'crch'],
  ChildMoved: ['ChildMoved', 'cmch'],

  // Event Changes
  EventRaisedChange: ['EventRaisedChange', 'lcerch'],
  MethodInvokedChange: ['MethodInvokedChange', 'mich'],

  // Session Event Changes (shorthand only - no known full names)
  FormToShowChange: ['ftserc'],
  DialogToShowChange: ['dtserc'],
  MessageToShowChange: ['mtserc'],
  LookupFormToShowChange: ['lftserc'],
  UriToShowChange: ['utserc'],
  SessionPropertyChange: ['spch'],
  SessionSettingsChange: ['settc'],

  // Extension Object Changes
  ExtensionObjectCreatedChange: ['ExtensionObjectCreatedChange', 'eocch'],
  ExtensionObjectDisposedChange: ['ExtensionObjectDisposedChange', 'eodch'],
  ExtensionObjectMethodInvokedChange: ['ExtensionObjectMethodInvokedChange', 'eomich'],

  // Navigation Changes
  NavigationServicePropertyChange: ['cnsp'],
  NavigationNodeInserted: ['cnni'],
  NavigationNodeMoved: ['cnnm'],
  NavigationNodeRemoved: ['cnnr'],
  NavigationNodePropertyChange: ['cnnp'],

  // Other Changes
  ChangeSet: ['chs'],
  InitializeChange: ['InitializeChange'],
  ControlAddChange: ['ControlAddChange'],
} as const;

/** Canonical change type names */
export type BcChangeTypeName = keyof typeof BC_CHANGE_TYPES;

/** All valid change type discriminator values */
export type BcChangeTypeDiscriminator = typeof BC_CHANGE_TYPES[BcChangeTypeName][number];

// ============================================================================
// Control Type Mappings
// ============================================================================

/**
 * BC Control Type Discriminator Mapping
 *
 * Maps canonical control type names to their discriminator values.
 * Control types typically only have shorthand codes (no full names).
 */
export const BC_CONTROL_TYPES = {
  // Form/Page Controls
  LogicalForm: ['lf'],
  LogicalMessageDialog: ['lmd'],

  // Repeater/List Controls
  RepeaterControl: ['rc'],
  ListRepeaterControl: ['lrc'],
  RepeaterColumnControl: ['rcc'],
  RepeaterRowControl: ['rrc'],

  // Container/Group Controls
  GroupControl: ['gc'],
  StackControl: ['stackc'],
  StackGroupControl: ['stackgc'],
  FormHostControl: ['fhc'],
  MatrixControl: ['matrixc'],

  // Data Entry Controls
  StringControl: ['sc'],
  BooleanControl: ['bc'],
  DecimalControl: ['dc'],
  Int32Control: ['i32c'],
  Int16Control: ['i16c'],
  Int64Control: ['i64c'],
  DateTimeControl: ['dtc'],
  SelectionControl: ['sec'],
  NumberControl: ['nuc'],
  PercentControl: ['pc'],
  GuidControl: ['guc'],
  ByteControl: ['byc'],
  CharControl: ['chc'],
  DoubleControl: ['douc'],
  FloatingPointControl: ['fpc'],
  SByteControl: ['sbyc'],
  SingleControl: ['sinc'],
  StaticStringControl: ['ssc'],
  TimeSpanControl: ['tsc'],
  UInt16Control: ['ui16c'],
  UInt32Control: ['ui32c'],
  UInt64Control: ['ui64c'],

  // Action Controls
  ActionControl: ['ac'],
  ActionListControl: ['alc'],
  ActionReferenceControl: ['arc'],
  CustomActionControl: ['ca'],
  FileUploadActionControl: ['fla'],

  // Filter Controls
  FilterLogicalControl: ['filc'],
  FilterLineControl: ['flc'],
  FilterValueControl: ['fvc'],
  FilterSelectionControl: ['fsec'],
  SearchFilterLineControl: ['sfcl'],

  // Other Controls
  AgentControl: ['agc'],
  BlobControl: ['blobc'],
  ClickableStringControl: ['cssc'],
  EditLogicalControl: ['edc'],
  ImageControl: ['imgc'],
  LogicalControl: ['lc'],
  MediaThumbnailControl: ['mtc'],
  NotificationLogicalControl: ['nlc'],
  TreeNodeControl: ['tnc'],
  ReportControl: ['repc'],
} as const;

/** Canonical control type names */
export type BcControlTypeName = keyof typeof BC_CONTROL_TYPES;

/** All valid control type discriminator values */
export type BcControlTypeDiscriminator = typeof BC_CONTROL_TYPES[BcControlTypeName][number];

// ============================================================================
// Type Matching Functions
// ============================================================================

/**
 * Checks if a discriminator value matches a canonical change type.
 * Handles all known variants (full names and shorthands).
 *
 * @param discriminator - The `.t` value from a BC protocol object
 * @param typeName - The canonical type name to match against
 * @returns true if discriminator matches any variant of the type
 *
 * @example
 * matchesBcChangeType(change.t, 'PropertyChanges')  // matches 'PropertyChanges', 'lcpchs', 'prc'
 */
export function matchesBcChangeType(
  discriminator: string | undefined,
  typeName: BcChangeTypeName
): boolean {
  if (!discriminator) return false;
  const variants = BC_CHANGE_TYPES[typeName];
  return (variants as readonly string[]).includes(discriminator);
}

/**
 * Checks if a discriminator value matches a canonical control type.
 *
 * @param discriminator - The `.t` value from a BC control object
 * @param typeName - The canonical control type name to match against
 * @returns true if discriminator matches
 */
export function matchesBcControlType(
  discriminator: string | undefined,
  typeName: BcControlTypeName
): boolean {
  if (!discriminator) return false;
  const variants = BC_CONTROL_TYPES[typeName];
  return (variants as readonly string[]).includes(discriminator);
}

/**
 * Normalizes a change type discriminator to its canonical name.
 *
 * @param discriminator - Any valid change type discriminator value
 * @returns The canonical type name, or undefined if not recognized
 *
 * @example
 * normalizeChangeType('prc')   // returns 'PropertyChanges'
 * normalizeChangeType('drch')  // returns 'DataRefreshChange'
 */
export function normalizeChangeType(discriminator: string): BcChangeTypeName | undefined {
  for (const [typeName, variants] of Object.entries(BC_CHANGE_TYPES)) {
    if ((variants as readonly string[]).includes(discriminator)) {
      return typeName as BcChangeTypeName;
    }
  }
  return undefined;
}

// ============================================================================
// Pre-built Type Matchers (for common types)
// ============================================================================

// Property Changes
export const isPropertyChangesType = (t?: string): boolean => matchesBcChangeType(t, 'PropertyChanges');
export const isPropertyChangeType = (t?: string): boolean => matchesBcChangeType(t, 'PropertyChange');

// Data Row Changes
export const isDataRefreshChangeType = (t?: string): boolean => matchesBcChangeType(t, 'DataRefreshChange');
export const isDataRowInsertedType = (t?: string): boolean => matchesBcChangeType(t, 'DataRowInserted');
export const isDataRowUpdatedType = (t?: string): boolean => matchesBcChangeType(t, 'DataRowUpdated');
export const isDataRowRemovedType = (t?: string): boolean => matchesBcChangeType(t, 'DataRowRemoved');

// Session Event Changes
export const isFormToShowChangeType = (t?: string): boolean => matchesBcChangeType(t, 'FormToShowChange');
export const isDialogToShowChangeType = (t?: string): boolean => matchesBcChangeType(t, 'DialogToShowChange');
export const isMessageToShowChangeType = (t?: string): boolean => matchesBcChangeType(t, 'MessageToShowChange');

// Control Types
export const isLogicalFormType = (t?: string): boolean => matchesBcControlType(t, 'LogicalForm');
export const isRepeaterControlType = (t?: string): boolean =>
  matchesBcControlType(t, 'RepeaterControl') || matchesBcControlType(t, 'ListRepeaterControl');
