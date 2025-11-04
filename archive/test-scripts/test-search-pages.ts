/**
 * Test Search Pages Tool
 *
 * Tests the search_pages MCP tool against the well-known pages list.
 *
 * Usage:
 *   npx tsx test-search-pages.ts
 */

import { SearchPagesTool } from './src/tools/search-pages-tool.js';
import { isOk } from './src/core/result.js';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BC Search Pages Tool Test                                ║');
  console.log('║  Testing page search functionality                        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const searchTool = new SearchPagesTool();

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Search for "Customer" pages
  console.log('Test 1: Search for "Customer" pages');
  console.log('─'.repeat(60));
  const customerResult = await searchTool.execute({ query: 'Customer' });

  if (isOk(customerResult)) {
    const value = customerResult.value as any;
    console.log(`✓ PASS: Found ${value.totalCount} Customer pages`);
    console.log(`  Results:`);
    for (const page of value.pages) {
      console.log(`    - ${page.caption} (ID: ${page.pageId}, Type: ${page.type})`);
    }
    testsPassed++;
  } else {
    console.error('✗ FAIL: Search for Customer failed');
    console.error(`  Error: ${customerResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Test 2: Search for "Sales" pages
  console.log('Test 2: Search for "Sales" pages');
  console.log('─'.repeat(60));
  const salesResult = await searchTool.execute({ query: 'Sales' });

  if (isOk(salesResult)) {
    const value = salesResult.value as any;
    console.log(`✓ PASS: Found ${value.totalCount} Sales pages`);
    console.log(`  Results:`);
    for (const page of value.pages) {
      console.log(`    - ${page.caption} (ID: ${page.pageId}, Type: ${page.type})`);
    }
    testsPassed++;
  } else {
    console.error('✗ FAIL: Search for Sales failed');
    console.error(`  Error: ${salesResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Test 3: Search by page ID "21"
  console.log('Test 3: Search by page ID "21"');
  console.log('─'.repeat(60));
  const idResult = await searchTool.execute({ query: '21' });

  if (isOk(idResult)) {
    const value = idResult.value as any;
    if (value.totalCount === 1 && value.pages[0].pageId === '21') {
      console.log(`✓ PASS: Found Customer Card (ID: 21)`);
      console.log(`  Result: ${value.pages[0].caption}`);
      testsPassed++;
    } else {
      console.error(`✗ FAIL: Expected 1 result with pageId='21', got ${value.totalCount}`);
      testsFailed++;
    }
  } else {
    console.error('✗ FAIL: Search by ID failed');
    console.error(`  Error: ${idResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Test 4: Search with type filter (Card)
  console.log('Test 4: Search with type filter (Card)');
  console.log('─'.repeat(60));
  const cardResult = await searchTool.execute({ query: 'Customer', type: 'Card' });

  if (isOk(cardResult)) {
    const value = cardResult.value as any;
    const allCards = value.pages.every((p: any) => p.type === 'Card');
    if (allCards && value.totalCount > 0) {
      console.log(`✓ PASS: Found ${value.totalCount} Customer Card pages`);
      console.log(`  Results:`);
      for (const page of value.pages) {
        console.log(`    - ${page.caption} (ID: ${page.pageId})`);
      }
      testsPassed++;
    } else {
      console.error('✗ FAIL: Type filter did not work correctly');
      testsFailed++;
    }
  } else {
    console.error('✗ FAIL: Search with type filter failed');
    console.error(`  Error: ${cardResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Test 5: Search with limit
  console.log('Test 5: Search with limit (limit: 2)');
  console.log('─'.repeat(60));
  const limitResult = await searchTool.execute({ query: 'Order', limit: 2 });

  if (isOk(limitResult)) {
    const value = limitResult.value as any;
    if (value.pages.length <= 2) {
      console.log(`✓ PASS: Limit applied correctly`);
      console.log(`  Returned: ${value.pages.length} pages (max 2)`);
      console.log(`  Total found: ${value.totalCount} pages`);
      testsPassed++;
    } else {
      console.error(`✗ FAIL: Limit not applied (got ${value.pages.length} pages)`);
      testsFailed++;
    }
  } else {
    console.error('✗ FAIL: Search with limit failed');
    console.error(`  Error: ${limitResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Test 6: Search for non-existent page
  console.log('Test 6: Search for non-existent page');
  console.log('─'.repeat(60));
  const notFoundResult = await searchTool.execute({ query: 'XYZ_NONEXISTENT' });

  if (isOk(notFoundResult)) {
    const value = notFoundResult.value as any;
    if (value.totalCount === 0) {
      console.log('✓ PASS: Correctly returned 0 results for non-existent page');
      testsPassed++;
    } else {
      console.error(`✗ FAIL: Expected 0 results, got ${value.totalCount}`);
      testsFailed++;
    }
  } else {
    console.error('✗ FAIL: Search failed unexpectedly');
    console.error(`  Error: ${notFoundResult.error.message}`);
    testsFailed++;
  }
  console.log('');

  // Summary
  console.log('═'.repeat(60));
  console.log('TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total tests: ${testsPassed + testsFailed}`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log('');

  if (testsFailed === 0) {
    console.log('✅ All tests passed!');
    console.log('');
    console.log('The search_pages tool is working correctly.');
    console.log('It can search by caption, page ID, and filter by type.');
  } else {
    console.log('❌ Some tests failed.');
    console.log('');
    console.log('Review the errors above to diagnose the issues.');
  }
  console.log('');

  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
