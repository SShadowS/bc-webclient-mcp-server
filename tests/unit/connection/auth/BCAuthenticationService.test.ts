/**
 * Unit tests for BCAuthenticationService
 *
 * Tests the HTTP login flow, cookie management, and CSRF token extraction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BCAuthenticationService } from '@/connection/auth/BCAuthenticationService.js';
import type { BCConfig } from '@/types.js';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock cheerio
vi.mock('cheerio', () => ({
  load: vi.fn(),
}));

// Mock logger to suppress output during tests
vi.mock('@/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

describe('BCAuthenticationService', () => {
  let service: BCAuthenticationService;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLoad: ReturnType<typeof vi.fn>;

  const mockConfig: BCConfig = {
    baseUrl: 'http://localhost/BC',
  };

  beforeEach(() => {
    mockFetch = fetch as any;
    mockLoad = cheerio.load as any;

    service = new BCAuthenticationService({
      config: mockConfig,
      username: 'testuser',
      password: 'testpass',
      tenantId: 'default',
    });

    // Reset mocks
    mockFetch.mockReset();
    mockLoad.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(service).toBeDefined();
      expect(service.isAuthenticated()).toBe(false);
      expect(service.getSessionCookies()).toEqual([]);
      expect(service.getCsrfToken()).toBeNull();
    });

    it('should default tenantId to "default" if not provided', () => {
      const svc = new BCAuthenticationService({
        config: mockConfig,
        username: 'user',
        password: 'pass',
      });

      expect(svc).toBeDefined();
    });
  });

  describe('authenticateWeb', () => {
    it('should complete successful login flow', async () => {
      // Mock login page GET response
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({
            'set-cookie': ['SessionCookie1=value1; path=/'],
          }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="csrf-token-123"/></html>',
      };

      // Mock login POST response
      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': [
              'SessionCookie1=updated-value1; path=/',
              '.AspNetCore.Antiforgery.xyz=CfDJ8token123; path=/',
            ],
          }),
        },
      };

      // Mock cheerio parsing
      const mockCheerioElement = {
        val: () => 'csrf-token-123',
      };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      // Verify fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // First call: GET login page
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost/BC/SignIn?tenant=default',
        expect.objectContaining({
          redirect: 'manual',
        })
      );

      // Second call: POST credentials
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost/BC/SignIn?tenant=default',
        expect.objectContaining({
          method: 'POST',
        })
      );

      // Verify state
      expect(service.isAuthenticated()).toBe(true);
      expect(service.getSessionCookies()).toContain('SessionCookie1=updated-value1');
      expect(service.getSessionCookies()).toContain('.AspNetCore.Antiforgery.xyz=CfDJ8token123');
      expect(service.getCsrfToken()).toBe('CfDJ8token123');
    });

    it('should handle trailing slashes in baseUrl', async () => {
      const svc = new BCAuthenticationService({
        config: { baseUrl: 'http://localhost/BC///' },
        username: 'user',
        password: 'pass',
        tenantId: 'test',
      });

      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await svc.authenticateWeb();

      // Verify URL has no trailing slashes
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost/BC/SignIn?tenant=test',
        expect.any(Object)
      );
    });

    it('should throw AuthenticationError if CSRF token not found', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () => '<html><!-- No CSRF token --></html>',
      };

      const mockCheerioElement = {
        val: () => undefined, // No token
      };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockLoad.mockReturnValue(mock$);

      // Capture the promise to test it once
      let error: any;
      try {
        await service.authenticateWeb();
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.message).toContain('Could not find __RequestVerificationToken');
      expect(error.name).toBe('AuthenticationError');

      // Should not be authenticated
      expect(service.isAuthenticated()).toBe(false);
    });

    it('should throw AuthenticationError if login POST fails', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 401, // Unauthorized
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      // Capture the promise to test it once
      let error: any;
      try {
        await service.authenticateWeb();
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.message).toContain('Login failed with status 401');
      expect(error.name).toBe('AuthenticationError');
      expect(service.isAuthenticated()).toBe(false);
    });

    it('should update existing cookies from login response', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({
            'set-cookie': ['Cookie1=initial; path=/'],
          }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': [
              'Cookie1=updated; path=/', // Update existing
              'Cookie2=new; path=/',      // Add new
            ],
          }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      const cookies = service.getSessionCookies();

      // Should have updated Cookie1, not duplicated
      expect(cookies).toContain('Cookie1=updated');
      expect(cookies).toContain('Cookie2=new');
      expect(cookies.filter(c => c.startsWith('Cookie1=')).length).toBe(1);
    });

    it('should handle missing Antiforgery cookie gracefully', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': ['SomeCookie=value; path=/'], // No Antiforgery cookie
          }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      expect(service.isAuthenticated()).toBe(true);
      expect(service.getCsrfToken()).toBeNull();
    });

    it('should extract CSRF token from Antiforgery cookie with CfDJ8 prefix', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': ['.AspNetCore.Antiforgery.abc=CfDJ8mytoken; path=/'],
          }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      expect(service.getCsrfToken()).toBe('CfDJ8mytoken');
    });

    it('should not extract CSRF token from Antiforgery cookie without CfDJ8 prefix', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': ['.AspNetCore.Antiforgery.abc=invalidtoken; path=/'],
          }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      // Token should not be extracted (doesn't start with CfDJ8)
      expect(service.getCsrfToken()).toBeNull();
    });
  });

  describe('getSessionCookies', () => {
    it('should return empty array before authentication', () => {
      expect(service.getSessionCookies()).toEqual([]);
    });

    it('should return cookies after authentication', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({
            'set-cookie': ['Cookie1=value1; path=/'],
          }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': ['Cookie2=value2; path=/'],
          }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      const cookies = service.getSessionCookies();
      expect(cookies).toContain('Cookie1=value1');
      expect(cookies).toContain('Cookie2=value2');
    });
  });

  describe('getCsrfToken', () => {
    it('should return null before authentication', () => {
      expect(service.getCsrfToken()).toBeNull();
    });

    it('should return CSRF token after authentication', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({
            'set-cookie': ['.AspNetCore.Antiforgery.xyz=CfDJ8csrf123; path=/'],
          }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      expect(service.getCsrfToken()).toBe('CfDJ8csrf123');
    });
  });

  describe('isAuthenticated', () => {
    it('should return false before authentication', () => {
      expect(service.isAuthenticated()).toBe(false);
    });

    it('should return true after successful authentication', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 302,
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await service.authenticateWeb();

      expect(service.isAuthenticated()).toBe(true);
    });

    it('should remain false after failed authentication', async () => {
      const mockLoginPageResponse = {
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
        text: async () =>
          '<html><input name="__RequestVerificationToken" value="token"/></html>',
      };

      const mockLoginPostResponse = {
        status: 401, // Failed
        headers: {
          raw: () => ({ 'set-cookie': [] }),
        },
      };

      const mockCheerioElement = { val: () => 'token' };
      const mock$ = vi.fn(() => mockCheerioElement);

      mockFetch.mockResolvedValueOnce(mockLoginPageResponse as any);
      mockFetch.mockResolvedValueOnce(mockLoginPostResponse as any);
      mockLoad.mockReturnValue(mock$);

      await expect(service.authenticateWeb()).rejects.toThrow();

      expect(service.isAuthenticated()).toBe(false);
    });
  });
});
