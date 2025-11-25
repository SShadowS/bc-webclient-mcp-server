/**
 * BC WebSocket Manager
 *
 * Manages raw WebSocket connection and JSON-RPC request/response lifecycle.
 *
 * Responsibilities:
 * - WebSocket connection lifecycle (connect/disconnect)
 * - JSON-RPC request/response matching
 * - Raw message routing to subscribers (for protocol adapter)
 *
 * IMPORTANT: Does NOT parse BC protocol. Protocol parsing is delegated to
 * BCProtocolAdapter which subscribes to raw messages via onRawMessage().
 *
 * Usage:
 * ```ts
 * const wsManager = new BCWebSocketManager(config, authService, timeouts);
 * await wsManager.connect();
 *
 * // Protocol adapter subscribes to raw messages
 * const unsubscribe = wsManager.onRawMessage((msg) => {
 *   // Parse BC protocol here
 * });
 *
 * // Send JSON-RPC requests
 * const result = await wsManager.sendRpcRequest('OpenSession', [params]);
 * ```
 */

import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../core/logger.js';
import { debugWebSocket } from '../../services/debug-logger.js';
import { config } from '../../core/config.js';
import { composeWithTimeout, isTimeoutAbortReason } from '../../core/abort.js';
import { defaultTimeouts, type TimeoutsConfig } from '../../core/timeouts.js';
import {
  TimeoutError,
  AbortedError,
  ConnectionError,
  AuthenticationError,
} from '../../core/errors.js';
import type {
  IBCWebSocketManager,
  IBCAuthenticationService,
} from '../interfaces.js';
import type { BCConfig, JsonRpcRequest } from '../../types.js';

/**
 * WebSocket manager implementation for Business Central.
 *
 * Week 3: Extracted from BCRawWebSocketClient to separate transport
 * from protocol parsing.
 */
export class BCWebSocketManager implements IBCWebSocketManager {
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
    }
  >();
  private rawMessageHandlers: Array<(msg: any) => void> = [];

  constructor(
    private readonly config: BCConfig,
    private readonly authService: IBCAuthenticationService,
    private readonly timeouts: TimeoutsConfig
  ) {}

  /**
   * Build WebSocket URL with query parameters.
   */
  private buildWebSocketUrl(): string {
    const fullBaseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const baseUrl = fullBaseUrl.replace(/^https?:\/\//, '');
    const scheme = fullBaseUrl.startsWith('https://') ? 'wss' : 'ws';

    const queryParams = new URLSearchParams();
    queryParams.set('ackseqnb', '-1');
    const csrfToken = this.authService.getCsrfToken();
    if (csrfToken) {
      queryParams.set('csrftoken', csrfToken);
    }

    return `${scheme}://${baseUrl}/csh?${queryParams.toString()}`;
  }

  /**
   * Handle JSON-RPC response with explicit ID match.
   */
  private handleJsonRpcResponse(response: any): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      logger.warn(`Received JSON-RPC response with ID ${response.id} but no pending request found`);
      return;
    }

    // BC protocol: Some RPCs have meaningful payload in async Message events.
    // Only resolve here if result contains compressed data.
    if (response.result && (response.result.compressedResult || response.result.compressedData)) {
      this.pendingRequests.delete(response.id);
      pending.resolve(response.result);
    } else if (response.compressedResult || response.compressedData) {
      // Compressed data at root level (e.g., OpenSession)
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    } else if (response.error) {
      this.pendingRequests.delete(response.id);
      pending.reject(new Error(`RPC Error: ${response.error.message}`));
    } else {
      // JSON-RPC ack without compressed data - wait for async Message
      logger.info(`JSON-RPC response ${response.id} has no compressed data, waiting for async Message`);
    }
  }

  /**
   * Handle async Message events (BC's primary response format).
   */
  private handleAsyncMessage(response: any): void {
    logger.info(`Received async Message event`);

    const hasCompressedData = response.params?.[0]?.compressedResult || response.params?.[0]?.compressedData;
    if (!hasCompressedData) {
      logger.info(`  Message has no compressed data, ignoring`);
      return;
    }

    logger.info(`  Message has compressed data, resolving first pending request`);

    if (this.pendingRequests.size > 0) {
      const [[requestId, pending]] = this.pendingRequests.entries();
      this.pendingRequests.delete(requestId);
      logger.info(`  Resolved pending request ${requestId}, remaining: ${this.pendingRequests.size}`);
      pending.resolve(response.params[0]);
    } else {
      // No pending RPC request - forward async data to protocol adapter
      logger.info(`  No pending RPC request - forwarding async Message to protocol adapter`);
      this.rawMessageHandlers.forEach((handler) => {
        try {
          handler(response);
        } catch (error) {
          logger.error({ error }, 'Error in raw message handler');
        }
      });
    }
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleWebSocketMessage(data: WebSocket.Data): void {
    try {
      const message = data.toString();
      logger.info(`<- Received: ${message.substring(0, 200)}...`);

      const response = JSON.parse(message) as any;

      debugWebSocket('WebSocket message received', {
        messageType: response.method || 'response',
        id: response.id,
        method: response.method,
        hasResult: !!response.result,
        hasError: !!response.error,
        hasHandlers: !!response.result?.handlers,
        handlerCount: response.result?.handlers?.length,
        fullMessage: config.debug.logFullWsMessages ? response : undefined,
      }, undefined, Buffer.byteLength(message));

      // Emit to raw message handlers (for protocol adapter)
      this.rawMessageHandlers.forEach((handler) => {
        try {
          handler(response);
        } catch (error) {
          logger.error({ error }, 'Raw message handler error');
        }
      });

      // Route to appropriate handler
      if (response.jsonrpc && response.id) {
        this.handleJsonRpcResponse(response);
      } else if (response.method === 'Message') {
        this.handleAsyncMessage(response);
      } else {
        logger.info(`Unhandled message type: ${response.method || 'no method'}`);
      }
    } catch (error) {
      logger.error({ error }, 'Error parsing message');
    }
  }

  /**
   * Handle WebSocket close event.
   */
  private handleWebSocketClose(code: number, reason: Buffer): void {
    const reasonStr = reason ? reason.toString() : 'no reason';
    logger.info(`WebSocket closed: ${code} ${reasonStr}`);
    this.connected = false;

    // Reject all pending requests
    this.pendingRequests.forEach((pending) => {
      pending.reject(new Error('WebSocket closed'));
    });
    this.pendingRequests.clear();
  }

  /**
   * Set up persistent message and close handlers on WebSocket.
   */
  private setupPersistentHandlers(ws: WebSocket): void {
    ws.on('message', (data: WebSocket.Data) => this.handleWebSocketMessage(data));
    ws.on('close', (code: number, reason: Buffer) => this.handleWebSocketClose(code, reason));
  }

  /**
   * Connect to WebSocket with session cookies.
   *
   * Establishes WebSocket connection using authenticated session cookies.
   * Must call authService.authenticateWeb() first.
   *
   * @param options Optional cancellation signal and timeout override
   * @param options.signal Optional AbortSignal for external cancellation
   * @param options.timeoutMs Optional timeout override (default: 10s from config)
   */
  public async connect(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      throw new AuthenticationError('Must call authenticateWeb() first');
    }

    const wsUrl = this.buildWebSocketUrl();
    logger.info(`Connecting to WebSocket: ${wsUrl.substring(0, 100)}...`);

    const timeoutMs = options?.timeoutMs ?? this.timeouts.connectTimeoutMs;
    const signal = composeWithTimeout(options?.signal, timeoutMs);
    const cookieString = this.authService.getSessionCookies().join('; ');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Cookie: cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      let settled = false;

      const settle = (fn: () => void): boolean => {
        if (settled) return true;
        settled = true;
        fn();
        return false;
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
      };

      const onOpen = () => {
        if (settle(() => { this.connected = true; this.ws = ws; })) return;
        cleanup();
        this.setupPersistentHandlers(ws);
        logger.info('Raw WebSocket connection established');
        resolve();
      };

      const onError = (error: Error) => {
        if (settle(() => (this.connected = false))) return;
        cleanup();
        logger.error({ error }, 'WebSocket error');
        reject(new ConnectionError('WebSocket connection failed', { error }));
      };

      const onAbort = () => {
        if (settle(() => (this.connected = false))) return;
        ws.close();
        cleanup();

        if (isTimeoutAbortReason(signal.reason)) {
          reject(new TimeoutError(`WebSocket connection timeout after ${timeoutMs}ms`, { timeoutMs }));
        } else {
          reject(new AbortedError('WebSocket connection cancelled', { reason: signal.reason }));
        }
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener('abort', onAbort, { once: true });
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  /**
   * Disconnect WebSocket.
   *
   * Closes the WebSocket connection if open.
   */
  public async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      logger.info('WebSocket connection closed');
    }
  }

  /**
   * Send JSON-RPC request and wait for response.
   *
   * @param method RPC method name
   * @param params RPC parameters
   * @param options Optional cancellation signal and timeout
   * @returns Promise resolving to RPC result
   */
  public async sendRpcRequest(
    method: string,
    params: any[],
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<any> {
    if (!this.ws || !this.connected) {
      throw new ConnectionError('Not connected. Call connect() first.');
    }

    const requestId = uuidv4();
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: requestId,
    };

    // Compose timeout with optional parent signal
    const timeoutMs = options?.timeoutMs ?? this.timeouts.rpcTimeoutMs;
    const signal = composeWithTimeout(options?.signal, timeoutMs);

    return new Promise((resolve, reject) => {
      // Event handlers
      const onAbort = () => {
        cleanup();
        this.pendingRequests.delete(requestId);

        // Distinguish timeout from external cancellation
        if (isTimeoutAbortReason(signal.reason)) {
          reject(
            new TimeoutError(`RPC request timeout after ${timeoutMs}ms: ${method}`, {
              method,
              timeoutMs,
            })
          );
        } else {
          reject(
            new AbortedError(`RPC request cancelled: ${method}`, {
              method,
              reason: signal.reason,
            })
          );
        }
      };

      // Cleanup function
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      // Handle already-aborted signal before registering listener
      if (signal.aborted) {
        onAbort();
        return;
      }

      // Register abort listener
      signal.addEventListener('abort', onAbort, { once: true });

      // Store pending request (will be resolved by message handler)
      this.pendingRequests.set(requestId, {
        resolve: (value: any) => {
          cleanup();
          resolve(value);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      });

      // Send request
      const message = JSON.stringify(rpcRequest);
      logger.info(`-> Sending: ${message.substring(0, 200)}...`);

      // 🐛 Debug: Log outgoing WebSocket messages
      debugWebSocket('WebSocket request sent', {
        method,
        requestId,
        paramsCount: params.length,
        fullRequest: config.debug.logFullWsMessages ? rpcRequest : undefined,
      }, requestId, Buffer.byteLength(message));

      this.ws!.send(message, (error) => {
        if (error) {
          cleanup();
          this.pendingRequests.delete(requestId);
          reject(
            new ConnectionError('Failed to send RPC request', { method, error })
          );
        }
      });
    });
  }

  /**
   * Check if WebSocket is connected.
   *
   * @returns true if connected, false otherwise
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Subscribe to raw WebSocket messages.
   *
   * Allows protocol adapter to receive all raw messages for BC protocol parsing.
   *
   * @param handler Callback receiving raw message
   * @returns Unsubscribe function
   *
   * @example
   * ```ts
   * const unsubscribe = wsManager.onRawMessage((msg) => {
   *   // Parse BC protocol
   * });
   *
   * // Later: unsubscribe when done
   * unsubscribe();
   * ```
   */
  public onRawMessage(handler: (msg: any) => void): () => void {
    this.rawMessageHandlers.push(handler);

    return () => {
      const index = this.rawMessageHandlers.indexOf(handler);
      if (index !== -1) {
        this.rawMessageHandlers.splice(index, 1);
      }
    };
  }
}
