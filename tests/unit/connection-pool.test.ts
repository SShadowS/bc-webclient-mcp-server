/**
 * Unit Tests for BCConnectionPool
 *
 * Tests connection pool functionality including:
 * - Initialization
 * - Acquire/release
 * - Pool exhaustion
 * - Health checks
 * - Shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BCConnectionPool } from '../../src/services/connection-pool.js';
import type { BCConfig } from '../../src/types.js';

// Mock BCRawWebSocketClient
vi.mock('../../src/connection/clients/BCRawWebSocketClient.js', () => {
  class MockBCRawWebSocketClient {
    async authenticateWeb() {
      return undefined;
    }

    async connect() {
      return undefined;
    }

    async openSession() {
      return {
        workDate: '2024-01-01',
        culture: 'en-US',
        timeZone: 'UTC',
        language: 0,
        userId: 'testuser',
        userName: 'Test User',
        companyName: 'Test Company',
      };
    }

    async disconnect() {
      return undefined;
    }

    isReady() {
      return true;
    }

    getServerSessionId() {
      return 'test-session-id';
    }
  }

  return {
    BCRawWebSocketClient: MockBCRawWebSocketClient,
  };
});

describe('BCConnectionPool', () => {
  const mockConfig: BCConfig = {
    baseUrl: 'http://test-bc',
  } as any;

  const mockUsername = 'testuser';
  const mockPassword = 'testpass';
  const mockTenantId = 'default';

  let pool: BCConnectionPool;

  beforeEach(async () => {
    // Create pool with small limits for testing
    pool = new BCConnectionPool(
      mockConfig,
      mockUsername,
      mockPassword,
      mockTenantId,
      {
        minConnections: 1,
        maxConnections: 3,
        idleTimeoutMs: 10000,
        healthCheckIntervalMs: 5000,
        acquireTimeoutMs: 5000,
      }
    );
  });

  afterEach(async () => {
    // Clean up pool after each test
    if (pool) {
      await pool.shutdown();
    }
  });

  describe('initialization', () => {
    it('should initialize with minimum connections', async () => {
      await pool.initialize();

      const stats = pool.getStats();
      expect(stats.available).toBeGreaterThanOrEqual(1);
      expect(stats.active).toBe(0);
      expect(stats.total).toBeGreaterThanOrEqual(1);
      expect(stats.maxConnections).toBe(3);
    });

    it('should not allow double initialization', async () => {
      await pool.initialize();

      // Second init should log warning but not fail
      await expect(pool.initialize()).resolves.not.toThrow();
    });
  });

  describe('acquire and release', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should acquire a connection from pool', async () => {
      const connection = await pool.acquire();

      expect(connection).toBeDefined();
      expect(connection.client).toBeDefined();
      expect(connection.inUse).toBe(true);

      const stats = pool.getStats();
      expect(stats.active).toBe(1);

      await pool.release(connection);
    });

    it('should release connection back to pool', async () => {
      const connection = await pool.acquire();

      const statsBefore = pool.getStats();
      expect(statsBefore.active).toBe(1);

      await pool.release(connection);

      const statsAfter = pool.getStats();
      expect(statsAfter.active).toBe(0);
      expect(statsAfter.available).toBeGreaterThan(0);
    });

    it('should reuse released connections', async () => {
      // Acquire and release first connection
      const connection1 = await pool.acquire();
      const conn1Id = connection1.id;
      await pool.release(connection1);

      // Acquire again - should get same connection
      const connection2 = await pool.acquire();
      expect(connection2.id).toBe(conn1Id);

      await pool.release(connection2);
    });

    it('should create new connection if pool empty', async () => {
      // Exhaust available connections
      const connections: any[] = [];
      for (let i = 0; i < 3; i++) {
        connections.push(await pool.acquire());
      }

      expect(pool.getStats().active).toBe(3);
      expect(pool.getStats().available).toBe(0);

      // Release all
      for (const conn of connections) {
        await pool.release(conn);
      }
    });
  });

  describe('pool exhaustion', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should queue requests when pool exhausted', async () => {
      // Acquire all connections (max = 3)
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      const conn3 = await pool.acquire();

      expect(pool.getStats().active).toBe(3);
      expect(pool.getStats().queued).toBe(0);

      // Try to acquire 4th connection - should wait
      const acquirePromise = pool.acquire();

      // Wait a bit to let it queue
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(pool.getStats().queued).toBe(1);

      // Release one connection - queued request should get it
      await pool.release(conn1);

      const conn4 = await acquirePromise;
      expect(conn4).toBeDefined();
      expect(pool.getStats().queued).toBe(0);

      // Cleanup
      await pool.release(conn2);
      await pool.release(conn3);
      await pool.release(conn4);
    });

    it('should timeout if connection not available', async () => {
      // Acquire all connections
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      const conn3 = await pool.acquire();

      // Try to acquire with short timeout
      await expect(
        pool.acquire()
      ).rejects.toThrow(/timeout/i);

      // Cleanup
      await pool.release(conn1);
      await pool.release(conn2);
      await pool.release(conn3);
    }, 10000); // Increase test timeout
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should close all connections on shutdown', async () => {
      const connection = await pool.acquire();
      await pool.release(connection);

      await pool.shutdown();

      const stats = pool.getStats();
      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.available).toBe(0);
    });

    it('should reject acquire after shutdown', async () => {
      await pool.shutdown();

      await expect(pool.acquire()).rejects.toThrow(/shutting down|not initialized/i);
    });

    it('should reject queued requests on shutdown', async () => {
      // Acquire all connections
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      const conn3 = await pool.acquire();

      // Queue a request
      const acquirePromise = pool.acquire();

      // Wait for it to queue
      await new Promise(resolve => setTimeout(resolve, 100));

      // Shutdown - queued request should be rejected
      await pool.shutdown();

      await expect(acquirePromise).rejects.toThrow(/shutting down/i);
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      await pool.initialize();
    });

    it('should provide accurate statistics', async () => {
      const stats1 = pool.getStats();
      expect(stats1.maxConnections).toBe(3);

      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      const stats2 = pool.getStats();
      expect(stats2.active).toBe(2);
      expect(stats2.total).toBeGreaterThanOrEqual(2);

      await pool.release(conn1);

      const stats3 = pool.getStats();
      expect(stats3.active).toBe(1);

      await pool.release(conn2);
    });
  });
});
