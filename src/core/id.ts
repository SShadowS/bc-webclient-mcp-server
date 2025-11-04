/**
 * Centralized ID generation utilities
 *
 * Provides consistent UUID generation across the application
 * using Node.js built-in crypto.randomUUID() for security
 * and performance.
 */

import { randomUUID } from 'node:crypto';

/**
 * Generate a new UUID v4
 *
 * Uses Node.js built-in crypto.randomUUID() which is:
 * - Cryptographically secure
 * - Faster than custom implementations
 * - Standards compliant (RFC 4122)
 *
 * @returns A new UUID v4 string in format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *
 * @example
 * ```typescript
 * const id = newId(); // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function newId(): string {
  return randomUUID();
}

/**
 * Generate a prefixed ID for specific contexts
 *
 * @param prefix - The prefix to add before the UUID
 * @returns A prefixed UUID string
 *
 * @example
 * ```typescript
 * const sessionId = prefixedId('session'); // "session-550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function prefixedId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Generate a short ID (first 8 characters of UUID)
 *
 * WARNING: Higher collision probability than full UUID
 * Use only for non-critical identifiers like temporary keys
 *
 * @returns An 8-character hexadecimal string
 *
 * @example
 * ```typescript
 * const shortId = shortId(); // "550e8400"
 * ```
 */
export function shortId(): string {
  return randomUUID().substring(0, 8);
}