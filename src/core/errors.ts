/**
 * Error Hierarchy for BC MCP Server
 *
 * Comprehensive error types following SOLID principles.
 * All errors are immutable and provide structured error information.
 */

// ============================================================================
// Base Error Class
// ============================================================================

export abstract class BCError extends Error {
  public readonly name: string;
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  protected constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();
    this.context = context;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set the prototype explicitly for proper instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }

  public toString(): string {
    const contextStr = this.context
      ? ` | Context: ${JSON.stringify(this.context)}`
      : '';
    return `[${this.code}] ${this.name}: ${this.message}${contextStr}`;
  }
}

// ============================================================================
// Connection Errors
// ============================================================================

export class ConnectionError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_CONNECTION_ERROR', context);
  }
}

export class AuthenticationError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_AUTH_ERROR', { ...context, subtype: 'authentication' });
  }
}

export class WebSocketConnectionError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_WS_CONNECTION_ERROR', { ...context, subtype: 'websocket' });
  }
}

export class SessionExpiredError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_SESSION_EXPIRED', { ...context, subtype: 'session_expired' });
  }
}

export class TimeoutError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_TIMEOUT_ERROR', { ...context, subtype: 'timeout' });
  }
}

export class AbortedError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_ABORTED_ERROR', { ...context, subtype: 'aborted' });
  }
}

export class NetworkError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_NETWORK_ERROR', { ...context, subtype: 'network' });
  }
}

// ============================================================================
// Protocol Errors
// ============================================================================

export class ProtocolError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_PROTOCOL_ERROR', context);
  }
}

export class JsonRpcError extends BCError {
  public readonly rpcErrorCode?: number;

  public constructor(
    message: string,
    rpcErrorCode?: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_JSONRPC_ERROR', { ...context, rpcErrorCode });
    Object.defineProperty(this, 'rpcErrorCode', {
      value: rpcErrorCode,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class DecompressionError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_DECOMPRESSION_ERROR', { ...context, subtype: 'decompression' });
  }
}

export class InvalidResponseError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_INVALID_RESPONSE', { ...context, subtype: 'invalid_response' });
  }
}

// ============================================================================
// Parse Errors
// ============================================================================

export class ParseError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_PARSE_ERROR', context);
  }
}

export class HandlerParseError extends BCError {
  public readonly handlerType?: string;

  public constructor(
    message: string,
    handlerType?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_HANDLER_PARSE_ERROR', { ...context, handlerType });
    Object.defineProperty(this, 'handlerType', {
      value: handlerType,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class ControlParseError extends BCError {
  public readonly controlType?: string;

  public constructor(
    message: string,
    controlType?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_CONTROL_PARSE_ERROR', { ...context, controlType });
    Object.defineProperty(this, 'controlType', {
      value: controlType,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class LogicalFormParseError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_LOGICAL_FORM_PARSE_ERROR', { ...context, subtype: 'logical_form' });
  }
}

// ============================================================================
// Validation Errors
// ============================================================================

export class ValidationError extends BCError {
  public readonly field?: string;
  public readonly validationErrors?: readonly string[];

  public constructor(
    message: string,
    field?: string,
    validationErrors?: readonly string[],
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_VALIDATION_ERROR', {
      ...context,
      field,
      validationErrors,
    });
    this.field = field;
    this.validationErrors = validationErrors;
  }
}

export class ConfigValidationError extends BCError {
  public readonly field?: string;

  public constructor(
    message: string,
    field?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_CONFIG_VALIDATION_ERROR', { ...context, field, subtype: 'config' });
    Object.defineProperty(this, 'field', {
      value: field,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class InputValidationError extends BCError {
  public readonly field?: string;
  public readonly validationErrors?: readonly string[];

  public constructor(
    message: string,
    field?: string,
    validationErrors?: readonly string[],
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_INPUT_VALIDATION_ERROR', {
      ...context,
      field,
      validationErrors,
      subtype: 'input',
    });
    Object.defineProperty(this, 'field', {
      value: field,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, 'validationErrors', {
      value: validationErrors,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class SchemaValidationError extends BCError {
  public readonly validationErrors?: readonly string[];

  public constructor(
    message: string,
    validationErrors?: readonly string[],
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_SCHEMA_VALIDATION_ERROR', {
      ...context,
      validationErrors,
      subtype: 'schema',
    });
    Object.defineProperty(this, 'validationErrors', {
      value: validationErrors,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

// ============================================================================
// Business Logic Errors
// ============================================================================

export class BusinessLogicError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_BUSINESS_LOGIC_ERROR', context);
  }
}

export class PageNotFoundError extends BCError {
  public readonly pageId!: string;

  public constructor(
    pageId: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Page ${pageId} not found`,
      'BC_PAGE_NOT_FOUND',
      { ...context, pageId }
    );
    Object.defineProperty(this, 'pageId', {
      value: pageId,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class ActionNotFoundError extends BCError {
  public readonly actionName!: string;

  public constructor(
    actionName: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Action ${actionName} not found`,
      'BC_ACTION_NOT_FOUND',
      { ...context, actionName }
    );
    Object.defineProperty(this, 'actionName', {
      value: actionName,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class FieldNotFoundError extends BCError {
  public readonly fieldName!: string;

  public constructor(
    fieldName: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Field ${fieldName} not found`,
      'BC_FIELD_NOT_FOUND',
      { ...context, fieldName }
    );
    Object.defineProperty(this, 'fieldName', {
      value: fieldName,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class RecordNotFoundError extends BCError {
  public readonly recordId!: string;

  public constructor(
    recordId: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Record ${recordId} not found`,
      'BC_RECORD_NOT_FOUND',
      { ...context, recordId }
    );
    Object.defineProperty(this, 'recordId', {
      value: recordId,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class PermissionDeniedError extends BCError {
  public readonly resource?: string;
  public readonly action?: string;

  public constructor(
    message: string,
    resource?: string,
    action?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'BC_PERMISSION_DENIED', { ...context, resource, action });
    Object.defineProperty(this, 'resource', {
      value: resource,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, 'action', {
      value: action,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class ActionDisabledError extends BCError {
  public readonly actionName!: string;

  public constructor(
    actionName: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Action ${actionName} is disabled`,
      'BC_ACTION_DISABLED',
      { ...context, actionName }
    );
    Object.defineProperty(this, 'actionName', {
      value: actionName,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class FieldReadOnlyError extends BCError {
  public readonly fieldName!: string;

  public constructor(
    fieldName: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Field ${fieldName} is read-only`,
      'BC_FIELD_READONLY',
      { ...context, fieldName }
    );
    Object.defineProperty(this, 'fieldName', {
      value: fieldName,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

// ============================================================================
// MCP Protocol Errors
// ============================================================================

export class MCPError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'MCP_ERROR', context);
  }
}

export class MCPToolNotFoundError extends BCError {
  public readonly toolName!: string;

  public constructor(
    toolName: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `MCP tool ${toolName} not found`,
      'MCP_TOOL_NOT_FOUND',
      { ...context, toolName }
    );
    Object.defineProperty(this, 'toolName', {
      value: toolName,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class MCPResourceNotFoundError extends BCError {
  public readonly resourceUri!: string;

  public constructor(
    resourceUri: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `MCP resource ${resourceUri} not found`,
      'MCP_RESOURCE_NOT_FOUND',
      { ...context, resourceUri }
    );
    Object.defineProperty(this, 'resourceUri', {
      value: resourceUri,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class MCPInvalidArgumentsError extends BCError {
  public readonly toolName!: string;

  public constructor(
    toolName: string,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'MCP_INVALID_ARGUMENTS', { ...context, toolName });
    Object.defineProperty(this, 'toolName', {
      value: toolName,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

// ============================================================================
// Internal Errors
// ============================================================================

export class InternalError extends BCError {
  public constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'BC_INTERNAL_ERROR', context);
  }
}

export class NotImplementedError extends BCError {
  public readonly feature?: string;

  public constructor(
    feature?: string,
    message?: string,
    context?: Record<string, unknown>
  ) {
    super(
      message ?? `Feature ${feature ?? 'unknown'} is not yet implemented`,
      'BC_NOT_IMPLEMENTED',
      { ...context, feature }
    );
    Object.defineProperty(this, 'feature', {
      value: feature,
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}

export class UnreachableError extends BCError {
  public constructor(message?: string, context?: Record<string, unknown>) {
    super(
      message ?? 'Unreachable code path executed',
      'BC_UNREACHABLE',
      context
    );
  }
}

// ============================================================================
// Error Type Guards
// ============================================================================

export function isConnectionError(error: unknown): error is ConnectionError {
  return error instanceof ConnectionError;
}

export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

export function isProtocolError(error: unknown): error is ProtocolError {
  return error instanceof ProtocolError;
}

export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isBusinessLogicError(error: unknown): error is BusinessLogicError {
  return error instanceof BusinessLogicError;
}

export function isMCPError(error: unknown): error is MCPError {
  return error instanceof MCPError;
}

export function isInternalError(error: unknown): error is InternalError {
  return error instanceof InternalError;
}

export function isBCError(error: unknown): error is BCError {
  return error instanceof BCError;
}
