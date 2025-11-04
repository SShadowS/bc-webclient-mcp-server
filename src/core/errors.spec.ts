/**
 * Error Hierarchy Tests
 *
 * Tests for BC MCP Server error classes, base functionality, and type guards.
 */

import { describe, it, expect } from 'vitest';
import {
  BCError,
  ConnectionError,
  AuthenticationError,
  WebSocketConnectionError,
  SessionExpiredError,
  TimeoutError,
  AbortedError,
  NetworkError,
  ProtocolError,
  JsonRpcError,
  DecompressionError,
  InvalidResponseError,
  ParseError,
  HandlerParseError,
  ControlParseError,
  LogicalFormParseError,
  ValidationError,
  ConfigValidationError,
  InputValidationError,
  SchemaValidationError,
  BusinessLogicError,
  PageNotFoundError,
  ActionNotFoundError,
  FieldNotFoundError,
  RecordNotFoundError,
  PermissionDeniedError,
  ActionDisabledError,
  FieldReadOnlyError,
  MCPError,
  MCPToolNotFoundError,
  MCPResourceNotFoundError,
  MCPInvalidArgumentsError,
  InternalError,
  NotImplementedError,
  UnreachableError,
  isConnectionError,
  isAuthenticationError,
  isProtocolError,
  isParseError,
  isValidationError,
  isBusinessLogicError,
  isMCPError,
  isInternalError,
  isBCError,
} from './errors.js';

describe('errors', () => {
  describe('BCError base class', () => {
    it('sets name, code, message, and timestamp', () => {
      // Arrange & Act
      const error = new ConnectionError('Test error');

      // Assert
      expect(error.name).toBe('ConnectionError');
      expect(error.code).toBe('BC_CONNECTION_ERROR');
      expect(error.message).toBe('Test error');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('includes context when provided', () => {
      // Arrange & Act
      const error = new ConnectionError('Test error', { url: 'http://example.com' });

      // Assert
      expect(error.context).toEqual({ url: 'http://example.com' });
    });

    it('has no context when not provided', () => {
      // Arrange & Act
      const error = new ConnectionError('Test error');

      // Assert
      expect(error.context).toBeUndefined();
    });

    it('captures stack trace', () => {
      // Arrange & Act
      const error = new ConnectionError('Test error');

      // Assert
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
      expect(error.stack).toContain('ConnectionError');
    });

    it('is instanceof Error', () => {
      // Arrange & Act
      const error = new ConnectionError('Test error');

      // Assert
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BCError);
    });

    it('toJSON() returns structured error information', () => {
      // Arrange
      const error = new ConnectionError('Test error', { url: 'http://example.com' });

      // Act
      const json = error.toJSON();

      // Assert
      expect(json.name).toBe('ConnectionError');
      expect(json.code).toBe('BC_CONNECTION_ERROR');
      expect(json.message).toBe('Test error');
      expect(json.context).toEqual({ url: 'http://example.com' });
      expect(typeof json.timestamp).toBe('string'); // ISO string
      expect(typeof json.stack).toBe('string');
    });

    it('toJSON() handles missing context', () => {
      // Arrange
      const error = new TimeoutError('Timeout');

      // Act
      const json = error.toJSON();

      // Assert
      expect(json.context).toEqual({ subtype: 'timeout' });
    });

    it('toString() formats error without context', () => {
      // Arrange
      const error = new ConnectionError('Test error');

      // Act
      const str = error.toString();

      // Assert
      expect(str).toBe('[BC_CONNECTION_ERROR] ConnectionError: Test error');
    });

    it('toString() includes context when present', () => {
      // Arrange
      const error = new ConnectionError('Test error', { url: 'http://example.com' });

      // Act
      const str = error.toString();

      // Assert
      expect(str).toContain('[BC_CONNECTION_ERROR] ConnectionError: Test error');
      expect(str).toContain('Context');
      expect(str).toContain('http://example.com');
    });
  });

  describe('Connection Errors', () => {
    it('ConnectionError has correct code', () => {
      const error = new ConnectionError('Failed to connect');
      expect(error.code).toBe('BC_CONNECTION_ERROR');
      expect(error.name).toBe('ConnectionError');
    });

    it('AuthenticationError has correct code and subtype', () => {
      const error = new AuthenticationError('Invalid credentials');
      expect(error.code).toBe('BC_AUTH_ERROR');
      expect(error.context).toEqual({ subtype: 'authentication' });
    });

    it('WebSocketConnectionError has correct code and subtype', () => {
      const error = new WebSocketConnectionError('WS connection failed');
      expect(error.code).toBe('BC_WS_CONNECTION_ERROR');
      expect(error.context).toEqual({ subtype: 'websocket' });
    });

    it('SessionExpiredError has correct code and subtype', () => {
      const error = new SessionExpiredError('Session expired');
      expect(error.code).toBe('BC_SESSION_EXPIRED');
      expect(error.context).toEqual({ subtype: 'session_expired' });
    });

    it('TimeoutError has correct code and subtype', () => {
      const error = new TimeoutError('Operation timed out');
      expect(error.code).toBe('BC_TIMEOUT_ERROR');
      expect(error.context).toEqual({ subtype: 'timeout' });
    });

    it('AbortedError has correct code and subtype', () => {
      const error = new AbortedError('Operation cancelled');
      expect(error.code).toBe('BC_ABORTED_ERROR');
      expect(error.context).toEqual({ subtype: 'aborted' });
    });

    it('NetworkError has correct code and subtype', () => {
      const error = new NetworkError('Network failure');
      expect(error.code).toBe('BC_NETWORK_ERROR');
      expect(error.context).toEqual({ subtype: 'network' });
    });
  });

  describe('Protocol Errors', () => {
    it('ProtocolError has correct code', () => {
      const error = new ProtocolError('Invalid protocol');
      expect(error.code).toBe('BC_PROTOCOL_ERROR');
    });

    it('JsonRpcError has correct code and rpcErrorCode', () => {
      const error = new JsonRpcError('RPC failed', -32600);
      expect(error.code).toBe('BC_JSONRPC_ERROR');
      expect(error.rpcErrorCode).toBe(-32600);
      expect(error.context).toEqual({ rpcErrorCode: -32600 });
    });

    it('JsonRpcError rpcErrorCode is immutable', () => {
      const error = new JsonRpcError('RPC failed', -32600);
      expect(() => {
        (error as any).rpcErrorCode = 999;
      }).toThrow();
    });

    it('DecompressionError has correct code and subtype', () => {
      const error = new DecompressionError('Decompression failed');
      expect(error.code).toBe('BC_DECOMPRESSION_ERROR');
      expect(error.context).toEqual({ subtype: 'decompression' });
    });

    it('InvalidResponseError has correct code and subtype', () => {
      const error = new InvalidResponseError('Invalid response');
      expect(error.code).toBe('BC_INVALID_RESPONSE');
      expect(error.context).toEqual({ subtype: 'invalid_response' });
    });
  });

  describe('Parse Errors', () => {
    it('ParseError has correct code', () => {
      const error = new ParseError('Parse failed');
      expect(error.code).toBe('BC_PARSE_ERROR');
    });

    it('HandlerParseError has correct code and handlerType', () => {
      const error = new HandlerParseError('Handler parse failed', 'FormToShow');
      expect(error.code).toBe('BC_HANDLER_PARSE_ERROR');
      expect(error.handlerType).toBe('FormToShow');
      expect(error.context).toEqual({ handlerType: 'FormToShow' });
    });

    it('HandlerParseError handlerType is immutable', () => {
      const error = new HandlerParseError('Failed', 'FormToShow');
      expect(() => {
        (error as any).handlerType = 'OtherType';
      }).toThrow();
    });

    it('ControlParseError has correct code and controlType', () => {
      const error = new ControlParseError('Control parse failed', 'textbox');
      expect(error.code).toBe('BC_CONTROL_PARSE_ERROR');
      expect(error.controlType).toBe('textbox');
      expect(error.context).toEqual({ controlType: 'textbox' });
    });

    it('LogicalFormParseError has correct code and subtype', () => {
      const error = new LogicalFormParseError('Logical form parse failed');
      expect(error.code).toBe('BC_LOGICAL_FORM_PARSE_ERROR');
      expect(error.context).toEqual({ subtype: 'logical_form' });
    });
  });

  describe('Validation Errors', () => {
    it('ValidationError has correct code and field', () => {
      const error = new ValidationError('Invalid input', 'email');
      expect(error.code).toBe('BC_VALIDATION_ERROR');
      expect(error.field).toBe('email');
      expect(error.context).toEqual({ field: 'email', validationErrors: undefined });
    });

    it('ValidationError includes validationErrors array', () => {
      const errors = ['Too short', 'Invalid format'];
      const error = new ValidationError('Invalid input', 'password', errors);
      expect(error.validationErrors).toEqual(errors);
      expect(error.context).toEqual({ field: 'password', validationErrors: errors });
    });

    it('ConfigValidationError has correct code and field', () => {
      const error = new ConfigValidationError('Invalid config', 'baseUrl');
      expect(error.code).toBe('BC_CONFIG_VALIDATION_ERROR');
      expect(error.field).toBe('baseUrl');
      expect(error.context).toEqual({ field: 'baseUrl', subtype: 'config' });
    });

    it('InputValidationError has correct code, field, and validationErrors', () => {
      const errors = ['Required field'];
      const error = new InputValidationError('Invalid input', 'username', errors);
      expect(error.code).toBe('BC_INPUT_VALIDATION_ERROR');
      expect(error.field).toBe('username');
      expect(error.validationErrors).toEqual(errors);
      expect(error.context).toEqual({ field: 'username', validationErrors: errors, subtype: 'input' });
    });

    it('InputValidationError properties are immutable', () => {
      const error = new InputValidationError('Invalid', 'field', ['error']);
      expect(() => {
        (error as any).field = 'other';
      }).toThrow();
      expect(() => {
        (error as any).validationErrors = [];
      }).toThrow();
    });

    it('SchemaValidationError has correct code and validationErrors', () => {
      const errors = ['Missing required field', 'Invalid type'];
      const error = new SchemaValidationError('Schema validation failed', errors);
      expect(error.code).toBe('BC_SCHEMA_VALIDATION_ERROR');
      expect(error.validationErrors).toEqual(errors);
      expect(error.context).toEqual({ validationErrors: errors, subtype: 'schema' });
    });
  });

  describe('Business Logic Errors', () => {
    it('BusinessLogicError has correct code', () => {
      const error = new BusinessLogicError('Business rule violated');
      expect(error.code).toBe('BC_BUSINESS_LOGIC_ERROR');
    });

    it('PageNotFoundError has correct code and pageId', () => {
      const error = new PageNotFoundError('21');
      expect(error.code).toBe('BC_PAGE_NOT_FOUND');
      expect(error.message).toBe('Page 21 not found');
      expect(error.pageId).toBe('21');
    });

    it('PageNotFoundError accepts custom message', () => {
      const error = new PageNotFoundError('21', 'Custom message');
      expect(error.message).toBe('Custom message');
      expect(error.pageId).toBe('21');
    });

    it('ActionNotFoundError has correct code and actionName', () => {
      const error = new ActionNotFoundError('Post');
      expect(error.code).toBe('BC_ACTION_NOT_FOUND');
      expect(error.message).toBe('Action Post not found');
      expect(error.actionName).toBe('Post');
    });

    it('FieldNotFoundError has correct code and fieldName', () => {
      const error = new FieldNotFoundError('Email');
      expect(error.code).toBe('BC_FIELD_NOT_FOUND');
      expect(error.message).toBe('Field Email not found');
      expect(error.fieldName).toBe('Email');
    });

    it('RecordNotFoundError has correct code and recordId', () => {
      const error = new RecordNotFoundError('123');
      expect(error.code).toBe('BC_RECORD_NOT_FOUND');
      expect(error.message).toBe('Record 123 not found');
      expect(error.recordId).toBe('123');
    });

    it('PermissionDeniedError has correct code, resource, and action', () => {
      const error = new PermissionDeniedError('Access denied', 'Customer', 'Delete');
      expect(error.code).toBe('BC_PERMISSION_DENIED');
      expect(error.resource).toBe('Customer');
      expect(error.action).toBe('Delete');
      expect(error.context).toEqual({ resource: 'Customer', action: 'Delete' });
    });

    it('ActionDisabledError has correct code and actionName', () => {
      const error = new ActionDisabledError('Approve');
      expect(error.code).toBe('BC_ACTION_DISABLED');
      expect(error.message).toBe('Action Approve is disabled');
      expect(error.actionName).toBe('Approve');
    });

    it('FieldReadOnlyError has correct code and fieldName', () => {
      const error = new FieldReadOnlyError('CreatedDate');
      expect(error.code).toBe('BC_FIELD_READONLY');
      expect(error.message).toBe('Field CreatedDate is read-only');
      expect(error.fieldName).toBe('CreatedDate');
    });
  });

  describe('MCP Protocol Errors', () => {
    it('MCPError has correct code', () => {
      const error = new MCPError('MCP protocol error');
      expect(error.code).toBe('MCP_ERROR');
    });

    it('MCPToolNotFoundError has correct code and toolName', () => {
      const error = new MCPToolNotFoundError('search_pages');
      expect(error.code).toBe('MCP_TOOL_NOT_FOUND');
      expect(error.message).toBe('MCP tool search_pages not found');
      expect(error.toolName).toBe('search_pages');
    });

    it('MCPResourceNotFoundError has correct code and resourceUri', () => {
      const error = new MCPResourceNotFoundError('bc://page/21');
      expect(error.code).toBe('MCP_RESOURCE_NOT_FOUND');
      expect(error.message).toBe('MCP resource bc://page/21 not found');
      expect(error.resourceUri).toBe('bc://page/21');
    });

    it('MCPInvalidArgumentsError has correct code and toolName', () => {
      const error = new MCPInvalidArgumentsError('search_pages', 'Missing query parameter');
      expect(error.code).toBe('MCP_INVALID_ARGUMENTS');
      expect(error.message).toBe('Missing query parameter');
      expect(error.toolName).toBe('search_pages');
    });
  });

  describe('Internal Errors', () => {
    it('InternalError has correct code', () => {
      const error = new InternalError('Unexpected internal error');
      expect(error.code).toBe('BC_INTERNAL_ERROR');
    });

    it('NotImplementedError has correct code and feature', () => {
      const error = new NotImplementedError('DialogHandler');
      expect(error.code).toBe('BC_NOT_IMPLEMENTED');
      expect(error.message).toBe('Feature DialogHandler is not yet implemented');
      expect(error.feature).toBe('DialogHandler');
    });

    it('NotImplementedError uses default message when not provided', () => {
      const error = new NotImplementedError();
      expect(error.message).toBe('Feature unknown is not yet implemented');
    });

    it('UnreachableError has correct code', () => {
      const error = new UnreachableError();
      expect(error.code).toBe('BC_UNREACHABLE');
      expect(error.message).toBe('Unreachable code path executed');
    });

    it('UnreachableError accepts custom message', () => {
      const error = new UnreachableError('Should never reach here');
      expect(error.message).toBe('Should never reach here');
    });
  });

  describe('Type Guards', () => {
    it('isConnectionError identifies ConnectionError', () => {
      const error = new ConnectionError('Test');
      expect(isConnectionError(error)).toBe(true);
      expect(isConnectionError(new AuthenticationError('Test'))).toBe(false);
      expect(isConnectionError(new Error('Test'))).toBe(false);
      expect(isConnectionError(null)).toBe(false);
    });

    it('isAuthenticationError identifies AuthenticationError', () => {
      const error = new AuthenticationError('Test');
      expect(isAuthenticationError(error)).toBe(true);
      expect(isAuthenticationError(new ConnectionError('Test'))).toBe(false);
      expect(isAuthenticationError({})).toBe(false);
    });

    it('isProtocolError identifies ProtocolError', () => {
      const error = new ProtocolError('Test');
      expect(isProtocolError(error)).toBe(true);
      expect(isProtocolError(new ParseError('Test'))).toBe(false);
      expect(isProtocolError('error')).toBe(false);
    });

    it('isParseError identifies ParseError', () => {
      const error = new ParseError('Test');
      expect(isParseError(error)).toBe(true);
      expect(isParseError(new ProtocolError('Test'))).toBe(false);
      expect(isParseError(undefined)).toBe(false);
    });

    it('isValidationError identifies ValidationError', () => {
      const error = new ValidationError('Test');
      expect(isValidationError(error)).toBe(true);
      expect(isValidationError(new ParseError('Test'))).toBe(false);
      expect(isValidationError(123)).toBe(false);
    });

    it('isBusinessLogicError identifies BusinessLogicError', () => {
      const error = new BusinessLogicError('Test');
      expect(isBusinessLogicError(error)).toBe(true);
      expect(isBusinessLogicError(new ValidationError('Test'))).toBe(false);
      expect(isBusinessLogicError(true)).toBe(false);
    });

    it('isMCPError identifies MCPError', () => {
      const error = new MCPError('Test');
      expect(isMCPError(error)).toBe(true);
      expect(isMCPError(new InternalError('Test'))).toBe(false);
      expect(isMCPError([])).toBe(false);
    });

    it('isInternalError identifies InternalError', () => {
      const error = new InternalError('Test');
      expect(isInternalError(error)).toBe(true);
      expect(isInternalError(new MCPError('Test'))).toBe(false);
      expect(isInternalError({ code: 'ERROR' })).toBe(false);
    });

    it('isBCError identifies any BCError subclass', () => {
      expect(isBCError(new ConnectionError('Test'))).toBe(true);
      expect(isBCError(new AuthenticationError('Test'))).toBe(true);
      expect(isBCError(new ProtocolError('Test'))).toBe(true);
      expect(isBCError(new ValidationError('Test'))).toBe(true);
      expect(isBCError(new MCPError('Test'))).toBe(true);
      expect(isBCError(new InternalError('Test'))).toBe(true);
      expect(isBCError(new Error('Test'))).toBe(false);
      expect(isBCError(null)).toBe(false);
    });
  });

  describe('Context merging', () => {
    it('merges custom context with error-specific context', () => {
      const error = new AuthenticationError('Failed', { userId: '123' });
      expect(error.context).toEqual({ userId: '123', subtype: 'authentication' });
    });

    it('handles undefined context gracefully', () => {
      const error = new ConnectionError('Failed', undefined);
      expect(error.context).toBeUndefined();
    });

    it('preserves all context fields for complex errors', () => {
      const error = new InputValidationError(
        'Invalid',
        'email',
        ['Too short', 'Invalid format'],
        { source: 'form' }
      );
      expect(error.context).toEqual({
        field: 'email',
        validationErrors: ['Too short', 'Invalid format'],
        subtype: 'input',
        source: 'form',
      });
    });
  });
});
