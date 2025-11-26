/**
 * BC Handler Parsing Utilities
 *
 * Utilities for decompressing and extracting handler arrays from BC protocol responses.
 *
 * Extracted from BCRawWebSocketClient (lines 324-380).
 *
 * BC protocol uses gzip compression for handler responses. The compressed data
 * can appear in multiple response formats:
 * - Async Message envelope: `Message.params[0].compressedResult`
 * - Async Message with LoadForm: `Message.params[0].compressedData`
 * - Top-level: `compressedResult`
 * - JSON-RPC result: `result.compressedResult`
 *
 * Usage:
 * ```ts
 * // Extract compressed data from response
 * const compressed = extractCompressedResult(response);
 * if (compressed) {
 *   // Decompress to handler array
 *   const handlers = decompressHandlers(compressed);
 * }
 * ```
 */

import { gunzipSync } from 'zlib';
import { logger } from '../../core/logger.js';

/**
 * Decompress gzip-compressed BC handler array.
 *
 * BC sends handler arrays as base64-encoded gzipped JSON.
 * This function:
 * 1. Base64 decodes the string
 * 2. Gunzip decompresses
 * 3. JSON parses the result
 *
 * @param base64 Base64-encoded gzipped handler array
 * @returns Decompressed handler array
 * @throws {Error} If decompression or JSON parsing fails
 *
 * @example
 * ```ts
 * const handlers = decompressHandlers(response.result.compressedResult);
 * // handlers: [{ handlerType: 'DN...', parameters: [...] }, ...]
 * ```
 */
export function decompressHandlers(base64: string): unknown[] {
  logger.info('  Decompressing gzip response...');

  // Base64 decode
  const compressed = Buffer.from(base64, 'base64');

  // Gunzip decompress
  const decompressed = gunzipSync(compressed);
  const decompressedJson = decompressed.toString('utf-8');

  logger.info(`  Decompressed: ${decompressedJson.substring(0, 200)}...`);

  // Parse decompressed JSON as handler array
  const actualResponse: unknown = JSON.parse(decompressedJson);

  if (!Array.isArray(actualResponse)) {
    throw new Error('Decompressed response is not an array');
  }

  return actualResponse;
}

/** Response structure for compressed data extraction */
interface CompressedResponse {
  method?: string;
  params?: Array<{ compressedResult?: string; compressedData?: string }>;
  compressedResult?: string;
  jsonrpc?: string;
  result?: { compressedResult?: string };
}

/**
 * Extract compressed result from BC protocol response.
 *
 * BC responses can contain compressed data in multiple formats.
 * This function checks all known locations and returns the base64
 * compressed string if found.
 *
 * **Known formats:**
 * 1. Async Message with compressedResult (most common for Tell Me)
 * 2. Async Message with compressedData (LoadForm async responses)
 * 3. Top-level compressedResult
 * 4. JSON-RPC result.compressedResult
 *
 * @param response Raw BC WebSocket response
 * @returns Base64-encoded compressed data, or null if not found
 *
 * @example
 * ```ts
 * const compressed = extractCompressedResult(response);
 * if (compressed) {
 *   const handlers = decompressHandlers(compressed);
 * } else {
 *   // Handle uncompressed response
 * }
 * ```
 */
export function extractCompressedResult(response: unknown): string | null {
  const typedResponse = response as CompressedResponse;

  // 1) Async Message envelope with nested compressedResult (most common for Tell Me)
  if (typedResponse.method === 'Message' && typedResponse.params?.[0]?.compressedResult) {
    return typedResponse.params[0].compressedResult;
  }

  // 1b) Async Message envelope with compressedData (LoadForm async responses)
  if (typedResponse.method === 'Message' && typedResponse.params?.[0]?.compressedData) {
    return typedResponse.params[0].compressedData;
  }

  // 2) Top-level compressedResult
  if (typedResponse.compressedResult) {
    return typedResponse.compressedResult;
  }

  // 3) JSON-RPC result with compressedResult
  if (typedResponse.jsonrpc && typedResponse.result?.compressedResult) {
    return typedResponse.result.compressedResult;
  }

  // No compressed data found
  return null;
}

/**
 * Check if a response contains compressed handlers.
 *
 * Convenience helper to check whether a response has compressed data.
 *
 * @param response Raw BC WebSocket response
 * @returns true if response contains compressed data
 *
 * @example
 * ```ts
 * if (hasCompressedResult(response)) {
 *   const handlers = decompressHandlers(extractCompressedResult(response)!);
 * }
 * ```
 */
export function hasCompressedResult(response: unknown): boolean {
  return extractCompressedResult(response) !== null;
}
