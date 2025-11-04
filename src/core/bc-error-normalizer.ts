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
  // Extract message from various BC error body formats
  const message = extractErrorMessage(body);
  const errorContext = {
    ...context,
    httpStatus: status,
    errorBody: body,
  };

  // Map HTTP status to error type
  switch (status) {
    // Authentication
    case 401:
      throw new AuthenticationError(
        message || 'Authentication failed',
        errorContext
      );

    // Authorization
    case 403:
      throw new PermissionDeniedError(
        message || 'Permission denied',
        undefined,
        undefined,
        errorContext
      );

    // Not Found
    case 404:
      // Try to determine if it's a page or record
      const notFoundMessage = message || 'Resource not found';
      if (context?.pageId) {
        throw new PageNotFoundError(
          String(context.pageId),
          notFoundMessage,
          errorContext
        );
      } else if (context?.recordId) {
        throw new RecordNotFoundError(
          String(context.recordId),
          notFoundMessage,
          errorContext
        );
      } else {
        throw new RecordNotFoundError(
          'unknown',
          notFoundMessage,
          errorContext
        );
      }

    // Request Timeout
    case 408:
      throw new TimeoutError(
        message || 'Request timeout',
        errorContext
      );

    // Conflict
    case 409:
      throw new BusinessLogicError(
        message || 'Conflict - resource state conflict',
        errorContext
      );

    // Precondition Failed
    case 412:
      throw new BusinessLogicError(
        message || 'Precondition failed',
        errorContext
      );

    // Rate Limiting
    case 429:
      throw new NetworkError(
        message || 'Too many requests - rate limited',
        { ...errorContext, rateLimited: true }
      );

    // Server Errors
    case 500:
      throw new InternalError(
        message || 'BC server internal error',
        errorContext
      );

    case 502:
      throw new ConnectionError(
        message || 'Bad gateway - BC server unreachable',
        { ...errorContext, gatewayError: true }
      );

    case 503:
      throw new ConnectionError(
        message || 'Service unavailable - BC server temporarily unavailable',
        { ...errorContext, serviceUnavailable: true }
      );

    case 504:
      throw new TimeoutError(
        message || 'Gateway timeout - BC server did not respond in time',
        { ...errorContext, gatewayTimeout: true }
      );

    // Bad Request
    case 400:
      throw new ProtocolError(
        message || 'Bad request - invalid request format',
        errorContext
      );

    // Method Not Allowed
    case 405:
      throw new ProtocolError(
        message || 'Method not allowed',
        errorContext
      );

    // Unsupported Media Type
    case 415:
      throw new ProtocolError(
        message || 'Unsupported media type',
        errorContext
      );

    // Default: Map other 4xx to ProtocolError, 5xx to InternalError
    default:
      if (status >= 400 && status < 500) {
        throw new ProtocolError(
          message || `Client error: ${status}`,
          errorContext
        );
      } else if (status >= 500) {
        throw new InternalError(
          message || `Server error: ${status}`,
          errorContext
        );
      } else {
        throw new InternalError(
          message || `Unexpected HTTP status: ${status}`,
          errorContext
        );
      }
  }
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
