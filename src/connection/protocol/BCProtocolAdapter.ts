/**
 * BC Protocol Adapter
 *
 * Parses BC protocol from raw WebSocket messages and emits typed HandlerEvents.
 *
 * Responsibilities:
 * - Listen to raw WebSocket messages (via IBCWebSocketManager)
 * - Decompress gzip-compressed handler responses
 * - Extract server sequence numbers from Message events
 * - Emit typed HandlerEvents (RawHandlers, Message, FormToShow, etc.)
 *
 * IMPORTANT: This is a STATELESS service (except for lastServerSequence).
 * It does NOT own session state - it only parses protocol and emits events.
 * BCSessionManager subscribes to these events to update session state.
 *
 * Usage:
 * ```ts
 * const adapter = new BCProtocolAdapter(wsManager, eventEmitter);
 * adapter.start();
 *
 * // Events are emitted automatically as messages arrive
 * // BCSessionManager and other consumers subscribe via eventEmitter.onHandlers()
 * ```
 */

import { logger } from '../../core/logger.js';
import type {
  IBCProtocolAdapter,
  IBCWebSocketManager,
  IBCHandlerEventEmitter,
  HandlerEvent,
  BCHandler,
} from '../interfaces.js';
import {
  decompressHandlers,
  extractCompressedData,
  extractSessionInfo,
  extractOpenFormIds,
} from './handlers.js';

/**
 * BC Protocol Adapter implementation.
 *
 * Minimal version for Week 2:
 * - Handles raw message parsing
 * - Decompresses gzipped handlers
 * - Tracks server sequence numbers
 * - Emits RawHandlers events
 *
 * Week 3 will add specialized event parsing (FormToShow, SessionInfo, etc.)
 */
export class BCProtocolAdapter implements IBCProtocolAdapter {
  private wsManager: IBCWebSocketManager;
  private eventEmitter: IBCHandlerEventEmitter;
  private lastServerSequence = -1;
  private unsubscribe: (() => void) | null = null;

  constructor(
    wsManager: IBCWebSocketManager,
    eventEmitter: IBCHandlerEventEmitter
  ) {
    this.wsManager = wsManager;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start listening to WebSocket messages and parsing BC protocol.
   *
   * Subscribes to IBCWebSocketManager.onRawMessage() and processes
   * all incoming messages.
   *
   * Idempotent - safe to call multiple times (won't subscribe twice).
   */
  public start(): void {
    // Idempotent - don't subscribe twice
    if (this.unsubscribe) {
      logger.info('[BCProtocolAdapter] Already started');
      return;
    }

    logger.info('[BCProtocolAdapter] Starting protocol adapter');

    // Subscribe to raw WebSocket messages
    this.unsubscribe = this.wsManager.onRawMessage((msg: any) => {
      this.handleRawMessage(msg);
    });
  }

  /**
   * Stop listening to WebSocket messages.
   *
   * Unsubscribes from raw message handler.
   *
   * Idempotent - safe to call multiple times.
   */
  public stop(): void {
    if (this.unsubscribe) {
      logger.info('[BCProtocolAdapter] Stopping protocol adapter');
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Get current server sequence number.
   *
   * Extracted from Message events during protocol parsing.
   *
   * @returns Last server sequence number received (-1 if none)
   */
  public getLastServerSequence(): number {
    return this.lastServerSequence;
  }

  /**
   * Handle raw WebSocket message.
   *
   * Processes incoming message:
   * 1. Track server sequence number (from Message events)
   * 2. Decompress handlers (if compressed)
   * 3. Emit HandlerEvent
   *
   * @param msg Raw JSON-RPC message from WebSocket
   * @internal
   */
  private handleRawMessage(msg: any): void {
    try {
      // Track server sequence number from Message events
      if (msg.method === 'Message' && msg.params?.[0]?.sequenceNumber !== undefined) {
        const serverSeq = msg.params[0].sequenceNumber;
        if (serverSeq > this.lastServerSequence) {
          this.lastServerSequence = serverSeq;
          logger.info(`[BCProtocolAdapter] Server sequence: ${serverSeq}`);
        }

        // Extract openFormIds from Message event (if present)
        const openFormIds = msg.params[0].openFormIds as string[] | undefined;

        // Emit Message event BEFORE processing handlers
        // This allows SessionManager to track sequence and openFormIds
        const messageEvent: HandlerEvent = {
          kind: 'Message',
          sequenceNumber: serverSeq,
          openFormIds,
          raw: msg,
        };
        this.eventEmitter.emit(messageEvent);
      }

      // Check for compressed handlers
      const compressed = extractCompressedData(msg);
      if (compressed) {
        // Decompress and emit RawHandlers event
        const handlers = decompressHandlers(compressed);
        logger.info(
          `[BCProtocolAdapter] Decompressed ${handlers.length} handlers`
        );

        // Emit RawHandlers event first
        const rawEvent: HandlerEvent = {
          kind: 'RawHandlers',
          handlers,
        };
        this.eventEmitter.emit(rawEvent);

        // Week 3: Parse and emit typed events
        this.emitTypedEvents(handlers);
      }
    } catch (error) {
      logger.warn({ error }, '[BCProtocolAdapter] Error handling message');
    }
  }

  /**
   * Parse handlers and emit typed events.
   *
   * Week 3 enhancement: Extract FormToShow, SessionInfo, and DataRefreshChange
   * events from handler arrays.
   *
   * @param handlers Decompressed handler array
   * @internal
   */
  private emitTypedEvents(handlers: BCHandler[]): void {
    // Extract and emit SessionInfo event (uses utility from handlers.ts)
    const sessionInfo = extractSessionInfo(handlers);
    if (sessionInfo && sessionInfo.serverSessionId && sessionInfo.sessionKey && sessionInfo.companyName) {
      const event: HandlerEvent = {
        kind: 'SessionInfo',
        sessionId: sessionInfo.serverSessionId,
        sessionKey: sessionInfo.sessionKey,
        company: sessionInfo.companyName,
        roleCenterFormId: sessionInfo.roleCenterFormId,
        raw: handlers[0], // Include first handler for context
      };
      this.eventEmitter.emit(event);
      logger.info(
        `[BCProtocolAdapter] Emitted SessionInfo: ${sessionInfo.companyName}`
      );
    }

    // Extract and emit FormToShow events
    for (const handler of handlers) {
      if (
        handler.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        handler.parameters?.[0] === 'FormToShow' &&
        handler.parameters?.[1]?.ServerId
      ) {
        const formData = handler.parameters[1];
        const event: HandlerEvent = {
          kind: 'FormToShow',
          formId: formData.ServerId,
          caption: formData.Caption,
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info(
          `[BCProtocolAdapter] Emitted FormToShow: ${formData.ServerId}`
        );
      }
    }

    // Extract and emit DataRefreshChange events
    for (const handler of handlers) {
      if (
        handler.handlerType === 'DN.LogicalClientChangeHandler' &&
        handler.parameters?.[1]
      ) {
        const changes = handler.parameters[1];
        if (Array.isArray(changes)) {
          // Filter for data refresh changes
          const dataRefreshChanges = changes.filter(
            (change: any) => change.t === 'DataRefreshChange'
          );

          if (dataRefreshChanges.length > 0) {
            const event: HandlerEvent = {
              kind: 'DataRefreshChange',
              updates: dataRefreshChanges,
              raw: handler,
            };
            this.eventEmitter.emit(event);
            logger.info(
              `[BCProtocolAdapter] Emitted DataRefreshChange: ${dataRefreshChanges.length} updates`
            );
          }
        }
      }
    }

    // Extract and emit CallbackResponse events
    for (const handler of handlers) {
      if (handler.handlerType === 'DN.CallbackResponseProperties') {
        const event: HandlerEvent = {
          kind: 'CallbackResponse',
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info('[BCProtocolAdapter] Emitted CallbackResponse');
      }
    }

    // Extract and emit Error events
    for (const handler of handlers) {
      if (handler.handlerType === 'DN.ErrorMessageProperties') {
        const event: HandlerEvent = {
          kind: 'Error',
          errorType: 'ErrorMessage',
          message: handler.parameters?.[0]?.Message,
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info(
          `[BCProtocolAdapter] Emitted Error (ErrorMessage): ${event.message || 'no message'}`
        );
      } else if (handler.handlerType === 'DN.ErrorDialogProperties') {
        const event: HandlerEvent = {
          kind: 'Error',
          errorType: 'ErrorDialog',
          message: handler.parameters?.[0]?.Message,
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info(
          `[BCProtocolAdapter] Emitted Error (ErrorDialog): ${event.message || 'no message'}`
        );
      }
    }

    // Extract and emit ValidationMessage events
    for (const handler of handlers) {
      if (handler.handlerType === 'DN.ValidationMessageProperties') {
        const event: HandlerEvent = {
          kind: 'ValidationMessage',
          message: handler.parameters?.[0]?.Message,
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info(
          `[BCProtocolAdapter] Emitted ValidationMessage: ${event.message || 'no message'}`
        );
      }
    }

    // Extract and emit Dialog events
    for (const handler of handlers) {
      if (handler.handlerType === 'DN.ConfirmDialogProperties') {
        const event: HandlerEvent = {
          kind: 'Dialog',
          dialogType: 'Confirm',
          message: handler.parameters?.[0]?.Message,
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info(
          `[BCProtocolAdapter] Emitted Dialog (Confirm): ${event.message || 'no message'}`
        );
      } else if (handler.handlerType === 'DN.YesNoDialogProperties') {
        const event: HandlerEvent = {
          kind: 'Dialog',
          dialogType: 'YesNo',
          message: handler.parameters?.[0]?.Message,
          raw: handler,
        };
        this.eventEmitter.emit(event);
        logger.info(
          `[BCProtocolAdapter] Emitted Dialog (YesNo): ${event.message || 'no message'}`
        );
      }
    }
  }

}
