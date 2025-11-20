/**
 * Base MCP Tool Implementation
 *
 * Provides common functionality for all MCP tools.
 * Handles input validation and error conversion.
 *
 * Supports both Zod schema validation (recommended) and legacy validation helpers.
 */

import type { IMCPTool } from '../core/interfaces.js';
import type { Result } from '../core/result.js';
import { err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { InputValidationError } from '../core/errors.js';
import type { ZodTypeAny, ZodError } from 'zod';
import type { AuditLogger } from '../services/audit-logger.js';
import { debugTools } from '../services/debug-logger.js';
import { config } from '../core/config.js';

/**
 * Options for BaseMCPTool constructor.
 */
export interface BaseMCPToolOptions {
  /**
   * Optional Zod schema for input validation.
   * If provided, validateInput will use Zod validation.
   * Otherwise, falls back to legacy validation helpers.
   */
  inputZod?: ZodTypeAny;

  /**
   * Optional audit logger for tracking tool executions.
   * If provided and requiresConsent is true, all executions will be logged.
   */
  auditLogger?: AuditLogger;
}

/**
 * Abstract base class for MCP tools.
 * Implements common validation and error handling.
 *
 * Tools can provide a Zod schema for automatic validation with type coercion,
 * or use the legacy validation helpers for manual validation.
 */
export abstract class BaseMCPTool implements IMCPTool {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly inputSchema: unknown;

  /**
   * Optional Zod schema for input validation.
   * When provided, validateInput uses this instead of legacy validation.
   */
  protected readonly inputZod?: ZodTypeAny;

  /**
   * Optional audit logger for tracking tool executions.
   * Used to log all consent-required tool invocations.
   */
  protected readonly auditLogger?: AuditLogger;

  /**
   * Constructor that optionally accepts a Zod schema and audit logger.
   */
  constructor(opts?: BaseMCPToolOptions) {
    if (opts?.inputZod) {
      this.inputZod = opts.inputZod;
    }
    if (opts?.auditLogger) {
      this.auditLogger = opts.auditLogger;
    }
  }

  /**
   * Executes the tool with validated input.
   * Subclasses must implement this method.
   */
  protected abstract executeInternal(input: unknown): Promise<Result<unknown, BCError>>;

  /**
   * Validates input against the tool's schema.
   * Subclasses can override for custom validation.
   *
   * If inputZod is provided, uses Zod validation with type coercion.
   * Otherwise, uses basic type checking (legacy mode).
   */
  protected validateInput(input: unknown): Result<unknown, BCError> {
    // Zod validation (recommended)
    if (this.inputZod) {
      const parsed = this.inputZod.safeParse(input);
      if (!parsed.success) {
        return err(this.zodErrorToInputValidationError(parsed.error));
      }
      return { ok: true, value: parsed.data };
    }

    // Legacy validation - basic type checking
    if (typeof input !== 'object' || input === null) {
      return err(
        new InputValidationError(
          'Tool input must be an object',
          undefined,
          ['Input must be a non-null object'],
          { received: typeof input }
        )
      );
    }

    return { ok: true, value: input };
  }

  /**
   * Converts Zod validation error to InputValidationError.
   */
  private zodErrorToInputValidationError(zodError: ZodError): InputValidationError {
    const issues = zodError.issues;
    const validationErrors = issues.map(issue => {
      const path = issue.path.join('.');
      return `${path ? path + ': ' : ''}${issue.message}`;
    });

    // Get the first field path for the error
    const firstField = issues[0]?.path[0];
    const field = firstField !== undefined ? String(firstField) : undefined;

    return new InputValidationError(
      'Input validation failed',
      field,
      validationErrors,
      { zodIssues: issues }
    );
  }

  /**
   * Executes the tool.
   * Validates input and calls executeInternal.
   *
   * CRITICAL FIX: Audit logging happens AFTER execution completes,
   * with the actual result status. This prevents contradictory audit
   * entries where "success" is logged but the operation fails.
   */
  public async execute(input: unknown): Promise<Result<unknown, BCError>> {
    const startTime = Date.now();
    const executionId = `exec-${Date.now()}-${this.name}`;

    // 🐛 Debug: Log tool start
    debugTools('Tool execution started', {
      toolName: this.name,
      requiresConsent: (this as IMCPTool).requiresConsent,
    }, executionId);

    // Validate input
    const validationResult = this.validateInput(input);
    if (!validationResult.ok) {
      const duration = Date.now() - startTime;

      // 🐛 Debug: Log validation failure
      debugTools('Tool validation failed', {
        toolName: this.name,
        error: validationResult.error.message,
        errorCode: validationResult.error.code,
      }, executionId, duration);

      return validationResult;
    }

    // 🐛 Debug: Log validated parameters
    debugTools('Tool parameters validated', {
      toolName: this.name,
      validatedInput: config.debug.logFullHandlers
        ? validationResult.value
        : this.getInputSummary(validationResult.value),
    }, executionId);

    // Execute tool logic
    const result = await this.executeInternal(validationResult.value);

    const duration = Date.now() - startTime;

    // 🐛 Debug: Log tool result
    debugTools('Tool execution completed', {
      toolName: this.name,
      success: result.ok,
      error: result.ok ? undefined : result.error.message,
      errorCode: result.ok ? undefined : result.error.code,
      resultSize: result.ok ? JSON.stringify(result.value).length : 0,
    }, executionId, duration);

    // Log audit event AFTER execution for consent-required tools
    // This ensures we log the actual result (success/error), not a prediction
    // Access requiresConsent through property lookup since it's defined by subclasses
    const requiresConsent = (this as IMCPTool).requiresConsent;
    if (requiresConsent && this.auditLogger) {
      this.auditLogger.logToolExecution({
        toolName: this.name,
        userApproved: true, // If we reach here, user approved (host enforces)
        inputSummary: this.getInputSummary(validationResult.value),
        result: result.ok ? 'success' : 'error',
        errorMessage: result.ok ? undefined : result.error.message,
      });
    }

    return result;
  }

  /**
   * Get a safe summary of input for audit logging.
   * Subclasses can override to customize what gets logged.
   *
   * Default implementation extracts key fields and truncates complex values.
   */
  protected getInputSummary(input: unknown): Record<string, unknown> {
    if (typeof input === 'object' && input !== null) {
      const summary: Record<string, unknown> = {};

      // Extract key fields (limit to avoid huge logs)
      for (const [key, value] of Object.entries(input)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          summary[key] = '[Object]';
        } else if (Array.isArray(value)) {
          summary[key] = `[Array(${value.length})]`;
        } else {
          summary[key] = value;
        }
      }

      return summary;
    }

    return { input: String(input) };
  }

  /**
   * Helper to check if a property exists on an object.
   */
  protected hasProperty<K extends string>(
    obj: unknown,
    key: K
  ): obj is Record<K, unknown> {
    return typeof obj === 'object' && obj !== null && key in obj;
  }

  /**
   * Helper to get a required string property.
   */
  protected getRequiredString(
    obj: unknown,
    key: string
  ): Result<string, InputValidationError> {
    if (!this.hasProperty(obj, key)) {
      return err(
        new InputValidationError(
          `Missing required field: ${key}`,
          key,
          [`Field '${key}' is required`]
        )
      );
    }

    const value = (obj as Record<string, unknown>)[key];

    if (typeof value !== 'string') {
      return err(
        new InputValidationError(
          `Field '${key}' must be a string`,
          key,
          [`Expected string, got ${typeof value}`]
        )
      );
    }

    return { ok: true, value };
  }

  /**
   * Helper to get an optional string property.
   */
  protected getOptionalString(
    obj: unknown,
    key: string
  ): Result<string | undefined, InputValidationError> {
    if (!this.hasProperty(obj, key)) {
      return { ok: true, value: undefined };
    }

    const value = (obj as Record<string, unknown>)[key];

    if (value === undefined || value === null) {
      return { ok: true, value: undefined };
    }

    if (typeof value !== 'string') {
      return err(
        new InputValidationError(
          `Field '${key}' must be a string`,
          key,
          [`Expected string, got ${typeof value}`]
        )
      );
    }

    return { ok: true, value };
  }

  /**
   * Helper to get a required number property.
   */
  protected getRequiredNumber(
    obj: unknown,
    key: string
  ): Result<number, InputValidationError> {
    if (!this.hasProperty(obj, key)) {
      return err(
        new InputValidationError(
          `Missing required field: ${key}`,
          key,
          [`Field '${key}' is required`]
        )
      );
    }

    const value = (obj as Record<string, unknown>)[key];

    if (typeof value !== 'number') {
      return err(
        new InputValidationError(
          `Field '${key}' must be a number`,
          key,
          [`Expected number, got ${typeof value}`]
        )
      );
    }

    return { ok: true, value };
  }

  /**
   * Helper to get an optional number property.
   */
  protected getOptionalNumber(
    obj: unknown,
    key: string
  ): Result<number | undefined, InputValidationError> {
    if (!this.hasProperty(obj, key)) {
      return { ok: true, value: undefined };
    }

    const value = (obj as Record<string, unknown>)[key];

    if (value === undefined || value === null) {
      return { ok: true, value: undefined };
    }

    if (typeof value !== 'number') {
      return err(
        new InputValidationError(
          `Field '${key}' must be a number`,
          key,
          [`Expected number, got ${typeof value}`]
        )
      );
    }

    return { ok: true, value };
  }

  /**
   * Helper to get an optional object property.
   */
  protected getOptionalObject(
    obj: unknown,
    key: string
  ): Result<Record<string, unknown> | undefined, InputValidationError> {
    if (!this.hasProperty(obj, key)) {
      return { ok: true, value: undefined };
    }

    const value = (obj as Record<string, unknown>)[key];

    if (value === undefined || value === null) {
      return { ok: true, value: undefined };
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      return err(
        new InputValidationError(
          `Field '${key}' must be an object`,
          key,
          [`Expected object, got ${typeof value}`]
        )
      );
    }

    return { ok: true, value: value as Record<string, unknown> };
  }
}
