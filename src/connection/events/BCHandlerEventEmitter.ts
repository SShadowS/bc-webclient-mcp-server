/**
 * BC Handler Event Emitter
 *
 * Provides pub/sub for BC handler events and predicate-based waiting.
 * Used by both WebSocketManager/ProtocolAdapter (emit) and consumers (wait).
 *
 * This is a stateless service (except for listener subscriptions).
 * It does NOT own any session or protocol state.
 */

import { composeWithTimeout, isTimeoutAbortReason } from '../../core/abort.js';
import { TimeoutError, AbortedError } from '../../core/errors.js';
import { defaultTimeouts } from '../../core/timeouts.js';
import type { IBCHandlerEventEmitter, HandlerEvent } from '../interfaces.js';
import { debugHandlers } from '../../services/debug-logger.js';
import { config } from '../../core/config.js';
import { logger } from '../../core/logger.js';

/**
 * Event emitter for BC handler arrays.
 *
 * Extracted from BCRawWebSocketClient (lines 56-57, 782-874).
 *
 * Key features:
 * - Type-safe event emission (HandlerEvent union type)
 * - Predicate-based waiting with timeout/abort support
 * - Error isolation (listener errors don't break other listeners)
 *
 * Usage:
 * ```ts
 * const emitter = new BCHandlerEventEmitter();
 *
 * // Subscribe
 * const unsubscribe = emitter.onHandlers((event) => {
 *   if (event.kind === 'FormToShow') {
 *     console.log('Form appeared:', event.formId);
 *   }
 * });
 *
 * // Wait for specific event
 * const formId = await emitter.waitForHandlers(
 *   (event) => event.kind === 'FormToShow'
 *     ? { matched: true, data: event.formId }
 *     : { matched: false },
 *   { timeoutMs: 5000 }
 * );
 *
 * // Emit
 * emitter.emit({
 *   kind: 'FormToShow',
 *   formId: 'form123',
 *   raw: { handlerType: 'DN.LogicalClientEventRaisingHandler', parameters: [] }
 * });
 * ```
 */
export class BCHandlerEventEmitter implements IBCHandlerEventEmitter {
  private handlerListeners: Array<(event: HandlerEvent) => void> = [];

  /**
   * Subscribe to handler events.
   *
   * Returns an unsubscribe function for cleanup.
   *
   * @param listener Callback for each event
   * @returns Unsubscribe function
   *
   * @example
   * ```ts
   * const unsubscribe = emitter.onHandlers((event) => {
   *   console.log('Event:', event.kind);
   * });
   *
   * // Later: cleanup
   * unsubscribe();
   * ```
   */
  public onHandlers(listener: (event: HandlerEvent) => void): () => void {
    this.handlerListeners.push(listener);

    // 🐛 Debug: Handler listener registered
    debugHandlers('Handler listener registered', {
      totalListeners: this.handlerListeners.length,
    });

    // Return unsubscribe function
    return () => {
      const index = this.handlerListeners.indexOf(listener);
      if (index !== -1) {
        this.handlerListeners.splice(index, 1);

        // 🐛 Debug: Handler listener unregistered
        debugHandlers('Handler listener unregistered', {
          totalListeners: this.handlerListeners.length,
        });
      }
    };
  }

  /**
   * Wait for a handler event that matches the predicate.
   *
   * Promise-based waiting with timeout and abort signal support.
   * Uses the same composeWithTimeout pattern as RPC requests.
   *
   * @param predicate Function that returns {matched: true, data: T} when event matches
   * @param options Optional timeout and abort signal
   * @returns Promise resolving to matched data
   * @throws {TimeoutError} If no matching event arrives within timeout
   * @throws {AbortedError} If externally aborted via signal
   *
   * @example
   * ```ts
   * // Wait for Tell Me dialog to appear
   * const formId = await emitter.waitForHandlers(
   *   (event) => {
   *     if (event.kind === 'FormToShow') {
   *       return { matched: true, data: event.formId };
   *     }
   *     return { matched: false };
   *   },
   *   { timeoutMs: 2500 }
   * );
   * ```
   */
  public async waitForHandlers<T>(
    predicate: (event: HandlerEvent) => { matched: boolean; data?: T },
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<T> {
    const waitId = `wait-${Date.now()}`;
    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? defaultTimeouts.handlerWaitTimeoutMs;
    const parentSignal = options?.signal;

    // 🐛 Debug: Wait start
    debugHandlers('Waiting for handlers', {
      waitId,
      timeoutMs,
      hasAbortSignal: !!options?.signal,
    }, waitId);

    // Compose timeout with optional parent signal
    const signal = composeWithTimeout(parentSignal, timeoutMs);

    return new Promise<T>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;

      // Event handlers
      const onAbort = () => {
        cleanup();

        // Distinguish timeout from external cancellation
        if (isTimeoutAbortReason(signal.reason)) {
          reject(
            new TimeoutError(`waitForHandlers timeout after ${timeoutMs}ms`, {
              timeoutMs,
            })
          );
        } else {
          reject(
            new AbortedError('waitForHandlers cancelled', {
              reason: signal.reason,
            })
          );
        }
      };

      // Cleanup function
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        if (unsubscribe) unsubscribe();
      };

      // Handle already-aborted signal before registering listener
      if (signal.aborted) {
        onAbort();
        return;
      }

      // Register abort listener
      signal.addEventListener('abort', onAbort, { once: true });

      // Listen for handlers
      unsubscribe = this.onHandlers((event) => {
        try {
          const result = predicate(event);

          // 🐛 Debug: Handler event evaluated (log only if matched or full logging enabled)
          if (config.debug.logFullHandlers || result.matched) {
            debugHandlers('Handler event evaluated', {
              waitId,
              eventKind: event.kind,
              matched: result.matched,
              fullEvent: config.debug.logFullHandlers ? event : undefined,
            }, waitId);
          }

          if (result.matched) {
            cleanup();
            const duration = Date.now() - startTime;

            // 🐛 Debug: Handler match found
            debugHandlers('Handler match found', {
              waitId,
              eventKind: event.kind,
              duration,
            }, waitId);

            resolve(result.data!);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    });
  }

  /**
   * Emit a handler event to all subscribers.
   *
   * Called by BCProtocolAdapter after parsing WebSocket messages.
   *
   * Error isolation: If a listener throws, the error is logged but
   * other listeners are still called. This prevents one bad listener
   * from breaking the entire event pipeline.
   *
   * IMPORTANT: Iterates over a copy of the listeners array to prevent
   * issues when listeners unsubscribe during emission (e.g., waitForHandlers
   * cleanup after match).
   *
   * @param event The handler event to emit
   *
   * @example
   * ```ts
   * // From BCProtocolAdapter
   * emitter.emit({
   *   kind: 'RawHandlers',
   *   handlers: [
   *     { handlerType: 'DN.LogicalClientEventRaisingHandler', parameters: [...] }
   *   ]
   * });
   * ```
   */
  public emit(event: HandlerEvent): void {
    // Iterate over a copy to prevent issues when listeners unsubscribe during emission
    const listeners = [...this.handlerListeners];

    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        // Log but don't throw - one listener error shouldn't break others
        logger.error({ err: error }, '[BCHandlerEventEmitter] Listener error');
      }
    });
  }
}
