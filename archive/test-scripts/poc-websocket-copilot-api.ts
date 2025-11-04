/**
 * POC: WebSocket + Copilot API Integration
 *
 * Demonstrates:
 * 1. Create BC session via WebSocket
 * 2. Extract server session ID
 * 3. Use session ID with Copilot API Skills endpoints
 * 4. Query page metadata and records
 */

import { BCRawWebSocketClient } from './src/BCRawWebSocketClient.js';
import type { BCConfig } from './src/types.js';

interface PageMetadataResponse {
  Name: string;
  Id: number;
  SourceTableName: string;
  SourceTableId: number;
  Description: string;
  PageType: string;
  Fields: FieldMetadata[];
  Controls: PageControlMetadata[];
  SubPages: InfoPartMetadata[];
  SupportedCapabilities: number;
}

interface FieldMetadata {
  Id: number;
  Name: string;
  Type: string;
  Description: string;
  OptionValues?: string[];
  MaxLength?: number;
  CanBeUsedForSorting: boolean;
}

interface PageControlMetadata {
  ControlId: number;
  Name: string;
  Caption: string;
  Tooltip: string;
  HasDrillDown: boolean;
  HasLookup: boolean;
  Visible: boolean;
}

interface InfoPartMetadata {
  PageId: number;
  ControlId: number;
  Name: string;
  Caption: string;
}

interface PageSummaryResponse {
  Caption: string;
  Url: string;
  PageType: string;
  TotalRecordCount?: number;
  Records?: RecordSummary[];
}

interface RecordSummary {
  SystemId: string;
  Heading: string;
  Fields?: FieldSummary[];
}

interface FieldSummary {
  Caption: string;
  FieldValue: string;
  FieldType: string;
}

class CopilotApiWithSession {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private tenantId: string,
    private serverSessionId: string
  ) {}

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'X-Copilot-ApiKey': this.apiKey,
      'server-session-id': this.serverSessionId,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    console.log(`\n[API] ${options.method || 'GET'} ${url}`);

    const response = await globalThis.fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API Error ${response.status}: ${text}`);
    }

    return response.json();
  }

  async searchPages(query: string, pageTypes?: string[], top: number = 10): Promise<PageMetadataResponse[]> {
    const params = new URLSearchParams({
      tenantId: this.tenantId,
      top: top.toString(),
    });

    params.append('query', query);

    if (pageTypes) {
      pageTypes.forEach(type => params.append('pageTypes', type));
    }

    return this.fetch(`/v2.0/skills/pageMetadata?${params}`);
  }

  async getPageMetadata(pageId: number): Promise<PageMetadataResponse> {
    const params = new URLSearchParams({
      tenantId: this.tenantId,
    });

    return this.fetch(`/v2.0/skills/pageMetadata/${pageId}?${params}`);
  }

  async getPageSummary(
    pageId: number,
    options: {
      filters?: string[];
      sortField?: string;
      sortDirection?: 'Ascending' | 'Descending';
      topRecords?: number;
      includeCount?: boolean;
      includeRecordFields?: boolean;
      fieldsToInclude?: string[];
    } = {}
  ): Promise<PageSummaryResponse> {
    const params = new URLSearchParams({
      tenantId: this.tenantId,
      topRecords: (options.topRecords || 5).toString(),
      includeCount: (options.includeCount || false).toString(),
      includeRecordFields: (options.includeRecordFields || true).toString(),
    });

    if (options.filters) {
      options.filters.forEach(f => params.append('filters', f));
    }

    if (options.sortField) {
      params.append('sortField', options.sortField);
      params.append('sortDirection', options.sortDirection || 'Ascending');
    }

    if (options.fieldsToInclude) {
      options.fieldsToInclude.forEach(f => params.append('fieldsToInclude', f));
    }

    return this.fetch(`/v2.0/skills/pages/${pageId}/summary?${params}`);
  }

  async getRecordData(
    pageId: number,
    systemId: string,
    options: {
      includeFields?: boolean;
      includeParts?: boolean;
      includeRelatedPages?: boolean;
    } = {}
  ): Promise<any> {
    const params = new URLSearchParams({
      tenantId: this.tenantId,
      includeFields: (options.includeFields !== false).toString(),
      includeParts: (options.includeParts !== false).toString(),
      includeRelatedPages: (options.includeRelatedPages !== false).toString(),
    });

    return this.fetch(`/v2.0/skills/pages/${pageId}/records/${systemId}/data?${params}`);
  }
}

async function demo() {
  console.log('='.repeat(80));
  console.log('WebSocket + Copilot API Integration POC');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Create WebSocket session
  console.log('🔌 Step 1: Creating WebSocket session...');
  console.log('-'.repeat(80));

  const config: BCConfig = {
    baseUrl: 'http://Cronus27/BC',
    wsEndpoint: 'ws://Cronus27/BC'
  };

  const wsClient = new BCRawWebSocketClient(config, 'sshadows', '1234', 'default');

  try {
    await wsClient.authenticateWeb();
    await wsClient.connect();

    // Open a session to get ServerSessionId
    await wsClient.openSession({
      interactionsToInvoke: [{
        interactionName: 'OpenForm',
        namedParameters: { query: 'page=21' }
      }]
    });

    const serverSessionId = wsClient.getServerSessionId();

    if (!serverSessionId) {
      throw new Error('Failed to get server session ID from WebSocket');
    }

    console.log(`✅ WebSocket session created`);
    console.log(`   Server Session ID: ${serverSessionId}`);
    console.log('');

    // Step 2: Use Copilot API with session ID
    console.log('🔍 Step 2: Using Copilot API with session...');
    console.log('-'.repeat(80));

    const copilotApi = new CopilotApiWithSession(
      'http://Cronus27:7100/BC/copilot',
      'your-secret-key-here',
      'default',
      serverSessionId
    );

    // Search for Customer pages
    console.log('\n📋 Searching for Customer pages...');
    const customerPages = await copilotApi.searchPages('Customer', ['List', 'Card'], 5);
    console.log(`Found ${customerPages.length} pages:`);
    customerPages.forEach(p => {
      console.log(`  - [${p.Id}] ${p.Name} (${p.PageType}) - Table: ${p.SourceTableName}`);
    });

    // Get metadata for Customer List (Page 22)
    console.log('\n📋 Getting metadata for Customer List (Page 22)...');
    const pageMetadata = await copilotApi.getPageMetadata(22);
    console.log(`Page: ${pageMetadata.Name} (ID: ${pageMetadata.Id})`);
    console.log(`Type: ${pageMetadata.PageType}`);
    console.log(`Source Table: ${pageMetadata.SourceTableName} (ID: ${pageMetadata.SourceTableId})`);
    console.log(`Description: ${pageMetadata.Description || '(none)'}`);
    console.log(`\nFields: ${pageMetadata.Fields.length} total`);
    pageMetadata.Fields.slice(0, 10).forEach(f => {
      console.log(`  - ${f.Name} (${f.Type})`);
    });
    if (pageMetadata.Fields.length > 10) {
      console.log(`  ... and ${pageMetadata.Fields.length - 10} more`);
    }

    console.log(`\nControls: ${pageMetadata.Controls.length} total`);
    pageMetadata.Controls.slice(0, 5).forEach(c => {
      const actions: string[] = [];
      if (c.HasDrillDown) actions.push('DrillDown');
      if (c.HasLookup) actions.push('Lookup');
      const actionStr = actions.length > 0 ? ` [${actions.join(', ')}]` : '';
      console.log(`  - ${c.Caption || c.Name}${actionStr}`);
    });
    if (pageMetadata.Controls.length > 5) {
      console.log(`  ... and ${pageMetadata.Controls.length - 5} more`);
    }

    if (pageMetadata.SubPages.length > 0) {
      console.log(`\nSubPages: ${pageMetadata.SubPages.length}`);
      pageMetadata.SubPages.forEach(sp => {
        console.log(`  - ${sp.Caption || sp.Name} (Page ${sp.PageId})`);
      });
    }

    // Get page summary with records
    console.log('\n📋 Getting customer records...');
    const pageSummary = await copilotApi.getPageSummary(22, {
      topRecords: 3,
      includeCount: true,
      includeRecordFields: true,
    });

    console.log(`Page: ${pageSummary.Caption}`);
    console.log(`URL: ${pageSummary.Url}`);
    if (pageSummary.TotalRecordCount !== undefined) {
      console.log(`Total Records: ${pageSummary.TotalRecordCount}`);
    }

    if (pageSummary.Records) {
      console.log(`\nRecords (showing ${pageSummary.Records.length}):`);
      pageSummary.Records.forEach((record, idx) => {
        console.log(`\n  Record ${idx + 1}: ${record.Heading}`);
        console.log(`  SystemId: ${record.SystemId}`);
        if (record.Fields) {
          record.Fields.forEach(f => {
            console.log(`    - ${f.Caption}: ${f.FieldValue}`);
          });
        }
      });
    }

    // Get complete record data for first customer
    if (pageSummary.Records && pageSummary.Records.length > 0) {
      const firstCustomer = pageSummary.Records[0];
      console.log('\n📋 Getting complete record data...');
      const recordData = await copilotApi.getRecordData(22, firstCustomer.SystemId);
      console.log(`Complete OData record:`);
      console.log(JSON.stringify(recordData, null, 2));
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Demo Complete!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await wsClient.disconnect();
  }
}

// Run demo
demo().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
