/**
 * NavUserPassword Authentication
 *
 * Implements HTTP Basic Authentication for Business Central WebSocket connections
 * Based on decompiled code analysis from ClientServiceAuthenticationHandler.cs
 */

export interface NavUserPasswordCredentials {
  username: string;
  password: string;
  tenantId?: string;  // For multi-tenant environments
}

/**
 * Create HTTP Basic Authentication header for NavUserPassword
 *
 * Format: Authorization: Basic <base64-encoded-credentials>
 * Credentials: username:password (or tenantId\username:password for multi-tenant)
 */
export function createNavUserPasswordAuthHeader(credentials: NavUserPasswordCredentials): string {
  // Multi-tenant format: TenantId\Username
  // Single tenant format: Username
  const username = credentials.tenantId
    ? `${credentials.tenantId}\\${credentials.username}`
    : credentials.username;

  // Create credentials string: username:password
  const credentialsString = `${username}:${credentials.password}`;

  // Base64 encode (UTF-8 -> Base64)
  // BC uses ISO-8859-1 encoding, but UTF-8 is compatible for most cases
  const encoded = Buffer.from(credentialsString, 'utf-8').toString('base64');

  // Return Basic Auth header value
  return `Basic ${encoded}`;
}

/**
 * Parse NavUserPassword username to extract tenant ID if present
 */
export function parseNavUsername(username: string): { tenantId?: string; username: string } {
  const backslashIndex = username.indexOf('\\');

  if (backslashIndex < 0) {
    // Single tenant format
    return { username };
  }

  // Multi-tenant format: TenantId\Username
  return {
    tenantId: username.substring(0, backslashIndex),
    username: username.substring(backslashIndex + 1)
  };
}

/**
 * Validate NavUserPassword credentials format
 */
export function validateNavCredentials(credentials: NavUserPasswordCredentials): { valid: boolean; error?: string } {
  if (!credentials.username || credentials.username.trim().length === 0) {
    return { valid: false, error: 'Username is required' };
  }

  if (!credentials.password || credentials.password.length === 0) {
    return { valid: false, error: 'Password is required' };
  }

  // Check for invalid characters in username (besides backslash for tenant separator)
  const usernameWithoutTenant = credentials.username.split('\\').pop() || '';
  if (usernameWithoutTenant.includes(':')) {
    return { valid: false, error: 'Username cannot contain colon (:)' };
  }

  return { valid: true };
}

/**
 * Check if credentials appear to include tenant ID
 */
export function hasTenantInUsername(username: string): boolean {
  return username.includes('\\');
}
