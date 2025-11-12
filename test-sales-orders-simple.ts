/**
 * Simple debug test - just call the MCP tools directly to reproduce the issue
 */

import { BCPageConnection } from './src/connection/bc-page-connection.js';
import { bcConfig } from './src/core/config.js';
import { GetPageMetadataTool } from './src/tools/get-page-metadata-tool.js';
import { ReadPageDataTool } from './src/tools/read-page-data-tool.js';
import { isOk } from './src/core/result.js';

async function test() {
  console.log('Testing Sales Orders page (9305)...\n');

  const connection = new BCPageConnection({
    baseUrl: bcConfig.baseUrl,
    username: bcConfig.username,
    password: bcConfig.password,
    tenantId: bcConfig.tenantId,
    timeout: 30000,
  });

  const getPageMetadataTool = new GetPageMetadataTool(connection, bcConfig);
  const readPageDataTool = new ReadPageDataTool(connection, bcConfig);

  try {
    // Step 1: Open page
    console.log('1. Opening page with get_page_metadata...');
    const metadataResult = await getPageMetadataTool.execute({ pageId: '9305' });

    if (!isOk(metadataResult)) {
      throw new Error(`Failed: ${metadataResult.error.message}`);
    }

    const metadata = metadataResult.value as any;
    console.log(`✓ Opened: ${metadata.caption} (${metadata.pageType})`);
    console.log(`  PageContextId: ${metadata.pageContextId}\n`);

    // Step 2: Read data
    console.log('2. Reading data with read_page_data...');
    const dataResult = await readPageDataTool.execute({
      pageContextId: metadata.pageContextId,
    });

    if (!isOk(dataResult)) {
      throw new Error(`Failed: ${dataResult.error.message}`);
    }

    const data = dataResult.value as any;
    console.log(`✓ Result: ${data.totalCount} records\n`);

    if (data.totalCount === 0) {
      console.log('❌ BUG: Expected 9 records but got 0!');
    } else {
      console.log('First record:', JSON.stringify(data.records[0], null, 2));
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  } finally {
    await connection.close();
  }
}

test().catch(console.error);
