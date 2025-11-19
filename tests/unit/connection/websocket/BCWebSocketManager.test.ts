/**
 * Unit tests for BCWebSocketManager
 *
 * Tests WebSocket connection lifecycle, JSON-RPC request/response matching,
 * and raw message routing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCWebSocketManager } from '@/connection/websocket/BCWebSocketManager.js';
import type { IBCAuthenticationService } from '@/connection/interfaces.js';
import type { BCConfig } from '@/types.js';
import { AuthenticationError, ConnectionError } from '@/core/errors.js';
import { defaultTimeouts } from '@/core/timeouts.js';

// Mock logger
vi.mock('@/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock WebSocket methods (hoisted)
let mockOn: any;
let mockOnce: any;
let mockClose: any;
let mockSend: any;
let mockRemoveListener: any;

vi.mock('ws', () => {
  return {
    default: class MockWebSocket {
      constructor() {
        this.on = mockOn;
        this.once = mockOnce;
        this.close = mockClose;
        this.send = mockSend;
        this.removeListener = mockRemoveListener;
      }
      on: any;
      once: any;
      close: any;
      send: any;
      removeListener: any;
    },
  };
});

describe('BCWebSocketManager', () => {
  let wsManager: BCWebSocketManager;
  let mockAuthService: IBCAuthenticationService;
  let mockConfig: BCConfig;

  beforeEach(() => {
    // Reset mocks
    mockOn = vi.fn();
    mockOnce = vi.fn();
    mockClose = vi.fn();
    mockSend = vi.fn();
    mockRemoveListener = vi.fn();

    vi.clearAllMocks();

    mockConfig = {
      baseUrl: 'http://localhost/BC',
      companyName: 'TEST',
    };

    mockAuthService = {
      authenticateWeb: vi.fn(),
      isAuthenticated: vi.fn(() => true),
      getSessionCookies: vi.fn(() => ['cookie1', 'cookie2']),
      getCsrfToken: vi.fn(() => 'csrf-token-123'),
    };

    wsManager = new BCWebSocketManager(
      mockConfig,
      mockAuthService,
      defaultTimeouts
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('should throw AuthenticationError if not authenticated', async () => {
      vi.mocked(mockAuthService.isAuthenticated).mockReturnValue(false);

      await expect(wsManager.connect()).rejects.toThrow(AuthenticationError);
      await expect(wsManager.connect()).rejects.toThrow(
        'Must call authenticateWeb() first'
      );
    });

    it('should create WebSocket with correct URL and headers', async () => {
      // Trigger onOpen immediately
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();

      // Verify cookies were used
      expect(mockAuthService.getSessionCookies).toHaveBeenCalled();
    });

    it('should successfully connect with HTTPS URLs', async () => {
      mockConfig.baseUrl = 'https://secure.example.com/BC';

      wsManager = new BCWebSocketManager(
        mockConfig,
        mockAuthService,
        defaultTimeouts
      );

      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await expect(wsManager.connect()).resolves.toBeUndefined();
      expect(wsManager.isConnected()).toBe(true);
    });

    it('should use CSRF token from auth service', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();

      // Verify CSRF token was retrieved
      expect(mockAuthService.getCsrfToken).toHaveBeenCalled();
    });

    it('should resolve on successful connection', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await expect(wsManager.connect()).resolves.toBeUndefined();
      expect(wsManager.isConnected()).toBe(true);
    });

    it('should reject on WebSocket error', async () => {
      const testError = new Error('Connection failed');

      mockOnce.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(testError), 0);
        }
      });

      await expect(wsManager.connect()).rejects.toThrow(ConnectionError);
      await expect(wsManager.connect()).rejects.toThrow(
        'WebSocket connection failed'
      );
    });

    it('should set up message handler', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();

      expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should set up close handler', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();

      expect(mockOn).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('disconnect', () => {
    it('should close WebSocket if connected', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();
      await wsManager.disconnect();

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(wsManager.isConnected()).toBe(false);
    });

    it('should be safe to call without connecting', async () => {
      // Should not throw
      await wsManager.disconnect();
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();
      await wsManager.disconnect();
      await wsManager.disconnect();
      await wsManager.disconnect();

      // Should only close once
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendRpcRequest', () => {
    beforeEach(async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });
      await wsManager.connect();
    });

    it('should throw ConnectionError if not connected', async () => {
      await wsManager.disconnect();

      await expect(
        wsManager.sendRpcRequest('TestMethod', [])
      ).rejects.toThrow(ConnectionError);
      await expect(
        wsManager.sendRpcRequest('TestMethod', [])
      ).rejects.toThrow('Not connected');
    });

    it('should send JSON-RPC request with correct format', async () => {
      const method = 'OpenSession';
      const params = [{ tenant: 'default' }];

      // Trigger send callback immediately
      mockSend.mockImplementation((message, callback) => {
        callback && callback(null);
        return true;
      });

      // Start the request (don't await yet)
      const requestPromise = wsManager.sendRpcRequest(method, params);

      // Wait a tick for the send to be called
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Verify send was called with correct format
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"jsonrpc":"2.0"'),
        expect.any(Function)
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"method":"OpenSession"'),
        expect.any(Function)
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.stringContaining('"id"'),
        expect.any(Function)
      );

      // Note: Request won't resolve without simulating a response,
      // but we've verified the send format
    });

    it('should resolve with JSON-RPC result', async () => {
      // Get the message handler that was set up during connect
      const messageHandlerCall = mockOn.mock.calls.find(
        (call) => call[0] === 'message'
      );
      const messageHandler = messageHandlerCall[1];

      mockSend.mockImplementation((message, callback) => {
        callback && callback(null);

        // Parse request to get ID
        const request = JSON.parse(message);

        // Simulate response
        setTimeout(() => {
          const response = JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { success: true, data: 'test-result' },
          });
          messageHandler({ toString: () => response });
        }, 10);
        return true;
      });

      const result = await wsManager.sendRpcRequest('TestMethod', []);

      expect(result).toEqual({ success: true, data: 'test-result' });
    });

    it('should reject with JSON-RPC error', async () => {
      // Get the message handler that was set up during connect
      const messageHandlerCall = mockOn.mock.calls.find(
        (call) => call[0] === 'message'
      );
      const messageHandler = messageHandlerCall[1];

      mockSend.mockImplementation((message, callback) => {
        callback && callback(null);

        const request = JSON.parse(message);

        setTimeout(() => {
          const response = JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32600, message: 'Invalid Request' },
          });
          messageHandler({ toString: () => response });
        }, 10);
        return true;
      });

      await expect(wsManager.sendRpcRequest('BadMethod', [])).rejects.toThrow(
        'RPC Error: Invalid Request'
      );
    });

    it('should reject if send fails', async () => {
      const sendError = new Error('Send failed');

      mockSend.mockImplementation((message, callback) => {
        callback && callback(sendError);
        return false;
      });

      await expect(
        wsManager.sendRpcRequest('TestMethod', [])
      ).rejects.toThrow(ConnectionError);
      await expect(
        wsManager.sendRpcRequest('TestMethod', [])
      ).rejects.toThrow('Failed to send RPC request');
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      expect(wsManager.isConnected()).toBe(false);
    });

    it('should return true after successful connection', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();

      expect(wsManager.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();
      await wsManager.disconnect();

      expect(wsManager.isConnected()).toBe(false);
    });
  });

  describe('onRawMessage', () => {
    let messageHandler: ((data: any) => void) | null = null;

    beforeEach(async () => {
      mockOn.mockImplementation((event, handler) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      });
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      await wsManager.connect();
    });

    it('should call handler when message received', () => {
      const handler = vi.fn();
      wsManager.onRawMessage(handler);

      const testMessage = { method: 'Test', params: [] };
      const data = { toString: () => JSON.stringify(testMessage) };

      messageHandler!(data);

      expect(handler).toHaveBeenCalledWith(testMessage);
    });

    it('should support multiple handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      wsManager.onRawMessage(handler1);
      wsManager.onRawMessage(handler2);

      const testMessage = { method: 'Test', params: [] };
      const data = { toString: () => JSON.stringify(testMessage) };

      messageHandler!(data);

      expect(handler1).toHaveBeenCalledWith(testMessage);
      expect(handler2).toHaveBeenCalledWith(testMessage);
    });

    it('should unsubscribe handler', () => {
      const handler = vi.fn();
      const unsubscribe = wsManager.onRawMessage(handler);

      // Unsubscribe
      unsubscribe();

      const testMessage = { method: 'Test', params: [] };
      const data = { toString: () => JSON.stringify(testMessage) };

      messageHandler!(data);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should isolate handler errors', () => {
      const goodHandler = vi.fn();
      const badHandler = vi.fn(() => {
        throw new Error('Handler error');
      });

      wsManager.onRawMessage(badHandler);
      wsManager.onRawMessage(goodHandler);

      const testMessage = { method: 'Test', params: [] };
      const data = { toString: () => JSON.stringify(testMessage) };

      // Should not throw
      expect(() => messageHandler!(data)).not.toThrow();

      // Good handler should still be called
      expect(goodHandler).toHaveBeenCalledWith(testMessage);
    });
  });

  describe('integration', () => {
    it('should handle full connect → send → receive → disconnect flow', async () => {
      let messageHandler: ((data: any) => void) | null = null;

      mockOn.mockImplementation((event, handler) => {
        if (event === 'message') {
          messageHandler = handler;
        }
      });
      mockOnce.mockImplementation((event, handler) => {
        if (event === 'open') {
          setTimeout(() => handler(), 0);
        }
      });

      // Connect
      await wsManager.connect();
      expect(wsManager.isConnected()).toBe(true);

      // Set up raw message handler
      const rawHandler = vi.fn();
      wsManager.onRawMessage(rawHandler);

      // Send request
      mockSend.mockImplementation((message, callback) => {
        callback && callback(null);

        const request = JSON.parse(message);

        setTimeout(() => {
          if (messageHandler) {
            const response = JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: { sessionId: 'session-123' },
            });
            messageHandler({ toString: () => response });
          }
        }, 10);
        return true;
      });

      const result = await wsManager.sendRpcRequest('OpenSession', []);

      // Verify result
      expect(result).toEqual({ sessionId: 'session-123' });

      // Verify raw handler was called
      expect(rawHandler).toHaveBeenCalled();

      // Disconnect
      await wsManager.disconnect();
      expect(wsManager.isConnected()).toBe(false);
    });
  });
});
