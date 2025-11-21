/**
 * BC Authentication Service
 *
 * Handles HTTP login to BC Web Client to obtain session cookies and CSRF token.
 *
 * Extracted from BCRawWebSocketClient (lines 108-195).
 *
 * Responsibilities:
 * - HTTP login via web form
 * - Session cookie management
 * - CSRF token extraction from Antiforgery cookie
 *
 * Usage:
 * ```ts
 * const auth = new BCAuthenticationService({
 *   baseUrl: 'http://localhost/BC',
 *   username: 'admin',
 *   password: 'pass',
 *   tenantId: 'default'
 * });
 *
 * await auth.authenticateWeb();
 *
 * const cookies = auth.getSessionCookies(); // For WebSocket connection
 * const csrf = auth.getCsrfToken();        // For RPC requests
 * ```
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { logger } from '../../core/logger.js';
import { AuthenticationError } from '../../core/errors.js';
import type { IBCAuthenticationService } from '../interfaces.js';
import type { BCConfig } from '../../types.js';

/**
 * Authentication service for BC Web Client login.
 *
 * Authenticates via HTTP form submission to get session cookies and CSRF token.
 * These are then used for WebSocket connection and JSON-RPC requests.
 */
export class BCAuthenticationService implements IBCAuthenticationService {
  private config: BCConfig;
  private username: string;
  private password: string;
  private tenantId: string;
  private sessionCookies: string[] = [];
  private csrfToken: string | null = null;
  private authenticated = false;

  constructor(params: {
    config: BCConfig;
    username: string;
    password: string;
    tenantId?: string;
  }) {
    this.config = params.config;
    this.username = params.username;
    this.password = params.password;
    this.tenantId = params.tenantId || 'default';
  }

  /**
   * Authenticate via web login to get session cookies and CSRF token.
   *
   * Two-step process:
   * 1. GET /SignIn - Extract CSRF token from login form
   * 2. POST /SignIn - Submit credentials and get session cookies
   *
   * @throws {AuthenticationError} If login fails
   */
  public async authenticateWeb(): Promise<void> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const tenant = this.tenantId;

    logger.info('Authenticating via web login...');
    logger.info(`  URL: ${baseUrl}/?tenant=${tenant}`);
    logger.info(`  User: ${this.tenantId !== 'default' ? `${this.tenantId}\\${this.username}` : this.username}`);

    // Step 1a: Get the login page to extract CSRF token
    const loginPageUrl = `${baseUrl}/SignIn?tenant=${tenant}`;
    logger.info('  Fetching login page...');

    const loginPageResponse = await fetch(loginPageUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Extract cookies from login page
    const setCookieHeaders = loginPageResponse.headers.raw()['set-cookie'] || [];
    this.sessionCookies = setCookieHeaders.map(cookie => cookie.split(';')[0]);

    const loginPageHtml = await loginPageResponse.text();

    // Parse CSRF token from login form
    const $ = cheerio.load(loginPageHtml);
    const csrfInput = $('input[name="__RequestVerificationToken"]');
    const requestVerificationToken = csrfInput.val() as string;

    if (!requestVerificationToken) {
      throw new AuthenticationError(
        'Could not find __RequestVerificationToken in login page',
        { url: loginPageUrl }
      );
    }

    logger.info('  Got CSRF token from login page');

    // Step 1b: POST credentials to login
    logger.info('  Submitting credentials...');

    const loginFormData = new URLSearchParams();
    loginFormData.append('userName', this.username);
    loginFormData.append('password', this.password);
    loginFormData.append('__RequestVerificationToken', requestVerificationToken);

    const loginResponse = await fetch(loginPageUrl, {
      method: 'POST',
      body: loginFormData,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.sessionCookies.join('; '),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Check for successful login (302 redirect)
    if (loginResponse.status !== 302) {
      throw new AuthenticationError(
        `Login failed with status ${loginResponse.status}`,
        { status: loginResponse.status, url: loginPageUrl }
      );
    }

    // Extract updated session cookies
    const loginSetCookies = loginResponse.headers.raw()['set-cookie'] || [];
    loginSetCookies.forEach(cookie => {
      const cookieName = cookie.split('=')[0];
      // Update or add cookie
      const existingIndex = this.sessionCookies.findIndex(c => c.startsWith(cookieName + '='));
      if (existingIndex >= 0) {
        this.sessionCookies[existingIndex] = cookie.split(';')[0];
      } else {
        this.sessionCookies.push(cookie.split(';')[0]);
      }
    });

    logger.info('  Login successful');

    // Extract CSRF token from Antiforgery cookie
    const antiforgCookie = this.sessionCookies.find(c => c.startsWith('.AspNetCore.Antiforgery.'));
    if (antiforgCookie) {
      const tokenValue = antiforgCookie.split('=')[1];
      if (tokenValue && tokenValue.startsWith('CfDJ8')) {
        this.csrfToken = tokenValue;
        logger.info(`  Extracted CSRF token from Antiforgery cookie`);
      }
    }

    this.authenticated = true;
    logger.info('Web authentication complete\n');
  }

  /**
   * Get current session cookies.
   *
   * Used by WebSocket manager to establish authenticated connection.
   *
   * @returns Array of cookie strings in "name=value" format
   */
  public getSessionCookies(): string[] {
    return this.sessionCookies;
  }

  /**
   * Get CSRF token for WebSocket connection.
   *
   * Extracted from .AspNetCore.Antiforgery.* cookie during login.
   *
   * @returns CSRF token or null if not available
   */
  public getCsrfToken(): string | null {
    return this.csrfToken;
  }

  /**
   * Check if authenticated.
   *
   * @returns true if authenticateWeb() completed successfully
   */
  public isAuthenticated(): boolean {
    return this.authenticated;
  }
}
