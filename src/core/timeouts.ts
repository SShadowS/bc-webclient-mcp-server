/**
 * Timeout Configuration
 *
 * Centralized timeout configuration for BC MCP Server operations.
 * Provides reasonable defaults matching current behavior while allowing
 * per-operation overrides.
 */

/**
 * Comprehensive timeout configuration for all BC operations.
 */
export interface TimeoutsConfig {
  /** WebSocket connection establishment timeout (ms) */
  connectTimeoutMs: number;

  /** Generic RPC request timeout (ms) */
  rpcTimeoutMs: number;

  /** Handler wait (event-driven) timeout (ms) */
  handlerWaitTimeoutMs: number;

  /** Read operation timeout (ms) - for page reads, metadata fetch */
  readOpTimeoutMs: number;

  /** Write operation timeout (ms) - typically longer than reads */
  writeOpTimeoutMs: number;

  /** Tell Me search timeout (ms) - dialog + search + parse */
  searchTimeoutMs: number;
}

/**
 * Default timeouts matching current hardcoded behavior.
 * These values preserve backward compatibility.
 */
export const defaultTimeouts: TimeoutsConfig = {
  connectTimeoutMs: 10_000, // 10 seconds - matches current hardcoded value
  rpcTimeoutMs: 120_000, // 120 seconds - increased for BC heavy operations
  handlerWaitTimeoutMs: 2_500, // 2.5 seconds - matches current default
  readOpTimeoutMs: 120_000, // 120 seconds - increased for complex queries/filters
  writeOpTimeoutMs: 120_000, // 120 seconds - increased for document operations
  searchTimeoutMs: 120_000, // 120 seconds - Tell Me search with dialog
};

/**
 * Resolves final timeout configuration by merging overrides with defaults.
 *
 * Allows tools and services to override specific timeouts while
 * inheriting defaults for others.
 *
 * @param overrides - Partial timeout overrides
 * @returns Complete timeout configuration
 *
 * @example
 * ```ts
 * // Use defaults
 * const timeouts = resolveTimeouts();
 *
 * // Override search timeout
 * const timeouts = resolveTimeouts({ searchTimeoutMs: 45_000 });
 * ```
 */
export function resolveTimeouts(
  overrides?: Partial<TimeoutsConfig>
): TimeoutsConfig {
  return { ...defaultTimeouts, ...(overrides ?? {}) };
}

/**
 * Reads timeout configuration from environment variables.
 * Environment variables take precedence over code defaults.
 *
 * Supported env vars:
 * - BC_CONNECT_TIMEOUT_MS
 * - BC_RPC_TIMEOUT_MS
 * - BC_HANDLER_WAIT_TIMEOUT_MS
 * - BC_READ_OP_TIMEOUT_MS
 * - BC_WRITE_OP_TIMEOUT_MS
 * - BC_SEARCH_TIMEOUT_MS
 *
 * @returns Timeout configuration from environment or defaults
 */
export function timeoutsFromEnv(): TimeoutsConfig {
  const env = process.env;

  return {
    connectTimeoutMs: parseTimeoutMs(env.BC_CONNECT_TIMEOUT_MS, defaultTimeouts.connectTimeoutMs),
    rpcTimeoutMs: parseTimeoutMs(env.BC_RPC_TIMEOUT_MS, defaultTimeouts.rpcTimeoutMs),
    handlerWaitTimeoutMs: parseTimeoutMs(env.BC_HANDLER_WAIT_TIMEOUT_MS, defaultTimeouts.handlerWaitTimeoutMs),
    readOpTimeoutMs: parseTimeoutMs(env.BC_READ_OP_TIMEOUT_MS, defaultTimeouts.readOpTimeoutMs),
    writeOpTimeoutMs: parseTimeoutMs(env.BC_WRITE_OP_TIMEOUT_MS, defaultTimeouts.writeOpTimeoutMs),
    searchTimeoutMs: parseTimeoutMs(env.BC_SEARCH_TIMEOUT_MS, defaultTimeouts.searchTimeoutMs),
  };
}

/**
 * Parses timeout value from environment variable string.
 * Returns default if parsing fails.
 */
function parseTimeoutMs(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}
