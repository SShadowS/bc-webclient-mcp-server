/**
 * BC Raw WebSocket Client (Week 2 Refactored)
 *
 * This is the transitional state after Week 2 refactoring:
 * ✅ Uses BCAuthenticationService (extracted)
 * ✅ Uses BCHandlerEventEmitter (extracted)
 * ✅ Uses BCProtocolAdapter (extracted)
 * ⏳ Still contains WebSocket management (Week 3 will extract)
 * ⏳ Still contains session management (Week 4 will extract)
 * ⏳ Still contains filter cache (Week 4 will extract)
 *
 * After Week 4, this will become a thin facade (< 200 lines).
 */

import { v4 as uuidv4 } from 'uuid';
import { gunzipSync } from 'zlib';
import { logger } from '../../core/logger.js';
import { defaultTimeouts, type TimeoutsConfig } from '../../core/timeouts.js';
import type {
  ConnectionRequest,
  UserSettings,
  MasterPage,
  BCConfig,
} from '../../types.js';

// Week 2-3: Import extracted services
import { BCAuthenticationService } from '../auth/BCAuthenticationService.js';
import { BCHandlerEventEmitter } from '../events/BCHandlerEventEmitter.js';
import { BCProtocolAdapter } from '../protocol/BCProtocolAdapter.js';
import { BCWebSocketManager } from '../websocket/BCWebSocketManager.js';
import type { HandlerEvent, BCHandler } from '../interfaces.js';

/**
 * BC Raw WebSocket Client
 *
 * Week 3 refactored version - delegates WebSocket management too.
 * - Week 2: Extracted auth, events, protocol ✅
 * - Week 3: Extracted WebSocket management ✅
 * - Week 4: Will extract session & filter cache
 */
export class BCRawWebSocketClient {
  // Extracted services (Week 2-3)
  private readonly authService: BCAuthenticationService;
  private readonly eventEmitter: BCHandlerEventEmitter;
  private readonly wsManager: BCWebSocketManager;
  private protocolAdapter: BCProtocolAdapter | null = null;

  // Config
  private config: BCConfig;
  private timeouts: TimeoutsConfig;

  // Session state (Week 4 will extract to BCSessionManager)
  private serverSessionId: string | null = null;
  private sessionKey: string | null = null;
  private companyName: string | null = null;
  private roleCenterFormId: string | null = null;
  private clientSequenceCounter = 0;
  private openFormIds: string[] = [];
  private spaInstanceId = `poc${Date.now()}`;

  // Filter metadata cache (Week 4 will extract to BCFilterMetadataCache)
  private filterMetadataCache = new Map<string, Map<string, string>>();

  constructor(
    config: BCConfig,
    username: string,
    password: string,
    tenantId: string = '',
    timeouts?: Partial<TimeoutsConfig>
  ) {
    this.config = config;
    this.timeouts = { ...defaultTimeouts, ...(timeouts ?? {}) };

    // Create extracted services
    this.authService = new BCAuthenticationService({
      config,
      username,
      password,
      tenantId,
    });
    this.eventEmitter = new BCHandlerEventEmitter();
    this.wsManager = new BCWebSocketManager(config, this.authService, this.timeouts);
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
    return this.authService.isAuthenticated()
      ? this.config.baseUrl.includes('tenant=')
        ? new URL(this.config.baseUrl).searchParams.get('tenant') || 'default'
        : 'default'
      : 'default';
  }

  /**
   * Get the role center form ID (for use with InvokeSessionAction)
   */
  getRoleCenterFormId(): string | null {
    return this.roleCenterFormId;
  }

  /**
   * Step 1: Authenticate via web login
   *
   * Delegates to BCAuthenticationService
   */
  async authenticateWeb(): Promise<void> {
    await this.authService.authenticateWeb();
  }

  /**
   * Step 2: Connect to WebSocket with session cookies
   *
   * Week 3: Delegates to BCWebSocketManager
   */
  async connect(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void> {
    // Delegate connection to WebSocket manager
    await this.wsManager.connect(options);

    // Start protocol adapter after connection
    this.protocolAdapter = new BCProtocolAdapter(
      this.wsManager,
      this.eventEmitter
    );
    this.protocolAdapter.start();
  }

  /**
   * Check if client is ready (authenticated + connected)
   */
  isReady(): boolean {
    return this.authService.isAuthenticated() && this.wsManager.isConnected();
  }

  /**
   * Disconnect WebSocket
   *
   * Week 3: Delegates to BCWebSocketManager
   */
  async disconnect(): Promise<void> {
    if (this.protocolAdapter) {
      this.protocolAdapter.stop();
      this.protocolAdapter = null;
    }

    await this.wsManager.disconnect();
  }

  /**
   * Subscribe to handler events
   *
   * Delegates to BCHandlerEventEmitter
   */
  public onHandlers(listener: (handlers: any[]) => void): () => void {
    return this.eventEmitter.onHandlers((event) => {
      // For backward compatibility, extract raw handlers
      if (event.kind === 'RawHandlers') {
        listener(event.handlers);
      }
    });
  }

  /**
   * Wait for handlers that match a predicate
   *
   * Delegates to BCHandlerEventEmitter
   */
  public async waitForHandlers<T>(
    predicate: (handlers: any[]) => { matched: boolean; data?: T },
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<T> {
    return this.eventEmitter.waitForHandlers((event) => {
      if (event.kind === 'RawHandlers') {
        return predicate(event.handlers);
      }
      return { matched: false };
    }, options);
  }

  /**
   * Send JSON-RPC request and wait for response
   *
   * Week 3: Delegates to BCWebSocketManager
   */
  private async sendRpcRequest(
    method: string,
    params: any[],
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<any> {
    return this.wsManager.sendRpcRequest(method, params, options);
  }

  /**
   * Step 3: Open BC session
   *
   * Week 4 TODO: Extract to BCSessionManager
   */
  async openSession(connectionRequest: ConnectionRequest): Promise<any> {
    logger.info('Opening BC session...');

    // Build FULL OpenSession request matching browser format
    // BC requires all these fields - a simplified request will not get a response!
    const now = new Date();
    const dstStart = new Date(now.getFullYear(), 2, 31); // Last Sunday of March
    dstStart.setDate(dstStart.getDate() - dstStart.getDay());
    const dstEnd = new Date(now.getFullYear(), 9, 31); // Last Sunday of October
    dstEnd.setDate(dstEnd.getDate() - dstEnd.getDay());

    const sessionId = uuidv4();

    // Set spaInstanceId for the session (used in sequenceNo and navigationContext)
    this.spaInstanceId = sessionId.substring(0, 8);

    const fullRequest = {
      openFormIds: [],
      sessionId: '',
      sequenceNo: null,
      lastClientAckSequenceNumber: -1,
      telemetryClientActivityId: null,
      telemetryTraceStartInfo: 'traceStartInfo=%5BWeb%20Client%20-%20Web%20browser%5D%20OpenForm',
      navigationContext: {
        applicationId: 'FIN',
        deviceCategory: 0,
        spaInstanceId: this.spaInstanceId
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
          namedParameters: `{"query":"tenant=${this.getTenantId()}&startTraceId=${sessionId}&tid=undefined&runinframe=1"}`,
          callbackId: '0'
        }
      ],
      tenantId: this.getTenantId(),
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
    };

    const result = await this.sendRpcRequest('OpenSession', [fullRequest]);

    // Extract session info from result
    const sessionHandlers = this.decompressIfNeeded(result);

    // Search for session information in handler parameters
    const searchParams = (params: any): void => {
      if (Array.isArray(params)) {
        for (const item of params) {
          searchParams(item);
        }
      } else if (params && typeof params === 'object') {
        if (params.ServerSessionId) {
          this.serverSessionId = params.ServerSessionId;
          logger.info(`  Server session ID: ${this.serverSessionId}`);
        }
        if (params.SessionKey) {
          this.sessionKey = params.SessionKey;
        }
        if (params.CompanyName) {
          this.companyName = params.CompanyName;
          logger.info(`  Company: ${this.companyName}`);
        }
        for (const value of Object.values(params)) {
          searchParams(value);
        }
      }
    };

    for (const handler of sessionHandlers) {
      if (handler.parameters) {
        searchParams(handler.parameters);
      }
    }

    // Extract role center form ID from FormToShow
    const formHandler = sessionHandlers.find(
      (h: any) =>
        h.handlerType === 'DN.LogicalClientEventRaisingHandler' &&
        h.parameters?.[0] === 'FormToShow' &&
        h.parameters?.[1]?.ServerId
    );

    if (formHandler?.parameters?.[1]?.ServerId) {
      this.roleCenterFormId = formHandler.parameters[1].ServerId;
      logger.info(`  Role center form: ${this.roleCenterFormId}`);

      // Track role center as open form (BC requires this for subsequent Invoke calls)
      this.openFormIds = [this.roleCenterFormId!]; // Non-null assertion safe here (checked in if condition)
    }

    logger.info('✓ BC session opened\n');
  }

  /**
   * Add a form to the openFormIds list.
   * Must be called when a new form is opened (FormToShow event).
   * BC requires ALL open forms to be listed in openFormIds for actions to work.
   */
  addOpenForm(formId: string): void {
    if (!this.openFormIds.includes(formId)) {
      this.openFormIds.push(formId);
      logger.info(`[BCRawWebSocketClient] Added form ${formId} to openFormIds: ${JSON.stringify(this.openFormIds)}`);
    }
  }

  /**
   * Remove a form from the openFormIds list.
   * Should be called when a form is closed.
   */
  removeOpenForm(formId: string): void {
    const index = this.openFormIds.indexOf(formId);
    if (index !== -1) {
      this.openFormIds.splice(index, 1);
      logger.info(`[BCRawWebSocketClient] Removed form ${formId} from openFormIds: ${JSON.stringify(this.openFormIds)}`);
    }
  }

  /**
   * Invoke BC action
   *
   * Week 4 TODO: Extract to BCSessionManager
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
    if (!this.serverSessionId || !this.sessionKey) {
      throw new Error('Session not initialized. Call openSession() first.');
    }

    // Auto-increment sequence number if not provided
    const sequenceNo =
      options.sequenceNo ?? `${this.spaInstanceId}#${++this.clientSequenceCounter}`;

    // Use current openFormIds if not provided
    const openFormIds = options.openFormIds ?? this.openFormIds;

    // Use last server sequence as ack number (from protocol adapter)
    const lastClientAckSequenceNumber =
      options.lastClientAckSequenceNumber ?? this.protocolAdapter?.getLastServerSequence() ?? -1;

    logger.info(`[invoke] sequenceNo=${sequenceNo}, lastClientAckSequenceNumber=${lastClientAckSequenceNumber}, openFormIds=${JSON.stringify(openFormIds)}`);

    // Build interaction object (matches browser format)
    const interaction: any = {
      interactionName: options.interactionName,
      skipExtendingSessionLifetime: false,
      namedParameters: typeof options.namedParameters === 'string'
        ? options.namedParameters
        : JSON.stringify(options.namedParameters),
      callbackId: String(this.clientSequenceCounter),
    };

    if (options.controlPath !== undefined) {
      interaction.controlPath = options.controlPath;
    }
    if (options.formId !== undefined) {
      interaction.formId = options.formId;
    }
    if (options.systemAction !== undefined) {
      interaction.systemAction = options.systemAction;
    }

    // Build full params matching browser format
    const params: any = {
      openFormIds,
      sessionId: this.serverSessionId,
      sequenceNo,
      lastClientAckSequenceNumber,
      telemetryClientActivityId: null,
      telemetryTraceStartInfo: `traceStartInfo=%5BWeb%20Client%20-%20Web%20browser%5D%20${options.interactionName}`,
      navigationContext: {
        applicationId: 'FIN',
        deviceCategory: 0,
        spaInstanceId: this.spaInstanceId,
      },
      supportedExtensions: JSON.stringify([
        { Name: 'Microsoft.Dynamics.Nav.Client.PageNotifier' },
        { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.Tour' },
        { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.UserTours' },
        { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.AppSource' },
        { Name: 'Microsoft.Dynamics.Nav.Client.Capabilities.Designer' },
      ]),
      interactionsToInvoke: [interaction],
      tenantId: this.getTenantId(),
      sessionKey: this.sessionKey,
      company: this.companyName,
      telemetryClientSessionId: uuidv4(),
      features: [
        'QueueInteractions',
        'MetadataCache',
        'CacheSession',
        'DynamicsQuickEntry',
        'Multitasking',
        'MultilineEdit',
        'SaveValueToDatabasePromptly',
        'CalcOnlyVisibleFlowFields',
      ],
    };

    const result = await this.sendRpcRequest('Invoke', [params], {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });

    return this.decompressIfNeeded(result);
  }

  /**
   * Decompress handler response if needed
   *
   * Week 2: Still using local implementation (BCProtocolAdapter handles WebSocket messages)
   * Week 4 TODO: Remove this when session manager is extracted
   */
  private decompressIfNeeded(result: any): any[] {
    if (result?.compressedResult) {
      const compressed = Buffer.from(result.compressedResult, 'base64');
      const decompressed = gunzipSync(compressed);
      const decompressedJson = decompressed.toString('utf-8');
      const actualResponse = JSON.parse(decompressedJson);
      return Array.isArray(actualResponse) ? actualResponse : [];
    }
    return Array.isArray(result) ? result : [];
  }

  /**
   * Cache filter metadata from handler response
   *
   * Week 4 TODO: Extract to BCFilterMetadataCache
   */
  cacheFilterMetadata(formId: string, handlers: any[]): number {
    let fieldCount = 0;
    const formCache = new Map<string, string>();

    for (const handler of handlers) {
      if (
        handler.handlerType === 'DN.LogicalClientChangeHandler' &&
        Array.isArray(handler.parameters?.[1])
      ) {
        const changes = handler.parameters[1];

        for (const change of changes) {
          if (change.t === 'PropertyChanges' && change.ControlReference) {
            const controlPath = change.ControlReference.controlPath;

            if (change.Columns) {
              for (const column of change.Columns) {
                if (column.Id && column.Caption) {
                  const canonicalId = `${controlPath}:${column.Id}`;
                  formCache.set(column.Caption, canonicalId);
                  fieldCount++;
                }
              }
            }
          }
        }
      }
    }

    if (fieldCount > 0) {
      this.filterMetadataCache.set(formId, formCache);
      logger.info(
        `  ✓ Cached ${fieldCount} filterable field(s) for form ${formId}`
      );
    }

    return fieldCount;
  }

  /**
   * Resolve filter field ID from column caption
   *
   * Week 4 TODO: Extract to BCFilterMetadataCache
   */
  resolveFilterFieldId(formId: string, caption: string): string | null {
    const formCache = this.filterMetadataCache.get(formId);
    if (!formCache) {
      throw new Error(
        `No filter metadata cached for form ${formId}. Did you call cacheFilterMetadata()?`
      );
    }

    return formCache.get(caption) || null;
  }

  /**
   * Get available filter captions for a form
   *
   * Week 4 TODO: Extract to BCFilterMetadataCache
   */
  getAvailableFilterCaptions(formId: string): string[] | null {
    const formCache = this.filterMetadataCache.get(formId);
    if (!formCache) {
      return null;
    }

    return Array.from(formCache.keys());
  }

  /**
   * Apply filter to a list control
   *
   * Week 4 TODO: Extract to BCFilterMetadataCache
   */
  async applyFilter(params: {
    formId: string;
    listControlPath: string;
    columnCaption: string;
    filterValue?: string;
    signal?: AbortSignal;
  }): Promise<any> {
    const canonicalId = this.resolveFilterFieldId(
      params.formId,
      params.columnCaption
    );

    if (!canonicalId) {
      const available = this.getAvailableFilterCaptions(params.formId) || [];
      throw new Error(
        `Column "${params.columnCaption}" not found in cached metadata for form ${params.formId}. Available: ${available.join(', ')}`
      );
    }

    const [controlPath, fieldId] = canonicalId.split(':');

    logger.info(`Applying filter:`);
    logger.info(`  Form: ${params.formId}`);
    logger.info(`  Column: ${params.columnCaption} → ${canonicalId}`);
    logger.info(`  Value: ${params.filterValue || '(clear)'}`);

    // Step 1: Invoke Filter to activate filter row
    await this.invoke({
      interactionName: 'Filter',
      namedParameters: {},
      formId: params.formId,
      controlPath: controlPath,
      signal: params.signal,
    });

    // Step 2: SaveValue to set filter value
    const filterControlPath = `${controlPath}::${fieldId}`;
    await this.invoke({
      interactionName: 'SaveValue',
      namedParameters: {
        newValue: params.filterValue || '',
      },
      formId: params.formId,
      controlPath: filterControlPath,
      signal: params.signal,
    });

    logger.info(`✓ Filter applied`);

    return { success: true };
  }
}
