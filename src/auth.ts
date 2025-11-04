import * as msal from '@azure/msal-node';
import type { BCConfig } from './types.js';
import { logger } from './core/logger.js';

/**
 * Azure AD Authentication using Device Code Flow
 * This is ideal for CLI/headless scenarios
 */
export class BCAuth {
  private msalClient: msal.PublicClientApplication;
  private config: BCConfig;

  constructor(config: BCConfig) {
    this.config = config;

    const msalConfig: msal.Configuration = {
      auth: {
        clientId: config.azureClientId,
        authority: config.azureAuthority,
      },
      system: {
        loggerOptions: {
          loggerCallback(loglevel, message, containsPii) {
            if (!containsPii) {
              logger.info(message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: msal.LogLevel.Warning,
        }
      }
    };

    this.msalClient = new msal.PublicClientApplication(msalConfig);
  }

  /**
   * Authenticate using Device Code Flow
   * User will be prompted to visit a URL and enter a code
   */
  async authenticateDeviceCode(): Promise<string> {
    const deviceCodeRequest: msal.DeviceCodeRequest = {
      deviceCodeCallback: (response) => {
        logger.info('\n========================================');
        logger.info('AUTHENTICATION REQUIRED');
        logger.info('========================================');
        logger.info(response.message);
        logger.info('========================================\n');
      },
      scopes: this.getScopes()
    };

    try {
      const response = await this.msalClient.acquireTokenByDeviceCode(deviceCodeRequest);

      if (!response?.accessToken) {
        throw new Error('No access token received');
      }

      logger.info('✓ Authentication successful');
      logger.info(`  User: ${response.account?.username || 'Unknown'}`);
      logger.info(`  Token expires: ${response.expiresOn?.toLocaleString() || 'Unknown'}\n`);

      return response.accessToken;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Authentication failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Authenticate using Username/Password (if allowed by tenant)
   * Note: This requires special Azure AD configuration and is less secure
   */
  async authenticateUsernamePassword(username: string, password: string): Promise<string> {
    const usernamePasswordRequest: msal.UsernamePasswordRequest = {
      scopes: this.getScopes(),
      username,
      password,
    };

    try {
      const response = await this.msalClient.acquireTokenByUsernamePassword(usernamePasswordRequest);

      if (!response?.accessToken) {
        throw new Error('No access token received');
      }

      logger.info('✓ Authentication successful');
      return response.accessToken;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Authentication failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get required OAuth scopes for Business Central
   */
  private getScopes(): string[] {
    // Standard BC API scopes
    // For BC Online, the resource is typically:
    // https://api.businesscentral.dynamics.com/.default
    // or specific scopes like:
    // https://api.businesscentral.dynamics.com/Financials.ReadWrite.All

    return [
      'https://api.businesscentral.dynamics.com/.default'
    ];
  }

  /**
   * Try silent token acquisition (if cached)
   */
  async acquireTokenSilent(): Promise<string | null> {
    try {
      const cache = this.msalClient.getTokenCache();
      const accounts = await cache.getAllAccounts();

      if (accounts.length === 0) {
        return null;
      }

      const silentRequest: msal.SilentFlowRequest = {
        account: accounts[0],
        scopes: this.getScopes(),
      };

      const response = await this.msalClient.acquireTokenSilent(silentRequest);
      return response?.accessToken || null;
    } catch (error) {
      return null;
    }
  }
}
