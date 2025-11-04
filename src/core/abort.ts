/**
 * AbortSignal Utilities
 *
 * Utilities for composing AbortSignals with timeouts and distinguishing
 * external abort from deadline exceeded.
 *
 * Uses Node 20+ native AbortSignal.timeout() and AbortSignal.any() for
 * efficient signal composition.
 */

/**
 * Composes an optional parent AbortSignal with a timeout deadline.
 *
 * Uses Node 20+ native AbortSignal.timeout() and AbortSignal.any() for
 * efficient composition. The returned signal aborts when either:
 * - The parent signal aborts (external cancellation)
 * - The timeout expires (deadline exceeded)
 *
 * @param parent - Optional parent AbortSignal (e.g., from upstream caller)
 * @param timeoutMs - Timeout in milliseconds
 * @returns Composed AbortSignal that aborts on parent abort OR timeout
 *
 * @example
 * ```ts
 * // Timeout only
 * const signal = composeWithTimeout(undefined, 5000);
 *
 * // Compose with parent
 * const userSignal = new AbortController().signal;
 * const signal = composeWithTimeout(userSignal, 5000);
 * // Aborts if userSignal aborts OR after 5 seconds
 * ```
 */
export function composeWithTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);

  // If no parent, just return the timeout signal
  if (!parent) {
    return deadline;
  }

  // Compose parent with deadline using native AbortSignal.any()
  // Aborts when either signal aborts
  return AbortSignal.any([parent, deadline]);
}

/**
 * Checks if an abort reason indicates a timeout (deadline exceeded)
 * rather than external cancellation.
 *
 * Node 20+ AbortSignal.timeout() creates a DOMException with name "TimeoutError".
 * This function detects that specific reason.
 *
 * @param reason - The abort reason from signal.reason
 * @returns true if the reason indicates a timeout
 *
 * @example
 * ```ts
 * signal.addEventListener('abort', () => {
 *   if (isTimeoutAbortReason(signal.reason)) {
 *     // Deadline exceeded
 *     return new TimeoutError(...);
 *   } else {
 *     // External cancellation
 *     return new AbortedError(...);
 *   }
 * });
 * ```
 */
export function isTimeoutAbortReason(reason: unknown): boolean {
  // Node 20+ timeout creates DOMException with name === 'TimeoutError'
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as any).name === 'TimeoutError'
  );
}

/**
 * Checks if an error is a DOMException with name 'AbortError'.
 *
 * This is thrown by native AbortSignal-aware APIs when aborted.
 *
 * @param e - The error to check
 * @returns true if the error is an abort error
 *
 * @example
 * ```ts
 * try {
 *   await fetch(url, { signal });
 * } catch (e) {
 *   if (isAbortError(e)) {
 *     // Request was aborted
 *   }
 * }
 * ```
 */
export function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as any).name === 'AbortError'
  );
}

/**
 * Determines if a signal was aborted externally (not by timeout).
 *
 * Useful for distinguishing user cancellation from deadline expiration.
 *
 * @param signal - The AbortSignal to check
 * @returns true if aborted by external cancel (not timeout)
 *
 * @example
 * ```ts
 * if (signal.aborted) {
 *   if (wasExternallyAborted(signal)) {
 *     return new AbortedError('Operation cancelled');
 *   } else {
 *     return new TimeoutError('Operation timed out');
 *   }
 * }
 * ```
 */
export function wasExternallyAborted(signal?: AbortSignal): boolean {
  if (!signal || !signal.aborted) {
    return false;
  }

  // If the reason is a timeout, it's NOT an external abort
  if (isTimeoutAbortReason(signal.reason)) {
    return false;
  }

  // Any other abort reason is considered external
  return true;
}

/**
 * Creates an abort listener that removes itself after firing once.
 *
 * Convenience helper for the common pattern of listening for abort
 * and cleaning up the listener.
 *
 * @param signal - The AbortSignal to listen to
 * @param callback - Function to call when aborted
 * @returns Function to manually remove the listener (if not yet aborted)
 *
 * @example
 * ```ts
 * const cleanup = onceAborted(signal, () => {
 *   // Handle abort
 *   ws.close();
 * });
 *
 * // Later, if you want to remove listener before abort:
 * cleanup();
 * ```
 */
export function onceAborted(
  signal: AbortSignal,
  callback: () => void
): () => void {
  const listener = () => callback();

  signal.addEventListener('abort', listener, { once: true });

  // Return cleanup function
  return () => {
    signal.removeEventListener('abort', listener);
  };
}
