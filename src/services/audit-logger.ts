/**
 * Audit Logger for MCP Tool Executions
 *
 * Logs all tool executions that required user consent.
 * Provides audit trail for compliance and debugging.
 *
 * CRITICAL FIX: Logs result AFTER execution completes, not before.
 * This prevents contradictory audit entries where "success" is logged
 * but the operation actually fails.
 */

import type { ILogger } from '../core/interfaces.js';

export interface AuditEvent {
  readonly timestamp: Date;
  readonly toolName: string;
  readonly userId?: string;
  readonly userApproved: boolean;
  readonly inputSummary: Record<string, unknown>;
  readonly result: 'success' | 'error';
  readonly errorMessage?: string;
}

/**
 * Expanded list of sensitive key patterns for redaction.
 * Includes all common authentication and credential patterns.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'token',
  'secret',
  'apikey',
  'api_key',
  'key',
  'auth',
  'authorization',
  'bearer',
  'client_secret',
  'clientsecret',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'private_key',
  'privatekey',
  'credential',
  'credentials',
] as const;

export class AuditLogger {
  private readonly events: AuditEvent[] = [];

  constructor(
    private readonly logger?: ILogger,
    private readonly maxEvents: number = 1000
  ) {}

  /**
   * Log a tool execution that required user approval.
   *
   * NOTE: This should only be called AFTER the tool execution completes,
   * with the actual result status (success/error).
   */
  public logToolExecution(event: Omit<AuditEvent, 'timestamp'>): void {
    const auditEvent: AuditEvent = {
      timestamp: new Date(),
      ...event,
    };

    // Add to in-memory buffer
    this.events.push(auditEvent);

    // Trim old events if buffer is full
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Log to structured logger
    if (this.logger) {
      const level = auditEvent.result === 'error' ? 'warn' : 'info';
      this.logger[level]('Tool execution audit', {
        toolName: auditEvent.toolName,
        userApproved: auditEvent.userApproved,
        result: auditEvent.result,
        timestamp: auditEvent.timestamp.toISOString(),
        inputSummary: this.sanitizeInput(auditEvent.inputSummary),
        ...(auditEvent.errorMessage && { error: auditEvent.errorMessage }),
        ...(auditEvent.userId && { userId: auditEvent.userId }),
      });
    }
  }

  /**
   * Get recent audit events.
   */
  public getRecentEvents(count: number = 100): readonly AuditEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Sanitize input to remove sensitive data before logging.
   *
   * EXPANDED REDACTION: Now includes comprehensive list of credential patterns.
   */
  private sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();

      // Check if key matches any sensitive pattern
      const isSensitive = SENSITIVE_KEY_PATTERNS.some(pattern =>
        lowerKey.includes(pattern)
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      }
      // Keep other fields (truncate if too long)
      else if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = value.substring(0, 100) + '...';
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects
        if (Array.isArray(value)) {
          sanitized[key] = `[Array(${value.length})]`;
        } else {
          sanitized[key] = this.sanitizeInput(value as Record<string, unknown>);
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Export audit log to JSON.
   */
  public exportToJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * Clear all audit events.
   */
  public clear(): void {
    this.events.length = 0;
  }

  /**
   * Get total event count.
   */
  public getEventCount(): number {
    return this.events.length;
  }
}
