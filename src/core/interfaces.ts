/**
 * Core Abstractions (Dependency Inversion Principle)
 *
 * All interfaces follow SOLID principles:
 * - Single Responsibility: Each interface has one clear purpose
 * - Interface Segregation: Small, focused interfaces
 * - Dependency Inversion: Depend on abstractions, not concrete implementations
 */

import type { Result } from './result.js';
import type { BCError } from './errors.js';
import type {
  BCConnectionConfig,
  BCSession,
  BCInteraction,
  Handler,
  LogicalForm,
  Control,
  PageMetadata,
  FieldMetadata,
  ActionMetadata,
} from '../types/bc-types.js';

// ============================================================================
// Connection Layer
// ============================================================================

/**
 * Abstraction for BC WebSocket connection.
 * Implementations handle authentication and low-level protocol.
 */
export interface IBCConnection {
  /**
   * Establishes connection and authenticates.
   * @returns Session information or error
   */
  connect(): Promise<Result<BCSession, BCError>>;

  /**
   * Sends an interaction and waits for response.
   * @param interaction - The interaction to invoke
   * @returns Handler array or error
   */
  invoke(interaction: BCInteraction): Promise<Result<readonly Handler[], BCError>>;

  /**
   * Closes the connection gracefully.
   */
  close(): Promise<Result<void, BCError>>;

  /**
   * Checks if connection is active.
   */
  isConnected(): boolean;

  /**
   * Gets current session information.
   */
  getSession(): BCSession | undefined;

  /**
   * Gets the company name from the current session.
   */
  getCompanyName(): string | null;

  /**
   * Gets the tenant ID from the current session.
   */
  getTenantId(): string;

  /**
   * Checks if a page is already open in the session.
   */
  isPageOpen(pageId: string): boolean;

  /**
   * Gets the formId for an already-open page.
   */
  getOpenFormId(pageId: string): string | undefined;

  /**
   * Tracks a newly opened form.
   */
  trackOpenForm(pageId: string, formId: string): void;

  /**
   * Gets all currently open formIds for BC's openFormIds parameter.
   */
  getAllOpenFormIds(): string[];

  /**
   * Loads child forms using the LoadForm interaction.
   * Implements the complete LoadForm solution for BC pages.
   * @param childForms - Array of child form info objects with serverId, container, and form
   * @returns Array of handlers from all LoadForm responses
   */
  loadChildForms(childForms: Array<{
    serverId: string;
    container: any;
    form: any;
  }>): Promise<Result<readonly Handler[], BCError>>;

  /**
   * Waits for handlers that match a predicate.
   * Used for event-driven pattern to capture asynchronous BC responses.
   * @param predicate - Function to test if handlers match the desired criteria, returns { matched: boolean, data?: T }
   * @param options - Optional configuration with timeoutMs and signal
   * @returns Promise that resolves with the data from the predicate
   */
  waitForHandlers<T>(
    predicate: (handlers: any[]) => { matched: boolean; data?: T },
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<T>;

  /**
   * Gets the underlying raw WebSocket client (for advanced operations).
   * Returns null if not connected.
   */
  getRawClient(): any | null;
}

/**
 * Factory for creating BC connections.
 * Allows different implementations (real, mock, test).
 */
export interface IBCConnectionFactory {
  create(config: BCConnectionConfig): IBCConnection;
}

// ============================================================================
// Parser Layer
// ============================================================================

/**
 * Parses handler arrays from BC responses.
 */
export interface IHandlerParser {
  /**
   * Parses handlers from JSON-RPC response.
   * @param response - Raw response from BC
   * @returns Parsed handlers or error
   */
  parse(response: unknown): Result<readonly Handler[], BCError>;

  /**
   * Extracts formId from CallbackResponseProperties in handlers.
   * The formId identifies which form was opened after an OpenForm interaction.
   * @param handlers - Array of handlers
   * @returns FormId string if found, undefined otherwise
   */
  extractFormId(handlers: readonly Handler[]): string | undefined;

  /**
   * Extracts LogicalForm from FormToShow event.
   * If formId is provided, filters to the specific form.
   * @param handlers - Array of handlers
   * @param formId - Optional formId to filter by (from OpenForm callback)
   * @returns LogicalForm or error
   */
  extractLogicalForm(handlers: readonly Handler[], formId?: string): Result<LogicalForm, BCError>;
}

/**
 * Parses controls from LogicalForm.
 */
export interface IControlParser {
  /**
   * Walks the control tree and extracts all controls.
   * @param logicalForm - The form to parse
   * @returns Array of controls
   */
  walkControls(logicalForm: LogicalForm): readonly Control[];

  /**
   * Extracts field metadata from controls.
   * @param controls - Array of controls
   * @returns Field metadata
   */
  extractFields(controls: readonly Control[]): readonly FieldMetadata[];

  /**
   * Extracts action metadata from controls.
   * @param controls - Array of controls
   * @returns Action metadata
   */
  extractActions(controls: readonly Control[]): readonly ActionMetadata[];
}

/**
 * High-level parser that combines handler and control parsing.
 */
export interface IPageMetadataParser {
  /**
   * Parses complete page metadata from handlers.
   * @param handlers - Response handlers from OpenForm
   * @returns Page metadata or error
   */
  parse(handlers: readonly Handler[]): Result<PageMetadata, BCError>;
}

// ============================================================================
// Service Layer
// ============================================================================

/**
 * Page service for high-level page operations.
 */
export interface IPageService {
  /**
   * Opens a page and returns its metadata.
   * @param pageId - The page ID to open
   * @returns Page metadata or error
   */
  getPageMetadata(pageId: string): Promise<Result<PageMetadata, BCError>>;

  /**
   * Searches for pages by query.
   * @param query - Search query
   * @param limit - Maximum results
   * @returns Array of page IDs or error
   */
  searchPages(query: string, limit?: number): Promise<Result<readonly string[], BCError>>;

  /**
   * Reads data from a page.
   * @param pageId - The page ID
   * @param filters - Optional filters
   * @returns Page data or error
   */
  readPageData(
    pageId: string,
    filters?: Record<string, unknown>
  ): Promise<Result<readonly Record<string, unknown>[], BCError>>;

  /**
   * Writes data to a page.
   * @param pageId - The page ID
   * @param recordId - Optional record ID for updates
   * @param fields - Field values
   * @returns Success status or error
   */
  writePageData(
    pageId: string,
    recordId: string | undefined,
    fields: Record<string, unknown>
  ): Promise<Result<string, BCError>>;

  /**
   * Executes an action on a page.
   * @param pageId - The page ID
   * @param actionName - The action to execute
   * @param recordId - Optional record ID
   * @returns Action result or error
   */
  executeAction(
    pageId: string,
    actionName: string,
    recordId?: string
  ): Promise<Result<unknown, BCError>>;
}

/**
 * Session management service.
 */
export interface ISessionService {
  /**
   * Opens a new session.
   * @param config - Connection configuration
   * @returns Session or error
   */
  openSession(config: BCConnectionConfig): Promise<Result<BCSession, BCError>>;

  /**
   * Closes a session.
   * @param sessionId - The session to close
   */
  closeSession(sessionId: string): Promise<Result<void, BCError>>;

  /**
   * Gets an active session.
   * @param sessionId - The session ID
   * @returns Session or undefined
   */
  getSession(sessionId: string): BCSession | undefined;

  /**
   * Checks if a session is active.
   * @param sessionId - The session ID
   */
  isSessionActive(sessionId: string): boolean;
}

// ============================================================================
// Cache Layer
// ============================================================================

/**
 * Generic cache interface.
 */
export interface ICache<K, V> {
  /**
   * Gets a value from cache.
   * @param key - The cache key
   * @returns Cached value or undefined
   */
  get(key: K): V | undefined;

  /**
   * Sets a value in cache.
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttl - Optional time-to-live in milliseconds
   */
  set(key: K, value: V, ttl?: number): void;

  /**
   * Checks if a key exists in cache.
   * @param key - The cache key
   */
  has(key: K): boolean;

  /**
   * Deletes a value from cache.
   * @param key - The cache key
   */
  delete(key: K): boolean;

  /**
   * Clears all cache entries.
   */
  clear(): void;

  /**
   * Gets the number of cached entries.
   */
  size(): number;
}

/**
 * Cache factory for creating different cache implementations.
 */
export interface ICacheFactory {
  create<K, V>(options?: CacheOptions): ICache<K, V>;
}

export interface CacheOptions {
  readonly maxSize?: number;
  readonly defaultTtl?: number;
  readonly cleanupInterval?: number;
}

// ============================================================================
// Validation Layer
// ============================================================================

/**
 * Validator for type-safe validation.
 */
export interface IValidator<T> {
  /**
   * Validates input data.
   * @param data - Data to validate
   * @returns Validated data or error
   */
  validate(data: unknown): Result<T, BCError>;
}

/**
 * Validator factory for creating validators.
 */
export interface IValidatorFactory {
  /**
   * Creates a validator from a schema.
   * @param schema - Validation schema (e.g., Zod schema)
   */
  create<T>(schema: unknown): IValidator<T>;
}

// ============================================================================
// Logging Layer
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  readonly [key: string]: unknown;
}

/**
 * Structured logger interface.
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;

  /**
   * Creates a child logger with additional context.
   */
  child(context: LogContext): ILogger;
}

/**
 * Logger factory for creating loggers.
 */
export interface ILoggerFactory {
  create(name: string): ILogger;
}

// ============================================================================
// Metrics Layer
// ============================================================================

/**
 * Metrics collector interface.
 */
export interface IMetrics {
  /**
   * Increments a counter.
   */
  increment(metric: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Records a gauge value.
   */
  gauge(metric: string, value: number, tags?: Record<string, string>): void;

  /**
   * Records a timing value.
   */
  timing(metric: string, duration: number, tags?: Record<string, string>): void;

  /**
   * Records a histogram value.
   */
  histogram(metric: string, value: number, tags?: Record<string, string>): void;

  /**
   * Starts a timer for a metric.
   */
  startTimer(metric: string, tags?: Record<string, string>): ITimer;
}

/**
 * Timer for measuring operation duration.
 */
export interface ITimer {
  /**
   * Stops the timer and records the duration.
   */
  stop(): void;
}

// ============================================================================
// MCP Server Layer
// ============================================================================

/**
 * MCP tool implementation.
 */
export interface IMCPTool {
  /**
   * Tool name.
   */
  readonly name: string;

  /**
   * Tool description for Claude.
   */
  readonly description: string;

  /**
   * JSON schema for tool input.
   */
  readonly inputSchema: unknown;

  /**
   * Whether this tool requires explicit user consent before execution.
   * Set to true for write operations and dangerous actions.
   * Default: false (no consent required for read-only operations)
   */
  readonly requiresConsent?: boolean;

  /**
   * Human-readable consent prompt shown to user in approval dialog.
   * Supports template variables like {{pageId}}, {{actionName}}.
   * Only relevant if requiresConsent is true.
   */
  readonly consentPrompt?: string;

  /**
   * Risk classification for UI styling and warnings.
   * - low: Read-only operations (no consent needed)
   * - medium: Write operations (consent required, reversible)
   * - high: Dangerous operations (consent required, may be irreversible)
   */
  readonly sensitivityLevel?: 'low' | 'medium' | 'high';

  /**
   * Executes the tool.
   * @param input - Validated tool input
   * @returns Tool result or error
   */
  execute(input: unknown): Promise<Result<unknown, BCError>>;
}

/**
 * MCP resource implementation.
 */
export interface IMCPResource {
  /**
   * Resource URI.
   */
  readonly uri: string;

  /**
   * Resource name.
   */
  readonly name: string;

  /**
   * Resource description.
   */
  readonly description: string;

  /**
   * Resource MIME type.
   */
  readonly mimeType: string;

  /**
   * Reads the resource content.
   * @returns Resource content or error
   */
  read(): Promise<Result<string, BCError>>;
}

/**
 * MCP server interface.
 */
export interface IMCPServer {
  /**
   * Initializes the MCP server.
   */
  initialize(): Promise<Result<void, BCError>>;

  /**
   * Registers a tool.
   */
  registerTool(tool: IMCPTool): void;

  /**
   * Registers a resource.
   */
  registerResource(resource: IMCPResource): void;

  /**
   * Starts the server.
   */
  start(): Promise<Result<void, BCError>>;

  /**
   * Stops the server.
   */
  stop(): Promise<Result<void, BCError>>;

  /**
   * Gets all registered tools.
   */
  getTools(): readonly IMCPTool[];

  /**
   * Gets all registered resources.
   */
  getResources(): readonly IMCPResource[];
}

// ============================================================================
// Visitor Pattern for Control Tree Traversal
// ============================================================================

/**
 * Visitor for walking the control tree.
 */
export interface IControlVisitor {
  /**
   * Visits a control.
   * @param control - The control to visit
   * @param depth - Current depth in tree
   * @returns Whether to continue visiting children
   */
  visit(control: Control, depth: number): boolean;
}

/**
 * Control tree walker using visitor pattern.
 */
export interface IControlWalker {
  /**
   * Walks the control tree with a visitor.
   * @param logicalForm - The form to walk
   * @param visitor - The visitor to apply
   */
  walk(logicalForm: LogicalForm, visitor: IControlVisitor): void;
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Rate limiter interface.
 */
export interface IRateLimiter {
  /**
   * Checks if an operation is allowed.
   * @param key - Rate limit key (e.g., user ID)
   * @returns Whether the operation is allowed
   */
  isAllowed(key: string): Promise<boolean>;

  /**
   * Waits until an operation is allowed.
   * @param key - Rate limit key
   */
  waitUntilAllowed(key: string): Promise<void>;
}

// ============================================================================
// Connection Pool
// ============================================================================

/**
 * Connection pool for managing BC connections.
 */
export interface IConnectionPool {
  /**
   * Acquires a connection from the pool.
   * @param config - Connection configuration
   * @returns Connection or error
   */
  acquire(config: BCConnectionConfig): Promise<Result<IBCConnection, BCError>>;

  /**
   * Releases a connection back to the pool.
   * @param connection - The connection to release
   */
  release(connection: IBCConnection): Promise<void>;

  /**
   * Closes all connections in the pool.
   */
  close(): Promise<void>;

  /**
   * Gets pool statistics.
   */
  stats(): PoolStats;
}

export interface PoolStats {
  readonly total: number;
  readonly active: number;
  readonly idle: number;
  readonly pending: number;
}
