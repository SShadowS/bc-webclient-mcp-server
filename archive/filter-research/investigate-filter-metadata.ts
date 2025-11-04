/**
 * Metadata Investigation Spike: Filter Controls
 *
 * This script retrieves page metadata for the Customers list (Page 22)
 * and searches for filter-related controls to answer:
 *
 * 1. Can we find filter controls in page metadata?
 * 2. What are their control types and paths?
 * 3. Can we get a stable reference to filter fields?
 */

import { BCConnection } from './src/core/bc-connection.js';
import { GetPageMetadataTool } from './src/tools/get-page-metadata-tool.js';

async function investigateFilterMetadata() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Filter Metadata Investigation');
  console.log('  Target: Customers List (Page 22)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const connection = new BCConnection({
    baseUrl: 'http://Cronus27/BC/',
    tenant: 'default',
  });

  try {
    // Login
    console.log('1. Logging in...');
    const loginResult = await connection.login({
      username: 'sshadows',
      password: '1234',
    });

    if (!loginResult.success) {
      console.error('Login failed:', loginResult.error);
      return;
    }
    console.log('✓ Logged in\n');

    // Get metadata for Customers list
    console.log('2. Getting metadata for Page 22 (Customers)...');
    const metadataTool = new GetPageMetadataTool(connection);
    const metadataResult = await metadataTool.execute({ pageId: '22' });

    if (!metadataResult.success) {
      console.error('Metadata retrieval failed:', metadataResult.error);
      return;
    }

    const metadata = metadataResult.data;
    console.log(`✓ Retrieved metadata for: ${metadata.pageCaption}\n`);

    // Analyze page structure
    console.log('3. Analyzing page structure...\n');
    console.log(`Total fields: ${metadata.fields?.length || 0}`);
    console.log(`Total actions: ${metadata.actions?.length || 0}\n`);

    // Look for filter-related controls
    console.log('4. Searching for filter-related controls...\n');

    if (metadata.fields) {
      const filterControls = metadata.fields.filter(field => {
        const name = field.name?.toLowerCase() || '';
        const caption = field.caption?.toLowerCase() || '';
        return name.includes('filter') || caption.includes('filter') ||
               name.includes('search') || caption.includes('search');
      });

      console.log(`Found ${filterControls.length} potential filter controls:\n`);

      filterControls.forEach((control, idx) => {
        console.log(`${idx + 1}. ${control.name || '(unnamed)'}`);
        console.log(`   Caption: ${control.caption || '(none)'}`);
        console.log(`   Type: ${control.type || '(unknown)'}`);
        console.log(`   Editable: ${control.editable}`);
        console.log('');
      });
    }

    // Check if we have access to the full control tree
    console.log('5. Checking raw metadata structure...\n');

    // The metadata might have a raw structure we can inspect
    const rawKeys = Object.keys(metadata);
    console.log('Metadata keys:', rawKeys.join(', '));
    console.log('');

    // Save full metadata for manual inspection
    const fs = await import('fs/promises');
    await fs.writeFile(
      'customer-list-metadata.json',
      JSON.stringify(metadata, null, 2)
    );
    console.log('✓ Full metadata saved to: customer-list-metadata.json\n');

    // Analysis summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Analysis Summary');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Questions answered:');
    console.log('1. Filter controls in metadata?', filterControls?.length ? 'YES' : 'NO');
    console.log('2. Control types available?', metadata.fields?.[0]?.type ? 'YES' : 'NO');
    console.log('3. Can get stable paths?', 'See customer-list-metadata.json');
    console.log('');

    console.log('Next steps:');
    console.log('- Review customer-list-metadata.json for control tree structure');
    console.log('- Look for repeater/list controls and their children');
    console.log('- Identify filter pane control if present');
    console.log('');

  } catch (error) {
    console.error('Investigation failed:', error);
  } finally {
    await connection.close();
  }
}

investigateFilterMetadata().catch(console.error);
