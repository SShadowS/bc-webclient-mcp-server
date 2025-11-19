/**
 * Core service interfaces for BC WebSocket client architecture.
 *
 * These interfaces define contracts between services and enable:
 * - Dependency injection
 * - Isolated testing
 * - Clear architectural boundaries
 *
 * CRITICAL STATE OWNERSHIP RULES:
 * - BCSessionState is EXCLUSIVELY owned by BCSessionManager
 * - Other services get read-only views via getSessionState()
 * - State updates flow ONLY via HandlerEvent subscription (event-driven)
 * - BCProtocolAdapter NEVER calls BCSessionManager directly
 */

import type { BCConfig } from '../types.js';

// ============================================================================
// Shared Types (Re-exports)
// ============================================================================

/**
 * Cancelable operation options (timeout + abort support).
 * Re-exported from core/abort.ts to avoid duplication.
 */
export type { CancelableOptions } from '../core/abort.js';

// ============================================================================
// BC Protocol Types
// ============================================================================

/**
 * BC handler object (returned by BC protocol).
 *
 * Handlers are the fundamental unit of BC responses, containing
 * instructions for the client (form updates, validation, etc.)
 */
export type BCHandler = {
  handlerType: string;
  parameters?: any[];
};

/**
 * Typed handler events for protocol → session communication.
 *
 * CRITICAL: BCSessionManager MUST subscribe to these events via
 * IBCHandlerEventEmitter and update BCSessionState accordingly.
 * This is the ONLY way session state should be modified.
 *
 * Event Flow:
 * 1. BCProtocolAdapter parses WebSocket messages
 * 2. BCProtocolAdapter emits HandlerEvents via EventEmitter
 * 3. BCSessionManager receives events and updates BCSessionState
 * 4. NO direct ProtocolAdapter → SessionManager calls (avoids circular deps)
 */
export type HandlerEvent =
  | {
      kind: 'FormToShow';
      formId: string;
      caption?: string;
      raw: BCHandler;
    }
  | {
      kind: 'DataRefreshChange';
      updates: any[];
      raw: BCHandler;
    }
  | {
      kind: 'Message';
      sequenceNumber: number;
      openFormIds?: string[];
      raw: any;
    }
  | {
      kind: 'SessionInfo';
      sessionId: string;
      sessionKey: string;
      company: string;
      roleCenterFormId?: string;
      raw: BCHandler;
    }
  | {
      kind: 'RawHandlers';
      handlers: BCHandler[];
    }
  | {
      kind: 'CallbackResponse';
      raw: BCHandler;
    }
  | {
      kind: 'Error';
      errorType: 'ErrorMessage' | 'ErrorDialog';
      message?: string;
      raw: BCHandler;
    }
  | {
      kind: 'ValidationMessage';
      message?: string;
      raw: BCHandler;
    }
  | {
      kind: 'Dialog';
      dialogType: 'Confirm' | 'YesNo';
      message?: string;
      raw: BCHandler;
    };

// ============================================================================
// Service Interfaces
// ============================================================================

/**
 * Authentication service for BC Web Client login.
 *
 * Responsibilities:
 * - HTTP login to get session cookies
 * - CSRF token extraction from Antiforgery cookie
 * - Credential management
 *
 * Depends on: Nothing (foundational service)
 * Used by: BCWebSocketManager (for cookies/CSRF)
 */
export interface IBCAuthenticationService {
  /**
   * Authenticate via web login to get session cookies and CSRF token.
   *
   * @throws {AuthenticationError} If login fails
   */
  authenticateWeb(): Promise<void>;

  /**
   * Get current session cookies.
   *
   * @returns Array of cookie strings (name=value format)
   */
  getSessionCookies(): string[];

  /**
   * Get CSRF token for WebSocket connection.
   *
   * @returns CSRF token or null if not available
   */
  getCsrfToken(): string | null;

  /**
   * Check if authenticated.
   *
   * @returns true if authenticateWeb() completed successfully
   */
  isAuthenticated(): boolean;
}

/**
 * WebSocket manager for raw WebSocket lifecycle and JSON-RPC.
 *
 * Responsibilities:
 * - WebSocket connection lifecycle (connect/disconnect)
 * - JSON-RPC request/response matching
 * - Raw message routing to protocol adapter
 *
 * IMPORTANT: This service knows NOTHING about BC protocol semantics.
 * It only handles WebSocket transport and JSON-RPC mechanics.
 * BC-specific parsing happens in BCProtocolAdapter.
 *
 * Depends on: BCAuthenticationService
 * Used by: BCSessionManager, BCProtocolAdapter
 */
export interface IBCWebSocketManager {
  /**
   * Connect to BC WebSocket with session cookies.
   *
   * @param options Optional timeout and abort signal
   * @throws {AuthenticationError} If not authenticated
   * @throws {ConnectionError} If connection fails
   * @throws {TimeoutError} If connection times out
   */
  connect(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void>;

  /**
   * Disconnect WebSocket.
   *
   * Rejects all pending RPC requests and cleans up listeners.
   */
  disconnect(): Promise<void>;

  /**
   * Send JSON-RPC request and wait for response.
   *
   * @param method RPC method name (e.g., "Invoke", "OpenSession")
   * @param params RPC parameters array
   * @param options Optional timeout and abort signal
   * @returns RPC response result
   * @throws {ConnectionError} If not connected or send fails
   * @throws {TimeoutError} If request times out
   */
  sendRpcRequest(
    method: string,
    params: any[],
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<any>;

  /**
   * Check if WebSocket is connected.
   *
   * @returns true if connected
   */
  isConnected(): boolean;

  /**
   * Subscribe to raw WebSocket messages.
   *
   * Used by BCProtocolAdapter to parse BC-specific protocol.
   *
   * @param handler Callback for each message
   * @returns Unsubscribe function
   */
  onRawMessage(handler: (msg: any) => void): () => void;
}

/**
 * Event emitter for BC handler arrays.
 *
 * Responsibilities:
 * - Pub/sub for HandlerEvent objects
 * - Predicate-based waiting for specific events
 * - Event emission from protocol adapter
 *
 * This is a stateless service (except for subscriptions).
 * It does NOT own any session or protocol state.
 *
 * Depends on: Nothing (independent utility)
 * Used by: BCProtocolAdapter (emit), BCSessionManager (subscribe), consumers (wait)
 */
export interface IBCHandlerEventEmitter {
  /**
   * Subscribe to handler events.
   *
   * @param listener Callback for each event
   * @returns Unsubscribe function
   */
  onHandlers(listener: (event: HandlerEvent) => void): () => void;

  /**
   * Wait for a handler event that matches the predicate.
   *
   * @param predicate Function that returns {matched: true, data} when event matches
   * @param options Optional timeout and abort signal
   * @returns Promise resolving to matched data
   * @throws {TimeoutError} If no matching event arrives within timeout
   */
  waitForHandlers<T>(
    predicate: (event: HandlerEvent) => { matched: boolean; data?: T },
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<T>;

  /**
   * Emit a handler event to all subscribers.
   *
   * Called by BCProtocolAdapter after parsing WebSocket messages.
   *
   * @param event The handler event to emit
   */
  emit(event: HandlerEvent): void;
}

/**
 * BC protocol adapter (decodes BC-specific protocol from JSON-RPC).
 *
 * Responsibilities:
 * - Parse BC protocol from raw WebSocket messages
 * - Decompress gzip-compressed handler responses
 * - Emit typed HandlerEvents (FormToShow, DataRefreshChange, SessionInfo, etc.)
 * - Track server sequence numbers
 *
 * IMPORTANT: This adapter is STATELESS except for lastServerSequence.
 * It does NOT own session state (that's BCSessionManager's job).
 * It only PARSES protocol and EMITS events.
 *
 * Depends on: IBCWebSocketManager, IBCHandlerEventEmitter
 * Used by: BCSessionManager (via events), consumers (via events)
 */
export interface IBCProtocolAdapter {
  /**
   * Start listening to WebSocket messages and parsing BC protocol.
   *
   * Idempotent - safe to call multiple times.
   */
  start(): void;

  /**
   * Stop listening.
   *
   * Idempotent - safe to call multiple times.
   */
  stop(): void;

  /**
   * Get current server sequence number.
   *
   * This is tracked here because it's a protocol-level concept
   * (extracted from Message events before emission).
   *
   * @returns Last server sequence number received
   */
  getLastServerSequence(): number;
}

/**
 * BC session state.
 *
 * CRITICAL: This is the single source of truth for all session-level state.
 * EXCLUSIVELY owned by BCSessionManager - no other service should hold
 * a reference to this object.
 *
 * Other services access state via BCSessionManager.getSessionState() which
 * returns a read-only view.
 */
export interface IBCSessionState {
  /** Server-assigned session ID (from OpenSession response) */
  serverSessionId: string | null;

  /** Session key for subsequent requests (from OpenSession response) */
  sessionKey: string | null;

  /** Company name (from OpenSession response) */
  companyName: string | null;

  /** Role center form ID (from OpenSession response) */
  roleCenterFormId: string | null;

  /** SPA instance ID (client-generated, used in sequenceNo) */
  spaInstanceId: string;

  /** Client sequence counter (incremented per invoke) */
  clientSequenceCounter: number;

  /** Last server sequence number (from Message events) */
  lastServerSequence: number;

  /** Currently open form IDs (tracked across operations) */
  openFormIds: string[];
}

/**
 * BC session manager.
 *
 * Responsibilities:
 * - Initialize BC session (OpenSession)
 * - Execute BC interactions (Invoke)
 * - Own and manage BCSessionState
 * - Subscribe to HandlerEvents and update state
 *
 * STATE OWNERSHIP:
 * - BCSessionManager is the ONLY service that can modify BCSessionState
 * - State updates happen ONLY via handleHandlerEvent() (event-driven)
 * - No direct calls from BCProtocolAdapter (uses events instead)
 *
 * Event Integration:
 * - Constructor subscribes to IBCHandlerEventEmitter
 * - handleHandlerEvent() processes events and updates BCSessionState
 * - This pattern avoids circular dependency with BCProtocolAdapter
 *
 * Depends on: IBCWebSocketManager, IBCHandlerEventEmitter
 * Used by: BCFilterMetadataCache, consumers (MCP tools)
 */
export interface IBCSessionManager {
  /**
   * Open BC session.
   *
   * Sends OpenSession RPC request and processes response to initialize
   * session state (serverSessionId, sessionKey, companyName, roleCenterFormId).
   *
   * @param connectionRequest Session configuration
   * @returns User settings from session
   * @throws {ConnectionError} If not connected
   * @throws {ProtocolError} If session initialization fails
   */
  openSession(connectionRequest: any): Promise<any>;

  /**
   * Invoke BC action.
   *
   * Generic method for any BC interaction (OpenForm, SaveValue, Filter, etc.)
   * Automatically manages sequence numbers and session state.
   *
   * @param options Interaction parameters
   * @returns BC response handlers
   * @throws {ConnectionError} If session not initialized
   * @throws {TimeoutError} If request times out
   */
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
  }): Promise<any>;

  /**
   * Handle protocol events to update session state.
   *
   * INTERNAL METHOD - Called by event subscription in constructor.
   * Not part of public API - consumers should not call this directly.
   *
   * This is the ONLY method that modifies BCSessionState.
   * It processes HandlerEvents (Message, SessionInfo, FormToShow) and
   * updates state accordingly.
   *
   * @param event Handler event from protocol adapter
   * @internal
   */
  handleHandlerEvent(event: HandlerEvent): void;

  /**
   * Get session state (read-only view).
   *
   * Returns immutable copy to prevent external modification.
   *
   * @returns Read-only session state
   */
  getSessionState(): Readonly<IBCSessionState>;

  /**
   * Get server session ID.
   *
   * @returns Server session ID or null if not initialized
   */
  getServerSessionId(): string | null;

  /**
   * Get company name.
   *
   * @returns Company name or null if not initialized
   */
  getCompanyName(): string | null;

  /**
   * Get role center form ID.
   *
   * @returns Role center form ID or null if not initialized
   */
  getRoleCenterFormId(): string | null;
}

/**
 * Filter metadata cache.
 *
 * Responsibilities:
 * - Extract filter field metadata from handler responses
 * - Cache caption → canonical ID mappings per form
 * - Resolve user-friendly names to BC field IDs
 * - Apply filters to list controls
 *
 * This is a domain-specific service (filtering) that builds on
 * top of the session/protocol infrastructure.
 *
 * Depends on: IBCSessionManager (for invoke)
 * Used by: Consumers (MCP tools)
 */
export interface IBCFilterMetadataCache {
  /**
   * Cache filter metadata from handler response.
   *
   * Extracts field definitions (ID + caption) and builds
   * caption → canonical ID mapping for this form.
   *
   * @param formId Form ID to cache metadata for
   * @param handlers Handler array from BC response
   * @returns Number of filterable fields found
   */
  cacheFilterMetadata(formId: string, handlers: BCHandler[]): number;

  /**
   * Resolve column caption to canonical field ID.
   *
   * @param formId Form ID where filter will be applied
   * @param caption User-friendly column name (e.g., "Name", "Balance")
   * @returns Canonical field ID (e.g., "18_Customer.2") or null if not found
   * @throws {Error} If metadata not cached for this form
   */
  resolveFilterFieldId(formId: string, caption: string): string | null;

  /**
   * Get available filter captions for a form.
   *
   * @param formId Form ID
   * @returns Array of column captions or null if metadata not cached
   */
  getAvailableFilterCaptions(formId: string): string[] | null;

  /**
   * Apply filter to a list control.
   *
   * Sends Filter + SaveValue interactions to BC to activate
   * and set filter value.
   *
   * @param params Filter parameters
   * @returns BC response handlers
   * @throws {Error} If metadata not cached or column not found
   */
  applyFilter(params: {
    formId: string;
    listControlPath: string;
    columnCaption: string;
    filterValue?: string;
    signal?: AbortSignal;
  }): Promise<any>;
}
