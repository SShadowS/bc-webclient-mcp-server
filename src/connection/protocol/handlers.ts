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

/** Session info result type */
interface SessionInfo {
  serverSessionId?: string;
  sessionKey?: string;
  companyName?: string;
  roleCenterFormId?: string;
}

/** Session field names to extract from BC parameters */
const SESSION_FIELD_MAP = {
  ServerSessionId: 'serverSessionId',
  SessionKey: 'sessionKey',
  CompanyName: 'companyName',
} as const;

/**
 * Recursively search parameter tree for session fields.
 *
 * BC parameter structures can be deeply nested arrays and objects.
 * Session fields may be scattered across different nested structures.
 * This function collects ALL occurrences and merges them.
 */
function searchParamsForSessionFields(params: unknown, result: SessionInfo): void {
  if (Array.isArray(params)) {
    for (const item of params) {
      searchParamsForSessionFields(item, result);
    }
    return;
  }

  if (params && typeof params === 'object') {
    const obj = params as Record<string, unknown>;

    // Check for each session field
    for (const [bcField, resultField] of Object.entries(SESSION_FIELD_MAP)) {
      if (obj[bcField] && !result[resultField as keyof SessionInfo]) {
        (result as any)[resultField] = obj[bcField];
      }
    }

    // Recurse into object values
    for (const value of Object.values(obj)) {
      searchParamsForSessionFields(value, result);
    }
  }
}

/**
 * Find role center form ID from FormToShow handler.
 */
function findRoleCenterFormId(handlers: BCHandler[]): string | undefined {
  const formToShowHandler = handlers.find(
    h => h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
         h.parameters?.[0] === 'FormToShow' &&
         h.parameters?.[1]?.ServerId
  );
  return formToShowHandler?.parameters?.[1]?.ServerId;
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
export function extractSessionInfo(handlers: BCHandler[]): SessionInfo | null {
  const sessionInfo: SessionInfo = {};

  // Collect session fields from all handler parameters
  for (const handler of handlers) {
    if (handler.parameters) {
      searchParamsForSessionFields(handler.parameters, sessionInfo);
    }
  }

  // Check if we found any session fields
  const hasSessionInfo = sessionInfo.serverSessionId || sessionInfo.sessionKey || sessionInfo.companyName;
  if (!hasSessionInfo) {
    return null;
  }

  // Add role center form ID if present
  sessionInfo.roleCenterFormId = findRoleCenterFormId(handlers);

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
