/**
 * Current BC Session State Resource
 *
 * Provides introspection into active BC sessions and open pages.
 * This resource helps AI assistants understand the current state of the MCP server.
 */

import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import type { BCError } from '../core/errors.js';
import { InternalError } from '../core/errors.js';
import type { IMCPResource, ILogger } from '../core/interfaces.js';
import { SessionStateManager } from '../services/session-state-manager.js';

/**
 * BCSessionStateResource exposes the current state of BC sessions.
 */
export class BCSessionStateResource implements IMCPResource {
  public readonly uri = 'bc://session/current';
  public readonly name = 'Current BC Session State';
  public readonly description =
    'Active sessions, open pages, and pageContextIds for the current MCP server process.';
  public readonly mimeType = 'application/json';

  public constructor(private readonly logger?: ILogger) {}

  /**
   * Reads the current session state.
   * @returns JSON snapshot of all sessions
   */
  public async read(): Promise<Result<string, BCError>> {
    try {
      this.logger?.debug('Reading BC session state');

      const manager = SessionStateManager.getInstance(this.logger);
      const snapshot = manager.getSnapshot();

      // Add metadata
      const result = {
        timestamp: new Date().toISOString(),
        sessionCount: manager.getSessionCount(),
        totalOpenPages: manager.getTotalOpenPages(),
        sessions: snapshot.sessions,
      };

      const json = JSON.stringify(result, null, 2);

      this.logger?.debug('Returning BC session state', {
        sessionCount: result.sessionCount,
        totalOpenPages: result.totalOpenPages,
      });

      return ok(json);
    } catch (error) {
      this.logger?.error('Failed to read BCSessionStateResource', {
        error: String(error),
      });

      return err(
        new InternalError('Failed to read BC session state resource', {
          code: 'READ_SESSION_STATE_FAILED',
          error: String(error),
        })
      );
    }
  }
}
