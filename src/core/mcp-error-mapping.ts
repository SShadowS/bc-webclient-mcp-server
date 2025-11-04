/**
 * MCP Error Mapping
 *
 * Maps BCError subclasses to JSON-RPC 2.0 error codes.
 *
 * Standard JSON-RPC 2.0 error codes:
 * -32700: Parse error
 * -32600: Invalid Request
 * -32601: Method not found
 * -32602: Invalid params
 * -32603: Internal error
 *
 * Custom error codes (MCP extensions):
 * -32000: Timeout
 * -32001: Authentication error
 * -32002: Authorization/Permission denied
 * -32003: Network error
 * -32040: Business logic error
 * -32041: Validation error (non-input)
 * -32042: Protocol error
 * -32043: Connection error
 * -32044: Not found (page, record, field, action)
 * -32045: Conflict/Precondition failed
 * -32046: Read-only/Action disabled
 */

import {
  BCError,
  // Validation
  InputValidationError,
  ValidationError,
  SchemaValidationError,
  ConfigValidationError,
  // MCP Protocol
  MCPError,
  MCPToolNotFoundError,
  MCPResourceNotFoundError,
  MCPInvalidArgumentsError,
  // Auth
  AuthenticationError,
  PermissionDeniedError,
  // Connection
  ConnectionError,
  WebSocketConnectionError,
  SessionExpiredError,
  NetworkError,
  TimeoutError,
  // Protocol
  ProtocolError,
  JsonRpcError,
  DecompressionError,
  InvalidResponseError,
  // Parse
  ParseError,
  HandlerParseError,
  ControlParseError,
  LogicalFormParseError,
  // Business Logic
  BusinessLogicError,
  PageNotFoundError,
  ActionNotFoundError,
  FieldNotFoundError,
  RecordNotFoundError,
  ActionDisabledError,
  FieldReadOnlyError,
  // Internal
  InternalError,
  NotImplementedError,
  UnreachableError,
} from './errors.js';

/**
 * MCP Error structure for JSON-RPC 2.0 responses
 */
export interface MCPErrorResponse {
  code: number;
  message: string;
  data?: {
    errorType: string;
    errorCode: string;
    context?: Record<string, unknown>;
    stack?: string;
  };
}

/**
 * Maps a BCError to an MCP error response with appropriate JSON-RPC error code.
 *
 * @param error - The error to map (can be BCError, Error, or unknown)
 * @returns MCP error response with code, message, and optional data
 */
export function toMCPError(error: unknown): MCPErrorResponse {
  // Handle BCError subclasses
  if (error instanceof BCError) {
    return {
      code: getErrorCode(error),
      message: error.message,
      data: {
        errorType: error.name,
        errorCode: error.code,
        context: error.context,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    };
  }

  // Handle standard Error
  if (error instanceof Error) {
    return {
      code: -32603, // Internal error
      message: error.message,
      data: {
        errorType: error.name,
        errorCode: 'UNKNOWN_ERROR',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    };
  }

  // Handle non-Error values
  return {
    code: -32603, // Internal error
    message: String(error),
    data: {
      errorType: 'Unknown',
      errorCode: 'UNKNOWN_ERROR',
    },
  };
}

/**
 * Maps BCError subclass to JSON-RPC error code.
 */
function getErrorCode(error: BCError): number {
  // Input Validation → -32602 (Invalid params)
  if (error instanceof InputValidationError || error instanceof MCPInvalidArgumentsError) {
    return -32602;
  }

  // Method/Tool Not Found → -32601
  if (error instanceof MCPToolNotFoundError) {
    return -32601;
  }

  // Authentication → -32001 (custom)
  if (error instanceof AuthenticationError || error instanceof SessionExpiredError) {
    return -32001;
  }

  // Authorization/Permission → -32002 (custom)
  if (error instanceof PermissionDeniedError) {
    return -32002;
  }

  // Network errors → -32003 (custom)
  if (error instanceof NetworkError) {
    return -32003;
  }

  // Timeout → -32000 (custom)
  if (error instanceof TimeoutError) {
    return -32000;
  }

  // Connection errors → -32043 (custom)
  if (
    error instanceof ConnectionError ||
    error instanceof WebSocketConnectionError
  ) {
    return -32043;
  }

  // Protocol errors → -32042 (custom)
  if (
    error instanceof ProtocolError ||
    error instanceof JsonRpcError ||
    error instanceof DecompressionError ||
    error instanceof InvalidResponseError
  ) {
    return -32042;
  }

  // Parse errors → -32700 (Parse error)
  if (
    error instanceof ParseError ||
    error instanceof HandlerParseError ||
    error instanceof ControlParseError ||
    error instanceof LogicalFormParseError
  ) {
    return -32700;
  }

  // Not Found → -32044 (custom)
  if (
    error instanceof PageNotFoundError ||
    error instanceof ActionNotFoundError ||
    error instanceof FieldNotFoundError ||
    error instanceof RecordNotFoundError ||
    error instanceof MCPResourceNotFoundError
  ) {
    return -32044;
  }

  // Read-only/Disabled → -32046 (custom)
  if (error instanceof ActionDisabledError || error instanceof FieldReadOnlyError) {
    return -32046;
  }

  // Business Logic → -32040 (custom)
  if (error instanceof BusinessLogicError) {
    return -32040;
  }

  // Validation (non-input) → -32041 (custom)
  if (
    error instanceof ValidationError ||
    error instanceof SchemaValidationError ||
    error instanceof ConfigValidationError
  ) {
    return -32041;
  }

  // Not Implemented → -32601 (Method not found - feature doesn't exist yet)
  if (error instanceof NotImplementedError) {
    return -32601;
  }

  // MCP errors → -32603 (Internal error)
  if (error instanceof MCPError) {
    return -32603;
  }

  // Internal/Unreachable → -32603 (Internal error)
  if (error instanceof InternalError || error instanceof UnreachableError) {
    return -32603;
  }

  // Default: Internal error
  return -32603;
}
