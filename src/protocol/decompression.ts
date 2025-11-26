/**
 * Business Central WebSocket Response Decompression
 *
 * BC compresses WebSocket responses using standard gzip and base64 encoding.
 * This utility decompresses responses to access LogicalForm data.
 *
 * Based on protocol analysis - see docs/tell-me-search-protocol.md
 */

import { gunzipSync } from 'zlib';
import { DecompressionError } from '../core/errors.js';
import { ok, err, type Result } from '../core/result.js';
import type { BCError } from '../core/errors.js';

/**
 * Decompresses a BC WebSocket response payload.
 *
 * BC responses with "message": "compressed" contain gzip-compressed,
 * base64-encoded JSON data.
 *
 * @param compressedData - Base64 string from WebSocket response
 * @returns Decompressed JSON object or error
 */
export function decompressBCPayload(compressedData: string): Result<unknown, BCError> {
  try {
    // Step 1: Decode base64 to binary buffer
    const buffer = Buffer.from(compressedData, 'base64');

    // Step 2: Decompress with gzip
    const decompressed = gunzipSync(buffer);

    // Step 3: Convert to UTF-8 string
    const jsonString = decompressed.toString('utf8');

    // Step 4: Parse JSON
    const parsed: unknown = JSON.parse(jsonString);

    return ok(parsed);
  } catch (error) {
    return err(
      new DecompressionError(
        `Failed to decompress BC payload: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error }
      )
    );
  }
}

/** Message structure for compressed check */
interface CompressedMessage {
  message?: string;
  payload?: string;
}

/**
 * Decompresses a BC WebSocket message if it's compressed.
 *
 * @param message - WebSocket message object
 * @returns Decompressed payload or original message if not compressed
 */
export function decompressIfNeeded(message: unknown): Result<unknown, BCError> {
  const typedMessage = message as CompressedMessage;
  // Check if message is compressed
  if (typedMessage?.message === 'compressed' && typedMessage?.payload) {
    return decompressBCPayload(typedMessage.payload);
  }

  // Return as-is if not compressed
  return ok(message);
}

/**
 * Type guard to check if a WebSocket message is compressed.
 */
export function isCompressedMessage(message: unknown): boolean {
  const typedMessage = message as CompressedMessage;
  return typedMessage?.message === 'compressed' && typeof typedMessage?.payload === 'string';
}
