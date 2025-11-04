/**
 * Retry Utilities
 *
 * Provides robust retry logic with exponential backoff, jitter, and
 * intelligent error classification for Business Central operations.
 *
 * Key Features:
 * - Exponential backoff with jitter to prevent thundering herd
 * - AbortSignal support for cancellation
 * - Intelligent error classification (retryable vs non-retryable)
 * - Connection boundary retry guards
 * - Type-safe Result<T, E> integration
 */

import type { Result } from './result.js';
import { err, isOk } from './result.js';
import type { BCError } from './errors.js';
import {
  TimeoutError,
  AbortedError,
  ConnectionError,
  WebSocketConnectionError,
  NetworkError,
  AuthenticationError,
  SessionExpiredError,
  ProtocolError,
  ValidationError,
  PermissionDeniedError,
} from './errors.js';
import { isTimeoutAbortReason, wasExternallyAborted } from './abort.js';
import { createConnectionLogger } from './logger.js';

const logger = createConnectionLogger('Retry', 'retryWithBackoff');

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts (0 = no retries, 1 = one retry after initial failure)
   * Default: 1
   */
  maxAttempts?: number;

  /**
   * Initial delay in milliseconds before first retry
   * Default: 1000ms (1 second)
   */
  initialDelayMs?: number;

  /**
   * Maximum delay in milliseconds between retries (ceiling for exponential backoff)
   * Default: 10000ms (10 seconds)
   */
  maxDelayMs?: number;

  /**
   * Backoff multiplier (exponential growth factor)
   * Default: 2 (exponential backoff: 1s, 2s, 4s, 8s, ...)
   */
  backoffMultiplier?: number;

  /**
   * Add random jitter to prevent thundering herd
   * Default: true
   */
  jitter?: boolean;

  /**
   * Optional predicate to determine if an error is retryable
   * If not provided, uses default isRetryableError() logic
   */
  isRetryable?: (error: BCError) => boolean;

  /**
   * Optional AbortSignal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Optional callback invoked before each retry attempt
   * Receives the error that triggered the retry and the attempt number (1-based)
   */
  onRetry?: (error: BCError, attemptNumber: number) => void;
}

/**
 * Retries an async operation with exponential backoff and intelligent error handling.
 *
 * @param fn - Async function returning Result<T, BCError>
 * @param options - Retry configuration
 * @returns Result<T, BCError> - Final result or last error
 *
 * @example
 * ```ts
 * const result = await retryWithBackoff(
 *   () => client.connect(signal),
 *   { maxAttempts: 2, initialDelayMs: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<Result<T, BCError>>,
  options: RetryOptions = {}
): Promise<Result<T, BCError>> {
  const {
    maxAttempts = 1,
    initialDelayMs = 1000,
    maxDelayMs = 10_000,
    backoffMultiplier = 2,
    jitter = true,
    isRetryable = isRetryableError,
    signal,
    onRetry,
  } = options;

  // Check for pre-aborted signal
  if (signal?.aborted) {
    if (wasExternallyAborted(signal)) {
      return err(
        new AbortedError('Operation cancelled before starting', {
          reason: signal.reason,
        })
      );
    } else {
      return err(
        new TimeoutError('Operation timed out before starting', {
          reason: signal.reason,
        })
      );
    }
  }

  let lastError: BCError | undefined;
  let delayMs = initialDelayMs;

  // Attempt loop: initial attempt + retries
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      if (wasExternallyAborted(signal)) {
        return err(
          new AbortedError('Operation cancelled during retry', {
            reason: signal.reason,
            attempt,
            lastError: lastError?.message,
          })
        );
      } else {
        return err(
          new TimeoutError('Operation timed out during retry', {
            reason: signal.reason,
            attempt,
            lastError: lastError?.message,
          })
        );
      }
    }

    // Execute the operation
    const result = await fn();

    // Success! Return immediately
    if (isOk(result)) {
      if (attempt > 0) {
        logger.info(
          { attempt, maxAttempts },
          `✓ Operation succeeded after ${attempt} ${attempt === 1 ? 'retry' : 'retries'}`
        );
      }
      return result;
    }

    // Failure - store the error
    lastError = result.error;

    // If this was the last attempt, return the error
    if (attempt === maxAttempts) {
      logger.warn(
        { error: lastError, attempts: attempt + 1 },
        'Operation failed after all retry attempts'
      );
      return result;
    }

    // Check if error is retryable
    if (!isRetryable(lastError)) {
      logger.debug(
        { error: lastError, errorType: lastError.name },
        'Error is not retryable, aborting retry loop'
      );
      return result;
    }

    // Invoke onRetry callback (attempt is 1-based for user-facing)
    if (onRetry) {
      onRetry(lastError, attempt + 1);
    }

    // Calculate delay with exponential backoff
    const baseDelay = Math.min(delayMs, maxDelayMs);
    const jitterAmount = jitter ? Math.random() * baseDelay * 0.3 : 0; // ±30% jitter
    const actualDelay = Math.floor(baseDelay + jitterAmount);

    logger.debug(
      { attempt: attempt + 1, delayMs: actualDelay, error: lastError.message },
      `Retrying after delay...`
    );

    // Wait before retry (with abort support)
    const delayResult = await delay(actualDelay, signal);
    if (!isOk(delayResult)) {
      // Aborted during delay
      return delayResult as Result<never, BCError>;
    }

    // Increase delay for next iteration (exponential backoff)
    delayMs *= backoffMultiplier;
  }

  // Should never reach here, but TypeScript needs exhaustiveness
  return err(
    lastError ??
      new ProtocolError('Retry loop completed without result', { maxAttempts })
  );
}

/**
 * Determines if an error is retryable at the connection boundary.
 *
 * Connection boundary retries are appropriate for transient network issues,
 * timeouts, and certain WebSocket errors that may resolve on reconnection.
 *
 * NOT retryable:
 * - AbortedError (external cancellation)
 * - AuthenticationError (credentials wrong)
 * - PermissionDeniedError (authorization issue)
 * - ValidationError (bad input data)
 * - SessionExpiredError (requires re-authentication, not just retry)
 *
 * Retryable:
 * - TimeoutError (transient)
 * - ConnectionError (transient)
 * - WebSocketConnectionError (transient)
 * - NetworkError (transient)
 * - Certain ProtocolErrors (transient)
 *
 * @param error - The error to check
 * @returns true if the error is retryable at connection boundary
 *
 * @example
 * ```ts
 * if (isRetryableAtConnectionBoundary(error)) {
 *   return await retryWithBackoff(() => client.connect());
 * }
 * ```
 */
export function isRetryableAtConnectionBoundary(error: BCError): boolean {
  // Explicitly non-retryable errors
  if (
    error instanceof AbortedError ||
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    error instanceof ValidationError ||
    error instanceof SessionExpiredError
  ) {
    return false;
  }

  // Retryable transient errors
  if (
    error instanceof TimeoutError ||
    error instanceof ConnectionError ||
    error instanceof WebSocketConnectionError ||
    error instanceof NetworkError
  ) {
    return true;
  }

  // ProtocolError: retryable if it's a transient issue (connection-related)
  if (error instanceof ProtocolError) {
    const message = error.message.toLowerCase();
    // Retry if message suggests transient network/connection issue
    if (
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('refused') ||
      message.includes('reset') ||
      message.includes('closed')
    ) {
      return true;
    }
    // Don't retry protocol errors that suggest permanent issues
    return false;
  }

  // Default: don't retry unknown error types
  return false;
}

/**
 * Determines if an error is retryable (general heuristic).
 *
 * This is a more permissive check than isRetryableAtConnectionBoundary,
 * suitable for internal operations where retry is safe.
 *
 * @param error - The error to check
 * @returns true if the error is retryable
 */
export function isRetryableError(error: BCError): boolean {
  // Use connection boundary logic as baseline
  return isRetryableAtConnectionBoundary(error);
}

/**
 * Delays execution for a specified time, with AbortSignal support.
 *
 * @param ms - Milliseconds to delay
 * @param signal - Optional AbortSignal for cancellation
 * @returns Result<void, BCError>
 *
 * @example
 * ```ts
 * const result = await delay(1000, signal);
 * if (!isOk(result)) {
 *   // Aborted during delay
 * }
 * ```
 */
async function delay(
  ms: number,
  signal?: AbortSignal
): Promise<Result<void, BCError>> {
  return new Promise<Result<void, BCError>>((resolve) => {
    // Check for pre-aborted signal
    if (signal?.aborted) {
      if (wasExternallyAborted(signal)) {
        resolve(
          err(
            new AbortedError('Delay cancelled', { reason: signal.reason })
          )
        );
      } else {
        resolve(
          err(
            new TimeoutError('Delay timed out', { reason: signal.reason })
          )
        );
      }
      return;
    }

    let timeoutId: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
        abortListener = undefined;
      }
    };

    // Set up timeout
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ ok: true, value: undefined });
    }, ms);

    // Set up abort listener
    if (signal) {
      abortListener = () => {
        cleanup();
        if (isTimeoutAbortReason(signal.reason)) {
          resolve(
            err(
              new TimeoutError('Delay aborted by timeout', {
                reason: signal.reason,
              })
            )
          );
        } else {
          resolve(
            err(
              new AbortedError('Delay cancelled', { reason: signal.reason })
            )
          );
        }
      };
      signal.addEventListener('abort', abortListener, { once: true });
    }
  });
}
