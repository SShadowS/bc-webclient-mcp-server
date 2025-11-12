/**
 * Unit Tests for Result<T, E> Type
 *
 * Comprehensive tests following TDD principles.
 * Tests cover all Result operations and edge cases.
 */

import { describe, it, expect } from 'vitest';
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
} from '../../src/core/result.js';

// ============================================================================
// Constructor Tests
// ============================================================================

describe('Result Constructors', () => {
  it('should create Ok result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('should create Err result', () => {
    const error = new Error('test error');
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
    }
  });

  it('should preserve type information', () => {
    const okResult = ok<number>(42);
    const errResult = err<Error>(new Error('test'));

    // Type assertions to verify TypeScript types
    type OkType = typeof okResult;
    type ErrType = typeof errResult;

    // These should compile without errors
    const _okCheck: OkType extends { ok: true; value: number } ? true : false = true;
    const _errCheck: ErrType extends { ok: false; error: Error } ? true : false = true;
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  it('should correctly identify Ok result', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('should correctly identify Err result', () => {
    const result = err(new Error('test'));
    expect(isOk(result)).toBe(false);
    expect(isErr(result)).toBe(true);
  });

  it('should narrow types correctly', () => {
    const result = ok(42);
    if (isOk(result)) {
      // TypeScript should know result.value exists here
      expect(result.value).toBe(42);
    }
  });
});

// ============================================================================
// Extraction Tests
// ============================================================================

describe('Extraction Functions', () => {
  describe('unwrap', () => {
    it('should return value for Ok', () => {
      const result = ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it('should throw error for Err', () => {
      const error = new Error('test error');
      const result = err(error);
      expect(() => unwrap(result)).toThrow(error);
    });
  });

  describe('unwrapOr', () => {
    it('should return value for Ok', () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('should return default for Err', () => {
      const result = err(new Error('test'));
      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('unwrapOrElse', () => {
    it('should return value for Ok', () => {
      const result = ok(42);
      expect(unwrapOrElse(result, () => 0)).toBe(42);
    });

    it('should compute default for Err', () => {
      const result = err(new Error('test'));
      expect(unwrapOrElse(result, error => error.message.length)).toBe(4);
    });
  });

  describe('unwrapErr', () => {
    it('should return error for Err', () => {
      const error = new Error('test');
      const result = err(error);
      expect(unwrapErr(result)).toBe(error);
    });

    it('should throw for Ok', () => {
      const result = ok(42);
      expect(() => unwrapErr(result)).toThrow('Called unwrapErr on an Ok value');
    });
  });
});

// ============================================================================
// Transformation Tests
// ============================================================================

describe('Transformation Functions', () => {
  describe('map', () => {
    it('should transform Ok value', () => {
      const result = ok(42);
      const mapped = map(result, n => n * 2);
      expect(isOk(mapped)).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(84);
      }
    });

    it('should not transform Err', () => {
      const error = new Error('test');
      const result = err(error);
      const mapped = map(result, (n: number) => n * 2);
      expect(isErr(mapped)).toBe(true);
      if (isErr(mapped)) {
        expect(mapped.error).toBe(error);
      }
    });
  });

  describe('mapErr', () => {
    it('should not transform Ok', () => {
      const result = ok(42);
      const mapped = mapErr(result, () => new Error('new error'));
      expect(isOk(mapped)).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(42);
      }
    });

    it('should transform Err', () => {
      const result = err(new Error('test'));
      const mapped = mapErr(result, error => new Error(`wrapped: ${error.message}`));
      expect(isErr(mapped)).toBe(true);
      if (isErr(mapped)) {
        expect(mapped.error.message).toBe('wrapped: test');
      }
    });
  });

  describe('andThen', () => {
    it('should chain Ok results', () => {
      const result = ok(42);
      const chained = andThen(result, n => ok(n * 2));
      expect(isOk(chained)).toBe(true);
      if (isOk(chained)) {
        expect(chained.value).toBe(84);
      }
    });

    it('should short-circuit on Err', () => {
      const error = new Error('test');
      const result = err<number, Error>(error);
      const chained = andThen(result, n => ok(n * 2));
      expect(isErr(chained)).toBe(true);
      if (isErr(chained)) {
        expect(chained.error).toBe(error);
      }
    });

    it('should propagate Err from chain', () => {
      const result = ok(42);
      const error = new Error('chain error');
      const chained = andThen(result, () => err(error));
      expect(isErr(chained)).toBe(true);
      if (isErr(chained)) {
        expect(chained.error).toBe(error);
      }
    });
  });

  describe('orElse', () => {
    it('should not transform Ok', () => {
      const result = ok(42);
      const fallback = orElse(result, () => ok(0));
      expect(isOk(fallback)).toBe(true);
      if (isOk(fallback)) {
        expect(fallback.value).toBe(42);
      }
    });

    it('should provide fallback for Err', () => {
      const result = err<number, Error>(new Error('test'));
      const fallback = orElse(result, () => ok(0));
      expect(isOk(fallback)).toBe(true);
      if (isOk(fallback)) {
        expect(fallback.value).toBe(0);
      }
    });
  });
});

// ============================================================================
// Combining Tests
// ============================================================================

describe('Combining Functions', () => {
  describe('all', () => {
    it('should combine all Ok results', () => {
      const results = [ok(1), ok(2), ok(3)];
      const combined = all(results);
      expect(isOk(combined)).toBe(true);
      if (isOk(combined)) {
        expect(combined.value).toEqual([1, 2, 3]);
      }
    });

    it('should return first Err', () => {
      const error1 = new Error('error 1');
      const error2 = new Error('error 2');
      const results = [ok(1), err(error1), err(error2)];
      const combined = all(results);
      expect(isErr(combined)).toBe(true);
      if (isErr(combined)) {
        expect(combined.error).toBe(error1);
      }
    });

    it('should handle empty array', () => {
      const combined = all([]);
      expect(isOk(combined)).toBe(true);
      if (isOk(combined)) {
        expect(combined.value).toEqual([]);
      }
    });
  });

  describe('any', () => {
    it('should return first Ok', () => {
      const results = [err(new Error('1')), ok(42), ok(84)];
      const result = any(results);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it('should return last Err if all Err', () => {
      const error1 = new Error('error 1');
      const error2 = new Error('error 2');
      const results = [err(error1), err(error2)];
      const result = any(results);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe(error2);
      }
    });

    it('should throw on empty array', () => {
      expect(() => any([])).toThrow('Cannot call any() on empty array');
    });
  });

  describe('combine', () => {
    it('should combine two Ok results', () => {
      const r1 = ok(42);
      const r2 = ok('hello');
      const combined = combine(r1, r2);
      expect(isOk(combined)).toBe(true);
      if (isOk(combined)) {
        expect(combined.value).toEqual([42, 'hello']);
      }
    });

    it('should return first Err', () => {
      const error = new Error('test');
      const r1 = err<number, Error>(error);
      const r2 = ok('hello');
      const combined = combine(r1, r2);
      expect(isErr(combined)).toBe(true);
      if (isErr(combined)) {
        expect(combined.error).toBe(error);
      }
    });
  });

  describe('combine3', () => {
    it('should combine three Ok results', () => {
      const r1 = ok(42);
      const r2 = ok('hello');
      const r3 = ok(true);
      const combined = combine3(r1, r2, r3);
      expect(isOk(combined)).toBe(true);
      if (isOk(combined)) {
        expect(combined.value).toEqual([42, 'hello', true]);
      }
    });
  });
});

// ============================================================================
// Async Tests
// ============================================================================

describe('Async Functions', () => {
  describe('mapAsync', () => {
    it('should transform Ok value asynchronously', async () => {
      const result = ok(42);
      const mapped = await mapAsync(result, async n => n * 2);
      expect(isOk(mapped)).toBe(true);
      if (isOk(mapped)) {
        expect(mapped.value).toBe(84);
      }
    });

    it('should not transform Err', async () => {
      const error = new Error('test');
      const result = err(error);
      const mapped = await mapAsync(result, async (n: number) => n * 2);
      expect(isErr(mapped)).toBe(true);
      if (isErr(mapped)) {
        expect(mapped.error).toBe(error);
      }
    });
  });

  describe('andThenAsync', () => {
    it('should chain Ok results asynchronously', async () => {
      const result = ok(42);
      const chained = await andThenAsync(result, async n => ok(n * 2));
      expect(isOk(chained)).toBe(true);
      if (isOk(chained)) {
        expect(chained.value).toBe(84);
      }
    });
  });

  describe('fromPromise', () => {
    it('should convert resolved promise to Ok', async () => {
      const promise = Promise.resolve(42);
      const result = await fromPromise(promise);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it('should convert rejected promise to Err', async () => {
      const error = new Error('test');
      const promise = Promise.reject(error);
      const result = await fromPromise(promise);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('fromPromiseWith', () => {
    it('should use custom error mapper', async () => {
      const promise = Promise.reject('string error');
      const result = await fromPromiseWith(
        promise,
        error => new Error(String(error))
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('string error');
      }
    });
  });
});

// ============================================================================
// Utility Tests
// ============================================================================

describe('Utility Functions', () => {
  describe('fromThrowable', () => {
    it('should convert successful function to Ok', () => {
      const result = fromThrowable(() => 42);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it('should convert throwing function to Err', () => {
      const error = new Error('test');
      const result = fromThrowable(() => {
        throw error;
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('fromThrowableWith', () => {
    it('should use custom error mapper', () => {
      const result = fromThrowableWith(
        () => {
          throw 'string error';
        },
        error => new Error(String(error))
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('string error');
      }
    });
  });

  describe('inspect', () => {
    it('should execute function on Ok', () => {
      let called = false;
      const result = ok(42);
      const inspected = inspect(result, () => {
        called = true;
      });
      expect(called).toBe(true);
      expect(inspected).toBe(result);
    });

    it('should not execute function on Err', () => {
      let called = false;
      const result = err(new Error('test'));
      const inspected = inspect(result, () => {
        called = true;
      });
      expect(called).toBe(false);
      expect(inspected).toBe(result);
    });
  });

  describe('inspectErr', () => {
    it('should not execute function on Ok', () => {
      let called = false;
      const result = ok(42);
      const inspected = inspectErr(result, () => {
        called = true;
      });
      expect(called).toBe(false);
      expect(inspected).toBe(result);
    });

    it('should execute function on Err', () => {
      let called = false;
      const error = new Error('test');
      const result = err(error);
      const inspected = inspectErr(result, () => {
        called = true;
      });
      expect(called).toBe(true);
      expect(inspected).toBe(result);
    });
  });

  describe('match', () => {
    it('should call ok handler for Ok', () => {
      const result = ok(42);
      const matched = match(result, {
        ok: n => n * 2,
        err: () => 0,
      });
      expect(matched).toBe(84);
    });

    it('should call err handler for Err', () => {
      const result = err(new Error('test'));
      const matched = match(result, {
        ok: (n: number) => n * 2,
        err: error => error.message.length,
      });
      expect(matched).toBe(4);
    });
  });

  describe('matchAsync', () => {
    it('should call ok handler for Ok', async () => {
      const result = ok(42);
      const matched = await matchAsync(result, {
        ok: async n => n * 2,
        err: async () => 0,
      });
      expect(matched).toBe(84);
    });

    it('should call err handler for Err', async () => {
      const result = err(new Error('test'));
      const matched = await matchAsync(result, {
        ok: async (n: number) => n * 2,
        err: async error => error.message.length,
      });
      expect(matched).toBe(4);
    });
  });
});

// ============================================================================
// Partition Tests
// ============================================================================

describe('Partition Functions', () => {
  describe('partition', () => {
    it('should partition Ok and Err results', () => {
      const results = [
        ok(1),
        err(new Error('error 1')),
        ok(2),
        err(new Error('error 2')),
        ok(3),
      ];
      const { ok: okValues, err: errValues } = partition(results);
      expect(okValues).toEqual([1, 2, 3]);
      expect(errValues.map(e => e.message)).toEqual(['error 1', 'error 2']);
    });

    it('should handle all Ok', () => {
      const results = [ok(1), ok(2), ok(3)];
      const { ok: okValues, err: errValues } = partition(results);
      expect(okValues).toEqual([1, 2, 3]);
      expect(errValues).toEqual([]);
    });

    it('should handle all Err', () => {
      const results = [
        err(new Error('1')),
        err(new Error('2')),
      ];
      const { ok: okValues, err: errValues } = partition(results);
      expect(okValues).toEqual([]);
      expect(errValues.length).toBe(2);
    });
  });

  describe('filterOk', () => {
    it('should filter only Ok values', () => {
      const results = [
        ok(1),
        err(new Error('error')),
        ok(2),
        ok(3),
      ];
      const okValues = filterOk(results);
      expect(okValues).toEqual([1, 2, 3]);
    });
  });

  describe('filterErr', () => {
    it('should filter only Err values', () => {
      const results = [
        ok(1),
        err(new Error('error 1')),
        ok(2),
        err(new Error('error 2')),
      ];
      const errValues = filterErr(results);
      expect(errValues.map(e => e.message)).toEqual(['error 1', 'error 2']);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Result Integration', () => {
  it('should chain multiple operations', () => {
    // Pipeline operator syntax is not yet supported by esbuild
    // Using nested calls instead
    const result = map(
      andThen(
        map(ok(5), n => n * 2),
        n => n > 5 ? ok(n) : err(new Error('too small'))
      ),
      n => n + 1
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(11);
    }
  });

  it('should handle complex async workflow', async () => {
    const fetchUser = async (id: number) => ok({ id, name: 'John' });
    const fetchPosts = async (userId: number) => ok([{ userId, title: 'Post 1' }]);

    const result = await fromPromise(fetchUser(1))
      .then(r => andThenAsync(r, user => fetchPosts(user.id)));

    expect(isOk(result)).toBe(true);
  });
});
