/**
 * Logger Tests
 *
 * Tests for centralized logging utilities with structured logging support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  logger,
  createChildLogger,
  createToolLogger,
  createConnectionLogger,
  LogLevels,
} from './logger.js';

describe('logger', () => {
  // Store original log level to restore after tests
  let originalLevel: string;

  beforeEach(() => {
    originalLevel = logger.level;
  });

  afterEach(() => {
    // Restore original log level
    logger.level = originalLevel;
  });

  describe('Global logger', () => {
    it('is defined and has standard log methods', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });

    it('has a name property', () => {
      // Pino logger has bindings that include the name
      expect(logger.bindings()).toHaveProperty('name');
      expect(logger.bindings().name).toBe('bc-webclient-mcp');
    });

    it('has a level property', () => {
      expect(typeof logger.level).toBe('string');
      expect(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).toContain(
        logger.level
      );
    });
  });

  describe('createChildLogger()', () => {
    it('creates a child logger with context', () => {
      // Arrange
      const context = { userId: '123', operation: 'test' };

      // Act
      const childLogger = createChildLogger(context);

      // Assert
      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
      expect(childLogger.bindings()).toMatchObject(context);
    });

    it('child logger inherits parent configuration', () => {
      // Arrange
      const context = { test: 'value' };
      const childLogger = createChildLogger(context);

      // Assert
      expect(childLogger.level).toBe(logger.level);
      expect(childLogger.bindings().name).toBe('bc-webclient-mcp');
    });

    it('handles empty context', () => {
      // Arrange & Act
      const childLogger = createChildLogger({});

      // Assert
      expect(childLogger).toBeDefined();
      expect(childLogger.bindings()).toMatchObject({});
    });

    it('handles complex context with nested objects', () => {
      // Arrange
      const context = {
        metadata: { version: '1.0', tags: ['test', 'unit'] },
        count: 42,
      };

      // Act
      const childLogger = createChildLogger(context);

      // Assert
      expect(childLogger.bindings()).toMatchObject(context);
    });
  });

  describe('createToolLogger()', () => {
    it('creates logger with tool name only', () => {
      // Arrange & Act
      const toolLogger = createToolLogger('GetPageMetadata');

      // Assert
      expect(toolLogger).toBeDefined();
      expect(toolLogger.bindings()).toMatchObject({ tool: 'GetPageMetadata' });
    });

    it('creates logger with tool name and pageContextId', () => {
      // Arrange & Act
      const toolLogger = createToolLogger('GetPageMetadata', 'session123:page21');

      // Assert
      expect(toolLogger.bindings()).toMatchObject({
        tool: 'GetPageMetadata',
        pageContextId: 'session123:page21',
        sessionId: 'session123',
      });
    });

    it('extracts sessionId from pageContextId', () => {
      // Arrange & Act
      const toolLogger = createToolLogger('SearchPages', 'abc-def-ghi:42');

      // Assert
      expect(toolLogger.bindings().sessionId).toBe('abc-def-ghi');
      expect(toolLogger.bindings().pageContextId).toBe('abc-def-ghi:42');
    });

    it('handles pageContextId without colon', () => {
      // Arrange & Act
      const toolLogger = createToolLogger('SearchPages', 'simpleId');

      // Assert
      expect(toolLogger.bindings().sessionId).toBe('simpleId');
      expect(toolLogger.bindings().pageContextId).toBe('simpleId');
    });

    it('handles empty pageContextId', () => {
      // Arrange & Act
      const toolLogger = createToolLogger('Tool', '');

      // Assert
      // Empty string is falsy, so pageContextId should not be added
      expect(toolLogger.bindings()).toMatchObject({ tool: 'Tool' });
      expect(toolLogger.bindings()).not.toHaveProperty('pageContextId');
    });

    it('handles undefined pageContextId', () => {
      // Arrange & Act
      const toolLogger = createToolLogger('Tool', undefined);

      // Assert
      expect(toolLogger.bindings()).toMatchObject({ tool: 'Tool' });
      expect(toolLogger.bindings()).not.toHaveProperty('pageContextId');
    });
  });

  describe('createConnectionLogger()', () => {
    it('creates logger with sessionId only', () => {
      // Arrange & Act
      const connLogger = createConnectionLogger('session-abc-123');

      // Assert
      expect(connLogger).toBeDefined();
      expect(connLogger.bindings()).toMatchObject({ sessionId: 'session-abc-123' });
    });

    it('creates logger with sessionId and operation', () => {
      // Arrange & Act
      const connLogger = createConnectionLogger('session-456', 'authenticate');

      // Assert
      expect(connLogger.bindings()).toMatchObject({
        sessionId: 'session-456',
        operation: 'authenticate',
      });
    });

    it('handles empty operation', () => {
      // Arrange & Act
      const connLogger = createConnectionLogger('session-789', '');

      // Assert
      // Empty string is falsy, so operation should not be added
      expect(connLogger.bindings()).toMatchObject({ sessionId: 'session-789' });
      expect(connLogger.bindings()).not.toHaveProperty('operation');
    });

    it('handles undefined operation', () => {
      // Arrange & Act
      const connLogger = createConnectionLogger('session-xyz', undefined);

      // Assert
      expect(connLogger.bindings()).toMatchObject({ sessionId: 'session-xyz' });
      expect(connLogger.bindings()).not.toHaveProperty('operation');
    });
  });

  describe('LogLevels', () => {
    describe('isDebugEnabled()', () => {
      it('returns true when level is debug', () => {
        // Arrange
        LogLevels.setLevel('debug');

        // Act & Assert
        expect(LogLevels.isDebugEnabled()).toBe(true);
      });

      it('returns true when level is trace', () => {
        // Arrange
        LogLevels.setLevel('trace');

        // Act & Assert
        expect(LogLevels.isDebugEnabled()).toBe(true);
      });

      it('returns false when level is info', () => {
        // Arrange
        LogLevels.setLevel('info');

        // Act & Assert
        expect(LogLevels.isDebugEnabled()).toBe(false);
      });

      it('returns false when level is warn', () => {
        // Arrange
        LogLevels.setLevel('warn');

        // Act & Assert
        expect(LogLevels.isDebugEnabled()).toBe(false);
      });

      it('returns false when level is error', () => {
        // Arrange
        LogLevels.setLevel('error');

        // Act & Assert
        expect(LogLevels.isDebugEnabled()).toBe(false);
      });
    });

    describe('isTraceEnabled()', () => {
      it('returns true when level is trace', () => {
        // Arrange
        LogLevels.setLevel('trace');

        // Act & Assert
        expect(LogLevels.isTraceEnabled()).toBe(true);
      });

      it('returns false when level is debug', () => {
        // Arrange
        LogLevels.setLevel('debug');

        // Act & Assert
        expect(LogLevels.isTraceEnabled()).toBe(false);
      });

      it('returns false when level is info', () => {
        // Arrange
        LogLevels.setLevel('info');

        // Act & Assert
        expect(LogLevels.isTraceEnabled()).toBe(false);
      });
    });

    describe('setLevel() and getLevel()', () => {
      it('sets and gets log level', () => {
        // Arrange & Act
        LogLevels.setLevel('debug');

        // Assert
        expect(LogLevels.getLevel()).toBe('debug');
      });

      it('changes level from info to error', () => {
        // Arrange
        LogLevels.setLevel('info');
        expect(LogLevels.getLevel()).toBe('info');

        // Act
        LogLevels.setLevel('error');

        // Assert
        expect(LogLevels.getLevel()).toBe('error');
      });

      it('accepts all valid log levels', () => {
        const levels: Array<'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'> = [
          'fatal',
          'error',
          'warn',
          'info',
          'debug',
          'trace',
          'silent',
        ];

        levels.forEach((level) => {
          // Act
          LogLevels.setLevel(level);

          // Assert
          expect(LogLevels.getLevel()).toBe(level);
        });
      });

      it('affects global logger instance', () => {
        // Arrange
        LogLevels.setLevel('warn');

        // Assert
        expect(logger.level).toBe('warn');
        expect(LogLevels.getLevel()).toBe('warn');
      });
    });
  });

  describe('Child logger inheritance', () => {
    it('child logger respects parent level changes', () => {
      // Arrange
      const childLogger = createChildLogger({ test: 'value' });
      LogLevels.setLevel('debug');

      // Assert
      expect(childLogger.level).toBe('debug');

      // Act - change level
      LogLevels.setLevel('error');

      // Assert
      expect(childLogger.level).toBe('error');
    });

    it('tool logger respects level changes', () => {
      // Arrange
      const toolLogger = createToolLogger('TestTool');

      // Act
      LogLevels.setLevel('trace');

      // Assert
      expect(toolLogger.level).toBe('trace');
    });

    it('connection logger respects level changes', () => {
      // Arrange
      const connLogger = createConnectionLogger('session-123');

      // Act
      LogLevels.setLevel('fatal');

      // Assert
      expect(connLogger.level).toBe('fatal');
    });
  });

  describe('Logger context isolation', () => {
    it('child loggers have independent contexts', () => {
      // Arrange
      const child1 = createChildLogger({ id: '1', name: 'first' });
      const child2 = createChildLogger({ id: '2', name: 'second' });

      // Assert
      expect(child1.bindings()).toMatchObject({ id: '1', name: 'first' });
      expect(child2.bindings()).toMatchObject({ id: '2', name: 'second' });
      expect(child1.bindings().id).not.toBe(child2.bindings().id);
    });

    it('tool loggers have independent contexts', () => {
      // Arrange
      const tool1 = createToolLogger('Tool1', 'session1:page1');
      const tool2 = createToolLogger('Tool2', 'session2:page2');

      // Assert
      expect(tool1.bindings().tool).toBe('Tool1');
      expect(tool2.bindings().tool).toBe('Tool2');
      expect(tool1.bindings().sessionId).toBe('session1');
      expect(tool2.bindings().sessionId).toBe('session2');
    });
  });
});
