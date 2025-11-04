import fs from 'fs/promises';

const data = JSON.parse(await fs.readFile('search-response.json', 'utf-8'));
const repeater = data.Children?.[1] || data.Controls?.[1];

console.log('Repeater analysis:');
console.log('  Type:', repeater?.t);
console.log('  MappingHint:', repeater?.MappingHint);
console.log('  Has Value:', repeater?.Value !== undefined);
console.log('  Has Properties.Value:', repeater?.Properties?.Value !== undefined);
console.log('  Value length:', repeater?.Value?.length || repeater?.Properties?.Value?.length || 0);

if (repeater?.Value?.length > 0 || repeater?.Properties?.Value?.length > 0) {
  console.log('\nFirst result:', repeater?.Value?.[0] || repeater?.Properties?.Value?.[0]);
} else {
  console.log('\nNo results - repeater is empty');
}
