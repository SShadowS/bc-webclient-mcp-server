/**
 * Unit tests for BCProtocolAdapter
 *
 * Tests protocol parsing, decompression, sequence tracking, and event emission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCProtocolAdapter } from '@/connection/protocol/BCProtocolAdapter.js';
import type {
  IBCWebSocketManager,
  IBCHandlerEventEmitter,
  HandlerEvent,
} from '@/connection/interfaces.js';
import { gzipSync } from 'zlib';

// Mock logger
vi.mock('@/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('BCProtocolAdapter', () => {
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
        // Return unsubscribe function
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should subscribe to raw messages', () => {
      adapter.start();

      expect(mockWsManager.onRawMessage).toHaveBeenCalledTimes(1);
      expect(mockWsManager.onRawMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should be idempotent (safe to call multiple times)', () => {
      adapter.start();
      adapter.start();
      adapter.start();

      // Should only subscribe once
      expect(mockWsManager.onRawMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('should unsubscribe from raw messages', () => {
      adapter.start();
      expect(messageHandler).not.toBeNull();

      adapter.stop();
      expect(messageHandler).toBeNull();
    });

    it('should be idempotent (safe to call multiple times)', () => {
      adapter.start();
      adapter.stop();
      adapter.stop();
      adapter.stop();

      // Should not throw
      expect(messageHandler).toBeNull();
    });

    it('should be safe to call without starting', () => {
      // Should not throw
      adapter.stop();
    });
  });

  describe('getLastServerSequence', () => {
    it('should return -1 initially', () => {
      expect(adapter.getLastServerSequence()).toBe(-1);
    });

    it('should return tracked sequence after Message event', () => {
      adapter.start();

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 42 }],
      };

      messageHandler!(message);

      expect(adapter.getLastServerSequence()).toBe(42);
    });

    it('should track increasing sequence numbers', () => {
      adapter.start();

      messageHandler!({ method: 'Message', params: [{ sequenceNumber: 10 }] });
      expect(adapter.getLastServerSequence()).toBe(10);

      messageHandler!({ method: 'Message', params: [{ sequenceNumber: 20 }] });
      expect(adapter.getLastServerSequence()).toBe(20);

      messageHandler!({ method: 'Message', params: [{ sequenceNumber: 30 }] });
      expect(adapter.getLastServerSequence()).toBe(30);
    });

    it('should not decrease sequence number', () => {
      adapter.start();

      messageHandler!({ method: 'Message', params: [{ sequenceNumber: 100 }] });
      expect(adapter.getLastServerSequence()).toBe(100);

      // Older sequence - should not update
      messageHandler!({ method: 'Message', params: [{ sequenceNumber: 50 }] });
      expect(adapter.getLastServerSequence()).toBe(100);
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      adapter.start();
    });

    it('should emit Message event for Message method', () => {
      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 42 }],
      };

      messageHandler!(message);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 42,
        raw: message,
      });
    });

    it('should include openFormIds in Message event if present', () => {
      const message = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            openFormIds: ['form1', 'form2'],
          },
        ],
      };

      messageHandler!(message);

      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 42,
        openFormIds: ['form1', 'form2'],
      });
    });

    it('should emit Message event without openFormIds if not present', () => {
      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 42 }],
      };

      messageHandler!(message);

      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 42,
      });
      expect(emittedEvents[0].openFormIds).toBeUndefined();
    });

    it('should decompress and emit RawHandlers event', () => {
      const handlers = [
        { handlerType: 'DN.Test', parameters: ['param1'] },
      ];

      // Compress handlers
      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      // Message with compressed result
      const message = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            compressedResult: base64,
          },
        ],
      };

      messageHandler!(message);

      // Should emit both Message and RawHandlers events
      expect(emittedEvents).toHaveLength(2);

      // First: Message event
      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 42,
      });

      // Second: RawHandlers event
      expect(emittedEvents[1]).toMatchObject({
        kind: 'RawHandlers',
        handlers,
      });
    });

    it('should handle compressedData (LoadForm async responses)', () => {
      const handlers = [{ handlerType: 'DN.LoadForm', parameters: [] }];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 43,
            compressedData: base64, // LoadForm uses compressedData
          },
        ],
      };

      messageHandler!(message);

      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[1]).toMatchObject({
        kind: 'RawHandlers',
        handlers,
      });
    });

    it('should handle top-level compressedResult', () => {
      const handlers = [{ handlerType: 'DN.TopLevel', parameters: [] }];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        compressedResult: base64,
      };

      messageHandler!(message);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        kind: 'RawHandlers',
        handlers,
      });
    });

    it('should handle JSON-RPC result.compressedResult', () => {
      const handlers = [{ handlerType: 'DN.JsonRpc', parameters: [] }];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        jsonrpc: '2.0',
        id: '123',
        result: {
          compressedResult: base64,
        },
      };

      messageHandler!(message);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        kind: 'RawHandlers',
        handlers,
      });
    });

    it('should handle messages without compressed data', () => {
      const message = {
        jsonrpc: '2.0',
        id: '123',
        result: {
          someField: 'value',
        },
      };

      messageHandler!(message);

      // Should not emit any RawHandlers event
      expect(emittedEvents).toHaveLength(0);
    });

    it('should handle errors gracefully', () => {
      const message = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            compressedResult: 'invalid-base64!!!',
          },
        ],
      };

      // Should not throw
      expect(() => messageHandler!(message)).not.toThrow();

      // Should still emit Message event
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].kind).toBe('Message');
    });
  });

  describe('typed events', () => {
    beforeEach(() => {
      adapter.start();
    });

    it('should emit FormToShow event', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: [
            'FormToShow',
            { ServerId: 'page21', Caption: 'Customer Card' },
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      // Should emit: Message, RawHandlers, FormToShow
      expect(emittedEvents).toHaveLength(3);

      const formToShowEvent = emittedEvents.find((e) => e.kind === 'FormToShow');
      expect(formToShowEvent).toBeDefined();
      expect(formToShowEvent).toMatchObject({
        kind: 'FormToShow',
        formId: 'page21',
        caption: 'Customer Card',
        raw: handlers[0],
      });
    });

    it('should emit multiple FormToShow events', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: ['FormToShow', { ServerId: 'page21', Caption: 'Card' }],
        },
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: ['FormToShow', { ServerId: 'page22', Caption: 'List' }],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const formEvents = emittedEvents.filter((e) => e.kind === 'FormToShow');
      expect(formEvents).toHaveLength(2);
      expect(formEvents[0]).toMatchObject({ formId: 'page21', caption: 'Card' });
      expect(formEvents[1]).toMatchObject({ formId: 'page22', caption: 'List' });
    });

    it('should emit SessionInfo event', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientSetupHandler',
          parameters: [
            {
              ServerSessionId: 'session-123',
              SessionKey: 'key-456',
              CompanyName: 'CRONUS USA, Inc.',
            },
          ],
        },
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: [
            'FormToShow',
            { ServerId: 'page9022', Caption: 'Role Center' },
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const sessionEvent = emittedEvents.find((e) => e.kind === 'SessionInfo');
      expect(sessionEvent).toBeDefined();
      expect(sessionEvent).toMatchObject({
        kind: 'SessionInfo',
        sessionId: 'session-123',
        sessionKey: 'key-456',
        company: 'CRONUS USA, Inc.',
        roleCenterFormId: 'page9022',
        raw: handlers[0],
      });
    });

    it('should emit SessionInfo without roleCenterFormId if no FormToShow', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientSetupHandler',
          parameters: [
            {
              ServerSessionId: 'session-123',
              SessionKey: 'key-456',
              CompanyName: 'CRONUS USA, Inc.',
            },
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const sessionEvent = emittedEvents.find((e) => e.kind === 'SessionInfo');
      expect(sessionEvent).toBeDefined();
      expect(sessionEvent).toMatchObject({
        kind: 'SessionInfo',
        sessionId: 'session-123',
        sessionKey: 'key-456',
        company: 'CRONUS USA, Inc.',
      });
      expect(sessionEvent?.roleCenterFormId).toBeUndefined();
    });

    it('should not emit SessionInfo if missing required fields', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientSetupHandler',
          parameters: [
            {
              ServerSessionId: 'session-123',
              // Missing SessionKey and CompanyName
            },
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const sessionEvent = emittedEvents.find((e) => e.kind === 'SessionInfo');
      expect(sessionEvent).toBeUndefined();
    });

    it('should emit DataRefreshChange event', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'formId',
            [
              { t: 'PropertyChanges' },
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
                RowChanges: [
                  {
                    t: 'DataRowInserted',
                    DataRowInserted: [0, { cells: { No: '10000' } }],
                  },
                ],
              },
            ],
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const dataRefreshEvent = emittedEvents.find(
        (e) => e.kind === 'DataRefreshChange'
      );
      expect(dataRefreshEvent).toBeDefined();
      expect(dataRefreshEvent).toMatchObject({
        kind: 'DataRefreshChange',
        updates: [
          {
            t: 'DataRefreshChange',
            ControlReference: { controlPath: 'server:c[1]' },
            RowChanges: [
              {
                t: 'DataRowInserted',
                DataRowInserted: [0, { cells: { No: '10000' } }],
              },
            ],
          },
        ],
        raw: handlers[0],
      });
    });

    it('should filter only DataRefreshChange from changes array', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'formId',
            [
              { t: 'PropertyChanges' },
              { t: 'SomeOtherChange' },
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[1]' },
              },
              { t: 'AnotherChange' },
              {
                t: 'DataRefreshChange',
                ControlReference: { controlPath: 'server:c[2]' },
              },
            ],
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const dataRefreshEvent = emittedEvents.find(
        (e) => e.kind === 'DataRefreshChange'
      );
      expect(dataRefreshEvent).toBeDefined();
      expect(dataRefreshEvent?.updates).toHaveLength(2);
      expect(dataRefreshEvent?.updates[0]).toMatchObject({
        t: 'DataRefreshChange',
        ControlReference: { controlPath: 'server:c[1]' },
      });
      expect(dataRefreshEvent?.updates[1]).toMatchObject({
        t: 'DataRefreshChange',
        ControlReference: { controlPath: 'server:c[2]' },
      });
    });

    it('should not emit DataRefreshChange if no matching changes', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: [
            'formId',
            [{ t: 'PropertyChanges' }, { t: 'SomeOtherChange' }],
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const dataRefreshEvent = emittedEvents.find(
        (e) => e.kind === 'DataRefreshChange'
      );
      expect(dataRefreshEvent).toBeUndefined();
    });

    it('should extract session info from deeply nested parameters', () => {
      const handlers = [
        {
          handlerType: 'DN.Complex',
          parameters: [
            'outer',
            {
              nested: {
                deeper: {
                  ServerSessionId: 'deep-session',
                  SessionKey: 'deep-key',
                },
              },
            },
            {
              another: {
                CompanyName: 'Deep Company',
              },
            },
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [{ sequenceNumber: 1, compressedResult: base64 }],
      };

      messageHandler!(message);

      const sessionEvent = emittedEvents.find((e) => e.kind === 'SessionInfo');
      expect(sessionEvent).toBeDefined();
      expect(sessionEvent).toMatchObject({
        kind: 'SessionInfo',
        sessionId: 'deep-session',
        sessionKey: 'deep-key',
        company: 'Deep Company',
      });
    });
  });

  describe('integration', () => {
    it('should track sequence and emit events for full BC response flow', () => {
      adapter.start();

      // Simulate BC response with Message envelope and compressed handlers
      const handlers = [
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: ['FormToShow', { ServerId: 'page21' }],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const message = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 99,
            openFormIds: ['page21'],
            compressedResult: base64,
          },
        ],
      };

      messageHandler!(message);

      // Verify sequence tracked
      expect(adapter.getLastServerSequence()).toBe(99);

      // Verify events emitted (Message + RawHandlers + FormToShow)
      expect(emittedEvents).toHaveLength(3);

      // Message event
      expect(emittedEvents[0]).toMatchObject({
        kind: 'Message',
        sequenceNumber: 99,
        openFormIds: ['page21'],
      });

      // RawHandlers event
      expect(emittedEvents[1]).toMatchObject({
        kind: 'RawHandlers',
        handlers,
      });

      // FormToShow event
      expect(emittedEvents[2]).toMatchObject({
        kind: 'FormToShow',
        formId: 'page21',
      });
    });

    it('should handle multiple messages in sequence', () => {
      adapter.start();

      // First message
      messageHandler!({
        method: 'Message',
        params: [{ sequenceNumber: 1 }],
      });

      // Second message with handlers
      const handlers = [{ handlerType: 'DN.Test', parameters: [] }];
      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      messageHandler!({
        method: 'Message',
        params: [{ sequenceNumber: 2, compressedResult: base64 }],
      });

      // Third message
      messageHandler!({
        method: 'Message',
        params: [{ sequenceNumber: 3 }],
      });

      // Verify sequence
      expect(adapter.getLastServerSequence()).toBe(3);

      // Verify events
      expect(emittedEvents).toHaveLength(4); // 3 Message events + 1 RawHandlers event
      expect(emittedEvents.filter((e) => e.kind === 'Message')).toHaveLength(3);
      expect(emittedEvents.filter((e) => e.kind === 'RawHandlers')).toHaveLength(1);
    });
  });
});
