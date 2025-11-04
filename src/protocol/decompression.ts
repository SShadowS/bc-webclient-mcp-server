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
export function decompressBCPayload(compressedData: string): Result<any, BCError> {
  try {
    // Step 1: Decode base64 to binary buffer
    const buffer = Buffer.from(compressedData, 'base64');

    // Step 2: Decompress with gzip
    const decompressed = gunzipSync(buffer);

    // Step 3: Convert to UTF-8 string
    const jsonString = decompressed.toString('utf8');

    // Step 4: Parse JSON
    const parsed = JSON.parse(jsonString);

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

/**
 * Decompresses a BC WebSocket message if it's compressed.
 *
 * @param message - WebSocket message object
 * @returns Decompressed payload or original message if not compressed
 */
export function decompressIfNeeded(message: any): Result<any, BCError> {
  // Check if message is compressed
  if (message?.message === 'compressed' && message?.payload) {
    return decompressBCPayload(message.payload);
  }

  // Return as-is if not compressed
  return ok(message);
}

/**
 * Type guard to check if a WebSocket message is compressed.
 */
export function isCompressedMessage(message: any): boolean {
  return message?.message === 'compressed' && typeof message?.payload === 'string';
}
