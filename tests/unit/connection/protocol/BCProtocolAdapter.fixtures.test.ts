/**
 * Fixture-Based Tests for BCProtocolAdapter
 *
 * Tests protocol parsing using realistic BC message fixtures.
 * Ensures adapter correctly handles real-world message formats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BCProtocolAdapter } from '@/connection/protocol/BCProtocolAdapter.js';
import type {
  IBCWebSocketManager,
  IBCHandlerEventEmitter,
  HandlerEvent,
} from '@/connection/interfaces.js';
import * as fixtures from '../../../fixtures/bc-messages/index.js';

// Mock logger
vi.mock('@/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('BCProtocolAdapter - Fixture Tests', () => {
  let adapter: BCProtocolAdapter;
  let mockWsManager: IBCWebSocketManager;
  let mockEventEmitter: IBCHandlerEventEmitter;
  let messageHandler: ((msg: any) => void) | null = null;
  let emittedEvents: HandlerEvent[] = [];

  beforeEach(() => {
    emittedEvents = [];

    // Mock WebSocket Manager
    mockWsManager = {
      onRawMessage: vi.fn((handler: (msg: any) => void) => {
        messageHandler = handler;
        return () => {
          messageHandler = null;
        };
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendRpcRequest: vi.fn(),
      isConnected: vi.fn(),
    };

    // Mock Event Emitter
    mockEventEmitter = {
      emit: vi.fn((event: HandlerEvent) => {
        emittedEvents.push(event);
      }),
      onHandlers: vi.fn(),
      waitForHandlers: vi.fn(),
    };

    adapter = new BCProtocolAdapter(mockWsManager, mockEventEmitter);
    adapter.start();
  });

  describe('Message with compressedResult', () => {
    it('should parse and emit Message, RawHandlers, and FormToShow events', () => {
      messageHandler!(fixtures.messageCompressedResult);

      // Should emit 3 events: Message, RawHandlers, FormToShow
      expect(emittedEvents).toHaveLength(3);

      // Message event
      const messageEvent = emittedEvents.find((e) => e.kind === 'Message');
      expect(messageEvent).toBeDefined();
      expect(messageEvent).toMatchObject({
        kind: 'Message',
        sequenceNumber: 42,
        openFormIds: ['page21'],
      });

      // RawHandlers event
      const rawHandlersEvent = emittedEvents.find(
        (e) => e.kind === 'RawHandlers'
      );
      expect(rawHandlersEvent).toBeDefined();
      expect(rawHandlersEvent?.handlers).toHaveLength(1);
      expect(rawHandlersEvent?.handlers[0]).toMatchObject({
        handlerType: 'DN.LogicalClientEventRaisingHandler',
      });

      // FormToShow event
      const formToShowEvent = emittedEvents.find((e) => e.kind === 'FormToShow');
      expect(formToShowEvent).toBeDefined();
      expect(formToShowEvent).toMatchObject({
        kind: 'FormToShow',
        formId: 'page21',
        caption: 'Customer Card',
      });
    });

    it('should track server sequence number', () => {
      messageHandler!(fixtures.messageCompressedResult);

      expect(adapter.getLastServerSequence()).toBe(42);
    });
  });

  describe('Message with compressedData', () => {
    it('should parse LoadForm async responses', () => {
      messageHandler!(fixtures.messageCompressedData);

      // Should emit 2 events: Message, RawHandlers
      expect(emittedEvents).toHaveLength(2);

      // Message event
      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 43,
      });

      // RawHandlers event
      const rawHandlersEvent = emittedEvents.find(
        (e) => e.kind === 'RawHandlers'
      );
      expect(rawHandlersEvent).toBeDefined();
      expect(rawHandlersEvent?.handlers).toHaveLength(1);
      expect(rawHandlersEvent?.handlers[0]).toMatchObject({
        handlerType: 'DN.LoadFormHandler',
      });
    });
  });

  describe('Top-level compressedResult', () => {
    it('should parse top-level compressed messages', () => {
      messageHandler!(fixtures.topLevelCompressed);

      // Should emit 1 event: RawHandlers (no Message envelope)
      expect(emittedEvents).toHaveLength(1);

      expect(emittedEvents[0]).toMatchObject({
        kind: 'RawHandlers',
      });
      expect(emittedEvents[0].handlers).toHaveLength(1);
      expect(emittedEvents[0].handlers[0]).toMatchObject({
        handlerType: 'DN.TopLevelHandler',
      });
    });
  });

  describe('JSON-RPC result.compressedResult', () => {
    it('should parse JSON-RPC response with compressed result', () => {
      messageHandler!(fixtures.jsonrpcCompressed);

      // Should emit 1 event: RawHandlers
      expect(emittedEvents).toHaveLength(1);

      expect(emittedEvents[0]).toMatchObject({
        kind: 'RawHandlers',
      });
      expect(emittedEvents[0].handlers).toHaveLength(1);
      expect(emittedEvents[0].handlers[0]).toMatchObject({
        handlerType: 'DN.JsonRpcHandler',
      });
    });
  });

  describe('Malformed message', () => {
    it('should handle decompression errors gracefully', () => {
      // Should not throw
      expect(() => messageHandler!(fixtures.malformedMessage)).not.toThrow();

      // Should still emit Message event
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 44,
      });

      // Should not emit RawHandlers (decompression failed)
      const rawHandlersEvent = emittedEvents.find(
        (e) => e.kind === 'RawHandlers'
      );
      expect(rawHandlersEvent).toBeUndefined();
    });
  });

  describe('Session info handlers', () => {
    it('should extract and emit SessionInfo event', () => {
      messageHandler!(fixtures.sessionInfoHandlers);

      // Should emit: Message, RawHandlers, SessionInfo, FormToShow
      expect(emittedEvents).toHaveLength(4);

      // SessionInfo event
      const sessionEvent = emittedEvents.find((e) => e.kind === 'SessionInfo');
      expect(sessionEvent).toBeDefined();
      expect(sessionEvent).toMatchObject({
        kind: 'SessionInfo',
        sessionId: 'session-abc-123',
        sessionKey: 'key-xyz-789',
        company: 'CRONUS USA, Inc.',
        roleCenterFormId: 'page9022',
      });

      // FormToShow event (role center)
      const formEvent = emittedEvents.find((e) => e.kind === 'FormToShow');
      expect(formEvent).toBeDefined();
      expect(formEvent).toMatchObject({
        kind: 'FormToShow',
        formId: 'page9022',
        caption: 'Role Center',
      });
    });

    it('should extract session info from deeply nested parameters', () => {
      messageHandler!(fixtures.sessionInfoHandlers);

      const sessionEvent = emittedEvents.find((e) => e.kind === 'SessionInfo');
      expect(sessionEvent).toBeDefined();

      // Verify deep extraction worked (nested.deeper.extraData exists in fixture)
      expect(sessionEvent?.sessionId).toBe('session-abc-123');
      expect(sessionEvent?.sessionKey).toBe('key-xyz-789');
      expect(sessionEvent?.company).toBe('CRONUS USA, Inc.');
    });
  });

  describe('Integration - Multiple fixtures', () => {
    it('should handle sequence of different message types', () => {
      // Send multiple messages
      messageHandler!(fixtures.messageCompressedResult);
      messageHandler!(fixtures.messageCompressedData);
      messageHandler!(fixtures.sessionInfoHandlers);

      // Verify sequence tracking
      expect(adapter.getLastServerSequence()).toBe(43);

      // Verify total events emitted
      // message-compressed-result: 3 (Message, RawHandlers, FormToShow)
      // message-compressed-data: 2 (Message, RawHandlers)
      // session-info-handlers: 4 (Message, RawHandlers, SessionInfo, FormToShow)
      expect(emittedEvents.length).toBeGreaterThanOrEqual(9);

      // Verify event types
      const messageEvents = emittedEvents.filter((e) => e.kind === 'Message');
      const rawHandlersEvents = emittedEvents.filter(
        (e) => e.kind === 'RawHandlers'
      );
      const formToShowEvents = emittedEvents.filter(
        (e) => e.kind === 'FormToShow'
      );
      const sessionEvents = emittedEvents.filter(
        (e) => e.kind === 'SessionInfo'
      );

      expect(messageEvents).toHaveLength(3);
      expect(rawHandlersEvents).toHaveLength(3);
      expect(formToShowEvents).toHaveLength(2);
      expect(sessionEvents).toHaveLength(1);
    });
  });

  describe('CallbackResponse event', () => {
    it('should emit CallbackResponse for DN.CallbackResponseProperties', () => {
      messageHandler!(fixtures.callbackResponse);

      // Should emit: Message, RawHandlers, CallbackResponse
      const callbackEvent = emittedEvents.find((e) => e.kind === 'CallbackResponse');
      expect(callbackEvent).toBeDefined();
      expect(callbackEvent).toMatchObject({
        kind: 'CallbackResponse',
      });
      expect(callbackEvent?.raw).toBeDefined();
      expect(callbackEvent?.raw.handlerType).toBe('DN.CallbackResponseProperties');
    });
  });

  describe('Error events', () => {
    it('should emit Error event for DN.ErrorMessageProperties', () => {
      messageHandler!(fixtures.errorMessage);

      // Should emit: Message, RawHandlers, Error
      const errorEvent = emittedEvents.find((e) => e.kind === 'Error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent).toMatchObject({
        kind: 'Error',
        errorType: 'ErrorMessage',
      });
      expect(errorEvent?.message).toBeDefined();
    });
  });

  describe('ValidationMessage event', () => {
    it('should emit ValidationMessage for DN.ValidationMessageProperties', () => {
      messageHandler!(fixtures.validationMessage);

      // Should emit: Message, RawHandlers, ValidationMessage
      const validationEvent = emittedEvents.find((e) => e.kind === 'ValidationMessage');
      expect(validationEvent).toBeDefined();
      expect(validationEvent).toMatchObject({
        kind: 'ValidationMessage',
      });
      expect(validationEvent?.message).toBeDefined();
    });
  });

  describe('Dialog events', () => {
    it('should emit Dialog event for DN.ConfirmDialogProperties', () => {
      messageHandler!(fixtures.confirmDialog);

      // Should emit: Message, RawHandlers, Dialog
      const dialogEvent = emittedEvents.find((e) => e.kind === 'Dialog');
      expect(dialogEvent).toBeDefined();
      expect(dialogEvent).toMatchObject({
        kind: 'Dialog',
        dialogType: 'Confirm',
      });
      expect(dialogEvent?.message).toBeDefined();
    });
  });
});
