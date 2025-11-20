/**
 * Business Central Domain Types
 *
 * Type definitions for BC WebSocket protocol, LogicalForm structure,
 * and control types discovered from metadata extraction.
 *
 * @see SUCCESSFUL-METADATA-EXTRACTION.md for control type reference
 */

// ============================================================================
// Authentication Types
// ============================================================================

export type AuthenticationType = 'NavUserPassword' | 'Windows' | 'AAD';

export interface NavUserPasswordCredentials {
  readonly type: 'NavUserPassword';
  readonly username: string;
  readonly password: string;
}

export interface WindowsCredentials {
  readonly type: 'Windows';
  readonly domain?: string;
  readonly username: string;
  readonly password: string;
}

export interface AADCredentials {
  readonly type: 'AAD';
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly accessToken?: string;
}

export type BCCredentials = NavUserPasswordCredentials | WindowsCredentials | AADCredentials;

// ============================================================================
// Connection Types
// ============================================================================

export interface BCConnectionConfig {
  readonly serverUrl: string;
  readonly company: string;
  readonly credentials: BCCredentials;
  readonly timeout?: number;
}

export interface BCSession {
  readonly sessionId: string;
  readonly sessionKey: string;
  readonly company: string;
  readonly culture?: string;
  readonly userId?: string;
}

// ============================================================================
// JSON-RPC Protocol Types
// ============================================================================

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
  readonly id?: string | number;
}

export interface JsonRpcResponse<T = unknown> {
  readonly jsonrpc: '2.0';
  readonly result?: T;
  readonly compressedResult?: string;
  readonly error?: JsonRpcError;
  readonly id?: string | number;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

// ============================================================================
// BC WebSocket Protocol Types
// ============================================================================

export interface BCInvokeParams {
  readonly sessionId: string;
  readonly sessionKey: string;
  readonly company: string;
  readonly openFormIds: readonly string[];
  readonly sequenceNo: string;
  readonly lastClientAckSequenceNumber: number;
  readonly interactionsToInvoke: readonly BCInteraction[];
}

export interface BCInteraction {
  readonly interactionName: string;
  readonly namedParameters: string | Record<string, unknown>; // String for canonical protocol, object for convenience
  readonly callbackId: string;
  readonly controlPath?: string; // GPT-5-Pro fix: e.g., "server:c[0]"
  readonly formId?: string; // Optional formId for interactions on existing forms
  readonly openFormIds?: readonly string[]; // Optional formIds for session state tracking
}

export interface OpenFormInteraction extends BCInteraction {
  readonly interactionName: 'OpenForm';
  readonly namedParameters: {
    readonly Page: string;
  };
}

export interface CloseFormInteraction extends BCInteraction {
  readonly interactionName: 'CloseForm';
  readonly namedParameters: {
    readonly FormId: string;
  };
}

export interface SaveValueInteraction extends BCInteraction {
  readonly interactionName: 'SaveValue';
  readonly namedParameters: {
    readonly controlPath: string;
    readonly newValue: unknown;
  };
}

export interface InvokeActionInteraction extends BCInteraction {
  readonly interactionName: 'InvokeAction';
  readonly namedParameters: {
    readonly controlPath: string;
  };
}

export interface NavigateInteraction extends BCInteraction {
  readonly interactionName: 'Navigate';
  readonly namedParameters: {
    readonly nodeId: string; // GUID from navigation tree
    readonly source?: unknown;
    readonly navigationTreeContext?: number; // 0 in Wireshark capture
  };
  readonly formId: string; // FormId of the shell/container
  readonly controlPath: string; // e.g., "server:c[0]"
}

// ============================================================================
// Handler Types
// ============================================================================

export type HandlerType =
  | 'DN.CallbackResponseProperties'
  | 'DN.SessionInitHandler'
  | 'DN.LogicalClientEventRaisingHandler'
  | 'DN.LogicalClientChangeHandler';

export interface BCHandler {
  readonly handlerType: HandlerType;
  readonly parameters?: readonly unknown[];
}

export interface CallbackResponseProperties extends BCHandler {
  readonly handlerType: 'DN.CallbackResponseProperties';
  readonly parameters: readonly [
    {
      readonly SequenceNumber: number;
      readonly CompletedInteractions?: readonly {
        readonly InvocationId: string;
        readonly Duration: number;
        readonly Result?: unknown;
      }[];
    }
  ];
}

export interface SessionInitHandler extends BCHandler {
  readonly handlerType: 'DN.SessionInitHandler';
  readonly parameters: readonly [
    {
      readonly RequestToken: string;
      readonly ServerSessionId: string;
      readonly SessionKey: string;
      readonly CompanyName: string;
      readonly [key: string]: unknown;
    }
  ];
}

export interface LogicalClientEventRaisingHandler extends BCHandler {
  readonly handlerType: 'DN.LogicalClientEventRaisingHandler';
  readonly parameters: readonly [
    eventName: string,
    logicalForm?: LogicalForm,
    metadata?: unknown
  ];
}

export interface LogicalClientChangeHandler extends BCHandler {
  readonly handlerType: 'DN.LogicalClientChangeHandler';
  readonly parameters: readonly [
    formId: string,
    changes: readonly unknown[]
  ];
}

export type Handler =
  | CallbackResponseProperties
  | SessionInitHandler
  | LogicalClientEventRaisingHandler
  | LogicalClientChangeHandler;

// ============================================================================
// LogicalForm Structure Types
// ============================================================================

export interface LogicalForm {
  readonly t?: 'lf';
  readonly ServerId: string;
  readonly Caption: string;
  readonly CacheKey: string;
  readonly AppName?: string;
  readonly AppPublisher?: string;
  readonly AppVersion?: string;
  readonly Children?: readonly Control[];
  readonly [key: string]: unknown;
}

// ============================================================================
// Control Types (23 types discovered)
// ============================================================================

export type ControlType =
  | 'ac'      // Action Control
  | 'gc'      // Group Control
  | 'sc'      // String Control
  | 'arc'     // Action Reference Control
  | 'dc'      // Decimal Control
  | 'lc'      // Label Control
  | 'ssc'     // System Status Control
  | 'rcc'     // Repeater Column Control
  | 'lf'      // Logical Form (embedded)
  | 'bc'      // Boolean Control
  | 'fhc'     // FastTab Header Control
  | 'stackc'  // Stack Control
  | 'i32c'    // Integer32 Control
  | 'sec'     // Select/Enum Control
  | 'dtc'     // DateTime Control
  | 'rc'      // Repeater Control
  | 'alc'     // Action List Control
  | 'pc'      // Percent Control
  | 'filc'    // FactBox InfoList Control
  | 'mtc'     // Media/Image Control
  | 'fla'     // File Action
  | 'stackgc' // Stack Group Control
  | string;   // Allow unknown control types

export interface BaseControl {
  readonly t: ControlType;
  readonly ControlIdentifier?: string;
  readonly ID?: string;
  readonly DesignName?: string;
  readonly Name?: string;
  readonly Caption?: string;
  readonly Enabled?: boolean;
  readonly Visible?: boolean;
  readonly Children?: readonly Control[];
  readonly [key: string]: unknown;
}

// Field Controls

export interface StringControl extends BaseControl {
  readonly t: 'sc';
  readonly Caption?: string;
}

export interface DecimalControl extends BaseControl {
  readonly t: 'dc';
  readonly Caption?: string;
}

export interface BooleanControl extends BaseControl {
  readonly t: 'bc';
  readonly Caption?: string;
}

export interface Integer32Control extends BaseControl {
  readonly t: 'i32c';
  readonly Caption?: string;
}

export interface SelectControl extends BaseControl {
  readonly t: 'sec';
  readonly Caption?: string;
  readonly Options?: readonly string[];
}

export interface DateTimeControl extends BaseControl {
  readonly t: 'dtc';
  readonly Caption?: string;
}

export interface PercentControl extends BaseControl {
  readonly t: 'pc';
  readonly Caption?: string;
}

// Action Controls

export interface ActionControl extends BaseControl {
  readonly t: 'ac';
  readonly Caption?: string;
  readonly SystemAction?: SystemAction;
  readonly Enabled?: boolean;
  readonly Icon?: IconReference;
  readonly LargeIcon?: IconReference;
  readonly Synopsis?: string;
  readonly Action?: ActionDefinition;
}

export interface ActionReferenceControl extends BaseControl {
  readonly t: 'arc';
  readonly Caption?: string;
}

export interface ActionListControl extends BaseControl {
  readonly t: 'alc';
}

// Container Controls

export interface GroupControl extends BaseControl {
  readonly t: 'gc';
  readonly Name?: string;
  readonly Children?: readonly Control[];
}

export interface FastTabHeaderControl extends BaseControl {
  readonly t: 'fhc';
  readonly Caption?: string;
  readonly Children?: readonly Control[];
}

export interface StackControl extends BaseControl {
  readonly t: 'stackc';
  readonly Children?: readonly Control[];
}

export interface StackGroupControl extends BaseControl {
  readonly t: 'stackgc';
  readonly Children?: readonly Control[];
}

// List/Repeater Controls

export interface RepeaterControl extends BaseControl {
  readonly t: 'rc';
  readonly Children?: readonly Control[];
}

export interface RepeaterColumnControl extends BaseControl {
  readonly t: 'rcc';
  readonly Caption?: string;
}

// Other Controls

export interface LabelControl extends BaseControl {
  readonly t: 'lc';
  readonly Caption?: string;
}

export interface SystemStatusControl extends BaseControl {
  readonly t: 'ssc';
}

export interface FactBoxInfoListControl extends BaseControl {
  readonly t: 'filc';
}

export interface MediaControl extends BaseControl {
  readonly t: 'mtc';
}

export interface FileAction extends BaseControl {
  readonly t: 'fla';
}

export type Control =
  | StringControl
  | DecimalControl
  | BooleanControl
  | Integer32Control
  | SelectControl
  | DateTimeControl
  | PercentControl
  | ActionControl
  | ActionReferenceControl
  | ActionListControl
  | GroupControl
  | FastTabHeaderControl
  | StackControl
  | StackGroupControl
  | RepeaterControl
  | RepeaterColumnControl
  | LabelControl
  | SystemStatusControl
  | FactBoxInfoListControl
  | MediaControl
  | FileAction
  | LogicalForm
  | BaseControl;

// ============================================================================
// SystemAction Codes (discovered from testing)
// ============================================================================

export enum SystemAction {
  New = 10,
  Delete = 20,
  Edit = 40,
  View = 60,
}

export interface IconReference {
  readonly Identifier: string;
}

export interface ActionDefinition {
  readonly t: string;
  readonly DestinationFormCacheKey?: string;
  readonly [key: string]: unknown;
}

// ============================================================================
// Parsed Metadata Types
// ============================================================================

export interface FieldMetadata {
  readonly type: ControlType;
  readonly caption?: string;
  readonly name?: string;
  readonly controlId?: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly readonly?: boolean;
  readonly options?: readonly string[];
}

export interface ActionMetadata {
  readonly caption?: string;
  readonly systemAction?: SystemAction;
  readonly enabled: boolean;
  readonly controlId?: string;
  readonly icon?: string;
  readonly synopsis?: string;
  readonly controlPath?: string; // BC control path (e.g., "server:c[3]/ha[1]") for invoking the action
}

export interface PageMetadata {
  readonly pageId: string;
  readonly caption: string;
  readonly cacheKey: string;
  readonly appName?: string;
  readonly appPublisher?: string;
  readonly appVersion?: string;
  readonly fields: readonly FieldMetadata[];
  readonly actions: readonly ActionMetadata[];
  readonly controlCount: number;
}
