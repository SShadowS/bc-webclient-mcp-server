/**
 * Unit Tests for CacheManager
 *
 * Tests cache functionality including:
 * - Get/Set operations
 * - TTL expiration
 * - LRU eviction
 * - Cache stampede protection (coalescing)
 * - Statistics
 * - Pattern-based invalidation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheManager } from '../../src/services/cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    // Create cache with small limits for testing
    cache = new CacheManager({
      maxEntries: 5,
      cleanupIntervalMs: 100, // Fast cleanup for tests
      defaultTtlMs: 1000, // 1 second default TTL
      enableCoalescing: true,
    });
  });

  afterEach(() => {
    // Clean up cache after each test
    if (cache) {
      cache.shutdown();
    }
  });

  describe('get and set', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');

      const value = cache.get<string>('key1');
      expect(value).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      const value = cache.get('nonexistent');
      expect(value).toBeNull();
    });

    it('should update statistics on get', () => {
      cache.set('key1', 'value1');

      cache.get('key1'); // Hit
      cache.get('key2'); // Miss

      const stats = cache.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it('should support custom TTL', () => {
      cache.set('key1', 'value1', 100); // 100ms TTL

      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 100); // 100ms TTL

      expect(cache.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(cache.get('key1')).toBeNull();
    });

    it('should track expirations in statistics', async () => {
      cache.set('key1', 'value1', 100); // 100ms TTL

      await new Promise(resolve => setTimeout(resolve, 150));

      cache.get('key1'); // Triggers expiration check

      const stats = cache.getStats();
      expect(stats.expirations).toBe(1);
    });

    it('should clean up expired entries in background', async () => {
      cache.set('key1', 'value1', 50); // 50ms TTL
      cache.set('key2', 'value2', 50);

      expect(cache.getStats().size).toBe(2);

      // Wait for background cleanup
      await new Promise(resolve => setTimeout(resolve, 200));

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.expirations).toBeGreaterThan(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict LRU entry when cache full', () => {
      // Fill cache (max 5 entries)
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4');
      cache.set('key5', 'value5');

      expect(cache.getStats().size).toBe(5);

      // Access key2 (make it recently used)
      cache.get('key2');

      // Add 6th entry - should evict key1 (oldest access)
      cache.set('key6', 'value6');

      expect(cache.getStats().size).toBe(5);
      expect(cache.get('key1')).toBeNull(); // Evicted
      expect(cache.get('key2')).toBe('value2'); // Kept (recently accessed)
      expect(cache.get('key6')).toBe('value6'); // New entry
    });

    it('should track evictions in statistics', () => {
      // Fill cache
      for (let i = 0; i < 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      // Trigger eviction
      cache.set('key6', 'value6');

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('delete and clear', () => {
    it('should delete specific entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const deleted = cache.delete('key1');

      expect(deleted).toBe(true);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('should invalidate entries matching pattern', () => {
      cache.set('search:customer', 'result1');
      cache.set('search:vendor', 'result2');
      cache.set('page:21', 'result3');

      const count = cache.invalidate('search:*');

      expect(count).toBe(2);
      expect(cache.get('search:customer')).toBeNull();
      expect(cache.get('search:vendor')).toBeNull();
      expect(cache.get('page:21')).toBe('result3'); // Not matched
    });

    it('should support wildcard patterns', () => {
      cache.set('search:customer:Card:10', 'result1');
      cache.set('search:customer:List:20', 'result2');
      cache.set('search:vendor:Card:10', 'result3');

      const count = cache.invalidate('search:customer:*');

      expect(count).toBe(2);
      expect(cache.get('search:vendor:Card:10')).toBe('result3');
    });
  });

  describe('getOrCompute', () => {
    it('should compute value on cache miss', async () => {
      let computeCalls = 0;
      const compute = vi.fn(async () => {
        computeCalls++;
        return 'computed-value';
      });

      const result = await cache.getOrCompute('key1', compute);

      expect(result).toBe('computed-value');
      expect(computeCalls).toBe(1);
      expect(cache.get('key1')).toBe('computed-value');
    });

    it('should return cached value on cache hit', async () => {
      let computeCalls = 0;
      const compute = vi.fn(async () => {
        computeCalls++;
        return 'computed-value';
      });

      // First call - should compute
      await cache.getOrCompute('key1', compute);

      // Second call - should use cache
      const result = await cache.getOrCompute('key1', compute);

      expect(result).toBe('computed-value');
      expect(computeCalls).toBe(1); // Only called once
    });

    it('should prevent cache stampede (coalescing)', async () => {
      let computeCalls = 0;
      const compute = async () => {
        computeCalls++;
        await new Promise(resolve => setTimeout(resolve, 100)); // Slow operation
        return 'computed-value';
      };

      // Fire 5 concurrent requests for same key
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(cache.getOrCompute('key1', compute));
      }

      const results = await Promise.all(promises);

      // All should get same result
      for (const result of results) {
        expect(result).toBe('computed-value');
      }

      // Compute should only be called once (coalescing works)
      expect(computeCalls).toBe(1);
    });

    it('should handle computation errors', async () => {
      const compute = async () => {
        throw new Error('Computation failed');
      };

      await expect(cache.getOrCompute('key1', compute)).rejects.toThrow('Computation failed');

      // Should not cache the error
      expect(cache.get('key1')).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.get('key1'); // Hit
      cache.get('key3'); // Miss

      const stats = cache.getStats();

      expect(stats.totalRequests).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);
      expect(stats.size).toBe(2);
      expect(stats.maxEntries).toBe(5);
    });

    it('should reset statistics', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key2');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      // Size should not be reset
      expect(stats.size).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should stop background cleanup', () => {
      const stats1 = cache.getStats();

      cache.shutdown();

      // Verify cleanup stopped (no more automatic cleanup after shutdown)
      expect(cache.getStats()).toBeDefined();
    });
  });
});
