const fs = require('fs');

const form = JSON.parse(fs.readFileSync('./responses/page-21-logical-form.json', 'utf8'));

console.log('=== CUSTOMER CARD STRUCTURE ANALYSIS ===\n');

console.log(`Page: ${form.Caption}`);
console.log(`Form ID: ${form.ServerId}`);
console.log(`Cache Key: ${form.CacheKey}`);
console.log(`App: ${form.AppName} by ${form.AppPublisher}`);
console.log();

// Find all control types
const controlTypes = new Map();

function walkControls(obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return;

  if (obj.t) {
    const type = obj.t;
    const count = controlTypes.get(type) || 0;
    controlTypes.set(type, count + 1);

    // Show first few of each type
    if (count < 3) {
      console.log(`${type}: ${obj.Caption || obj.DesignName || obj.Name || '(unnamed)'}`);
      if (obj.Enabled !== undefined) console.log(`  Enabled: ${obj.Enabled}`);
      if (obj.SystemAction) console.log(`  SystemAction: ${obj.SystemAction}`);
      if (obj.ControlIdentifier) console.log(`  ID: ${obj.ControlIdentifier}`);
    }
  }

  if (Array.isArray(obj.Children)) {
    for (const child of obj.Children) {
      walkControls(child, depth + 1);
    }
  }

  // Also check other arrays
  for (const key in obj) {
    if (Array.isArray(obj[key]) && key !== 'Children') {
      for (const item of obj[key]) {
        walkControls(item, depth + 1);
      }
    }
  }
}

walkControls(form);

console.log('\n=== CONTROL TYPE SUMMARY ===\n');
for (const [type, count] of [...controlTypes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${type.padEnd(10)}: ${count}`);
}
