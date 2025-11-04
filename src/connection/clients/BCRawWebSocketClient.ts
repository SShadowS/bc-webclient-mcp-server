import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { gunzipSync } from 'zlib';
import { logger } from '../../core/logger.js';
import { composeWithTimeout, isTimeoutAbortReason } from '../../core/abort.js';
import { defaultTimeouts, type TimeoutsConfig } from '../../core/timeouts.js';
import {
  TimeoutError,
  AbortedError,
  ConnectionError,
  AuthenticationError,
} from '../../core/errors.js';
import type {
  ConnectionRequest,
  UserSettings,
  MasterPage,
  BCConfig,
  JsonRpcRequest,
  JsonRpcResponse
} from '../../types.js';

/**
 * Raw WebSocket Client for Business Central
 *
 * Uses session-based authentication (cookies + CSRF token) and
 * sends JSON-RPC messages directly over WebSocket (no SignalR Hub protocol)
 */
export class BCRawWebSocketClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private authenticated = false;
  private config: BCConfig;
  private sessionCookies: string[] = [];
  private csrfToken: string | null = null;
  private username: string;
  private password: string;
  private tenantId: string;
  private timeouts: TimeoutsConfig;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();
  private serverSessionId: string | null = null;
  private sessionKey: string | null = null;
  private companyName: string | null = null;

  // Session state tracking (required for Tell Me and other features)
  private clientSequenceCounter = 0;
  private lastServerSequence = -1;
  private openFormIds: string[] = [];
  private spaInstanceId = `poc${Date.now()}`;

  // Event listeners for handler arrays (allows waiting for async BC responses)
  private handlerListeners: Array<(handlers: any[]) => void> = [];

  // Filter field metadata cache (per formId)
  // Maps: formId -> (caption -> canonical field ID)
  private filterMetadataCache = new Map<string, Map<string, string>>();

  constructor(
    config: BCConfig,
    username: string,
    password: string,
    tenantId: string = '',
    timeouts?: Partial<TimeoutsConfig>
  ) {
    this.config = config;
    this.username = username;
    this.password = password;
    this.tenantId = tenantId;
    this.timeouts = { ...defaultTimeouts, ...(timeouts ?? {}) };
  }

  /**
   * Get the server session ID (for use with Copilot API)
   */
  getServerSessionId(): string | null {
    return this.serverSessionId;
  }

  /**
   * Get the company name from the current session
   */
  getCompanyName(): string | null {
    return this.companyName;
  }

  /**
   * Get the tenant ID
   */
  getTenantId(): string {
    return this.tenantId || 'default';
  }

  /**
   * Step 1: Authenticate via web login to get session cookies and CSRF token
   */
  async authenticateWeb(): Promise<void> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const tenant = this.tenantId || 'default';

    logger.info('Authenticating via web login...');
    logger.info(`  URL: ${baseUrl}/?tenant=${tenant}`);
    logger.info(`  User: ${this.tenantId ? `${this.tenantId}\\${this.username}` : this.username}`);

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
      throw new Error('Could not find __RequestVerificationToken in login page');
    }

    logger.info('  ✓ Got CSRF token from login page');

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
      throw new Error(`Login failed with status ${loginResponse.status}`);
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

    logger.info('  ✓ Login successful');

    // Extract CSRF token from Antiforgery cookie
    const antiforgCookie = this.sessionCookies.find(c => c.startsWith('.AspNetCore.Antiforgery.'));
    if (antiforgCookie) {
      const tokenValue = antiforgCookie.split('=')[1];
      if (tokenValue && tokenValue.startsWith('CfDJ8')) {
        this.csrfToken = tokenValue;
        logger.info(`  ✓ Extracted CSRF token from Antiforgery cookie`);
      }
    }

    this.authenticated = true;
    logger.info('✓ Web authentication complete\n');
  }

  /**
   * Step 2: Connect to WebSocket with session cookies
   *
   * @param options Optional cancellation signal and timeout override
   * @param options.signal Optional AbortSignal for external cancellation
   * @param options.timeoutMs Optional timeout override (default: 10s from config)
   */
  async connect(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
    if (!this.authenticated) {
      throw new AuthenticationError('Must call authenticateWeb() first');
    }

    const fullBaseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const baseUrl = fullBaseUrl.replace(/^https?:\/\//, '');

    // Use wss:// for HTTPS, ws:// for HTTP
    const scheme = fullBaseUrl.startsWith('https://') ? 'wss' : 'ws';

    // Build WebSocket URL with query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('ackseqnb', '-1');
    if (this.csrfToken) {
      queryParams.set('csrftoken', this.csrfToken);
    }

    const wsUrl = `${scheme}://${baseUrl}/csh?${queryParams.toString()}`;

    logger.info(`Connecting to WebSocket: ${wsUrl.substring(0, 100)}...`);

    // Compose timeout with optional parent signal
    const timeoutMs = options?.timeoutMs ?? this.timeouts.connectTimeoutMs;
    const signal = composeWithTimeout(options?.signal, timeoutMs);

    // Create WebSocket with cookies in headers
    const cookieString = this.sessionCookies.join('; ');

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      let settled = false;

      // Helper to ensure single resolution
      const settle = (fn: () => void): boolean => {
        if (settled) return true;
        settled = true;
        fn();
        return false;
      };

      // Event handlers
      const onOpen = () => {
        if (settle(() => {
          this.connected = true;
          this.ws = ws;
        })) return;
        cleanup();
        logger.info('✓ Raw WebSocket connection established');
        resolve();
      };

      const onError = (error: Error) => {
        if (settle(() => { this.connected = false; })) return;
        cleanup();
        logger.error({ error }, 'WebSocket error');
        reject(new ConnectionError('WebSocket connection failed', { error }));
      };

      const onAbort = () => {
        if (settle(() => { this.connected = false; })) return;
        // Close before cleanup to keep error listener active during teardown
        ws.close();
        cleanup();

        // Distinguish timeout from external cancellation
        if (isTimeoutAbortReason(signal.reason)) {
          reject(new TimeoutError(
            `WebSocket connection timeout after ${timeoutMs}ms`,
            { timeoutMs }
          ));
        } else {
          reject(new AbortedError(
            'WebSocket connection cancelled',
            { reason: signal.reason }
          ));
        }
      };

      // Cleanup function to remove all listeners
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
      };

      // Handle already-aborted signal before registering listeners
      if (signal.aborted) {
        onAbort();
        return;
      }

      // Register event listeners
      signal.addEventListener('abort', onAbort, { once: true });
      ws.once('open', onOpen);
      ws.once('error', onError);

      // Set up message handler (persists after connection)
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = data.toString();
          logger.info(`← Received: ${message.substring(0, 200)}...`);

          const response = JSON.parse(message) as any;

          // Track server Message sequence numbers
          if (response.method === 'Message' && response.params?.[0]?.sequenceNumber !== undefined) {
            const serverSeq = response.params[0].sequenceNumber;
            if (serverSeq > this.lastServerSequence) {
              this.lastServerSequence = serverSeq;
              logger.info(`  → Server sequence: ${serverSeq}`);
            }
          }

          // Handle compressed result
          if (response.compressedResult) {
            logger.info('  Decompressing gzip response...');

            // Base64 decode
            const compressed = Buffer.from(response.compressedResult, 'base64');

            // Gunzip decompress
            const decompressed = gunzipSync(compressed);
            const decompressedJson = decompressed.toString('utf-8');

            logger.info(`  ✓ Decompressed: ${decompressedJson.substring(0, 200)}...`);

            // Parse decompressed JSON as the actual response
            const actualResponse = JSON.parse(decompressedJson);

            // Emit to all handler listeners (for event-driven waits)
            // Do this BEFORE resolving pending request to ensure listeners can process it
            if (Array.isArray(actualResponse)) {
              this.handlerListeners.forEach(listener => {
                try {
                  listener(actualResponse);
                } catch (error) {
                  logger.error({ error }, 'Handler listener error');
                }
              });
            }

            // BC returns array of handlers, not standard JSON-RPC
            // Find any pending request and resolve with the handler array
            if (this.pendingRequests.size > 0) {
              const [[requestId, pending]] = this.pendingRequests.entries();
              this.pendingRequests.delete(requestId);
              pending.resolve(actualResponse);
            }
          }
          // Handle uncompressed JSON-RPC response
          else if (response.jsonrpc) {
            const pending = this.pendingRequests.get(response.id);

            if (pending) {
              this.pendingRequests.delete(response.id);

              if (response.error) {
                pending.reject(new Error(`RPC Error: ${response.error.message}`));
              } else {
                pending.resolve(response.result);
              }
            }
          }
        } catch (error) {
          logger.error({ error }, 'Error parsing message');
        }
      });

      // Set up close handler (persists after connection)
      ws.on('close', (code, reason) => {
        logger.info(`WebSocket closed: ${code} ${reason.toString()}`);
        this.connected = false;

        // Reject all pending requests
        this.pendingRequests.forEach(pending => {
          pending.reject(new Error('WebSocket closed'));
        });
        this.pendingRequests.clear();
      });
    });
  }

  /**
   * Send JSON-RPC request and wait for response
   *
   * @param method RPC method name
   * @param params RPC parameters
   * @param options Optional cancellation signal and timeout
   */
  private async sendRpcRequest(
    method: string,
    params: any[],
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<any> {
    if (!this.ws || !this.connected) {
      throw new ConnectionError('Not connected. Call connect() first.');
    }

    const requestId = uuidv4();
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: requestId
    };

    // Compose timeout with optional parent signal
    const timeoutMs = options?.timeoutMs ?? this.timeouts.rpcTimeoutMs;
    const signal = composeWithTimeout(options?.signal, timeoutMs);

    return new Promise((resolve, reject) => {
      // Event handlers
      const onAbort = () => {
        cleanup();
        this.pendingRequests.delete(requestId);

        // Distinguish timeout from external cancellation
        if (isTimeoutAbortReason(signal.reason)) {
          reject(new TimeoutError(
            `RPC request timeout after ${timeoutMs}ms: ${method}`,
            { method, timeoutMs }
          ));
        } else {
          reject(new AbortedError(
            `RPC request cancelled: ${method}`,
            { method, reason: signal.reason }
          ));
        }
      };

      // Cleanup function
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      // Handle already-aborted signal before registering listener
      if (signal.aborted) {
        onAbort();
        return;
      }

      // Register abort listener
      signal.addEventListener('abort', onAbort, { once: true });

      // Store pending request (will be resolved by message handler)
      this.pendingRequests.set(requestId, {
        resolve: (value: any) => {
          cleanup();
          resolve(value);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        }
      });

      // Send request
      const message = JSON.stringify(rpcRequest);
      logger.info(`→ Sending: ${message.substring(0, 200)}...`);

      this.ws!.send(message, (error) => {
        if (error) {
          cleanup();
          this.pendingRequests.delete(requestId);
          reject(new ConnectionError('Failed to send RPC request', { method, error }));
        }
      });
    });
  }

  /**
   * Open BC session
   */
  async openSession(connectionRequest: ConnectionRequest): Promise<UserSettings> {
    logger.info('Opening BC session...');

    // Build OpenSession request matching browser format
    const now = new Date();
    const dstStart = new Date(now.getFullYear(), 2, 31); // Last Sunday of March
    dstStart.setDate(dstStart.getDate() - dstStart.getDay());
    const dstEnd = new Date(now.getFullYear(), 9, 31); // Last Sunday of October
    dstEnd.setDate(dstEnd.getDate() - dstEnd.getDay());

    const sessionId = uuidv4();

    const result = await this.sendRpcRequest('OpenSession', [
      {
        openFormIds: [],
        sessionId: '',
        sequenceNo: null,
        lastClientAckSequenceNumber: -1,
        telemetryClientActivityId: null,
        telemetryTraceStartInfo: 'traceStartInfo=%5BWeb%20Client%20-%20Web%20browser%5D%20OpenForm',
        navigationContext: {
          applicationId: 'FIN',
          deviceCategory: 0,
          spaInstanceId: sessionId.substring(0, 8)
        },
        supportedExtensions: JSON.stringify([
          { Name: 'Microsoft.Dynamics.Nav.Client.PageNotifier' },
          { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.Tour' },
          { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.UserTours' },
          { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.AppSource' },
          { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.Designer' }
        ]),
        interactionsToInvoke: [
          {
            interactionName: 'OpenForm',
            skipExtendingSessionLifetime: false,
            namedParameters: `{"query":"tenant=${this.tenantId || 'default'}&startTraceId=${sessionId}&tid=undefined&runinframe=1"}`,
            callbackId: '0'
          }
        ],
        tenantId: this.tenantId || 'default',
        company: null,
        telemetryClientSessionId: sessionId,
        features: [
          'QueueInteractions',
          'MetadataCache',
          'CacheSession',
          'DynamicsQuickEntry',
          'Multitasking',
          'MultilineEdit',
          'SaveValueToDatabasePromptly',
          'CalcOnlyVisibleFlowFields'
        ],
        profile: '',
        rememberCompany: false,
        timeZoneInformation: {
          timeZoneBaseOffset: -new Date().getTimezoneOffset(),
          dstOffset: 60,
          dstPeriodStart: dstStart.toISOString(),
          dstPeriodEnd: dstEnd.toISOString()
        },
        profileDescription: {
          Id: null,
          Caption: null,
          Description: null
        },
        disableResponseSequencing: true
      }
    ]);

    logger.info(`✓ Received ${Array.isArray(result) ? result.length : 0} handler(s)`);

    // Save full response to file for analysis
    const fs = await import('fs');
    await fs.promises.writeFile('opensession-response.json', JSON.stringify(result, null, 2));
    logger.info(`  (Saved full response to opensession-response.json)`);

    // Extract session info from the handler array
    // BC returns an array of handlers with nested parameters
    let sessionInfo: any = {};

    if (Array.isArray(result) && result.length > 0) {
      // Try to find session-related data in the handler parameters
      const handlers = result;
      logger.info(`  Handler types: ${handlers.map((h: any) => h.handlerType).join(', ')}`);

      // Look for session information in handler parameters
      for (const handler of handlers) {
        if (handler.parameters && Array.isArray(handler.parameters)) {
          // Recursively search for session data
          const searchParams = (params: any): any => {
            if (Array.isArray(params)) {
              for (const item of params) {
                const found = searchParams(item);
                if (found) return found;
              }
            } else if (params && typeof params === 'object') {
              // Store session identifiers
              if (params.ServerSessionId) {
                this.serverSessionId = params.ServerSessionId;
              }
              if (params.SessionKey) {
                this.sessionKey = params.SessionKey;
              }
              if (params.CompanyName) {
                this.companyName = params.CompanyName;
              }

              if (params.userId || params.userName || params.CompanyName) {
                return params;
              }
              for (const value of Object.values(params)) {
                const found = searchParams(value);
                if (found) return found;
              }
            }
            return null;
          };

          const found = searchParams(handler.parameters);
          if (found) {
            sessionInfo = found;
          }
        }
      }

      logger.info(`  Session ID: ${this.serverSessionId?.substring(0, 40)}...`);
      logger.info(`  Session Key: ${this.sessionKey}`);
      logger.info(`  Company: ${this.companyName}`);
    }

    return {
      workDate: sessionInfo.workDate || '',
      culture: sessionInfo.culture || connectionRequest.clientCulture,
      timeZone: sessionInfo.timeZone || connectionRequest.clientTimeZone,
      language: sessionInfo.language || 0,
      userId: sessionInfo.userId || 'unknown',
      userName: sessionInfo.userName || 'Unknown User',
      companyName: sessionInfo.companyName || 'Unknown Company'
    } as UserSettings;
  }

  /**
   * Invoke BC action (generic method for any BC interaction)
   *
   * @param options Interaction parameters
   * @param options.interactionName Name of BC interaction (e.g., 'OpenForm', 'SaveValue')
   * @param options.namedParameters Parameters for the interaction
   * @param options.controlPath Optional control path for the interaction
   * @param options.formId Optional form ID
   * @param options.systemAction Optional system action code
   * @param options.openFormIds Optional list of open form IDs (defaults to tracked forms)
   * @param options.sequenceNo Optional sequence number (defaults to auto-increment)
   * @param options.lastClientAckSequenceNumber Optional last ack sequence number
   * @param options.signal Optional AbortSignal for cancellation
   * @param options.timeoutMs Optional timeout override (default: 30s from config)
   */
  async invoke(options: {
    interactionName: string;
    namedParameters: string | object;
    controlPath?: string;
    formId?: string;
    systemAction?: number;
    openFormIds?: string[];
    sequenceNo?: string;
    lastClientAckSequenceNumber?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<any> {
    if (!this.serverSessionId || !this.sessionKey || !this.companyName) {
      throw new ConnectionError('Session not initialized. Call openSession() first.');
    }

    logger.info(`Invoking action: ${options.interactionName}...`);

    // Convert namedParameters to string if it's an object
    const namedParamsStr = typeof options.namedParameters === 'string'
      ? options.namedParameters
      : JSON.stringify(options.namedParameters);

    // Increment client sequence counter
    this.clientSequenceCounter++;
    const sequenceNo = `${this.spaInstanceId}#${this.clientSequenceCounter}`;

    // Use tracked open forms or provided ones
    const openFormIds = options.openFormIds !== undefined
      ? options.openFormIds
      : this.openFormIds;

    const invokeParams = {
      openFormIds,
      sessionId: this.serverSessionId,
      sequenceNo,
      lastClientAckSequenceNumber: this.lastServerSequence,
      telemetryClientActivityId: null,
      telemetryTraceStartInfo: `traceStartInfo=%5BWeb%20Client%20-%20Web%20browser%5D%20${options.interactionName}`,
      navigationContext: {
        applicationId: 'FIN',
        deviceCategory: 0,
        spaInstanceId: uuidv4().substring(0, 8)
      },
      supportedExtensions: null,
      interactionsToInvoke: [
        {
          interactionName: options.interactionName,
          skipExtendingSessionLifetime: false,
          namedParameters: namedParamsStr,
          controlPath: options.controlPath || undefined,
          formId: options.formId || undefined,
          callbackId: '0'
        }
      ],
      tenantId: this.tenantId || 'default',
      sessionKey: this.sessionKey,
      company: this.companyName,
      telemetryClientSessionId: uuidv4()
    };

    const result = await this.sendRpcRequest('Invoke', [invokeParams], {
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });

    logger.info(`✓ Received ${Array.isArray(result) ? result.length : 0} handler(s) in response`);

    return result;
  }

  /**
   * Get master page metadata
   */
  async getMasterPage(pageId: number): Promise<MasterPage> {
    logger.info(`Fetching metadata for page ${pageId}...`);

    const result = await this.sendRpcRequest('GetMasterPage', [{ pageId: pageId }]);

    return result as MasterPage;
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.authenticated = false;
      logger.info('✓ WebSocket connection closed');
    }
  }

  /**
   * Check if ready
   */
  isReady(): boolean {
    return this.connected && this.authenticated;
  }

  /**
   * Register a listener for handler arrays.
   * Returns an unsubscribe function.
   *
   * Use this to wait for async BC responses (e.g., Tell Me dialog appearing after invoke).
   */
  public onHandlers(listener: (handlers: any[]) => void): () => void {
    this.handlerListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.handlerListeners.indexOf(listener);
      if (index !== -1) {
        this.handlerListeners.splice(index, 1);
      }
    };
  }

  /**
   * Wait for a handler array that matches the predicate.
   *
   * @param predicate Function that returns {matched: true, data: T} when the handler array matches
   * @param options Optional timeout and cancellation signal
   * @param options.timeoutMs Maximum time to wait (default: 2500ms from config)
   * @param options.signal Optional AbortSignal for external cancellation
   * @returns Promise that resolves with the matched data or rejects on timeout/abort
   *
   * Example:
   * ```ts
   * const formId = await client.waitForHandlers(
   *   (handlers) => {
   *     const h = handlers.find(h => h.handlerType === 'DN.LogicalClientEventRaisingHandler');
   *     return h ? { matched: true, data: h.parameters[1].ServerId } : { matched: false };
   *   },
   *   { timeoutMs: 2500 }
   * );
   * ```
   */
  public async waitForHandlers<T>(
    predicate: (handlers: any[]) => { matched: boolean; data?: T },
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? this.timeouts.handlerWaitTimeoutMs;
    const parentSignal = options?.signal;

    // Compose timeout with optional parent signal
    const signal = composeWithTimeout(parentSignal, timeoutMs);

    return new Promise<T>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;

      // Event handlers
      const onAbort = () => {
        cleanup();

        // Distinguish timeout from external cancellation
        if (isTimeoutAbortReason(signal.reason)) {
          reject(new TimeoutError(
            `waitForHandlers timeout after ${timeoutMs}ms`,
            { timeoutMs }
          ));
        } else {
          reject(new AbortedError(
            'waitForHandlers cancelled',
            { reason: signal.reason }
          ));
        }
      };

      // Cleanup function
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        if (unsubscribe) unsubscribe();
      };

      // Handle already-aborted signal before registering listener
      if (signal.aborted) {
        onAbort();
        return;
      }

      // Register abort listener
      signal.addEventListener('abort', onAbort, { once: true });

      // Listen for handlers
      unsubscribe = this.onHandlers((handlers) => {
        try {
          const result = predicate(handlers);
          if (result.matched) {
            cleanup();
            resolve(result.data!);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    });
  }

  /**
   * Extract filter field metadata from handler response
   *
   * Recursively searches for objects containing filter field definitions
   * with canonical IDs (e.g., "18_Customer.2") and captions (e.g., "Name")
   */
  private extractFilterMetadata(obj: any, results: Array<{id: string, caption: string}> = []): Array<{id: string, caption: string}> {
    if (!obj || typeof obj !== 'object') return results;

    // Look for objects with Id and Caption matching canonical field format
    if (obj.Id && obj.Caption && typeof obj.Id === 'string' && obj.Id.match(/^\d+_\w+\.\d+/)) {
      results.push({
        id: obj.Id,
        caption: obj.Caption
      });
    }

    // Also look for ColumnBinderPath (alternative location for canonical IDs)
    if (obj.ColumnBinderPath && typeof obj.ColumnBinderPath === 'string' &&
        obj.ColumnBinderPath.match(/^\d+_\w+\.\d+/)) {
      const caption = obj.Caption || obj.FieldName || obj.ColumnBinderPath;
      results.push({
        id: obj.ColumnBinderPath,
        caption: caption
      });
    }

    // Recursively search nested objects and arrays
    for (const value of Object.values(obj)) {
      if (typeof value === 'object' && value !== null) {
        this.extractFilterMetadata(value, results);
      }
    }

    return results;
  }

  /**
   * Parse handler response and cache filter field metadata for a form
   *
   * This should be called after receiving a LoadForm response or similar
   * handler containing page metadata.
   *
   * @param formId The form ID to cache metadata for
   * @param handlers Handler array from BC response
   * @returns Number of filterable fields found
   */
  public cacheFilterMetadata(formId: string, handlers: any[]): number {
    const fields = this.extractFilterMetadata(handlers);

    // Build caption → canonical ID mapping
    const mapping = new Map<string, string>();
    const seen = new Set<string>();

    for (const field of fields) {
      const key = `${field.caption}:${field.id}`;

      // Skip duplicates
      if (seen.has(key)) continue;
      seen.add(key);

      // Store mapping (later entries with same caption will override)
      mapping.set(field.caption, field.id);
    }

    // Cache for this form
    this.filterMetadataCache.set(formId, mapping);

    logger.info(`  Filter metadata cached for form ${formId}: ${mapping.size} fields`);
    return mapping.size;
  }

  /**
   * Resolve column caption to canonical field ID for filtering
   *
   * @param formId The form ID where the filter will be applied
   * @param caption The user-friendly column name (e.g., "Name", "Balance")
   * @returns Canonical field ID (e.g., "18_Customer.2") or null if not found
   *
   * @throws Error if metadata not cached for this form
   */
  public resolveFilterFieldId(formId: string, caption: string): string | null {
    const mapping = this.filterMetadataCache.get(formId);

    if (!mapping) {
      throw new Error(
        `Filter metadata not cached for form ${formId}. ` +
        `Call cacheFilterMetadata() after receiving LoadForm response.`
      );
    }

    return mapping.get(caption) || null;
  }

  /**
   * Get all available filter captions for a form
   *
   * @param formId The form ID
   * @returns Array of available column captions, or null if metadata not cached
   */
  public getAvailableFilterCaptions(formId: string): string[] | null {
    const mapping = this.filterMetadataCache.get(formId);
    return mapping ? Array.from(mapping.keys()) : null;
  }

  /**
   * Apply a filter to a list/repeater control
   *
   * This method sends the Filter interaction to BC which activates the filter pane
   * for the specified column. The user would then typically follow with a SaveValue
   * interaction to set the filter value.
   *
   * @param formId The form ID containing the list
   * @param listControlPath Control path to the list/repeater (e.g., "server:c[2]")
   * @param columnCaption User-friendly column name (e.g., "Name", "Balance")
   * @param filterValue Value to filter by (e.g., "Adatum", "1000") - optional for now
   *
   * @returns BC response handlers
   *
   * @throws Error if metadata not cached or column not found
   *
   * @example
   * ```ts
   * // After opening a list page and caching metadata:
   * await client.applyFilter('680', 'server:c[2]', 'Name', 'Adatum');
   * ```
   */
  public async applyFilter(
    formId: string,
    listControlPath: string,
    columnCaption: string,
    filterValue?: string
  ): Promise<any> {
    // Resolve caption to canonical field ID
    const fieldId = this.resolveFilterFieldId(formId, columnCaption);

    if (!fieldId) {
      throw new Error(
        `Column "${columnCaption}" not found in form ${formId} metadata. ` +
        `Available columns: ${this.getAvailableFilterCaptions(formId)?.join(', ')}`
      );
    }

    logger.info(`Applying filter: "${columnCaption}" (${fieldId}) = "${filterValue || '(none)'}"`);

    // Step 1: Send Filter interaction to activate filter pane
    const filterResult = await this.invoke({
      interactionName: 'Filter',
      namedParameters: {
        filterOperation: 1, // 1 = set filter
        filterColumnId: fieldId
      },
      controlPath: listControlPath,
      formId
    });

    logger.info(`  Filter interaction sent, received ${Array.isArray(filterResult) ? filterResult.length : 0} handlers`);

    // Step 2: Send SaveValue to set filter value (if provided)
    if (filterValue) {
      // Based on captured data, the filter input control path follows the pattern:
      // List control: server:c[2]
      // Filter input: server:c[2]/c[2]/c[1]
      const filterInputPath = `${listControlPath}/c[2]/c[1]`;

      logger.info(`  Setting filter value "${filterValue}" at ${filterInputPath}...`);

      const saveValueResult = await this.invoke({
        interactionName: 'SaveValue',
        namedParameters: {
          key: null,
          newValue: filterValue,
          alwaysCommitChange: true,
          ignoreForSavingState: true,
          notifyBusy: 1,
          telemetry: {
            'Control name': columnCaption,
            'QueuedTime': new Date().toISOString()
          }
        },
        controlPath: filterInputPath,
        formId
      });

      logger.info(`  ✓ Filter value set, received ${Array.isArray(saveValueResult) ? saveValueResult.length : 0} handlers`);

      return saveValueResult;
    }

    return filterResult;
  }
}
