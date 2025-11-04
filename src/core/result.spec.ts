/**
 * Result<T, E> Tests
 *
 * Tests for Rust-inspired functional error handling utilities.
 * Covers constructors, type guards, extractors, transformations,
 * combinators, async operations, and partition functions.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Result } from './result.js';
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  unwrapOrElse,
  unwrapErr,
  map,
  mapErr,
  andThen,
  orElse,
  all,
  any,
  combine,
  combine3,
  mapAsync,
  andThenAsync,
  fromPromise,
  fromPromiseWith,
  fromThrowable,
  fromThrowableWith,
  inspect,
  inspectErr,
  match,
  matchAsync,
  partition,
  filterOk,
  filterErr,
} from './result.js';

describe('result', () => {
  describe('Constructor functions', () => {
    describe('ok()', () => {
      it('creates an Ok result with a value', () => {
        const result = ok(42);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(42);
      });

      it('creates Ok with string value', () => {
        const result = ok('success');
        expect(result.ok).toBe(true);
        expect(result.value).toBe('success');
      });

      it('creates Ok with object value', () => {
        const value = { id: 1, name: 'test' };
        const result = ok(value);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(value);
      });

      it('creates Ok with null value', () => {
        const result = ok(null);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(null);
      });

      it('creates Ok with undefined value', () => {
        const result = ok(undefined);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(undefined);
      });
    });

    describe('err()', () => {
      it('creates an Err result with an error', () => {
        const error = new Error('failed');
        const result = err(error);
        expect(result.ok).toBe(false);
        expect(result.error).toBe(error);
      });

      it('creates Err with string error', () => {
        const result = err('error message');
        expect(result.ok).toBe(false);
        expect(result.error).toBe('error message');
      });

      it('creates Err with custom error object', () => {
        const error = { code: 'ERR_001', message: 'failed' };
        const result = err(error);
        expect(result.ok).toBe(false);
        expect(result.error).toBe(error);
      });
    });
  });

  describe('Type guards', () => {
    describe('isOk()', () => {
      it('returns true for Ok result', () => {
        const result = ok(42);
        expect(isOk(result)).toBe(true);
      });

      it('returns false for Err result', () => {
        const result = err(new Error('failed'));
        expect(isOk(result)).toBe(false);
      });

      it('narrows type to Ok<T>', () => {
        const result = ok(42);
        if (isOk(result)) {
          // Type narrowing: result.value should be accessible
          expect(result.value).toBe(42);
        }
      });
    });

    describe('isErr()', () => {
      it('returns true for Err result', () => {
        const result = err(new Error('failed'));
        expect(isErr(result)).toBe(true);
      });

      it('returns false for Ok result', () => {
        const result = ok(42);
        expect(isErr(result)).toBe(false);
      });

      it('narrows type to Err<E>', () => {
        const result = err(new Error('failed'));
        if (isErr(result)) {
          // Type narrowing: result.error should be accessible
          expect(result.error.message).toBe('failed');
        }
      });
    });
  });

  describe('Extraction functions', () => {
    describe('unwrap()', () => {
      it('returns value from Ok result', () => {
        const result = ok(42);
        expect(unwrap(result)).toBe(42);
      });

      it('throws error from Err result', () => {
        const error = new Error('failed');
        const result = err(error);
        expect(() => unwrap(result)).toThrow(error);
      });

      it('throws custom error object', () => {
        const error = { code: 'ERR_001', message: 'failed' };
        const result = err(error);
        try {
          unwrap(result);
          expect.fail('Should have thrown');
        } catch (thrown) {
          expect(thrown).toBe(error);
        }
      });
    });

    describe('unwrapOr()', () => {
      it('returns value from Ok result', () => {
        const result = ok(42);
        expect(unwrapOr(result, 0)).toBe(42);
      });

      it('returns default value for Err result', () => {
        const result = err(new Error('failed'));
        expect(unwrapOr(result, 0)).toBe(0);
      });

      it('works with different types', () => {
        const result = err(new Error('failed'));
        expect(unwrapOr(result, 'default')).toBe('default');
      });
    });

    describe('unwrapOrElse()', () => {
      it('returns value from Ok result', () => {
        const result = ok(42);
        const fn = vi.fn(() => 0);
        expect(unwrapOrElse(result, fn)).toBe(42);
        expect(fn).not.toHaveBeenCalled();
      });

      it('computes default from error for Err result', () => {
        const error = new Error('failed');
        const result = err(error);
        const fn = vi.fn(() => 0);
        expect(unwrapOrElse(result, fn)).toBe(0);
        expect(fn).toHaveBeenCalledWith(error);
      });

      it('can use error to compute default', () => {
        const result = err({ code: 404, message: 'Not found' });
        const defaultValue = unwrapOrElse(result, (e) => e.code);
        expect(defaultValue).toBe(404);
      });
    });

    describe('unwrapErr()', () => {
      it('returns error from Err result', () => {
        const error = new Error('failed');
        const result = err(error);
        expect(unwrapErr(result)).toBe(error);
      });

      it('throws for Ok result', () => {
        const result = ok(42);
        expect(() => unwrapErr(result)).toThrow('Called unwrapErr on an Ok value');
      });
    });
  });

  describe('Transformation functions', () => {
    describe('map()', () => {
      it('transforms Ok value', () => {
        const result = ok(42);
        const mapped = map(result, (x) => x * 2);
        expect(isOk(mapped)).toBe(true);
        if (isOk(mapped)) {
          expect(mapped.value).toBe(84);
        }
      });

      it('passes through Err unchanged', () => {
        const error = new Error('failed');
        const result = err(error);
        const mapped = map(result, (x: number) => x * 2);
        expect(isErr(mapped)).toBe(true);
        if (isErr(mapped)) {
          expect(mapped.error).toBe(error);
        }
      });

      it('works with type transformation', () => {
        const result = ok(42);
        const mapped = map(result, (x: number) => String(x));
        expect(unwrap(mapped)).toBe('42');
      });
    });

    describe('mapErr()', () => {
      it('transforms Err value', () => {
        const result = err(new Error('failed'));
        const mapped = mapErr(result, (e) => new Error(`Wrapped: ${e.message}`));
        expect(isErr(mapped)).toBe(true);
        if (isErr(mapped)) {
          expect(mapped.error.message).toBe('Wrapped: failed');
        }
      });

      it('passes through Ok unchanged', () => {
        const result = ok(42);
        const mapped = mapErr(result, (e: Error) => new Error(`Wrapped: ${e.message}`));
        expect(isOk(mapped)).toBe(true);
        if (isOk(mapped)) {
          expect(mapped.value).toBe(42);
        }
      });

      it('works with error type transformation', () => {
        const result = err('string error');
        const mapped = mapErr(result, (e) => new Error(e));
        expect(isErr(mapped)).toBe(true);
        if (isErr(mapped)) {
          expect(mapped.error).toBeInstanceOf(Error);
          expect(mapped.error.message).toBe('string error');
        }
      });
    });

    describe('andThen()', () => {
      it('chains Ok results', () => {
        const result = ok(42);
        const chained = andThen(result, (x) => ok(x * 2));
        expect(unwrap(chained)).toBe(84);
      });

      it('chains and flattens nested results', () => {
        const result = ok(42);
        const chained = andThen(result, (x) => ok(String(x)));
        expect(unwrap(chained)).toBe('42');
      });

      it('short-circuits on Err', () => {
        const error = new Error('failed');
        const result = err(error);
        const fn = vi.fn((x: number) => ok(x * 2));
        const chained = andThen(result, fn);
        expect(isErr(chained)).toBe(true);
        expect(fn).not.toHaveBeenCalled();
      });

      it('propagates Err from chained operation', () => {
        const result = ok(42);
        const error = new Error('chained error');
        const chained = andThen(result, () => err(error));
        expect(isErr(chained)).toBe(true);
        if (isErr(chained)) {
          expect(chained.error).toBe(error);
        }
      });
    });

    describe('orElse()', () => {
      it('replaces Err with new Result', () => {
        const result = err(new Error('failed'));
        const recovered = orElse(result, () => ok(42));
        expect(isOk(recovered)).toBe(true);
        if (isOk(recovered)) {
          expect(recovered.value).toBe(42);
        }
      });

      it('passes through Ok unchanged', () => {
        const result = ok(42);
        const fn = vi.fn(() => ok(0));
        const recovered = orElse(result, fn);
        expect(unwrap(recovered)).toBe(42);
        expect(fn).not.toHaveBeenCalled();
      });

      it('can transform error type', () => {
        const result = err('string error');
        const recovered = orElse(result, (e) => err(new Error(e)));
        expect(isErr(recovered)).toBe(true);
        if (isErr(recovered)) {
          expect(recovered.error).toBeInstanceOf(Error);
        }
      });
    });
  });

  describe('Combining functions', () => {
    describe('all()', () => {
      it('combines multiple Ok results into array', () => {
        const results = [ok(1), ok(2), ok(3)];
        const combined = all(results);
        expect(isOk(combined)).toBe(true);
        if (isOk(combined)) {
          expect(combined.value).toEqual([1, 2, 3]);
        }
      });

      it('returns first Err if any result is Err', () => {
        const error1 = new Error('error1');
        const error2 = new Error('error2');
        const results = [ok(1), err(error1), ok(3), err(error2)];
        const combined = all(results);
        expect(isErr(combined)).toBe(true);
        if (isErr(combined)) {
          expect(combined.error).toBe(error1);
        }
      });

      it('works with empty array', () => {
        const results: ReturnType<typeof ok<number>>[] = [];
        const combined = all(results);
        expect(isOk(combined)).toBe(true);
        if (isOk(combined)) {
          expect(combined.value).toEqual([]);
        }
      });

      it('works with single result', () => {
        const results = [ok(42)];
        const combined = all(results);
        expect(unwrap(combined)).toEqual([42]);
      });
    });

    describe('any()', () => {
      it('returns first Ok result', () => {
        const results = [err(new Error('e1')), ok(42), ok(100)];
        const result = any(results);
        expect(unwrap(result)).toBe(42);
      });

      it('returns last Err if all are Err', () => {
        const error1 = new Error('error1');
        const error2 = new Error('error2');
        const error3 = new Error('error3');
        const results = [err(error1), err(error2), err(error3)];
        const result = any(results);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toBe(error3);
        }
      });

      it('throws for empty array', () => {
        const results: ReturnType<typeof ok<number>>[] = [];
        expect(() => any(results)).toThrow('Cannot call any() on empty array');
      });

      it('returns single Ok result', () => {
        const results = [ok(42)];
        expect(unwrap(any(results))).toBe(42);
      });

      it('returns single Err result', () => {
        const error = new Error('failed');
        const results = [err(error)];
        const result = any(results);
        expect(unwrapErr(result)).toBe(error);
      });
    });

    describe('combine()', () => {
      it('combines two Ok results into tuple', () => {
        const r1 = ok(42);
        const r2 = ok('hello');
        const combined = combine(r1, r2);
        expect(isOk(combined)).toBe(true);
        if (isOk(combined)) {
          expect(combined.value).toEqual([42, 'hello']);
        }
      });

      it('returns first Err if r1 is Err', () => {
        const error = new Error('failed');
        const r1 = err(error);
        const r2 = ok('hello');
        const combined = combine(r1, r2);
        expect(isErr(combined)).toBe(true);
        if (isErr(combined)) {
          expect(combined.error).toBe(error);
        }
      });

      it('returns second Err if r2 is Err', () => {
        const error = new Error('failed');
        const r1 = ok(42);
        const r2 = err(error);
        const combined = combine(r1, r2);
        expect(isErr(combined)).toBe(true);
        if (isErr(combined)) {
          expect(combined.error).toBe(error);
        }
      });

      it('returns first Err if both are Err', () => {
        const error1 = new Error('error1');
        const error2 = new Error('error2');
        const r1 = err(error1);
        const r2 = err(error2);
        const combined = combine(r1, r2);
        expect(isErr(combined)).toBe(true);
        if (isErr(combined)) {
          expect(combined.error).toBe(error1);
        }
      });
    });

    describe('combine3()', () => {
      it('combines three Ok results into tuple', () => {
        const r1 = ok(42);
        const r2 = ok('hello');
        const r3 = ok(true);
        const combined = combine3(r1, r2, r3);
        expect(isOk(combined)).toBe(true);
        if (isOk(combined)) {
          expect(combined.value).toEqual([42, 'hello', true]);
        }
      });

      it('returns first Err encountered', () => {
        const error1 = new Error('error1');
        const error2 = new Error('error2');
        const r1 = ok(42);
        const r2 = err(error1);
        const r3 = err(error2);
        const combined = combine3(r1, r2, r3);
        expect(isErr(combined)).toBe(true);
        if (isErr(combined)) {
          expect(combined.error).toBe(error1);
        }
      });
    });
  });

  describe('Async functions', () => {
    describe('mapAsync()', () => {
      it('transforms Ok value with async function', async () => {
        const result = ok(42);
        const mapped = await mapAsync(result, async (x) => x * 2);
        expect(unwrap(mapped)).toBe(84);
      });

      it('passes through Err unchanged', async () => {
        const error = new Error('failed');
        const result = err(error);
        const fn = vi.fn(async (x: number) => x * 2);
        const mapped = await mapAsync(result, fn);
        expect(isErr(mapped)).toBe(true);
        expect(fn).not.toHaveBeenCalled();
      });

      it('works with async type transformation', async () => {
        const result = ok(42);
        const mapped = await mapAsync(result, async (x: number) => String(x));
        expect(unwrap(mapped)).toBe('42');
      });
    });

    describe('andThenAsync()', () => {
      it('chains Ok results with async function', async () => {
        const result = ok(42);
        const chained = await andThenAsync(result, async (x) => ok(x * 2));
        expect(unwrap(chained)).toBe(84);
      });

      it('short-circuits on Err', async () => {
        const error = new Error('failed');
        const result = err(error);
        const fn = vi.fn(async (x: number) => ok(x * 2));
        const chained = await andThenAsync(result, fn);
        expect(isErr(chained)).toBe(true);
        expect(fn).not.toHaveBeenCalled();
      });

      it('propagates Err from async chained operation', async () => {
        const result = ok(42);
        const error = new Error('async error');
        const chained = await andThenAsync(result, async () => err(error));
        expect(unwrapErr(chained)).toBe(error);
      });
    });

    describe('fromPromise()', () => {
      it('converts resolved promise to Ok', async () => {
        const promise = Promise.resolve(42);
        const result = await fromPromise(promise);
        expect(unwrap(result)).toBe(42);
      });

      it('converts rejected promise to Err', async () => {
        const error = new Error('failed');
        const promise = Promise.reject(error);
        const result = await fromPromise(promise);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toBe(error);
        }
      });

      it('wraps non-Error rejection in Error', async () => {
        const promise = Promise.reject('string error');
        const result = await fromPromise(promise);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toBeInstanceOf(Error);
          expect(result.error.message).toBe('string error');
        }
      });

      it('handles promise that throws', async () => {
        const promise = new Promise(() => {
          throw new Error('thrown error');
        });
        const result = await fromPromise(promise);
        expect(isErr(result)).toBe(true);
      });
    });

    describe('fromPromiseWith()', () => {
      it('converts resolved promise to Ok', async () => {
        const promise = Promise.resolve(42);
        const mapper = vi.fn((e: unknown) => new Error(String(e)));
        const result = await fromPromiseWith(promise, mapper);
        expect(unwrap(result)).toBe(42);
        expect(mapper).not.toHaveBeenCalled();
      });

      it('maps rejection with custom mapper', async () => {
        const promise = Promise.reject('string error');
        const mapper = (e: unknown) => ({ code: 'ERR', message: String(e) });
        const result = await fromPromiseWith(promise, mapper);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toEqual({ code: 'ERR', message: 'string error' });
        }
      });

      it('custom mapper receives original error', async () => {
        const error = new Error('original');
        const promise = Promise.reject(error);
        const mapper = vi.fn((e: unknown) => ({ original: e }));
        await fromPromiseWith(promise, mapper);
        expect(mapper).toHaveBeenCalledWith(error);
      });
    });
  });

  describe('Utility functions', () => {
    describe('fromThrowable()', () => {
      it('converts successful function to Ok', () => {
        const fn = () => 42;
        const result = fromThrowable(fn);
        expect(unwrap(result)).toBe(42);
      });

      it('catches thrown error and returns Err', () => {
        const error = new Error('failed');
        const fn = () => {
          throw error;
        };
        const result = fromThrowable(fn);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toBe(error);
        }
      });

      it('wraps non-Error throw in Error', () => {
        const fn = () => {
          throw 'string error';
        };
        const result = fromThrowable(fn);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toBeInstanceOf(Error);
          expect(result.error.message).toBe('string error');
        }
      });

      it('works with functions returning objects', () => {
        const fn = () => ({ id: 1, name: 'test' });
        const result = fromThrowable(fn);
        expect(unwrap(result)).toEqual({ id: 1, name: 'test' });
      });
    });

    describe('fromThrowableWith()', () => {
      it('converts successful function to Ok', () => {
        const fn = () => 42;
        const mapper = vi.fn((e: unknown) => new Error(String(e)));
        const result = fromThrowableWith(fn, mapper);
        expect(unwrap(result)).toBe(42);
        expect(mapper).not.toHaveBeenCalled();
      });

      it('maps thrown error with custom mapper', () => {
        const fn = () => {
          throw 'string error';
        };
        const mapper = (e: unknown) => ({ code: 'ERR', message: String(e) });
        const result = fromThrowableWith(fn, mapper);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error).toEqual({ code: 'ERR', message: 'string error' });
        }
      });

      it('custom mapper receives original error', () => {
        const error = new Error('original');
        const fn = () => {
          throw error;
        };
        const mapper = vi.fn((e: unknown) => e);
        fromThrowableWith(fn, mapper);
        expect(mapper).toHaveBeenCalledWith(error);
      });
    });

    describe('inspect()', () => {
      it('executes function on Ok value', () => {
        const result = ok(42);
        const spy = vi.fn();
        const inspected = inspect(result, spy);
        expect(spy).toHaveBeenCalledWith(42);
        expect(inspected).toBe(result);
      });

      it('does not execute function on Err', () => {
        const result = err(new Error('failed'));
        const spy = vi.fn();
        const inspected = inspect(result, spy);
        expect(spy).not.toHaveBeenCalled();
        expect(inspected).toBe(result);
      });

      it('returns same result unchanged', () => {
        const result = ok(42);
        const inspected = inspect(result, () => {});
        expect(inspected).toBe(result);
      });
    });

    describe('inspectErr()', () => {
      it('executes function on Err value', () => {
        const error = new Error('failed');
        const result = err(error);
        const spy = vi.fn();
        const inspected = inspectErr(result, spy);
        expect(spy).toHaveBeenCalledWith(error);
        expect(inspected).toBe(result);
      });

      it('does not execute function on Ok', () => {
        const result = ok(42);
        const spy = vi.fn();
        const inspected = inspectErr(result, spy);
        expect(spy).not.toHaveBeenCalled();
        expect(inspected).toBe(result);
      });

      it('returns same result unchanged', () => {
        const error = new Error('failed');
        const result = err(error);
        const inspected = inspectErr(result, () => {});
        expect(inspected).toBe(result);
      });
    });

    describe('match()', () => {
      it('calls ok handler for Ok result', () => {
        const result = ok(42);
        const value = match(result, {
          ok: (x) => x * 2,
          err: () => 0,
        });
        expect(value).toBe(84);
      });

      it('calls err handler for Err result', () => {
        const error = new Error('failed');
        const result = err(error);
        const value = match(result, {
          ok: () => 'success',
          err: (e) => e.message,
        });
        expect(value).toBe('failed');
      });

      it('forces exhaustive handling', () => {
        const result = ok(42);
        // Both handlers must be provided
        const value = match(result, {
          ok: (x) => String(x),
          err: () => 'error',
        });
        expect(value).toBe('42');
      });
    });

    describe('matchAsync()', () => {
      it('calls ok handler for Ok result', async () => {
        const result = ok(42);
        const value = await matchAsync(result, {
          ok: async (x) => x * 2,
          err: async () => 0,
        });
        expect(value).toBe(84);
      });

      it('calls err handler for Err result', async () => {
        const error = new Error('failed');
        const result = err(error);
        const value = await matchAsync(result, {
          ok: async () => 'success',
          err: async (e) => e.message,
        });
        expect(value).toBe('failed');
      });

      it('works with async operations', async () => {
        const result = ok(42);
        const value = await matchAsync(result, {
          ok: async (x) => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return x * 2;
          },
          err: async () => 0,
        });
        expect(value).toBe(84);
      });
    });
  });

  describe('Partition functions', () => {
    describe('partition()', () => {
      it('separates Ok and Err results', () => {
        const results = [
          ok(1),
          err(new Error('e1')),
          ok(2),
          err(new Error('e2')),
          ok(3),
        ];
        const { ok: okValues, err: errValues } = partition(results);
        expect(okValues).toEqual([1, 2, 3]);
        expect(errValues).toHaveLength(2);
        expect(errValues[0].message).toBe('e1');
        expect(errValues[1].message).toBe('e2');
      });

      it('handles all Ok results', () => {
        const results = [ok(1), ok(2), ok(3)];
        const { ok: okValues, err: errValues } = partition(results);
        expect(okValues).toEqual([1, 2, 3]);
        expect(errValues).toEqual([]);
      });

      it('handles all Err results', () => {
        const results = [
          err(new Error('e1')),
          err(new Error('e2')),
          err(new Error('e3')),
        ];
        const { ok: okValues, err: errValues } = partition(results);
        expect(okValues).toEqual([]);
        expect(errValues).toHaveLength(3);
      });

      it('handles empty array', () => {
        const results: ReturnType<typeof ok<number>>[] = [];
        const { ok: okValues, err: errValues } = partition(results);
        expect(okValues).toEqual([]);
        expect(errValues).toEqual([]);
      });
    });

    describe('filterOk()', () => {
      it('extracts only Ok values', () => {
        const results = [
          ok(1),
          err(new Error('e1')),
          ok(2),
          err(new Error('e2')),
          ok(3),
        ];
        const okValues = filterOk(results);
        expect(okValues).toEqual([1, 2, 3]);
      });

      it('returns empty array when no Ok results', () => {
        const results = [err(new Error('e1')), err(new Error('e2'))];
        const okValues = filterOk(results);
        expect(okValues).toEqual([]);
      });

      it('returns all values when all Ok', () => {
        const results = [ok(1), ok(2), ok(3)];
        const okValues = filterOk(results);
        expect(okValues).toEqual([1, 2, 3]);
      });

      it('handles empty array', () => {
        const results: ReturnType<typeof ok<number>>[] = [];
        const okValues = filterOk(results);
        expect(okValues).toEqual([]);
      });
    });

    describe('filterErr()', () => {
      it('extracts only Err values', () => {
        const results = [
          ok(1),
          err(new Error('e1')),
          ok(2),
          err(new Error('e2')),
          ok(3),
        ];
        const errValues = filterErr(results);
        expect(errValues).toHaveLength(2);
        expect(errValues[0].message).toBe('e1');
        expect(errValues[1].message).toBe('e2');
      });

      it('returns empty array when no Err results', () => {
        const results = [ok(1), ok(2), ok(3)];
        const errValues = filterErr(results);
        expect(errValues).toEqual([]);
      });

      it('returns all errors when all Err', () => {
        const results = [
          err(new Error('e1')),
          err(new Error('e2')),
          err(new Error('e3')),
        ];
        const errValues = filterErr(results);
        expect(errValues).toHaveLength(3);
      });

      it('handles empty array', () => {
        const results: ReturnType<typeof ok<number>>[] = [];
        const errValues = filterErr(results);
        expect(errValues).toEqual([]);
      });
    });
  });

  describe('Integration scenarios', () => {
    it('chains multiple operations', () => {
      let result: Result<number, Error> = ok(10);
      result = map(result, (x) => x * 2);
      result = andThen(result, (x) => ok(x + 5));
      const final = map(result, (x) => String(x));

      expect(unwrap(final)).toBe('25');
    });

    it('short-circuits on first error', () => {
      const error = new Error('division by zero');
      let result: Result<number, Error> = ok(10);
      result = map(result, (x) => x * 2);
      result = andThen(result, () => err(error));
      const final = map(result, (x: number) => x + 5); // This won't execute

      expect(isErr(final)).toBe(true);
      if (isErr(final)) {
        expect(final.error).toBe(error);
      }
    });

    it('combines results with all()', () => {
      const r1 = ok(1);
      const r2 = ok(2);
      const r3 = ok(3);
      const combined = all([r1, r2, r3]);
      const sum = map(combined, (values) => values.reduce((a, b) => a + b, 0));
      expect(unwrap(sum)).toBe(6);
    });

    it('handles async pipeline', async () => {
      const result = await fromPromise(Promise.resolve(10));
      const mapped = await mapAsync(result, async (x) => x * 2);
      const chained = await andThenAsync(mapped, async (x) => ok(x + 5));
      expect(unwrap(chained)).toBe(25);
    });
  });
});
