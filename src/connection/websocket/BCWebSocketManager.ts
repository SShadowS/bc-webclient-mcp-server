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

    const fullBaseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const baseUrl = fullBaseUrl.replace(/^https?:\/\//, '');

    // Use wss:// for HTTPS, ws:// for HTTP
    const scheme = fullBaseUrl.startsWith('https://') ? 'wss' : 'ws';

    // Build WebSocket URL with query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('ackseqnb', '-1');
    const csrfToken = this.authService.getCsrfToken();
    if (csrfToken) {
      queryParams.set('csrftoken', csrfToken);
    }

    const wsUrl = `${scheme}://${baseUrl}/csh?${queryParams.toString()}`;

    logger.info(`Connecting to WebSocket: ${wsUrl.substring(0, 100)}...`);

    // Compose timeout with optional parent signal
    const timeoutMs = options?.timeoutMs ?? this.timeouts.connectTimeoutMs;
    const signal = composeWithTimeout(options?.signal, timeoutMs);

    // Create WebSocket with cookies in headers
    const cookieString = this.authService.getSessionCookies().join('; ');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Cookie: cookieString,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      let settled = false;

      // Helper to ensure single resolution
      const settle = (fn: () => void): boolean => {
        if (settled) return true;
        settled = true;
        fn();
        return false;
      };

      // Event handlers
      const onOpen = () => {
        if (
          settle(() => {
            this.connected = true;
            this.ws = ws;
          })
        )
          return;
        cleanup();
        logger.info('✓ Raw WebSocket connection established');
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
        // Close before cleanup to keep error listener active during teardown
        ws.close();
        cleanup();

        // Distinguish timeout from external cancellation
        if (isTimeoutAbortReason(signal.reason)) {
          reject(
            new TimeoutError(
              `WebSocket connection timeout after ${timeoutMs}ms`,
              { timeoutMs }
            )
          );
        } else {
          reject(
            new AbortedError('WebSocket connection cancelled', {
              reason: signal.reason,
            })
          );
        }
      };

      // Cleanup function to remove all listeners
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
      };

      // Handle already-aborted signal before registering listeners
      if (signal.aborted) {
        onAbort();
        return;
      }

      // Register event listeners
      signal.addEventListener('abort', onAbort, { once: true });
      ws.once('open', onOpen);
      ws.once('error', onError);

      // Set up message handler (persists after connection)
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = data.toString();
          logger.info(`← Received: ${message.substring(0, 200)}...`);

          const response = JSON.parse(message) as any;

          // 🐛 Debug: Log incoming WebSocket messages
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
          // Protocol adapter will handle BC-specific parsing
          this.rawMessageHandlers.forEach((handler) => {
            try {
              handler(response);
            } catch (error) {
              logger.error({ error }, 'Raw message handler error');
            }
          });

          // Handle responses in two ways:
          // 1) Standard JSON-RPC responses (explicit ID match)
          if (response.jsonrpc && response.id) {
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
              // BC protocol: Some RPCs (like OpenSession) have meaningful payload
              // in async Message events, NOT in the JSON-RPC result.
              // Only resolve here if result contains compressed data.
              // Otherwise, leave pending for async Message resolution.
              if (
                response.result &&
                (response.result.compressedResult || response.result.compressedData)
              ) {
                // Result has compressed data in result field - resolve immediately
                this.pendingRequests.delete(response.id);
                pending.resolve(response.result);
              } else if (response.compressedResult || response.compressedData) {
                // Compressed data at root level (e.g., OpenSession) - resolve immediately
                this.pendingRequests.delete(response.id);
                pending.resolve(response);
              } else if (response.error) {
                // Errors should always be resolved immediately
                this.pendingRequests.delete(response.id);
                pending.reject(
                  new Error(`RPC Error: ${response.error.message}`)
                );
              } else {
                // JSON-RPC ack without compressed data
                logger.info(`JSON-RPC response with ID ${response.id} has no compressed data, result: ${JSON.stringify(response.result).substring(0, 100)}`);
                logger.info(`  Leaving pending request unresolved, waiting for async Message event`);
                logger.info(`  Pending requests count: ${this.pendingRequests.size}`);
              }
            } else {
              logger.warn(`Received JSON-RPC response with ID ${response.id} but no pending request found`);
            }
          }
          // 2) Async Message events with compressed data (BC's primary response format)
          // These don't have request IDs, so we resolve the first pending request
          else if (response.method === 'Message') {
            logger.info(`Received async Message event`);
            if (response.params?.[0]?.compressedResult || response.params?.[0]?.compressedData) {
              logger.info(`  Message has compressed data, resolving first pending request`);
              // For async Message events, resolve the first (oldest) pending request
              // This matches the original code's behavior
              if (this.pendingRequests.size > 0) {
                const [[requestId, pending]] = this.pendingRequests.entries();
                this.pendingRequests.delete(requestId);
                logger.info(`  Resolved pending request ${requestId}, remaining: ${this.pendingRequests.size}`);
                // Return the raw result (caller handles decompression)
                pending.resolve(response.params[0]);
              } else {
                logger.warn(`  No pending requests to resolve!`);
              }
            } else {
              logger.info(`  Message has no compressed data, ignoring (params: ${JSON.stringify(response.params).substring(0, 100)})`);
            }
          } else {
            // Log any other message types we're not handling
            logger.info(`Unhandled message type: ${response.method || 'no method'}, jsonrpc: ${response.jsonrpc || 'no jsonrpc'}`);
          }
        } catch (error) {
          logger.error({ error }, 'Error parsing message');
        }
      });

      // Set up close handler (persists after connection)
      ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'no reason';
        logger.info(`WebSocket closed: ${code} ${reasonStr}`);
        this.connected = false;

        // Reject all pending requests
        this.pendingRequests.forEach((pending) => {
          pending.reject(new Error('WebSocket closed'));
        });
        this.pendingRequests.clear();
      });
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
      logger.info('✓ WebSocket connection closed');
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
      logger.info(`→ Sending: ${message.substring(0, 200)}...`);

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
