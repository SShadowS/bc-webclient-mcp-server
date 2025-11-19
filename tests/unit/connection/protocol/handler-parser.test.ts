/**
 * Unit tests for handler parsing utilities
 *
 * Tests decompression and extraction of BC handler arrays from various response formats.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decompressHandlers,
  extractCompressedResult,
  hasCompressedResult,
} from '@/connection/protocol/handler-parser.js';
import { gzipSync } from 'zlib';

// Mock logger to suppress output during tests
vi.mock('@/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('handler-parser', () => {
  describe('decompressHandlers', () => {
    it('should decompress gzipped base64-encoded handler array', () => {
      // Create handler array
      const handlers = [
        { handlerType: 'DN.Test', parameters: ['param1'] },
        { handlerType: 'DN.Another', parameters: ['param2'] },
      ];

      // Gzip and base64 encode
      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      // Decompress
      const result = decompressHandlers(base64);

      expect(result).toEqual(handlers);
    });

    it('should handle empty handler array', () => {
      const handlers: any[] = [];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const result = decompressHandlers(base64);

      expect(result).toEqual([]);
    });

    it('should handle handler array with complex nested objects', () => {
      const handlers = [
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: [
            'FormToShow',
            {
              ServerId: 'form123',
              Caption: 'Customer Card',
              NestedObject: {
                Field1: 'value1',
                Field2: ['array', 'values'],
              },
            },
          ],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const result = decompressHandlers(base64);

      expect(result).toEqual(handlers);
    });

    it('should throw error if compressed data is invalid base64', () => {
      expect(() => decompressHandlers('not-valid-base64!!!')).toThrow();
    });

    it('should throw error if decompressed data is not JSON', () => {
      // Compress non-JSON data
      const compressed = gzipSync('This is not JSON');
      const base64 = compressed.toString('base64');

      expect(() => decompressHandlers(base64)).toThrow();
    });

    it('should throw error if decompressed JSON is not an array', () => {
      // Compress JSON object instead of array
      const json = JSON.stringify({ not: 'an array' });
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      expect(() => decompressHandlers(base64)).toThrow('not an array');
    });
  });

  describe('extractCompressedResult', () => {
    it('should extract from Async Message with compressedResult', () => {
      const response = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            compressedResult: 'base64data',
          },
        ],
      };

      const result = extractCompressedResult(response);

      expect(result).toBe('base64data');
    });

    it('should extract from Async Message with compressedData (LoadForm)', () => {
      const response = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            compressedData: 'base64data-loadform',
          },
        ],
      };

      const result = extractCompressedResult(response);

      expect(result).toBe('base64data-loadform');
    });

    it('should extract from top-level compressedResult', () => {
      const response = {
        compressedResult: 'base64data-toplevel',
      };

      const result = extractCompressedResult(response);

      expect(result).toBe('base64data-toplevel');
    });

    it('should extract from JSON-RPC result.compressedResult', () => {
      const response = {
        jsonrpc: '2.0',
        id: '123',
        result: {
          compressedResult: 'base64data-jsonrpc',
        },
      };

      const result = extractCompressedResult(response);

      expect(result).toBe('base64data-jsonrpc');
    });

    it('should return null if no compressed data found', () => {
      const response = {
        jsonrpc: '2.0',
        id: '123',
        result: {
          someOtherField: 'value',
        },
      };

      const result = extractCompressedResult(response);

      expect(result).toBeNull();
    });

    it('should return null for empty response', () => {
      const result = extractCompressedResult({});
      expect(result).toBeNull();
    });

    it('should prioritize Message.params[0].compressedResult over other formats', () => {
      // Response with multiple compressed fields
      const response = {
        method: 'Message',
        params: [
          {
            compressedResult: 'message-compressed',
          },
        ],
        compressedResult: 'top-level-compressed',
        jsonrpc: '2.0',
        result: {
          compressedResult: 'jsonrpc-compressed',
        },
      };

      const result = extractCompressedResult(response);

      // Should return Message.params[0].compressedResult first
      expect(result).toBe('message-compressed');
    });

    it('should handle Message with params but no compressedResult', () => {
      const response = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            // No compressedResult field
          },
        ],
        compressedResult: 'top-level-compressed',
      };

      const result = extractCompressedResult(response);

      // Should fall through to top-level compressedResult
      expect(result).toBe('top-level-compressed');
    });

    it('should handle Message with no params', () => {
      const response = {
        method: 'Message',
        // No params
        compressedResult: 'top-level-compressed',
      };

      const result = extractCompressedResult(response);

      // Should fall through to top-level
      expect(result).toBe('top-level-compressed');
    });

    it('should handle JSON-RPC without result', () => {
      const response = {
        jsonrpc: '2.0',
        id: '123',
        // No result field
      };

      const result = extractCompressedResult(response);

      expect(result).toBeNull();
    });
  });

  describe('hasCompressedResult', () => {
    it('should return true when compressed data exists', () => {
      const response = {
        method: 'Message',
        params: [{ compressedResult: 'data' }],
      };

      expect(hasCompressedResult(response)).toBe(true);
    });

    it('should return false when no compressed data exists', () => {
      const response = {
        method: 'Message',
        params: [{ sequenceNumber: 42 }],
      };

      expect(hasCompressedResult(response)).toBe(false);
    });

    it('should return false for empty response', () => {
      expect(hasCompressedResult({})).toBe(false);
    });

    it('should handle all compressed result formats', () => {
      // Message.params[0].compressedResult
      expect(
        hasCompressedResult({
          method: 'Message',
          params: [{ compressedResult: 'data' }],
        })
      ).toBe(true);

      // Message.params[0].compressedData
      expect(
        hasCompressedResult({
          method: 'Message',
          params: [{ compressedData: 'data' }],
        })
      ).toBe(true);

      // Top-level compressedResult
      expect(hasCompressedResult({ compressedResult: 'data' })).toBe(true);

      // JSON-RPC result.compressedResult
      expect(
        hasCompressedResult({
          jsonrpc: '2.0',
          result: { compressedResult: 'data' },
        })
      ).toBe(true);
    });
  });

  describe('integration', () => {
    it('should decompress real BC response flow', () => {
      // Simulate full BC response flow

      // 1. Create handler array (what BC would send)
      const handlers = [
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: ['FormToShow', { ServerId: 'page21', Caption: 'Customer Card' }],
        },
      ];

      // 2. BC compresses it
      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      // 3. BC wraps it in Message envelope
      const response = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 42,
            compressedResult: base64,
          },
        ],
      };

      // 4. Extract compressed data
      const compressedData = extractCompressedResult(response);
      expect(compressedData).toBeDefined();
      expect(compressedData).toBe(base64);

      // 5. Decompress
      const decompressed = decompressHandlers(compressedData!);
      expect(decompressed).toEqual(handlers);
    });

    it('should handle LoadForm async response flow', () => {
      // LoadForm uses compressedData instead of compressedResult

      const handlers = [
        {
          handlerType: 'DN.LogicalClientChangeHandler',
          parameters: ['form123', [{ t: 'PropertyChanges' }]],
        },
      ];

      const json = JSON.stringify(handlers);
      const compressed = gzipSync(json);
      const base64 = compressed.toString('base64');

      const response = {
        method: 'Message',
        params: [
          {
            sequenceNumber: 43,
            compressedData: base64, // LoadForm uses compressedData
          },
        ],
      };

      const compressedData = extractCompressedResult(response);
      expect(compressedData).toBe(base64);

      const decompressed = decompressHandlers(compressedData!);
      expect(decompressed).toEqual(handlers);
    });
  });
});
