/**
 * AbortSignal Utilities Tests
 *
 * Tests for AbortSignal composition, timeout detection, and abort listeners.
 * Note: AbortSignal.timeout() uses real timers (cannot be faked), so tests
 * use short timeouts and manual AbortController for deterministic testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  composeWithTimeout,
  isTimeoutAbortReason,
  isAbortError,
  wasExternallyAborted,
  onceAborted,
} from './abort.js';

describe('abort', () => {
  describe('composeWithTimeout()', () => {
    it('returns timeout signal when parent is undefined', () => {
      // Arrange & Act
      const signal = composeWithTimeout(undefined, 100);

      // Assert
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('composes parent with timeout using AbortSignal.any()', () => {
      // Arrange
      const parent = new AbortController().signal;

      // Act
      const signal = composeWithTimeout(parent, 100);

      // Assert
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('aborts when parent signal aborts', async () => {
      // Arrange
      const parentController = new AbortController();
      const signal = composeWithTimeout(parentController.signal, 1000);

      // Act
      parentController.abort();

      // Assert
      expect(signal.aborted).toBe(true);
      expect(wasExternallyAborted(signal)).toBe(true);
    });

    it('aborts when timeout expires', async () => {
      // Arrange & Act
      const signal = composeWithTimeout(undefined, 10); // Short timeout

      // Wait for timeout to expire
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert
      expect(signal.aborted).toBe(true);
      expect(isTimeoutAbortReason(signal.reason)).toBe(true);
    });

    it('aborts on parent abort before timeout', async () => {
      // Arrange
      const parentController = new AbortController();
      const signal = composeWithTimeout(parentController.signal, 1000);

      // Act - abort parent immediately
      parentController.abort(new Error('User cancelled'));

      // Assert
      expect(signal.aborted).toBe(true);
      expect(isTimeoutAbortReason(signal.reason)).toBe(false);
      expect(wasExternallyAborted(signal)).toBe(true);
    });

    it('aborts on timeout before parent abort', async () => {
      // Arrange
      const parentController = new AbortController();
      const signal = composeWithTimeout(parentController.signal, 10);

      // Act - wait for timeout (don't abort parent)
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert
      expect(signal.aborted).toBe(true);
      expect(isTimeoutAbortReason(signal.reason)).toBe(true);
      expect(wasExternallyAborted(signal)).toBe(false);
    });

    it('works with already-aborted parent signal', () => {
      // Arrange
      const parentController = new AbortController();
      parentController.abort(new Error('Already aborted'));

      // Act
      const signal = composeWithTimeout(parentController.signal, 1000);

      // Assert
      expect(signal.aborted).toBe(true);
      expect(wasExternallyAborted(signal)).toBe(true);
    });
  });

  describe('isTimeoutAbortReason()', () => {
    it('returns true for DOMException with name TimeoutError', () => {
      // Arrange
      const reason = new DOMException('Timeout', 'TimeoutError');

      // Act & Assert
      expect(isTimeoutAbortReason(reason)).toBe(true);
    });

    it('returns false for DOMException with different name', () => {
      // Arrange
      const reason = new DOMException('Aborted', 'AbortError');

      // Act & Assert
      expect(isTimeoutAbortReason(reason)).toBe(false);
    });

    it('returns false for Error objects', () => {
      // Arrange
      const reason = new Error('Cancelled');

      // Act & Assert
      expect(isTimeoutAbortReason(reason)).toBe(false);
    });

    it('returns false for plain objects without name property', () => {
      // Arrange
      const reason = { message: 'Aborted' };

      // Act & Assert
      expect(isTimeoutAbortReason(reason)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isTimeoutAbortReason(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isTimeoutAbortReason(undefined)).toBe(false);
    });

    it('returns false for primitive types', () => {
      expect(isTimeoutAbortReason('timeout')).toBe(false);
      expect(isTimeoutAbortReason(123)).toBe(false);
      expect(isTimeoutAbortReason(true)).toBe(false);
    });

    it('returns false for objects with name property but wrong value', () => {
      // Arrange
      const reason = { name: 'SomeOtherError', message: 'Failed' };

      // Act & Assert
      expect(isTimeoutAbortReason(reason)).toBe(false);
    });
  });

  describe('isAbortError()', () => {
    it('returns true for DOMException with name AbortError', () => {
      // Arrange
      const error = new DOMException('Aborted', 'AbortError');

      // Act & Assert
      expect(isAbortError(error)).toBe(true);
    });

    it('returns false for DOMException with different name', () => {
      // Arrange
      const error = new DOMException('Timeout', 'TimeoutError');

      // Act & Assert
      expect(isAbortError(error)).toBe(false);
    });

    it('returns false for regular Error objects', () => {
      // Arrange
      const error = new Error('Aborted');

      // Act & Assert
      expect(isAbortError(error)).toBe(false);
    });

    it('returns true for plain objects with name AbortError (duck typing)', () => {
      // Arrange - implementation uses duck typing, not instanceof
      const error = { name: 'AbortError', message: 'Aborted' };

      // Act & Assert
      expect(isAbortError(error)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isAbortError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isAbortError(undefined)).toBe(false);
    });

    it('returns false for primitive types', () => {
      expect(isAbortError('error')).toBe(false);
      expect(isAbortError(123)).toBe(false);
      expect(isAbortError(false)).toBe(false);
    });
  });

  describe('wasExternallyAborted()', () => {
    it('returns false when signal is undefined', () => {
      expect(wasExternallyAborted(undefined)).toBe(false);
    });

    it('returns false when signal is not aborted', () => {
      // Arrange
      const signal = new AbortController().signal;

      // Act & Assert
      expect(wasExternallyAborted(signal)).toBe(false);
    });

    it('returns true when signal is aborted with non-timeout reason', () => {
      // Arrange
      const controller = new AbortController();
      controller.abort(new Error('User cancelled'));

      // Act & Assert
      expect(wasExternallyAborted(controller.signal)).toBe(true);
    });

    it('returns false when signal is aborted by timeout', async () => {
      // Arrange - create timeout signal
      const signal = AbortSignal.timeout(10);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 50));

      // Act & Assert
      expect(signal.aborted).toBe(true);
      expect(wasExternallyAborted(signal)).toBe(false);
    });

    it('returns true when signal is aborted without reason', () => {
      // Arrange
      const controller = new AbortController();
      controller.abort(); // No reason provided

      // Act & Assert
      expect(wasExternallyAborted(controller.signal)).toBe(true);
    });

    it('returns true when signal is aborted with custom reason object', () => {
      // Arrange
      const controller = new AbortController();
      controller.abort({ code: 'USER_CANCEL', message: 'Cancelled' });

      // Act & Assert
      expect(wasExternallyAborted(controller.signal)).toBe(true);
    });

    it('distinguishes external abort from timeout in composed signal', async () => {
      // Arrange
      const parentController = new AbortController();
      const composed = composeWithTimeout(parentController.signal, 1000);

      // Act - external abort
      parentController.abort(new Error('User action'));

      // Assert
      expect(composed.aborted).toBe(true);
      expect(wasExternallyAborted(composed)).toBe(true);
    });
  });

  describe('onceAborted()', () => {
    it('calls callback when signal aborts', () => {
      // Arrange
      const controller = new AbortController();
      const callback = vi.fn();

      // Act
      onceAborted(controller.signal, callback);
      controller.abort();

      // Assert
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not call callback if signal never aborts', () => {
      // Arrange
      const controller = new AbortController();
      const callback = vi.fn();

      // Act
      onceAborted(controller.signal, callback);

      // Assert (no abort)
      expect(callback).not.toHaveBeenCalled();
    });

    it('calls callback only once even if abort is triggered multiple times', () => {
      // Arrange
      const controller = new AbortController();
      const callback = vi.fn();

      // Act
      onceAborted(controller.signal, callback);
      controller.abort();
      // Try to abort again (AbortController ignores subsequent aborts)
      controller.abort();

      // Assert
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('returns cleanup function that removes listener', () => {
      // Arrange
      const controller = new AbortController();
      const callback = vi.fn();

      // Act
      const cleanup = onceAborted(controller.signal, callback);
      cleanup(); // Remove listener before abort
      controller.abort();

      // Assert
      expect(callback).not.toHaveBeenCalled();
    });

    it('cleanup function is safe to call multiple times', () => {
      // Arrange
      const controller = new AbortController();
      const callback = vi.fn();

      // Act
      const cleanup = onceAborted(controller.signal, callback);
      cleanup();
      cleanup(); // Call again

      // Assert - no errors, callback not called
      controller.abort();
      expect(callback).not.toHaveBeenCalled();
    });

    it('cleanup function is safe to call after abort', () => {
      // Arrange
      const controller = new AbortController();
      const callback = vi.fn();

      // Act
      const cleanup = onceAborted(controller.signal, callback);
      controller.abort();
      cleanup(); // Call after abort

      // Assert - callback was called once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not call callback for already-aborted signal', () => {
      // Arrange
      const controller = new AbortController();
      controller.abort();
      const callback = vi.fn();

      // Act - attach listener to already-aborted signal
      onceAborted(controller.signal, callback);

      // Assert - addEventListener does not call listeners synchronously for already-aborted signals
      // The listener only handles future abort events, not past ones
      expect(callback).not.toHaveBeenCalled();
    });

    it('handles multiple listeners on same signal independently', () => {
      // Arrange
      const controller = new AbortController();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // Act
      const cleanup1 = onceAborted(controller.signal, callback1);
      onceAborted(controller.signal, callback2);

      cleanup1(); // Remove first listener
      controller.abort();

      // Assert
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('allows callback to be called when timeout signal aborts', async () => {
      // Arrange
      const signal = AbortSignal.timeout(10);
      const callback = vi.fn();

      // Act
      onceAborted(signal, callback);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 50));

      // Assert
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});
