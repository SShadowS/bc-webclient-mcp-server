/**
 * Session State Manager
 *
 * Tracks BC sessions and open pages for session introspection.
 * This is a singleton service that maintains in-memory state.
 *
 * NOTE: This is ephemeral (in-memory) and will reset when the process restarts.
 * For production use, you could back this with PageContextCache or a database.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ILogger } from '../core/interfaces.js';

/**
 * Information about an open page in a session.
 */
export interface OpenPageInfo {
  readonly pageContextId: string;
  readonly pageId: string;
  readonly pageType?: string;
  readonly openedAt: string; // ISO 8601 timestamp
}

/**
 * Information about a BC session.
 */
export interface SessionInfo {
  readonly sessionId: string;
  readonly openPages: OpenPageInfo[];
}

/**
 * Snapshot of all sessions and their state.
 */
export interface SessionStateSnapshot {
  readonly sessions: SessionInfo[];
}

/**
 * SessionStateManager tracks BC sessions and open pages.
 *
 * This is a singleton to maintain consistent state across the application.
 */
export class SessionStateManager {
  private static instance: SessionStateManager | undefined;

  /**
   * Gets the singleton instance.
   * @param logger - Optional logger for debug logging
   */
  public static getInstance(logger?: ILogger): SessionStateManager {
    if (!SessionStateManager.instance) {
      SessionStateManager.instance = new SessionStateManager(logger);
    }
    return SessionStateManager.instance;
  }

  /**
   * Resets the singleton instance (primarily for testing).
   */
  public static resetInstance(): void {
    SessionStateManager.instance = undefined;
  }

  private readonly sessions = new Map<string, SessionInfo>();

  private constructor(private readonly logger?: ILogger) {}

  /**
   * Creates a new session.
   * @returns The newly created session info
   */
  public createSession(): SessionInfo {
    const sessionId = uuidv4();
    const session: SessionInfo = { sessionId, openPages: [] };
    this.sessions.set(sessionId, session);
    this.logger?.debug('Created new BC session', { sessionId });
    return session;
  }

  /**
   * Creates a session with a specific ID (for existing sessions).
   * @param sessionId - The session ID to use
   * @returns The session info
   */
  public createSessionWithId(sessionId: string): SessionInfo {
    if (this.sessions.has(sessionId)) {
      this.logger?.debug('Session already exists', { sessionId });
      return this.sessions.get(sessionId)!;
    }

    const session: SessionInfo = { sessionId, openPages: [] };
    this.sessions.set(sessionId, session);
    this.logger?.debug('Created BC session with provided ID', { sessionId });
    return session;
  }

  /**
   * Gets a session by ID.
   * @param sessionId - The session ID
   * @returns The session info or undefined
   */
  public getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Adds an open page to a session.
   * If the session doesn't exist, it will be created.
   * @param sessionId - The session ID
   * @param pageContextId - The page context ID
   * @param pageId - The BC page ID
   * @param pageType - Optional page type (Card, List, Document, etc.)
   */
  public addOpenPage(
    sessionId: string,
    pageContextId: string,
    pageId: string,
    pageType?: string
  ): void {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.createSessionWithId(sessionId);
    }

    // Check if page is already tracked
    const existing = session.openPages.find((p) => p.pageContextId === pageContextId);
    if (existing) {
      this.logger?.debug('Page already tracked in session', {
        sessionId,
        pageContextId,
        pageId,
      });
      return;
    }

    // Add the page
    const openPage: OpenPageInfo = {
      pageContextId,
      pageId,
      pageType,
      openedAt: new Date().toISOString(),
    };

    // Create a new session object with updated pages (immutable pattern)
    const updatedSession: SessionInfo = {
      sessionId: session.sessionId,
      openPages: [...session.openPages, openPage],
    };

    this.sessions.set(sessionId, updatedSession);

    this.logger?.debug('Added open page to session', {
      sessionId,
      pageContextId,
      pageId,
      pageType,
    });
  }

  /**
   * Closes a page in all sessions.
   * @param pageContextId - The page context ID to close
   */
  public closePage(pageContextId: string): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      const idx = session.openPages.findIndex((p) => p.pageContextId === pageContextId);
      if (idx >= 0) {
        // Create a new session with the page removed
        const updatedPages = session.openPages.filter((p) => p.pageContextId !== pageContextId);
        const updatedSession: SessionInfo = {
          sessionId: session.sessionId,
          openPages: updatedPages,
        };
        this.sessions.set(sessionId, updatedSession);

        this.logger?.debug('Closed page', { sessionId, pageContextId });
        return;
      }
    }

    this.logger?.debug('Page not found in any session', { pageContextId });
  }

  /**
   * Closes a session and all its pages.
   * @param sessionId - The session ID to close
   */
  public closeSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) {
      this.logger?.debug('Closed session', { sessionId });
    } else {
      this.logger?.debug('Session not found', { sessionId });
    }
  }

  /**
   * Gets a snapshot of all sessions and their state.
   * @returns Immutable snapshot of current state
   */
  public getSnapshot(): SessionStateSnapshot {
    return {
      sessions: Array.from(this.sessions.values()).map((s) => ({
        sessionId: s.sessionId,
        openPages: [...s.openPages],
      })),
    };
  }

  /**
   * Gets all open pages across all sessions.
   * @returns Array of all open pages
   */
  public getAllOpenPages(): OpenPageInfo[] {
    const allPages: OpenPageInfo[] = [];
    for (const session of this.sessions.values()) {
      allPages.push(...session.openPages);
    }
    return allPages;
  }

  /**
   * Gets the number of active sessions.
   */
  public getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Gets the total number of open pages across all sessions.
   */
  public getTotalOpenPages(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      count += session.openPages.length;
    }
    return count;
  }

  /**
   * Clears all sessions (primarily for testing).
   */
  public clear(): void {
    this.sessions.clear();
    this.logger?.debug('Cleared all sessions');
  }
}
