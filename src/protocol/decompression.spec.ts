/**
 * Decompression Tests
 *
 * Tests for BC WebSocket response decompression utilities
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import {
  decompressBCPayload,
  decompressIfNeeded,
  isCompressedMessage,
} from './decompression.js';
import { isOk } from '../core/result.js';
import { DecompressionError } from '../core/errors.js';

describe('decompression', () => {
  describe('decompressBCPayload()', () => {
    it('decompresses valid gzip base64 data', () => {
      // Arrange: Create a test object, gzip it, and base64 encode
      const testData = { test: 'hello', value: 42 };
      const jsonString = JSON.stringify(testData);
      const compressed = gzipSync(Buffer.from(jsonString, 'utf8'));
      const base64 = compressed.toString('base64');

      // Act
      const result = decompressBCPayload(base64);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(testData);
      }
    });

    it('handles complex nested JSON structures', () => {
      // Arrange: Complex object with nested structures
      const testData = {
        form: {
          controls: [
            { id: 1, type: 'textbox', value: 'test' },
            { id: 2, type: 'button', enabled: true },
          ],
          metadata: { version: '1.0', timestamp: '2024-01-01' },
        },
      };
      const compressed = gzipSync(Buffer.from(JSON.stringify(testData), 'utf8'));
      const base64 = compressed.toString('base64');

      // Act
      const result = decompressBCPayload(base64);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(testData);
      }
    });

    it('handles empty JSON object', () => {
      // Arrange
      const testData = {};
      const compressed = gzipSync(Buffer.from(JSON.stringify(testData), 'utf8'));
      const base64 = compressed.toString('base64');

      // Act
      const result = decompressBCPayload(base64);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({});
      }
    });

    it('handles JSON array', () => {
      // Arrange
      const testData = [1, 2, 3, { nested: true }];
      const compressed = gzipSync(Buffer.from(JSON.stringify(testData), 'utf8'));
      const base64 = compressed.toString('base64');

      // Act
      const result = decompressBCPayload(base64);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(testData);
      }
    });

    it('returns error for invalid base64', () => {
      // Arrange: Invalid base64 string
      const invalidBase64 = 'not-valid-base64!!!@#$';

      // Act
      const result = decompressBCPayload(invalidBase64);

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBeInstanceOf(DecompressionError);
        expect(result.error.message).toContain('Failed to decompress BC payload');
      }
    });

    it('returns error for corrupt gzip data', () => {
      // Arrange: Valid base64 but not gzip data
      const corruptData = Buffer.from('corrupt gzip data').toString('base64');

      // Act
      const result = decompressBCPayload(corruptData);

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBeInstanceOf(DecompressionError);
        expect(result.error.message).toContain('Failed to decompress BC payload');
      }
    });

    it('returns error for truncated gzip data', () => {
      // Arrange: Create valid gzip data, then truncate it
      const testData = { test: 'data' };
      const compressed = gzipSync(Buffer.from(JSON.stringify(testData), 'utf8'));
      const truncated = compressed.subarray(0, compressed.length - 5); // Cut off last 5 bytes
      const base64 = truncated.toString('base64');

      // Act
      const result = decompressBCPayload(base64);

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBeInstanceOf(DecompressionError);
      }
    });

    it('returns error for empty string', () => {
      // Act
      const result = decompressBCPayload('');

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBeInstanceOf(DecompressionError);
      }
    });

    it('returns error when decompressed data is not valid JSON', () => {
      // Arrange: Gzip some non-JSON text
      const notJson = 'This is not JSON';
      const compressed = gzipSync(Buffer.from(notJson, 'utf8'));
      const base64 = compressed.toString('base64');

      // Act
      const result = decompressBCPayload(base64);

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBeInstanceOf(DecompressionError);
        expect(result.error.message).toContain('Failed to decompress BC payload');
      }
    });
  });

  describe('decompressIfNeeded()', () => {
    it('decompresses when message has compressed flag', () => {
      // Arrange: Compressed message format
      const testData = { result: 'success' };
      const compressed = gzipSync(Buffer.from(JSON.stringify(testData), 'utf8'));
      const base64 = compressed.toString('base64');
      const message = {
        message: 'compressed',
        payload: base64,
      };

      // Act
      const result = decompressIfNeeded(message);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(testData);
      }
    });

    it('returns original message when not compressed', () => {
      // Arrange: Regular uncompressed message
      const message = {
        message: 'success',
        data: { value: 123 },
      };

      // Act
      const result = decompressIfNeeded(message);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(message);
      }
    });

    it('returns original message when message field is missing', () => {
      // Arrange
      const message = { data: { value: 123 } };

      // Act
      const result = decompressIfNeeded(message);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(message);
      }
    });

    it('returns original message when payload field is missing', () => {
      // Arrange
      const message = { message: 'compressed' };

      // Act
      const result = decompressIfNeeded(message);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual(message);
      }
    });

    it('returns original message for null', () => {
      // Act
      const result = decompressIfNeeded(null);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeNull();
      }
    });

    it('returns original message for undefined', () => {
      // Act
      const result = decompressIfNeeded(undefined);

      // Assert
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBeUndefined();
      }
    });

    it('propagates decompression errors', () => {
      // Arrange: Compressed message with invalid payload
      const message = {
        message: 'compressed',
        payload: 'invalid-gzip-data',
      };

      // Act
      const result = decompressIfNeeded(message);

      // Assert
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error).toBeInstanceOf(DecompressionError);
      }
    });
  });

  describe('isCompressedMessage()', () => {
    it('returns true for valid compressed message', () => {
      // Arrange
      const message = {
        message: 'compressed',
        payload: 'base64data',
      };

      // Act & Assert
      expect(isCompressedMessage(message)).toBe(true);
    });

    it('returns false when message field is not "compressed"', () => {
      // Arrange
      const message = {
        message: 'success',
        payload: 'base64data',
      };

      // Act & Assert
      expect(isCompressedMessage(message)).toBe(false);
    });

    it('returns false when payload field is missing', () => {
      // Arrange
      const message = {
        message: 'compressed',
      };

      // Act & Assert
      expect(isCompressedMessage(message)).toBe(false);
    });

    it('returns false when payload is not a string', () => {
      // Arrange
      const message = {
        message: 'compressed',
        payload: { data: 'object' },
      };

      // Act & Assert
      expect(isCompressedMessage(message)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isCompressedMessage(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isCompressedMessage(undefined)).toBe(false);
    });

    it('returns false for primitive types', () => {
      expect(isCompressedMessage('string')).toBe(false);
      expect(isCompressedMessage(123)).toBe(false);
      expect(isCompressedMessage(true)).toBe(false);
    });

    it('returns false for empty object', () => {
      expect(isCompressedMessage({})).toBe(false);
    });
  });
});
