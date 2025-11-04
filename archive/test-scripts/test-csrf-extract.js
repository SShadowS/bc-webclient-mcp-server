// Test CSRF token extraction
import fetch from 'node-fetch';

const baseUrl = 'http://Cronus27/BC/';
const tenant = 'default';

// Simulate getting the main page
const response = await fetch(`${baseUrl}?tenant=${tenant}`);
const html = await response.text();

console.log('=== Looking for CSRF token in page ===\n');

// Try different patterns
const patterns = [
  /csrftoken['":\s=]+([A-Za-z0-9_-]+)/i,
  /csrftoken["'\s:=]+["']([A-Za-z0-9_-]+)["']/i,
  /data-csrf-token=["']([A-Za-z0-9_-]+)["']/i,
  /"csrfToken":\s*"([A-Za-z0-9_-]+)"/i,
  /csrfToken:\s*"([A-Za-z0-9_-]+)"/i,
];

patterns.forEach((pattern, i) => {
  const match = html.match(pattern);
  if (match) {
    console.log(`Pattern ${i+1} MATCHED: ${match[1].substring(0, 30)}...`);
  }
});

// Look for any long base64-like strings that might be the token
const longStrings = html.match(/CfDJ8[A-Za-z0-9_-]{50,}/g);
if (longStrings) {
  console.log('\nFound Base64-like strings starting with CfDJ8:');
  longStrings.slice(0, 5).forEach(s => {
    console.log(`  ${s.substring(0, 60)}...`);
  });
}

// Save a snippet around where we might expect to find it
const scriptTags = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi);
if (scriptTags) {
  console.log(`\nFound ${scriptTags.length} script tags`);
  scriptTags.slice(0, 3).forEach((tag, i) => {
    if (tag.toLowerCase().includes('csrf') || tag.includes('CfDJ8')) {
      console.log(`\nScript ${i+1} contains CSRF or CfDJ8:`);
      console.log(tag.substring(0, 500));
    }
  });
}
