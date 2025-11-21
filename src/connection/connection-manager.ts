/**
 * Connection Manager - Session Pooling for BC MCP Tools
 *
 * Manages BC WebSocket sessions across multiple tool invocations.
 * Enables multi-step workflows (read → edit → write → save) by maintaining
 * session state between tool calls.
 *
 * Key Features:
 * - Single session per environment (baseUrl + tenant + user)
 * - Form registry tracks open pages per session
 * - TTL-based auto-cleanup (15 min idle timeout)
 * - Thread-safe session access
 *
 * Based on GPT-5 Pro analysis in WRITE_TOOLS_ANALYSIS.md
 */

import type { BCPageConnection } from './bc-page-connection.js';
import { BCPageConnection as BCPageConnectionClass } from './bc-page-connection.js';
import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { ConnectionError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { FilterMetadataService } from '../services/filter-metadata-service.js';

/**
 * Information about an open BC form within a session.
 */
export interface FormInfo {
  readonly formId: string;
  readonly pageId: string;
  readonly caption: string;
  readonly listControlPath?: string;
  readonly quickFilterPath?: string;
  readonly openedAt: Date;
}

/**
 * Session information tracked by ConnectionManager.
 */
interface SessionInfo {
  readonly sessionId: string;
  readonly connection: BCPageConnection;
  readonly formRegistry: Map<string, FormInfo>;
  lastUsed: Date;
  readonly environment: string;
}

/**
 * Configuration for creating a BC session.
 */
export interface SessionConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly tenantId: string;
}

/**
 * Result of getting or creating a session.
 */
export interface SessionResult {
  readonly sessionId: string;
  readonly connection: BCPageConnection;
  readonly isNewSession: boolean;
}

/**
 * Singleton manager for BC WebSocket session pooling.
 *
 * Maintains a pool of BC sessions keyed by environment (baseUrl + tenant + user).
 * Each session tracks open forms and their metadata.
 *
 * Usage:
 * ```typescript
 * const manager = ConnectionManager.getInstance();
 * const { sessionId, connection } = await manager.getOrCreateSession(config);
 *
 * // Later, in another tool:
 * const connection = manager.getSession(sessionId);
 * ```
 */
export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private readonly sessions: Map<string, SessionInfo> = new Map();
  private readonly SESSION_TTL = 15 * 60 * 1000; // 15 min (below BC idle timeout)
  private readonly cleanupTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Private constructor - use getInstance() instead.
   */
  private constructor() {
    logger.info('[ConnectionManager] ConnectionManager initialized');
  }

  /**
   * Get the singleton instance of ConnectionManager.
   */
  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Get or create a BC session for the given environment.
   *
   * If a session already exists for this environment and is not expired,
   * it will be reused. Otherwise, a new session is created.
   *
   * @param config - Session configuration (baseUrl, username, password, tenantId)
   * @returns SessionResult with sessionId and connection
   */
  public async getOrCreateSession(
    config: SessionConfig
  ): Promise<Result<SessionResult, BCError>> {
    const envKey = this.getEnvironmentKey(config);

    // Check for existing session
    const existing = this.sessions.get(envKey);
    if (existing && !this.isExpired(existing)) {
      existing.lastUsed = new Date();
      logger.info(`[ConnectionManager] Reusing session: ${existing.sessionId} (env: ${envKey})`);

      return ok({
        sessionId: existing.sessionId,
        connection: existing.connection,
        isNewSession: false,
      });
    }

    // Remove expired session if it exists
    if (existing) {
      logger.warn(`[ConnectionManager] Session expired, creating new: ${existing.sessionId}`);
      await this.closeSessionByEnvKey(envKey);
    }

    // Create new session
    logger.info(`[ConnectionManager] Creating new session for ${envKey}`);

    try {
      const connection = new BCPageConnectionClass({
        baseUrl: config.baseUrl,
        username: config.username,
        password: config.password,
        tenantId: config.tenantId,
      });

      const connectResult = await connection.connect();
      if (!connectResult.ok) {
        const errorMsg = connectResult.ok === false ? connectResult.error.message : 'Unknown error';
        const errorObj = connectResult.ok === false ? connectResult.error : undefined;
        return err(
          new ConnectionError(
            `Failed to create BC session: ${errorMsg}`,
            { config, originalError: errorObj }
          )
        );
      }

      const sessionId = this.generateSessionId();
      const sessionInfo: SessionInfo = {
        sessionId,
        connection,
        formRegistry: new Map(),
        lastUsed: new Date(),
        environment: envKey,
      };

      this.sessions.set(envKey, sessionInfo);
      logger.info(`[ConnectionManager] Session created: ${sessionId}`);

      // Schedule TTL cleanup
      this.scheduleCleanup(envKey);

      return ok({
        sessionId,
        connection,
        isNewSession: true,
      });
    } catch (error) {
      return err(
        new ConnectionError(
          `Failed to create BC connection: ${error instanceof Error ? error.message : String(error)}`,
          { config, originalError: error }
        )
      );
    }
  }

  /**
   * Get an existing session by sessionId.
   *
   * @param sessionId - Session ID to retrieve
   * @returns BCPageConnection if found and not expired, null otherwise
   */
  public getSession(sessionId: string): BCPageConnection | null {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        if (this.isExpired(session)) {
          logger.warn(`[ConnectionManager] Session expired: ${sessionId}`);
          this.closeSessionById(sessionId);
          return null;
        }

        session.lastUsed = new Date();
        logger.debug(`[ConnectionManager] Retrieved session: ${sessionId}`);
        return session.connection;
      }
    }

    logger.warn(`[ConnectionManager] Session not found: ${sessionId}`);
    return null;
  }

  /**
   * Register an open form in the session's form registry.
   *
   * This allows tools to check if a page is already open before
   * attempting to open it again.
   *
   * @param sessionId - Session ID
   * @param pageId - BC Page ID
   * @param formInfo - Form information (formId, caption, etc.)
   */
  public registerForm(
    sessionId: string,
    pageId: string,
    formInfo: Omit<FormInfo, 'openedAt'>
  ): void {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        const fullFormInfo: FormInfo = {
          ...formInfo,
          openedAt: new Date(),
        };

        session.formRegistry.set(pageId, fullFormInfo);
        logger.debug(
          `[ConnectionManager] Registered form: Page ${pageId} -> formId ${formInfo.formId} (session: ${sessionId})`
        );
        return;
      }
    }

    logger.warn(
      `[ConnectionManager] Cannot register form - session not found: ${sessionId}`
    );
  }

  /**
   * Get form info from session's form registry.
   *
   * @param sessionId - Session ID
   * @param pageId - BC Page ID
   * @returns FormInfo if page is open in this session, null otherwise
   */
  public getForm(sessionId: string, pageId: string): FormInfo | null {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        const formInfo = session.formRegistry.get(pageId);
        if (formInfo) {
          logger.debug(
            `[ConnectionManager] Found open form: Page ${pageId} -> formId ${formInfo.formId}`
          );
        } else {
          logger.debug(
            `[ConnectionManager] Page ${pageId} not open in session ${sessionId}`
          );
        }
        return formInfo || null;
      }
    }

    logger.warn(
      `[ConnectionManager] Cannot get form - session not found: ${sessionId}`
    );
    return null;
  }

  /**
   * Check if a page is already open in a session.
   *
   * @param sessionId - Session ID
   * @param pageId - BC Page ID
   * @returns true if page is open, false otherwise
   */
  public isPageOpen(sessionId: string, pageId: string): boolean {
    return this.getForm(sessionId, pageId) !== null;
  }

  /**
   * Close a specific session by sessionId.
   *
   * @param sessionId - Session ID to close
   */
  public async closeSessionById(sessionId: string): Promise<void> {
    for (const [envKey, session] of this.sessions.entries()) {
      if (session.sessionId === sessionId) {
        logger.info(`[ConnectionManager] Closing session: ${sessionId}`);

        // Cancel cleanup timer
        const timer = this.cleanupTimers.get(envKey);
        if (timer) {
          clearTimeout(timer);
          this.cleanupTimers.delete(envKey);
        }

        // Close connection
        const closeResult = await session.connection.close();
        if (!closeResult.ok) {
          logger.warn(
            `[ConnectionManager] Error closing connection: ${closeResult.error.message}`
          );
        }

        // Clear filter state cache for this session (Phase 1: Filter State Cache)
        FilterMetadataService.getInstance().clearFilterStateForSession(sessionId);

        // Remove from registry
        this.sessions.delete(envKey);

        logger.info(`[ConnectionManager] Session closed: ${sessionId}`);
        return;
      }
    }

    logger.warn(
      `[ConnectionManager] Cannot close session - not found: ${sessionId}`
    );
  }

  /**
   * Close all sessions (for shutdown).
   */
  public async closeAllSessions(): Promise<void> {
    logger.info(`[ConnectionManager] Closing all sessions (${this.sessions.size} total)`);

    const closePromises: Promise<void>[] = [];
    for (const [envKey, session] of this.sessions.entries()) {
      logger.info(`[ConnectionManager] Closing session: ${session.sessionId}`);

      // Cancel cleanup timer
      const timer = this.cleanupTimers.get(envKey);
      if (timer) {
        clearTimeout(timer);
        this.cleanupTimers.delete(envKey);
      }

      // Unwrap Result<void, BCError> to Promise<void>
      closePromises.push(
        session.connection.close().then((result) => {
          if (!result.ok) {
            logger.warn(
              `[ConnectionManager] Error closing session ${session.sessionId}: ${result.error.message}`
            );
          }
        })
      );
    }

    await Promise.all(closePromises);
    this.sessions.clear();

    logger.info('[ConnectionManager] All sessions closed');
  }

  /**
   * Get statistics about current sessions.
   */
  public getStats(): {
    totalSessions: number;
    sessions: Array<{
      sessionId: string;
      environment: string;
      openForms: number;
      ageMinutes: number;
    }>;
  } {
    const now = new Date().getTime();
    const sessions = Array.from(this.sessions.values()).map((session) => ({
      sessionId: session.sessionId,
      environment: session.environment,
      openForms: session.formRegistry.size,
      ageMinutes: Math.floor((now - session.lastUsed.getTime()) / 60000),
    }));

    return {
      totalSessions: this.sessions.size,
      sessions,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Generate environment key for session lookup.
   */
  private getEnvironmentKey(config: SessionConfig): string {
    return `${config.baseUrl}|${config.tenantId}|${config.username}`;
  }

  /**
   * Check if a session has expired based on TTL.
   */
  private isExpired(session: SessionInfo): boolean {
    const now = new Date().getTime();
    const lastUsed = session.lastUsed.getTime();
    const age = now - lastUsed;
    return age > this.SESSION_TTL;
  }

  /**
   * Schedule automatic cleanup for a session after TTL expires.
   */
  private scheduleCleanup(envKey: string): void {
    // Cancel existing timer if any
    const existingTimer = this.cleanupTimers.get(envKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new cleanup
    const timer = setTimeout(
      async () => {
        const session = this.sessions.get(envKey);
        if (session && this.isExpired(session)) {
          logger.info(
            `[ConnectionManager] Auto-closing expired session: ${session.sessionId}`
          );
          await this.closeSessionByEnvKey(envKey);
        }
      },
      this.SESSION_TTL + 1000
    );

    this.cleanupTimers.set(envKey, timer);
  }

  /**
   * Close session by environment key.
   */
  private async closeSessionByEnvKey(envKey: string): Promise<void> {
    const session = this.sessions.get(envKey);
    if (session) {
      await this.closeSessionById(session.sessionId);
    }
  }

  /**
   * Generate a unique session ID.
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `mcp-session-${timestamp}-${random}`;
  }
}
