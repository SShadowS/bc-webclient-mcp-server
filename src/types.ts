// JSON-RPC Types
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  /** BC accepts both arrays (positional params) and objects (named params) */
  params?: unknown;
  id: string | number;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JsonRpcError;
  id: string | number;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Business Central Connection Types
export interface ConnectionRequest {
  clientType: string;
  clientVersion: string;
  clientCulture: string;
  clientTimeZone: string;
}

export interface UserSettings {
  workDate: string;
  culture: string;
  timeZone: string;
  language: number;
  userId: string;
  userName: string;
  companyName: string;
}

// Business Central Metadata Types
export interface MasterPage {
  id: number;
  name: string;
  caption: string;
  pageType?: string;
  sourceTable?: string;
  commandBar?: CommandBarDefinition;
  contentArea?: ContentAreaDefinition;
  pageProperties?: PageProperties;
  methods?: PageMethodDefinition[];
  expressions?: DataFieldDefinition[];
}

export interface CommandBarDefinition {
  actions: ActionDefinition[];
}

export interface ActionDefinition {
  id: number;
  name: string;
  caption: string;
  type?: string;
  enabled?: boolean;
  visible?: boolean;
  promoted?: boolean;
}

export interface ContentAreaDefinition {
  controls: ControlDefinition[];
  groups?: GroupDefinition[];
}

export interface ControlDefinition {
  id: number;
  name: string;
  caption: string;
  controlType: string;
  dataType?: string;
  fieldId?: number;
  sourceExpr?: string;
  editable?: boolean;
  visible?: boolean;
  enabled?: boolean;
}

export interface GroupDefinition {
  id: number;
  caption: string;
  controls: ControlDefinition[];
}

export interface PageProperties {
  insertAllowed: boolean;
  modifyAllowed: boolean;
  deleteAllowed: boolean;
  editable: boolean;
}

export interface PageMethodDefinition {
  id: number;
  name: string;
  parameters?: MethodParameter[];
}

export interface MethodParameter {
  name: string;
  type: string;
}

export interface DataFieldDefinition {
  id: number;
  name: string;
  dataType: string;
  length?: number;
}

// Configuration
export interface BCConfig {
  tenantId: string;
  environment: string;
  baseUrl: string;
  companyName?: string;
  azureClientId: string;
  azureTenantId: string;
  azureAuthority: string;
  roleCenterPageId: number;
}
