import fs from 'fs/promises';

const handler = JSON.parse(await fs.readFile('change-handler.json', 'utf-8'));
const dataChanges = handler.parameters[1].filter(x => x.t === 'DataRefreshChange');

console.log(`Found ${dataChanges.length} DataRefreshChange objects\n`);

dataChanges.forEach((dc, index) => {
  console.log(`=== DataRefresh ${index} ===`);
  console.log(`Control Path: ${dc.ControlReference.controlPath}`);
  console.log(`Rows: ${dc.RowChanges.length}`);

  if (dc.RowChanges.length > 0) {
    const firstRow = dc.RowChanges[0];
    console.log(`\nFirst row structure:`);
    console.log(JSON.stringify(firstRow, null, 2));

    // Save this data change
    fs.writeFile(
      `data-refresh-${index}.json`,
      JSON.stringify(dc, null, 2)
    );
  }
  console.log('\n');
});

// Look specifically at pages (c[1] is the first repeater - pages)
const pagesData = dataChanges.find(dc => dc.ControlReference.controlPath === 'server:c[1]');
if (pagesData && pagesData.RowChanges.length > 0) {
  console.log('=== PAGES DATA ===');
  console.log('Extracting cell data from first few pages...\n');

  pagesData.RowChanges.slice(0, 3).forEach((row, i) => {
    const cells = row.DataRowInserted[1].cells;
    console.log(`Page ${i + 1}:`);
    Object.entries(cells).forEach(([key, value]) => {
      console.log(`  ${key}:`, value.value || value.type || JSON.stringify(value).substring(0, 50));
    });
    console.log('');
  });
}
