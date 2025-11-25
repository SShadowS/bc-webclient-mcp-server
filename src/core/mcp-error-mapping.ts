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

import { BCError } from './errors.js';

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

/** JSON-RPC 2.0 Error Codes */
const JSON_RPC_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom MCP codes
  TIMEOUT: -32000,
  AUTHENTICATION: -32001,
  PERMISSION_DENIED: -32002,
  NETWORK: -32003,
  BUSINESS_LOGIC: -32040,
  VALIDATION: -32041,
  PROTOCOL: -32042,
  CONNECTION: -32043,
  NOT_FOUND: -32044,
  READ_ONLY: -32046,
} as const;

/**
 * Error name to JSON-RPC code mapping.
 * Uses error.name for O(1) lookup instead of instanceof chains.
 */
const ERROR_CODE_MAP: Record<string, number> = {
  // Input Validation → Invalid params
  InputValidationError: JSON_RPC_CODES.INVALID_PARAMS,
  MCPInvalidArgumentsError: JSON_RPC_CODES.INVALID_PARAMS,

  // Method/Tool Not Found
  MCPToolNotFoundError: JSON_RPC_CODES.METHOD_NOT_FOUND,
  NotImplementedError: JSON_RPC_CODES.METHOD_NOT_FOUND,

  // Authentication
  AuthenticationError: JSON_RPC_CODES.AUTHENTICATION,
  SessionExpiredError: JSON_RPC_CODES.AUTHENTICATION,

  // Authorization/Permission
  PermissionDeniedError: JSON_RPC_CODES.PERMISSION_DENIED,

  // Network
  NetworkError: JSON_RPC_CODES.NETWORK,

  // Timeout
  TimeoutError: JSON_RPC_CODES.TIMEOUT,

  // Connection
  ConnectionError: JSON_RPC_CODES.CONNECTION,
  WebSocketConnectionError: JSON_RPC_CODES.CONNECTION,

  // Protocol
  ProtocolError: JSON_RPC_CODES.PROTOCOL,
  JsonRpcError: JSON_RPC_CODES.PROTOCOL,
  DecompressionError: JSON_RPC_CODES.PROTOCOL,
  InvalidResponseError: JSON_RPC_CODES.PROTOCOL,

  // Parse errors
  ParseError: JSON_RPC_CODES.PARSE_ERROR,
  HandlerParseError: JSON_RPC_CODES.PARSE_ERROR,
  ControlParseError: JSON_RPC_CODES.PARSE_ERROR,
  LogicalFormParseError: JSON_RPC_CODES.PARSE_ERROR,

  // Not Found
  PageNotFoundError: JSON_RPC_CODES.NOT_FOUND,
  ActionNotFoundError: JSON_RPC_CODES.NOT_FOUND,
  FieldNotFoundError: JSON_RPC_CODES.NOT_FOUND,
  RecordNotFoundError: JSON_RPC_CODES.NOT_FOUND,
  MCPResourceNotFoundError: JSON_RPC_CODES.NOT_FOUND,

  // Read-only/Disabled
  ActionDisabledError: JSON_RPC_CODES.READ_ONLY,
  FieldReadOnlyError: JSON_RPC_CODES.READ_ONLY,

  // Business Logic
  BusinessLogicError: JSON_RPC_CODES.BUSINESS_LOGIC,

  // Validation (non-input)
  ValidationError: JSON_RPC_CODES.VALIDATION,
  SchemaValidationError: JSON_RPC_CODES.VALIDATION,
  ConfigValidationError: JSON_RPC_CODES.VALIDATION,

  // Internal errors
  MCPError: JSON_RPC_CODES.INTERNAL_ERROR,
  InternalError: JSON_RPC_CODES.INTERNAL_ERROR,
  UnreachableError: JSON_RPC_CODES.INTERNAL_ERROR,
};

/**
 * Maps BCError subclass to JSON-RPC error code using O(1) lookup.
 */
function getErrorCode(error: BCError): number {
  return ERROR_CODE_MAP[error.name] ?? JSON_RPC_CODES.INTERNAL_ERROR;
}
