/**
 * Type definitions for BC WebSocket client services
 */

/**
 * Filter field definition.
 *
 * Represents a filterable column in a BC list page.
 */
export type FilterField = {
  /** Canonical field ID (e.g., "18_Customer.2") */
  id: string;
  /** User-friendly caption (e.g., "Name", "Balance") */
  caption: string;
};

/**
 * Session credentials for BC login.
 */
export type SessionCredentials = {
  username: string;
  password: string;
  tenantId: string;
};

/**
 * Connection configuration for BC Web Client.
 */
export type ConnectionConfig = {
  baseUrl: string;
  tenantId: string;
  username: string;
  password: string;
};
