import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ConnectionRequest,
  UserSettings,
  MasterPage,
  BCConfig
} from '../../types.js';
import { logger } from '../../core/logger.js';

export type AuthHeaders = {
  Authorization: string;
};

export class BCClient {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string | number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private messageQueue: JsonRpcRequest[] = [];
  private connected = false;
  private authenticated = false;
  private config: BCConfig;
  private authHeaders: AuthHeaders | null = null;

  constructor(config: BCConfig) {
    this.config = config;
  }

  /**
   * Set authentication headers (OAuth Bearer token or Basic Auth)
   */
  setAuthHeaders(headers: AuthHeaders): void {
    this.authHeaders = headers;
  }

  /**
   * Set OAuth Bearer token for authentication
   */
  setAccessToken(token: string): void {
    this.authHeaders = {
      Authorization: `Bearer ${token}`
    };
  }

  /**
   * Set NavUserPassword Basic Auth credentials
   */
  setBasicAuth(username: string, password: string): void {
    const credentials = `${username}:${password}`;
    const encoded = Buffer.from(credentials, 'utf-8').toString('base64');
    this.authHeaders = {
      Authorization: `Basic ${encoded}`
    };
  }

  /**
   * Connect to Business Central WebSocket endpoint
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Construct WebSocket URL based on BC deployment
        const wsUrl = this.buildWebSocketUrl();
        logger.info(`Connecting to: ${wsUrl}`);

        this.ws = new WebSocket(wsUrl, {
          headers: this.authHeaders || {}
        });

        this.ws.on('open', () => {
          logger.info('WebSocket connection established');
          this.connected = true;

          // Process queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg) {
              this.ws?.send(JSON.stringify(msg));
            }
          }

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          logger.error({ error }, 'WebSocket error');
          reject(error);
        });

        this.ws.on('close', () => {
          logger.info('WebSocket connection closed');
          this.connected = false;
          this.authenticated = false;
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Build the WebSocket URL for BC
   */
  private buildWebSocketUrl(): string {
    // For BC Online: wss://businesscentral.dynamics.com/{tenant}/api/bc/v2.0
    // For BC On-Prem: ws://server:port/BC/ws/connect

    // This is a simplified version - actual BC WebSocket endpoint may differ
    // Based on decompiled code: WebSocketController.cs handles the endpoint at /ws/connect

    const { baseUrl, tenantId, environment } = this.config;

    // BC Online format
    if (baseUrl.includes('dynamics.com')) {
      return `wss://businesscentral.dynamics.com/${tenantId}/${environment}/ws/connect`;
    }

    // BC On-Prem format
    // Strip http:// or https:// prefix if present
    let cleanBaseUrl = baseUrl
      .replace(/^https?:\/\//, '')  // Remove http:// or https://
      .replace(/\/+$/, '');          // Remove trailing slashes

    // Determine protocol (use wss for https, ws for http)
    const protocol = baseUrl.startsWith('https://') ? 'wss' : 'ws';

    // From WebSocketController.cs, the route is [Route("ws")] with [Route("connect")]
    // So the full path is: /ws/connect
    return `${protocol}://${cleanBaseUrl}/ws/connect`;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const response: JsonRpcResponse = JSON.parse(data);

      // Find pending request
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(new Error(`JSON-RPC Error: ${response.error.message} (${response.error.code})`));
        } else {
          pending.resolve(response.result);
        }
      } else {
        logger.warn({ id: response.id }, 'Received response for unknown request ID');
      }
    } catch (error) {
      logger.error({ error }, 'Error parsing WebSocket message');
    }
  }

  /**
   * Send JSON-RPC request
   */
  private async sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        method,
        params,
        id
      };

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject });

      // Send or queue message
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(request));
      } else {
        this.messageQueue.push(request);
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Open connection to BC (IClientApi.OpenConnection)
   */
  async openConnection(): Promise<UserSettings> {
    const connectionRequest: ConnectionRequest = {
      clientType: 'WebClient',
      clientVersion: '24.0.0.0',
      clientCulture: 'en-US',
      clientTimeZone: 'UTC'
    };

    logger.info('Opening connection...');
    const result = await this.sendRequest('OpenConnection', connectionRequest);
    this.authenticated = true;
    return result as UserSettings;
  }

  /**
   * Open company (IClientApi.OpenCompany)
   */
  async openCompany(companyName?: string): Promise<void> {
    const company = companyName || this.config.companyName || '';
    logger.info(`Opening company: ${company || '(default)'}`);
    await this.sendRequest('OpenCompany', { companyName: company });
  }

  /**
   * Get master page metadata (IClientMetadataApi.GetMasterPage)
   */
  async getMasterPage(pageId: number): Promise<MasterPage> {
    logger.info(`Fetching metadata for page ${pageId}...`);
    const result = await this.sendRequest('GetMasterPage', { pageId });
    return result as MasterPage;
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      // Try to send CloseConnection if authenticated
      if (this.authenticated) {
        try {
          await this.sendRequest('CloseConnection', {});
        } catch (error) {
          logger.error({ error }, 'Error closing connection gracefully');
        }
      }

      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.authenticated = false;
    }
  }

  /**
   * Check if connected and authenticated
   */
  isReady(): boolean {
    return this.connected && this.authenticated;
  }
}
