/**
 * Factory for creating BC WebSocket client services.
 *
 * This factory will be implemented incrementally:
 * - Week 2: BCAuthenticationService, BCHandlerEventEmitter, minimal BCProtocolAdapter
 * - Week 3: BCWebSocketManager, complete BCProtocolAdapter
 * - Week 4: BCSessionManager, BCFilterMetadataCache, final wiring
 */

import type { BCConfig } from '../types.js';
import type { TimeoutsConfig } from '../core/timeouts.js';
import type {
  IBCAuthenticationService,
  IBCWebSocketManager,
  IBCSessionManager,
  IBCHandlerEventEmitter,
  IBCProtocolAdapter,
  IBCFilterMetadataCache,
} from './interfaces.js';

/**
 * BC Client with all services wired together.
 *
 * This is the main entry point for creating a fully configured BC client.
 */
export interface IBCClient {
  /** Authentication service */
  readonly authService: IBCAuthenticationService;
  /** WebSocket manager */
  readonly wsManager: IBCWebSocketManager;
  /** Protocol adapter */
  readonly protocolAdapter: IBCProtocolAdapter;
  /** Session manager */
  readonly sessionManager: IBCSessionManager;
  /** Filter metadata cache */
  readonly filterCache: IBCFilterMetadataCache;
  /** Handler event emitter */
  readonly eventEmitter: IBCHandlerEventEmitter;

  /** Authenticate via web login */
  authenticateWeb(): Promise<void>;
  /** Connect to WebSocket */
  connect(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
  /** Disconnect WebSocket */
  disconnect(): Promise<void>;
  /** Open BC session */
  openSession(connectionRequest: unknown): Promise<unknown[]>;
  /** Invoke BC action */
  invoke(options: {
    interactionName: string;
    namedParameters: string | object;
    controlPath?: string;
    formId?: string;
    systemAction?: number;
    openFormIds?: string[];
    sequenceNo?: string;
    lastClientAckSequenceNumber?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<unknown>;
}

/**
 * Create full BC client with all services wired together.
 *
 * NOTE: Implementation will be added incrementally over weeks 2-4.
 *
 * @param config BC connection configuration
 * @param username Username for authentication
 * @param password Password for authentication
 * @param tenantId Optional tenant ID (default: '')
 * @param timeouts Optional timeout configuration
 * @returns Fully configured BC client
 *
 * @throws {Error} Not yet implemented - will be implemented in Week 2-4
 */
export function createBCClient(
  config: BCConfig,
  username: string,
  password: string,
  tenantId: string = '',
  timeouts?: Partial<TimeoutsConfig>
): IBCClient {
  throw new Error(
    'createBCClient not yet implemented - will be implemented during refactoring Week 2-4'
  );
}
