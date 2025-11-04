/**
 * Result<T, E> Type for Functional Error Handling
 *
 * Rust-inspired Result type that forces explicit error handling without exceptions.
 * All operations that can fail return Result<T, E> instead of throwing.
 *
 * @see https://doc.rust-lang.org/std/result/
 */

import type { BCError } from './errors.js';

// ============================================================================
// Result Type Definition
// ============================================================================

export type Result<T, E = BCError> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

// ============================================================================
// Constructor Functions
// ============================================================================

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false;
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Unwraps a Result, returning the value or throwing the error.
 * Use only when you're certain the result is Ok.
 *
 * @throws {E} The error if result is Err
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwraps a Result, returning the value or a default value.
 * Safe alternative to unwrap().
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue;
}

/**
 * Unwraps a Result, returning the value or computing a default from the error.
 */
export function unwrapOrElse<T, E>(
  result: Result<T, E>,
  fn: (error: E) => T
): T {
  return isOk(result) ? result.value : fn(result.error);
}

/**
 * Returns the error if Result is Err, otherwise throws.
 * Use only when you're certain the result is Err.
 *
 * @throws {Error} If result is Ok
 */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (isErr(result)) {
    return result.error;
  }
  throw new Error('Called unwrapErr on an Ok value');
}

// ============================================================================
// Transformation Functions
// ============================================================================

/**
 * Maps a Result<T, E> to Result<U, E> by applying a function to the Ok value.
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return isOk(result) ? ok(fn(result.value)) : result;
}

/**
 * Maps a Result<T, E> to Result<T, F> by applying a function to the Err value.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  return isErr(result) ? err(fn(result.error)) : result;
}

/**
 * Applies a function to the Ok value and flattens the result.
 * Also known as 'flatMap' or 'bind'.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return isOk(result) ? fn(result.value) : result;
}

/**
 * Chains operations, replacing Err with a new Result computed from the error.
 */
export function orElse<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => Result<T, F>
): Result<T, F> {
  return isErr(result) ? fn(result.error) : result;
}

// ============================================================================
// Combining Functions
// ============================================================================

/**
 * Combines multiple Results into a single Result containing an array of values.
 * If any Result is Err, returns the first error encountered.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> {
  const values: T[] = [];

  for (const result of results) {
    if (isErr(result)) {
      return result;
    }
    values.push(result.value);
  }

  return ok(values);
}

/**
 * Returns the first Ok result, or the last Err if all are Err.
 */
export function any<T, E>(results: readonly Result<T, E>[]): Result<T, E> {
  if (results.length === 0) {
    throw new Error('Cannot call any() on empty array');
  }

  let lastErr: Err<E> | undefined;

  for (const result of results) {
    if (isOk(result)) {
      return result;
    }
    lastErr = result;
  }

  return lastErr!;
}

/**
 * Combines two Results into a Result containing a tuple.
 */
export function combine<T1, T2, E>(
  r1: Result<T1, E>,
  r2: Result<T2, E>
): Result<readonly [T1, T2], E> {
  if (isErr(r1)) return r1;
  if (isErr(r2)) return r2;
  return ok([r1.value, r2.value] as const);
}

/**
 * Combines three Results into a Result containing a tuple.
 */
export function combine3<T1, T2, T3, E>(
  r1: Result<T1, E>,
  r2: Result<T2, E>,
  r3: Result<T3, E>
): Result<readonly [T1, T2, T3], E> {
  if (isErr(r1)) return r1;
  if (isErr(r2)) return r2;
  if (isErr(r3)) return r3;
  return ok([r1.value, r2.value, r3.value] as const);
}

// ============================================================================
// Async Functions
// ============================================================================

/**
 * Maps an async Result with an async function.
 */
export async function mapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<U>
): Promise<Result<U, E>> {
  return isOk(result) ? ok(await fn(result.value)) : result;
}

/**
 * Chains async operations.
 */
export async function andThenAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>
): Promise<Result<U, E>> {
  return isOk(result) ? fn(result.value) : result;
}

/**
 * Wraps an async operation that might throw into a Result.
 */
export async function fromPromise<T>(
  promise: Promise<T>
): Promise<Result<T, Error>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wraps an async operation with a custom error mapper.
 */
export async function fromPromiseWith<T, E>(
  promise: Promise<T>,
  errorMapper: (error: unknown) => E
): Promise<Result<T, E>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (error) {
    return err(errorMapper(error));
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wraps a function that might throw into a Result.
 */
export function fromThrowable<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Wraps a function with a custom error mapper.
 */
export function fromThrowableWith<T, E>(
  fn: () => T,
  errorMapper: (error: unknown) => E
): Result<T, E> {
  try {
    return ok(fn());
  } catch (error) {
    return err(errorMapper(error));
  }
}

/**
 * Executes a function on the Ok value without transforming the Result.
 * Useful for side effects like logging.
 */
export function inspect<T, E>(
  result: Result<T, E>,
  fn: (value: T) => void
): Result<T, E> {
  if (isOk(result)) {
    fn(result.value);
  }
  return result;
}

/**
 * Executes a function on the Err value without transforming the Result.
 * Useful for error logging.
 */
export function inspectErr<T, E>(
  result: Result<T, E>,
  fn: (error: E) => void
): Result<T, E> {
  if (isErr(result)) {
    fn(result.error);
  }
  return result;
}

/**
 * Matches on a Result, executing one of two functions.
 * Forces explicit handling of both Ok and Err cases.
 */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => U;
    err: (error: E) => U;
  }
): U {
  return isOk(result) ? handlers.ok(result.value) : handlers.err(result.error);
}

/**
 * Async version of match.
 */
export async function matchAsync<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => Promise<U>;
    err: (error: E) => Promise<U>;
  }
): Promise<U> {
  return isOk(result)
    ? handlers.ok(result.value)
    : handlers.err(result.error);
}

// ============================================================================
// Partition Functions
// ============================================================================

/**
 * Partitions an array of Results into two arrays: one with Ok values, one with Err values.
 */
export function partition<T, E>(
  results: readonly Result<T, E>[]
): {
  ok: readonly T[];
  err: readonly E[];
} {
  const okValues: T[] = [];
  const errValues: E[] = [];

  for (const result of results) {
    if (isOk(result)) {
      okValues.push(result.value);
    } else {
      errValues.push(result.error);
    }
  }

  return { ok: okValues, err: errValues };
}

/**
 * Filters an array of Results, keeping only Ok values.
 */
export function filterOk<T, E>(results: readonly Result<T, E>[]): readonly T[] {
  return results
    .filter((r): r is Ok<T> => isOk(r))
    .map(r => r.value);
}

/**
 * Filters an array of Results, keeping only Err values.
 */
export function filterErr<T, E>(results: readonly Result<T, E>[]): readonly E[] {
  return results
    .filter((r): r is Err<E> => isErr(r))
    .map(r => r.error);
}
