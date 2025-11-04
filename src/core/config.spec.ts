/**
 * Configuration Tests
 *
 * Tests for centralized configuration module.
 * Note: Config is a singleton that reads env vars at module load time,
 * so these tests verify the current runtime config rather than testing
 * all possible configurations.
 */

import { describe, it, expect } from 'vitest';
import {
  config,
  bcConfig,
  isDevelopment,
  isProduction,
  isTest,
  nodeEnv,
  logLevel,
} from './config.js';

describe('config', () => {
  describe('Config singleton', () => {
    it('is defined and has getConfig method', () => {
      expect(config).toBeDefined();
      expect(typeof config.getConfig).toBe('function');
    });

    it('has nodeEnv accessor', () => {
      expect(config.nodeEnv).toBeDefined();
      expect(['development', 'production', 'test']).toContain(config.nodeEnv);
    });

    it('has logLevel accessor', () => {
      expect(config.logLevel).toBeDefined();
      expect(['debug', 'info', 'warn', 'error']).toContain(config.logLevel);
    });

    it('has bc accessor with BC configuration', () => {
      expect(config.bc).toBeDefined();
      expect(config.bc).toHaveProperty('baseUrl');
      expect(config.bc).toHaveProperty('username');
      expect(config.bc).toHaveProperty('password');
      expect(config.bc).toHaveProperty('tenantId');
      expect(config.bc).toHaveProperty('timeout');
    });

    it('has environment check accessors', () => {
      expect(typeof config.isDevelopment).toBe('boolean');
      expect(typeof config.isProduction).toBe('boolean');
      expect(typeof config.isTest).toBe('boolean');
    });

    it('getConfig returns readonly configuration', () => {
      const cfg = config.getConfig();
      expect(cfg).toBeDefined();
      expect(cfg).toHaveProperty('nodeEnv');
      expect(cfg).toHaveProperty('logLevel');
      expect(cfg).toHaveProperty('bc');
    });

    it('environment flags are mutually exclusive', () => {
      // At most one should be true
      const trueCount = [config.isDevelopment, config.isProduction, config.isTest].filter(
        Boolean
      ).length;
      expect(trueCount).toBeLessThanOrEqual(1);
    });
  });

  describe('BC configuration', () => {
    it('bcConfig has required fields', () => {
      expect(bcConfig).toBeDefined();
      expect(typeof bcConfig.baseUrl).toBe('string');
      expect(typeof bcConfig.username).toBe('string');
      expect(typeof bcConfig.password).toBe('string');
      expect(typeof bcConfig.tenantId).toBe('string');
      expect(typeof bcConfig.timeout).toBe('number');
      expect(typeof bcConfig.searchTimingWindowMs).toBe('number');
    });

    it('baseUrl is a valid URL', () => {
      expect(() => new URL(bcConfig.baseUrl)).not.toThrow();
    });

    it('baseUrl is not empty', () => {
      expect(bcConfig.baseUrl.length).toBeGreaterThan(0);
    });

    it('username is not empty', () => {
      expect(bcConfig.username.length).toBeGreaterThan(0);
    });

    it('tenantId has default value', () => {
      // Should have a value, either from env or default
      expect(bcConfig.tenantId.length).toBeGreaterThan(0);
    });

    it('timeout is a positive number', () => {
      expect(bcConfig.timeout).toBeGreaterThan(0);
      expect(Number.isFinite(bcConfig.timeout)).toBe(true);
    });

    it('searchTimingWindowMs is a positive number', () => {
      expect(bcConfig.searchTimingWindowMs).toBeGreaterThan(0);
      expect(Number.isFinite(bcConfig.searchTimingWindowMs)).toBe(true);
    });

    it('bcConfig is same as config.bc', () => {
      expect(bcConfig).toBe(config.bc);
    });

    it('bcConfig properties are defined and stable', () => {
      // Config should have stable values throughout test run
      const snapshot = {
        baseUrl: bcConfig.baseUrl,
        username: bcConfig.username,
        tenantId: bcConfig.tenantId,
        timeout: bcConfig.timeout,
      };

      // Read again and verify stability
      expect(bcConfig.baseUrl).toBe(snapshot.baseUrl);
      expect(bcConfig.username).toBe(snapshot.username);
      expect(bcConfig.tenantId).toBe(snapshot.tenantId);
      expect(bcConfig.timeout).toBe(snapshot.timeout);
    });
  });

  describe('Environment accessors', () => {
    it('isDevelopment matches config.isDevelopment', () => {
      expect(isDevelopment).toBe(config.isDevelopment);
    });

    it('isProduction matches config.isProduction', () => {
      expect(isProduction).toBe(config.isProduction);
    });

    it('isTest matches config.isTest', () => {
      expect(isTest).toBe(config.isTest);
    });

    it('nodeEnv matches config.nodeEnv', () => {
      expect(nodeEnv).toBe(config.nodeEnv);
    });

    it('logLevel matches config.logLevel', () => {
      expect(logLevel).toBe(config.logLevel);
    });
  });

  describe('Configuration consistency', () => {
    it('nodeEnv corresponds to environment flags', () => {
      if (config.nodeEnv === 'development') {
        expect(config.isDevelopment).toBe(true);
        expect(config.isProduction).toBe(false);
        expect(config.isTest).toBe(false);
      } else if (config.nodeEnv === 'production') {
        expect(config.isDevelopment).toBe(false);
        expect(config.isProduction).toBe(true);
        expect(config.isTest).toBe(false);
      } else if (config.nodeEnv === 'test') {
        expect(config.isDevelopment).toBe(false);
        expect(config.isProduction).toBe(false);
        expect(config.isTest).toBe(true);
      }
    });

    it('getConfig returns consistent configuration', () => {
      const cfg1 = config.getConfig();
      const cfg2 = config.getConfig();

      // Should return consistent values
      expect(cfg1.nodeEnv).toBe(cfg2.nodeEnv);
      expect(cfg1.logLevel).toBe(cfg2.logLevel);
      expect(cfg1.bc.baseUrl).toBe(cfg2.bc.baseUrl);
      expect(cfg1.bc.timeout).toBe(cfg2.bc.timeout);
    });

    it('bc config has stable values', () => {
      const snapshot1 = {
        baseUrl: config.bc.baseUrl,
        timeout: config.bc.timeout,
        tenantId: config.bc.tenantId,
      };

      // Read again and verify stability
      const snapshot2 = {
        baseUrl: config.bc.baseUrl,
        timeout: config.bc.timeout,
        tenantId: config.bc.tenantId,
      };

      expect(snapshot1).toEqual(snapshot2);
    });
  });

  describe('Type validation', () => {
    it('nodeEnv is one of valid values', () => {
      expect(['development', 'production', 'test']).toContain(config.nodeEnv);
    });

    it('logLevel is one of valid values', () => {
      expect(['debug', 'info', 'warn', 'error']).toContain(config.logLevel);
    });

    it('all BC config values have correct types', () => {
      expect(typeof bcConfig.baseUrl).toBe('string');
      expect(typeof bcConfig.username).toBe('string');
      expect(typeof bcConfig.password).toBe('string');
      expect(typeof bcConfig.tenantId).toBe('string');
      expect(typeof bcConfig.timeout).toBe('number');
      expect(typeof bcConfig.searchTimingWindowMs).toBe('number');
    });
  });

  describe('Default values', () => {
    it('has sensible default timeout', () => {
      // Default should be 30000ms based on code
      expect(bcConfig.timeout).toBeGreaterThanOrEqual(1000);
      expect(bcConfig.timeout).toBeLessThanOrEqual(120000);
    });

    it('has sensible default searchTimingWindowMs', () => {
      // Default should be 3000ms based on code
      expect(bcConfig.searchTimingWindowMs).toBeGreaterThanOrEqual(1000);
      expect(bcConfig.searchTimingWindowMs).toBeLessThanOrEqual(30000);
    });

    it('tenant defaults to "default" if not set', () => {
      // Should be "default" or a custom value from env
      expect(bcConfig.tenantId.length).toBeGreaterThan(0);
    });
  });

  describe('Runtime configuration', () => {
    it('configuration is loaded at module initialization', () => {
      // Config should be available immediately
      expect(config).toBeDefined();
      expect(config.bc).toBeDefined();
      expect(config.nodeEnv).toBeDefined();
    });

    it('exported accessors reference the same config instance', () => {
      // Verify that bcConfig is the same as config.bc (already tested above)
      // and that environment accessors reference the same underlying config
      expect(bcConfig).toBe(config.bc);
      expect(nodeEnv).toBe(config.nodeEnv);
      expect(logLevel).toBe(config.logLevel);
    });
  });
});
