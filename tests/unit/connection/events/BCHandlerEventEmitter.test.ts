/**
 * Unit tests for BCHandlerEventEmitter
 *
 * Tests the event emission and predicate-based waiting functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BCHandlerEventEmitter } from '@/connection/events/BCHandlerEventEmitter.js';
import type { HandlerEvent } from '@/connection/interfaces.js';

describe('BCHandlerEventEmitter', () => {
  let emitter: BCHandlerEventEmitter;

  beforeEach(() => {
    emitter = new BCHandlerEventEmitter();
  });

  describe('onHandlers', () => {
    it('should call listener when event is emitted', () => {
      const listener = vi.fn();
      emitter.onHandlers(listener);

      const event: HandlerEvent = {
        kind: 'RawHandlers',
        handlers: [],
      };
      emitter.emit(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.onHandlers(listener);

      // Unsubscribe
      unsubscribe();

      // Emit after unsubscribe
      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };
      emitter.emit(event);

      // Listener should not be called
      expect(listener).not.toHaveBeenCalled();
    });

    it('should call multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.onHandlers(listener1);
      emitter.onHandlers(listener2);

      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };
      emitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should allow same listener to be registered multiple times', () => {
      const listener = vi.fn();

      emitter.onHandlers(listener);
      emitter.onHandlers(listener);

      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };
      emitter.emit(event);

      // Listener called twice (registered twice)
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should handle unsubscribe called multiple times', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.onHandlers(listener);

      unsubscribe();
      unsubscribe(); // Second call should be safe

      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };
      emitter.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('waitForHandlers', () => {
    it('should resolve when predicate matches', async () => {
      const promise = emitter.waitForHandlers(
        (event) => {
          if (event.kind === 'FormToShow') {
            return { matched: true, data: event.formId };
          }
          return { matched: false };
        },
        { timeoutMs: 1000 }
      );

      // Emit matching event
      const event: HandlerEvent = {
        kind: 'FormToShow',
        formId: 'form123',
        caption: 'Test Form',
        raw: { handlerType: 'test', parameters: [] },
      };
      emitter.emit(event);

      const result = await promise;
      expect(result).toBe('form123');
    });

    it('should ignore non-matching events', async () => {
      const promise = emitter.waitForHandlers(
        (event) => {
          if (event.kind === 'FormToShow') {
            return { matched: true, data: event.formId };
          }
          return { matched: false };
        },
        { timeoutMs: 500 }
      );

      // Emit non-matching event
      emitter.emit({
        kind: 'Message',
        sequenceNumber: 42,
        raw: {},
      });

      // Emit matching event
      setTimeout(() => {
        emitter.emit({
          kind: 'FormToShow',
          formId: 'form456',
          raw: { handlerType: 'test', parameters: [] },
        });
      }, 100);

      const result = await promise;
      expect(result).toBe('form456');
    });

    it('should timeout if predicate never matches', async () => {
      const promise = emitter.waitForHandlers(
        () => ({ matched: false }),
        { timeoutMs: 100 }
      );

      // Emit non-matching events
      emitter.emit({ kind: 'RawHandlers', handlers: [] });

      await expect(promise).rejects.toThrow('timeout');
      await expect(promise).rejects.toHaveProperty('name', 'TimeoutError');
    });

    it('should handle external abort signal', async () => {
      const abortController = new AbortController();

      const promise = emitter.waitForHandlers(
        () => ({ matched: false }),
        { signal: abortController.signal, timeoutMs: 5000 }
      );

      // Abort after 50ms
      setTimeout(() => abortController.abort(), 50);

      await expect(promise).rejects.toThrow('cancelled');
      await expect(promise).rejects.toHaveProperty('name', 'AbortedError');
    });

    it('should reject immediately if signal already aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const promise = emitter.waitForHandlers(
        () => ({ matched: false }),
        { signal: abortController.signal, timeoutMs: 5000 }
      );

      await expect(promise).rejects.toThrow('cancelled');
    });

    it('should clean up listener after match', async () => {
      const listenerCountBefore = (emitter as any).handlerListeners.length;

      const promise = emitter.waitForHandlers(
        (event) =>
          event.kind === 'Message'
            ? { matched: true, data: event.sequenceNumber }
            : { matched: false },
        { timeoutMs: 1000 }
      );

      // Listener added
      expect((emitter as any).handlerListeners.length).toBe(listenerCountBefore + 1);

      // Emit matching event
      emitter.emit({
        kind: 'Message',
        sequenceNumber: 42,
        raw: {},
      });

      await promise;

      // Listener removed after match
      expect((emitter as any).handlerListeners.length).toBe(listenerCountBefore);
    });

    it('should clean up listener after timeout', async () => {
      const listenerCountBefore = (emitter as any).handlerListeners.length;

      const promise = emitter.waitForHandlers(
        () => ({ matched: false }),
        { timeoutMs: 100 }
      );

      // Listener added
      expect((emitter as any).handlerListeners.length).toBe(listenerCountBefore + 1);

      await expect(promise).rejects.toThrow('timeout');

      // Listener removed after timeout
      expect((emitter as any).handlerListeners.length).toBe(listenerCountBefore);
    });

    it('should clean up listener after abort', async () => {
      const abortController = new AbortController();
      const listenerCountBefore = (emitter as any).handlerListeners.length;

      const promise = emitter.waitForHandlers(
        () => ({ matched: false }),
        { signal: abortController.signal, timeoutMs: 5000 }
      );

      // Listener added
      expect((emitter as any).handlerListeners.length).toBe(listenerCountBefore + 1);

      abortController.abort();

      await expect(promise).rejects.toThrow('cancelled');

      // Listener removed after abort
      expect((emitter as any).handlerListeners.length).toBe(listenerCountBefore);
    });

    it('should handle predicate errors', async () => {
      const promise = emitter.waitForHandlers(
        () => {
          throw new Error('Predicate error');
        },
        { timeoutMs: 1000 }
      );

      emitter.emit({ kind: 'RawHandlers', handlers: [] });

      await expect(promise).rejects.toThrow('Predicate error');
    });

    it('should support SessionInfo events', async () => {
      const promise = emitter.waitForHandlers(
        (event) =>
          event.kind === 'SessionInfo'
            ? { matched: true, data: event.company }
            : { matched: false },
        { timeoutMs: 1000 }
      );

      emitter.emit({
        kind: 'SessionInfo',
        sessionId: 'sess123',
        sessionKey: 'key456',
        company: 'CRONUS',
        roleCenterFormId: 'form789',
        raw: { handlerType: 'test', parameters: [] },
      });

      const result = await promise;
      expect(result).toBe('CRONUS');
    });

    it('should support DataRefreshChange events', async () => {
      const promise = emitter.waitForHandlers(
        (event) =>
          event.kind === 'DataRefreshChange'
            ? { matched: true, data: event.updates }
            : { matched: false },
        { timeoutMs: 1000 }
      );

      const updates = [{ field: 'Name', value: 'Test' }];
      emitter.emit({
        kind: 'DataRefreshChange',
        updates,
        raw: { handlerType: 'test', parameters: [] },
      });

      const result = await promise;
      expect(result).toBe(updates);
    });
  });

  describe('emit', () => {
    it('should not throw if listener throws', () => {
      emitter.onHandlers(() => {
        throw new Error('Listener error');
      });

      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };

      // Should not throw - error is isolated
      expect(() => emitter.emit(event)).not.toThrow();
    });

    it('should call other listeners even if one throws', () => {
      const listener1 = vi.fn(() => {
        throw new Error('Listener 1 error');
      });
      const listener2 = vi.fn();

      emitter.onHandlers(listener1);
      emitter.onHandlers(listener2);

      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };
      emitter.emit(event);

      // Both listeners called despite error in listener1
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should emit to no listeners without error', () => {
      const event: HandlerEvent = { kind: 'RawHandlers', handlers: [] };

      // Should not throw when no listeners
      expect(() => emitter.emit(event)).not.toThrow();
    });

    it('should support all event types', () => {
      const listener = vi.fn();
      emitter.onHandlers(listener);

      // FormToShow
      emitter.emit({
        kind: 'FormToShow',
        formId: 'form1',
        raw: { handlerType: 'test', parameters: [] },
      });

      // Message
      emitter.emit({
        kind: 'Message',
        sequenceNumber: 42,
        raw: {},
      });

      // SessionInfo
      emitter.emit({
        kind: 'SessionInfo',
        sessionId: 'sess1',
        sessionKey: 'key1',
        company: 'CRONUS',
        raw: { handlerType: 'test', parameters: [] },
      });

      // DataRefreshChange
      emitter.emit({
        kind: 'DataRefreshChange',
        updates: [],
        raw: { handlerType: 'test', parameters: [] },
      });

      // RawHandlers
      emitter.emit({
        kind: 'RawHandlers',
        handlers: [],
      });

      // All events emitted
      expect(listener).toHaveBeenCalledTimes(5);
    });
  });

  describe('integration', () => {
    it('should support multiple concurrent waiters', async () => {
      const waiter1 = emitter.waitForHandlers(
        (event) =>
          event.kind === 'FormToShow'
            ? { matched: true, data: 'waiter1' }
            : { matched: false },
        { timeoutMs: 1000 }
      );

      const waiter2 = emitter.waitForHandlers(
        (event) =>
          event.kind === 'FormToShow'
            ? { matched: true, data: 'waiter2' }
            : { matched: false },
        { timeoutMs: 1000 }
      );

      // Emit event
      emitter.emit({
        kind: 'FormToShow',
        formId: 'form123',
        raw: { handlerType: 'test', parameters: [] },
      });

      // Both waiters should resolve
      const [result1, result2] = await Promise.all([waiter1, waiter2]);
      expect(result1).toBe('waiter1');
      expect(result2).toBe('waiter2');
    });

    it('should support waiter + regular listener', async () => {
      const regularListener = vi.fn();
      emitter.onHandlers(regularListener);

      const waiter = emitter.waitForHandlers(
        (event) =>
          event.kind === 'Message'
            ? { matched: true, data: event.sequenceNumber }
            : { matched: false },
        { timeoutMs: 1000 }
      );

      emitter.emit({
        kind: 'Message',
        sequenceNumber: 99,
        raw: {},
      });

      const result = await waiter;
      expect(result).toBe(99);
      expect(regularListener).toHaveBeenCalledTimes(1);
    });
  });
});
