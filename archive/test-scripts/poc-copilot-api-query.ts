/**
 * POC: Business Central Copilot API - Page Metadata & Record Query
 *
 * Demonstrates:
 * 1. Searching for pages by name
 * 2. Getting page metadata (fields, controls, subpages)
 * 3. Querying page records with filters
 * 4. Getting complete record data
 */

interface CopilotApiConfig {
  baseUrl: string;
  apiKey: string;
  tenantId: string;
  serverSessionId?: string;
}

interface PageMetadataResponse {
  Name: string;
  Id: number;
  SourceTableName: string;
  SourceTableId: number;
  Description: string;
  PageType: string;
  IsBookmarked: boolean;
  Fields: FieldMetadata[];
  SubPages: InfoPartMetadata[];
  Controls: PageControlMetadata[];
  SupportedCapabilities: number;
  UsageCategory: number;
}

interface FieldMetadata {
  Id: number;
  SourceTableId: number;
  SourceTableName: string;
  Name: string;
  Description: string;
  Type: string;
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
  Fields: FieldSummary[];
}

interface FieldSummary {
  Caption: string;
  FieldValue: string;
  FieldType: string;
}

class CopilotApiClient {
  constructor(private config: CopilotApiConfig) {}

  private async fetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.baseUrl}${path}`;
    const headers = {
      'X-Copilot-ApiKey': this.config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.config.serverSessionId) {
      headers['server-session-id'] = this.config.serverSessionId;
    }

    console.log(`[API] ${options.method || 'GET'} ${url}`);

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

  /**
   * Search for pages by name/description
   */
  async searchPages(query: string, pageTypes?: string[], top: number = 10): Promise<PageMetadataResponse[]> {
    const params = new URLSearchParams({
      tenantId: this.config.tenantId,
      top: top.toString(),
    });

    // Add query parameters (can be multiple)
    params.append('query', query);

    // Add page types if specified
    if (pageTypes) {
      pageTypes.forEach(type => params.append('pageTypes', type));
    }

    return this.fetch(`/v2.0/skills/pageMetadata?${params}`);
  }

  /**
   * Get detailed metadata for a specific page
   */
  async getPageMetadata(pageId: number): Promise<PageMetadataResponse> {
    const params = new URLSearchParams({
      tenantId: this.config.tenantId,
    });

    return this.fetch(`/v2.0/skills/pageMetadata/${pageId}?${params}`);
  }

  /**
   * Get page summary with filtered records
   */
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
      tenantId: this.config.tenantId,
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

  /**
   * Get complete record data
   */
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
      tenantId: this.config.tenantId,
      includeFields: (options.includeFields !== false).toString(),
      includeParts: (options.includeParts !== false).toString(),
      includeRelatedPages: (options.includeRelatedPages !== false).toString(),
    });

    return this.fetch(`/v2.0/skills/pages/${pageId}/records/${systemId}/data?${params}`);
  }

  /**
   * Get available actions for a page
   */
  async getCopilotActions(pageId: number): Promise<any[]> {
    const params = new URLSearchParams({
      tenantId: this.config.tenantId,
    });

    return this.fetch(`/v2.0/skills/pages/${pageId}/copilotActions?${params}`);
  }
}

// =============================================================================
// Demo Script
// =============================================================================

async function demo() {
  const client = new CopilotApiClient({
    baseUrl: 'http://Cronus27:7100/BC/copilot',
    apiKey: 'your-secret-key-here',
    tenantId: 'default',
  });

  console.log('='.repeat(80));
  console.log('Business Central Copilot API - POC Demo');
  console.log('='.repeat(80));
  console.log('');

  // -----------------------------------------------------------------------------
  // 1. Search for Customer-related pages
  // -----------------------------------------------------------------------------
  console.log('📋 Step 1: Search for "Customer" pages');
  console.log('-'.repeat(80));

  const customerPages = await client.searchPages('Customer', ['List', 'Card'], 5);
  console.log(`Found ${customerPages.length} customer pages:`);
  customerPages.forEach(p => {
    console.log(`  - [${p.Id}] ${p.Name} (${p.PageType}) - Table: ${p.SourceTableName}`);
  });
  console.log('');

  // -----------------------------------------------------------------------------
  // 2. Get detailed metadata for Customer List (Page 22)
  // -----------------------------------------------------------------------------
  console.log('📋 Step 2: Get metadata for Customer List (Page 22)');
  console.log('-'.repeat(80));

  const pageMetadata = await client.getPageMetadata(22);
  console.log(`Page: ${pageMetadata.Name} (ID: ${pageMetadata.Id})`);
  console.log(`Type: ${pageMetadata.PageType}`);
  console.log(`Source Table: ${pageMetadata.SourceTableName} (ID: ${pageMetadata.SourceTableId})`);
  console.log(`Description: ${pageMetadata.Description || '(none)'}`);
  console.log('');

  console.log(`Fields (${pageMetadata.Fields.length}):`);
  pageMetadata.Fields.slice(0, 10).forEach(f => {
    const optionInfo = f.OptionValues ? ` [Options: ${f.OptionValues.join(', ')}]` : '';
    const lengthInfo = f.MaxLength ? ` [MaxLen: ${f.MaxLength}]` : '';
    console.log(`  - ${f.Name} (${f.Type})${optionInfo}${lengthInfo}`);
    if (f.Description) {
      console.log(`    └─ ${f.Description}`);
    }
  });
  if (pageMetadata.Fields.length > 10) {
    console.log(`  ... and ${pageMetadata.Fields.length - 10} more fields`);
  }
  console.log('');

  console.log(`Controls (${pageMetadata.Controls.length}):`);
  pageMetadata.Controls.slice(0, 5).forEach(c => {
    const actions: string[] = [];
    if (c.HasDrillDown) actions.push('DrillDown');
    if (c.HasLookup) actions.push('Lookup');
    const actionStr = actions.length > 0 ? ` [${actions.join(', ')}]` : '';
    console.log(`  - ${c.Caption || c.Name}${actionStr}`);
    if (c.Tooltip) {
      console.log(`    └─ ${c.Tooltip}`);
    }
  });
  if (pageMetadata.Controls.length > 5) {
    console.log(`  ... and ${pageMetadata.Controls.length - 5} more controls`);
  }
  console.log('');

  if (pageMetadata.SubPages.length > 0) {
    console.log(`SubPages (${pageMetadata.SubPages.length}):`);
    pageMetadata.SubPages.forEach(sp => {
      console.log(`  - ${sp.Caption || sp.Name} (Page ${sp.PageId})`);
    });
    console.log('');
  }

  // -----------------------------------------------------------------------------
  // 3. Query customer records with filter
  // -----------------------------------------------------------------------------
  console.log('📋 Step 3: Query customer records');
  console.log('-'.repeat(80));

  const pageSummary = await client.getPageSummary(22, {
    topRecords: 3,
    includeCount: true,
    includeRecordFields: true,
    fieldsToInclude: ['No.', 'Name', 'Balance (LCY)', 'Credit Limit (LCY)'],
  });

  console.log(`Page: ${pageSummary.Caption}`);
  console.log(`Type: ${pageSummary.PageType}`);
  console.log(`URL: ${pageSummary.Url}`);
  if (pageSummary.TotalRecordCount !== undefined) {
    console.log(`Total Records: ${pageSummary.TotalRecordCount}`);
  }
  console.log('');

  if (pageSummary.Records) {
    console.log(`Records (showing ${pageSummary.Records.length}):`);
    pageSummary.Records.forEach((record, idx) => {
      console.log(`\n  Record ${idx + 1}: ${record.Heading}`);
      console.log(`  SystemId: ${record.SystemId}`);
      if (record.Fields) {
        record.Fields.forEach(f => {
          console.log(`    - ${f.Caption}: ${f.FieldValue} (${f.FieldType})`);
        });
      }
    });
    console.log('');
  }

  // -----------------------------------------------------------------------------
  // 4. Get complete data for first customer record
  // -----------------------------------------------------------------------------
  if (pageSummary.Records && pageSummary.Records.length > 0) {
    const firstCustomer = pageSummary.Records[0];
    console.log('📋 Step 4: Get complete record data for first customer');
    console.log('-'.repeat(80));

    const recordData = await client.getRecordData(22, firstCustomer.SystemId, {
      includeFields: true,
      includeParts: true,
      includeRelatedPages: true,
    });

    console.log(`Record: ${firstCustomer.Heading}`);
    console.log('Complete OData record:');
    console.log(JSON.stringify(recordData, null, 2));
    console.log('');
  }

  // -----------------------------------------------------------------------------
  // 5. Get available actions
  // -----------------------------------------------------------------------------
  console.log('📋 Step 5: Get available Copilot actions');
  console.log('-'.repeat(80));

  const actions = await client.getCopilotActions(22);
  console.log(`Found ${actions.length} actions:`);
  actions.forEach(action => {
    console.log(`  - ${action.Name || action.Caption || JSON.stringify(action)}`);
  });
  console.log('');

  console.log('='.repeat(80));
  console.log('✅ Demo Complete!');
  console.log('='.repeat(80));
}

export { CopilotApiClient, demo };

// Run demo if executed directly (ES module check)
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  demo().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}
