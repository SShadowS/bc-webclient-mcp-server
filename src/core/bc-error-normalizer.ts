/**
 * BC Error Normalizer
 *
 * Normalizes Business Central HTTP responses into typed BCError subclasses.
 * Used at the HTTP client boundary to map status codes and error bodies
 * to appropriate error types.
 */

import {
  AuthenticationError,
  PermissionDeniedError,
  RecordNotFoundError,
  PageNotFoundError,
  TimeoutError,
  NetworkError,
  ConnectionError,
  InternalError,
  ProtocolError,
  BusinessLogicError,
  type BCError,
} from './errors.js';

/**
 * BC error response body structure (when available)
 */
export interface BCErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
  Message?: string;
  ExceptionMessage?: string;
  ExceptionType?: string;
}

/** Error factory function type */
type ErrorFactory = (message: string, context: Record<string, unknown>) => BCError;

/** Status code to error factory mapping */
const STATUS_ERROR_MAP: Record<number, { factory: ErrorFactory; defaultMessage: string; contextExtras?: Record<string, unknown> }> = {
  401: { factory: (m, c) => new AuthenticationError(m, c), defaultMessage: 'Authentication failed' },
  403: { factory: (m, c) => new PermissionDeniedError(m, undefined, undefined, c), defaultMessage: 'Permission denied' },
  408: { factory: (m, c) => new TimeoutError(m, c), defaultMessage: 'Request timeout' },
  409: { factory: (m, c) => new BusinessLogicError(m, c), defaultMessage: 'Conflict - resource state conflict' },
  412: { factory: (m, c) => new BusinessLogicError(m, c), defaultMessage: 'Precondition failed' },
  429: { factory: (m, c) => new NetworkError(m, c), defaultMessage: 'Too many requests - rate limited', contextExtras: { rateLimited: true } },
  500: { factory: (m, c) => new InternalError(m, c), defaultMessage: 'BC server internal error' },
  502: { factory: (m, c) => new ConnectionError(m, c), defaultMessage: 'Bad gateway - BC server unreachable', contextExtras: { gatewayError: true } },
  503: { factory: (m, c) => new ConnectionError(m, c), defaultMessage: 'Service unavailable - BC server temporarily unavailable', contextExtras: { serviceUnavailable: true } },
  504: { factory: (m, c) => new TimeoutError(m, c), defaultMessage: 'Gateway timeout - BC server did not respond in time', contextExtras: { gatewayTimeout: true } },
  400: { factory: (m, c) => new ProtocolError(m, c), defaultMessage: 'Bad request - invalid request format' },
  405: { factory: (m, c) => new ProtocolError(m, c), defaultMessage: 'Method not allowed' },
  415: { factory: (m, c) => new ProtocolError(m, c), defaultMessage: 'Unsupported media type' },
};

/** Handle 404 with page/record context detection */
function throw404Error(message: string | undefined, context: Record<string, unknown>): never {
  const notFoundMessage = message || 'Resource not found';
  if (context.pageId) {
    throw new PageNotFoundError(String(context.pageId), notFoundMessage, context);
  }
  throw new RecordNotFoundError(
    context.recordId ? String(context.recordId) : 'unknown',
    notFoundMessage,
    context
  );
}

/** Handle unknown status codes */
function throwDefaultError(status: number, message: string | undefined, context: Record<string, unknown>): never {
  if (status >= 400 && status < 500) {
    throw new ProtocolError(message || `Client error: ${status}`, context);
  }
  if (status >= 500) {
    throw new InternalError(message || `Server error: ${status}`, context);
  }
  throw new InternalError(message || `Unexpected HTTP status: ${status}`, context);
}

/**
 * Normalizes BC HTTP error into a typed BCError.
 * Throws the appropriate BCError subclass - does not return.
 *
 * @param status - HTTP status code
 * @param body - Optional error response body
 * @param context - Additional context for debugging
 * @throws {BCError} - Always throws the appropriate BCError subclass
 */
export function normalizeBCError(
  status: number,
  body?: BCErrorBody,
  context?: Record<string, unknown>
): never {
  const message = extractErrorMessage(body);
  const errorContext = { ...context, httpStatus: status, errorBody: body };

  // Handle 404 specially (needs context detection)
  if (status === 404) {
    throw404Error(message, errorContext);
  }

  // Look up in status map
  const mapping = STATUS_ERROR_MAP[status];
  if (mapping) {
    const fullContext = mapping.contextExtras ? { ...errorContext, ...mapping.contextExtras } : errorContext;
    throw mapping.factory(message || mapping.defaultMessage, fullContext);
  }

  // Default handling for unmapped status codes
  throwDefaultError(status, message, errorContext);
}

/**
 * Extracts error message from various BC error body formats.
 */
function extractErrorMessage(body?: BCErrorBody): string | undefined {
  if (!body) {
    return undefined;
  }

  // Try standard error.message format
  if (body.error?.message) {
    return body.error.message;
  }

  // Try direct message field
  if (body.message) {
    return body.message;
  }

  // Try capital Message field (BC sometimes uses this)
  if (body.Message) {
    return body.Message;
  }

  // Try exception message
  if (body.ExceptionMessage) {
    return body.ExceptionMessage;
  }

  return undefined;
}

/**
 * Checks if an HTTP status code represents an error.
 */
export function isErrorStatus(status: number): boolean {
  return status >= 400;
}

/**
 * Type guard to check if a value is a BC error body.
 */
export function isBCErrorBody(value: unknown): value is BCErrorBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const body = value as Partial<BCErrorBody>;
  return !!(
    body.error ||
    body.message ||
    body.Message ||
    body.ExceptionMessage
  );
}
