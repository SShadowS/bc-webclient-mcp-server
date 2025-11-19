/**
 * Pure functions for BC handler parsing.
 *
 * No dependencies - easily testable in isolation.
 * Extracted from BCRawWebSocketClient per FUTURE_ERRATA.md Week 2.4
 *
 * These utilities handle:
 * - Handler decompression (gzip → JSON)
 * - Compressed data extraction (multiple BC message formats)
 * - Session information extraction (recursive parameter search)
 */

import { gunzipSync } from 'zlib';
import type { BCHandler } from '../interfaces.js';

/**
 * Decompress gzip-compressed BC handler array.
 *
 * BC sends handler responses as base64-encoded gzip-compressed JSON arrays.
 * This function reverses that encoding.
 *
 * @param base64 Base64-encoded gzip data
 * @returns Decompressed handler array
 * @throws {Error} If decompression or JSON parsing fails
 *
 * @example
 * ```ts
 * const handlers = decompressHandlers('H4sIAAAAAAAA...');
 * // [{ handlerType: 'DN.LogicalClientEventRaisingHandler', parameters: [...] }]
 * ```
 */
export function decompressHandlers(base64: string): BCHandler[] {
  const compressed = Buffer.from(base64, 'base64');
  const decompressed = gunzipSync(compressed);
  const decompressedJson = decompressed.toString('utf-8');
  const actualResponse = JSON.parse(decompressedJson);

  return Array.isArray(actualResponse) ? actualResponse : [];
}

/**
 * Extract compressed handler data from BC message (multiple formats).
 *
 * BC protocol uses several different message formats depending on context:
 * 1. Async Message envelope with nested compressedResult
 * 2. Async Message envelope with nested compressedData
 * 3. Top-level compressedResult
 * 4. JSON-RPC result with compressedResult
 *
 * This function checks all known formats and returns the compressed data
 * if found in any of them.
 *
 * @param message Raw WebSocket message (parsed JSON)
 * @returns Base64-encoded compressed data or null if not found
 *
 * @example
 * ```ts
 * // Format 1: Async Message with compressedResult
 * const msg1 = {
 *   method: 'Message',
 *   params: [{ sequenceNumber: 42, compressedResult: 'H4sI...' }]
 * };
 * extractCompressedData(msg1); // 'H4sI...'
 *
 * // Format 3: Top-level compressedResult
 * const msg3 = { compressedResult: 'H4sI...' };
 * extractCompressedData(msg3); // 'H4sI...'
 * ```
 */
export function extractCompressedData(message: any): string | null {
  // Format 1: Async Message envelope with nested compressedResult
  if (message.method === 'Message' && message.params?.[0]?.compressedResult) {
    return message.params[0].compressedResult;
  }

  // Format 2: Async Message envelope with compressedData (alternative field name)
  if (message.method === 'Message' && message.params?.[0]?.compressedData) {
    return message.params[0].compressedData;
  }

  // Format 3: Top-level compressedResult
  if (message.compressedResult) {
    return message.compressedResult;
  }

  // Format 4: JSON-RPC result with compressedResult
  if (message.result?.compressedResult) {
    return message.result.compressedResult;
  }

  return null;
}

/**
 * Extract session information from handler array.
 *
 * BC embeds session info (ServerSessionId, SessionKey, CompanyName) deep
 * within handler parameters. This function recursively searches handler
 * parameter trees to find these values.
 *
 * Session info typically appears in OpenSession responses but may also
 * appear in other handlers during session establishment.
 *
 * @param handlers Array of BC handlers to search
 * @returns Session info object or null if not found
 *
 * @example
 * ```ts
 * const handlers = [
 *   {
 *     handlerType: 'DN.SessionHandler',
 *     parameters: [
 *       { ServerSessionId: 'abc123', SessionKey: 'key456', CompanyName: 'CRONUS' }
 *     ]
 *   }
 * ];
 *
 * const info = extractSessionInfo(handlers);
 * // { serverSessionId: 'abc123', sessionKey: 'key456', companyName: 'CRONUS' }
 * ```
 */
export function extractSessionInfo(handlers: BCHandler[]): {
  serverSessionId?: string;
  sessionKey?: string;
  companyName?: string;
  roleCenterFormId?: string;
} | null {
  /**
   * Recursively search parameter tree for session fields.
   *
   * BC parameter structures can be deeply nested arrays and objects.
   * Session fields may be scattered across different nested structures.
   * This function collects ALL occurrences and merges them.
   */
  const searchParams = (params: any, result: any): void => {
    // Handle arrays: recursively search each element
    if (Array.isArray(params)) {
      for (const item of params) {
        searchParams(item, result);
      }
    }
    // Handle objects: check for session fields, then recurse into values
    else if (params && typeof params === 'object') {
      // Collect any session fields from this object
      if (params.ServerSessionId && !result.serverSessionId) {
        result.serverSessionId = params.ServerSessionId;
      }
      if (params.SessionKey && !result.sessionKey) {
        result.sessionKey = params.SessionKey;
      }
      if (params.CompanyName && !result.companyName) {
        result.companyName = params.CompanyName;
      }

      // Recurse into object values
      for (const value of Object.values(params)) {
        searchParams(value, result);
      }
    }
  };

  // Collect session info from all handlers
  const sessionInfo: any = {
    serverSessionId: undefined,
    sessionKey: undefined,
    companyName: undefined,
  };

  for (const handler of handlers) {
    if (handler.parameters) {
      searchParams(handler.parameters, sessionInfo);
    }
  }

  // Check if we found any session fields
  if (!sessionInfo.serverSessionId && !sessionInfo.sessionKey && !sessionInfo.companyName) {
    return null;
  }

  // Also look for FormToShow handler to extract role center form ID
  for (const handler of handlers) {
    if (
      handler.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
      handler.parameters?.[0] === 'FormToShow' &&
      handler.parameters?.[1]?.ServerId
    ) {
      sessionInfo.roleCenterFormId = handler.parameters[1].ServerId;
      break;
    }
  }

  return sessionInfo;
}

/**
 * Extract open form IDs from Message event.
 *
 * BC sends openFormIds array in Message events to track which forms
 * are currently displayed to the user. This information is used for
 * subsequent interactions to maintain form context.
 *
 * @param message Raw WebSocket message (parsed JSON)
 * @returns Array of form IDs or null if not found
 *
 * @example
 * ```ts
 * const msg = {
 *   method: 'Message',
 *   params: [{
 *     sequenceNumber: 42,
 *     openFormIds: ['form1', 'form2']
 *   }]
 * };
 *
 * const formIds = extractOpenFormIds(msg);
 * // ['form1', 'form2']
 * ```
 */
export function extractOpenFormIds(message: any): string[] | null {
  if (message.method === 'Message' && message.params?.[0]?.openFormIds) {
    return message.params[0].openFormIds;
  }

  return null;
}
