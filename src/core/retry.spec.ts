/**
 * Retry Utilities Tests
 *
 * Tests for retry logic with exponential backoff, jitter, and AbortSignal support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  retryWithBackoff,
  isRetryableAtConnectionBoundary,
  isRetryableError,
} from './retry.js';
import { ok, err, isOk } from './result.js';
import {
  TimeoutError,
  AbortedError,
  ConnectionError,
  AuthenticationError,
  ProtocolError,
  ValidationError,
  SessionExpiredError,
  PermissionDeniedError,
} from './errors.js';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('retryWithBackoff()', () => {
    it('returns success on first attempt', async () => {
      // Arrange
      const fn = vi.fn(async () => ok('success'));

      // Act
      const promise = retryWithBackoff(fn, { maxAttempts: 2 });
      const result = await promise;

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('success');
      }
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries once and succeeds on second attempt', async () => {
      // Arrange
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return err(new ConnectionError('temporary failure'));
        }
        return ok('success');
      });

      // Act
      const promise = retryWithBackoff(fn, {
        maxAttempts: 1,
        initialDelayMs: 100,
        jitter: false,
      });

      // Advance time to trigger retry
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('success');
      }
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries multiple times with exponential backoff', async () => {
      // Arrange
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return err(new TimeoutError('timeout'));
        }
        return ok('success');
      });

      // Act
      const promise = retryWithBackoff(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      });

      // First retry: 100ms delay
      await vi.advanceTimersByTimeAsync(100);

      // Second retry: 200ms delay (exponential)
      await vi.advanceTimersByTimeAsync(200);

      const result = await promise;

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe('success');
      }
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('returns last error when max attempts reached', async () => {
      // Arrange
      const error = new ConnectionError('persistent failure');
      const fn = vi.fn(async () => err(error));

      // Act
      const promise = retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 50,
        jitter: false,
      });

      await vi.advanceTimersByTimeAsync(50); // First retry
      await vi.advanceTimersByTimeAsync(100); // Second retry
      const result = await promise;

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBe(error);
      }
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('does not retry non-retryable errors', async () => {
      // Arrange
      const error = new AuthenticationError('invalid credentials');
      const fn = vi.fn(async () => err(error));

      // Act
      const result = await retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
      });

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBe(error);
      }
      expect(fn).toHaveBeenCalledTimes(1); // No retries for AuthenticationError
    });

    it('respects custom isRetryable predicate', async () => {
      // Arrange
      const error = new ProtocolError('custom non-retryable');
      const fn = vi.fn(async () => err(error));
      const customIsRetryable = vi.fn(() => false); // Never retry

      // Act
      const result = await retryWithBackoff(fn, {
        maxAttempts: 2,
        isRetryable: customIsRetryable,
      });

      // Assert
      expect(isOk(result)).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(customIsRetryable).toHaveBeenCalledWith(error);
    });

    it('respects maxDelayMs ceiling', async () => {
      // Arrange
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount < 4) {
          return err(new TimeoutError('timeout'));
        }
        return ok('success');
      });

      // Act
      const promise = retryWithBackoff(fn, {
        maxAttempts: 4,
        initialDelayMs: 1000,
        maxDelayMs: 2000, // Cap at 2 seconds
        backoffMultiplier: 2,
        jitter: false,
      });

      // First retry: 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      // Second retry: 2000ms (would be 2000, capped)
      await vi.advanceTimersByTimeAsync(2000);

      // Third retry: 2000ms (would be 4000, capped at 2000)
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      // Assert
      expect(isOk(result)).toBe(true);
      expect(fn).toHaveBeenCalledTimes(4);
    });

    it('calls onRetry callback before each retry', async () => {
      // Arrange
      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          return err(new ConnectionError('failure'));
        }
        return ok('success');
      });

      const onRetry = vi.fn();

      // Act
      const promise = retryWithBackoff(fn, {
        maxAttempts: 2,
        initialDelayMs: 50,
        jitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      // Assert
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(ConnectionError), 1);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(ConnectionError), 2);
    });

    describe('AbortSignal support', () => {
      it('aborts immediately if signal is already aborted', async () => {
        // Arrange
        const controller = new AbortController();
        controller.abort();
        const fn = vi.fn(async () => ok('success'));

        // Act
        const result = await retryWithBackoff(fn, {
          signal: controller.signal,
        });

        // Assert
        expect(isOk(result)).toBe(false);
        if (!isOk(result)) {
          expect(result.error).toBeInstanceOf(AbortedError);
        }
        expect(fn).not.toHaveBeenCalled();
      });

      it('aborts during backoff delay', async () => {
        // Arrange
        const controller = new AbortController();
        const fn = vi.fn(async () => err(new TimeoutError('timeout')));

        // Act
        const promise = retryWithBackoff(fn, {
          maxAttempts: 2,
          initialDelayMs: 1000,
          signal: controller.signal,
          jitter: false,
        });

        // Start delay, then abort during it
        await vi.advanceTimersByTimeAsync(500);
        controller.abort();
        await vi.advanceTimersByTimeAsync(500);

        const result = await promise;

        // Assert
        expect(isOk(result)).toBe(false);
        if (!isOk(result)) {
          expect(result.error).toBeInstanceOf(AbortedError);
          expect(result.error.message).toContain('cancelled');
        }
        expect(fn).toHaveBeenCalledTimes(1); // Only initial attempt
      });

      it('aborts between attempts', async () => {
        // Arrange
        const controller = new AbortController();
        let callCount = 0;
        const fn = vi.fn(async () => {
          callCount++;
          return err(new TimeoutError('timeout'));
        });

        // Act
        const promise = retryWithBackoff(fn, {
          maxAttempts: 3,
          initialDelayMs: 100,
          signal: controller.signal,
          jitter: false,
        });

        // Let first attempt complete
        await vi.advanceTimersByTimeAsync(1);

        // Abort before retry
        controller.abort();
        await vi.advanceTimersByTimeAsync(100);

        const result = await promise;

        // Assert
        expect(isOk(result)).toBe(false);
        if (!isOk(result)) {
          expect(result.error).toBeInstanceOf(AbortedError);
        }
        expect(fn).toHaveBeenCalledTimes(1); // Only first attempt before abort
      });
    });
  });

  describe('isRetryableAtConnectionBoundary()', () => {
    it('returns true for TimeoutError', () => {
      const error = new TimeoutError('timeout');
      expect(isRetryableAtConnectionBoundary(error)).toBe(true);
    });

    it('returns true for ConnectionError', () => {
      const error = new ConnectionError('connection failed');
      expect(isRetryableAtConnectionBoundary(error)).toBe(true);
    });

    it('returns false for AbortedError', () => {
      const error = new AbortedError('cancelled');
      expect(isRetryableAtConnectionBoundary(error)).toBe(false);
    });

    it('returns false for AuthenticationError', () => {
      const error = new AuthenticationError('invalid credentials');
      expect(isRetryableAtConnectionBoundary(error)).toBe(false);
    });

    it('returns false for PermissionDeniedError', () => {
      const error = new PermissionDeniedError('access denied');
      expect(isRetryableAtConnectionBoundary(error)).toBe(false);
    });

    it('returns false for ValidationError', () => {
      const error = new ValidationError('invalid input');
      expect(isRetryableAtConnectionBoundary(error)).toBe(false);
    });

    it('returns false for SessionExpiredError', () => {
      const error = new SessionExpiredError('session expired');
      expect(isRetryableAtConnectionBoundary(error)).toBe(false);
    });

    it('returns true for connection-related ProtocolError', () => {
      const errors = [
        new ProtocolError('Connection reset by peer'),
        new ProtocolError('Network timeout occurred'),
        new ProtocolError('Connection refused'),
        new ProtocolError('Socket closed unexpectedly'),
      ];

      errors.forEach(error => {
        expect(isRetryableAtConnectionBoundary(error)).toBe(true);
      });
    });

    it('returns false for non-connection ProtocolError', () => {
      const errors = [
        new ProtocolError('Invalid message format'),
        new ProtocolError('Parse error'),
        new ProtocolError('Unknown command'),
      ];

      errors.forEach(error => {
        expect(isRetryableAtConnectionBoundary(error)).toBe(false);
      });
    });
  });

  describe('isRetryableError()', () => {
    it('uses isRetryableAtConnectionBoundary logic', () => {
      // Should match behavior of isRetryableAtConnectionBoundary
      expect(isRetryableError(new TimeoutError('timeout'))).toBe(true);
      expect(isRetryableError(new ConnectionError('failed'))).toBe(true);
      expect(isRetryableError(new AuthenticationError('invalid'))).toBe(false);
      expect(isRetryableError(new ValidationError('bad input'))).toBe(false);
    });
  });
});
