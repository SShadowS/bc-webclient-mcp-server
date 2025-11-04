// Debug CSRF token extraction
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const baseUrl = 'http://Cronus27/BC/';
const tenant = 'default';

// Login first to get cookies
const loginPageUrl = `${baseUrl}SignIn?tenant=${tenant}`;
const loginResponse = await fetch(loginPageUrl);
const cookies = loginResponse.headers.raw()['set-cookie'] || [];
const sessionCookies = cookies.map(c => c.split(';')[0]);

const loginHtml = await loginResponse.text();
const $ = cheerio.load(loginHtml);
const token = $('input[name="__RequestVerificationToken"]').val();

// Login with credentials
const formData = new URLSearchParams();
formData.append('userName', 'sshadows');
formData.append('password', process.env.BC_PASSWORD || 'test');
formData.append('__RequestVerificationToken', token);

const loginPost = await fetch(loginPageUrl, {
  method: 'POST',
  body: formData,
  redirect: 'manual',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cookie': sessionCookies.join('; ')
  }
});

// Update cookies
const newCookies = loginPost.headers.raw()['set-cookie'] || [];
newCookies.forEach(cookie => {
  const name = cookie.split('=')[0];
  const idx = sessionCookies.findIndex(c => c.startsWith(name + '='));
  if (idx >= 0) sessionCookies[idx] = cookie.split(';')[0];
  else sessionCookies.push(cookie.split(';')[0]);
});

// Get main page with authenticated cookies
const mainResponse = await fetch(`${baseUrl}?tenant=${tenant}`, {
  headers: { 'Cookie': sessionCookies.join('; ') }
});
const mainHtml = await mainResponse.text();

console.log('=== CSRF Token Search ===\n');

// Try the broad pattern
const broadMatch = mainHtml.match(/CfDJ8[A-Za-z0-9_-]{50,}/);
if (broadMatch) {
  const token = broadMatch[0];
  console.log(`✓ Found CfDJ8 token: ${token.substring(0, 60)}...`);
  console.log(`  Full length: ${token.length} characters\n`);
} else {
  console.log('❌ No CfDJ8 token found\n');
}

// Look for context around the token
const lines = mainHtml.split('\n');
lines.forEach((line, i) => {
  if (line.includes('CfDJ8')) {
    console.log(`Line ${i}: ${line.trim().substring(0, 200)}...`);
  }
});
