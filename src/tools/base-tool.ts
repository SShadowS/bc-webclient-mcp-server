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
   * Constructor that optionally accepts a Zod schema.
   */
  constructor(opts?: BaseMCPToolOptions) {
    if (opts?.inputZod) {
      this.inputZod = opts.inputZod;
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
   */
  public async execute(input: unknown): Promise<Result<unknown, BCError>> {
    // Validate input
    const validationResult = this.validateInput(input);
    if (!validationResult.ok) {
      return validationResult;
    }

    // Execute tool logic
    return this.executeInternal(validationResult.value);
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
