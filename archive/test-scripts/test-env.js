/**
 * Test script to verify .env file is being loaded correctly
 *
 * Run this to check if your .env file is in the right place and being loaded.
 *
 * Usage:
 *   node test-env.js
 */

import 'dotenv/config';

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  .env File Test                                          ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');

// Check if .env file was loaded
console.log('Testing environment variable loading...\n');

const envVars = {
  'BC_BASE_URL': process.env.BC_BASE_URL,
  'BC_USERNAME': process.env.BC_USERNAME,
  'BC_PASSWORD': process.env.BC_PASSWORD,
  'BC_TENANT_ID': process.env.BC_TENANT_ID,
  'BC_COMPANY_NAME': process.env.BC_COMPANY_NAME,
  'BC_ENVIRONMENT': process.env.BC_ENVIRONMENT,
  'ROLE_CENTER_PAGE_ID': process.env.ROLE_CENTER_PAGE_ID,
  'AZURE_CLIENT_ID': process.env.AZURE_CLIENT_ID,
  'AZURE_TENANT_ID': process.env.AZURE_TENANT_ID,
  'AZURE_AUTHORITY': process.env.AZURE_AUTHORITY,
};

let hasValues = false;

for (const [key, value] of Object.entries(envVars)) {
  if (value) {
    hasValues = true;
    // Mask sensitive values
    if (key.includes('PASSWORD') || key.includes('SECRET')) {
      console.log(`✓ ${key.padEnd(25)} = ${'*'.repeat(value.length)}`);
    } else {
      console.log(`✓ ${key.padEnd(25)} = ${value}`);
    }
  } else {
    console.log(`✗ ${key.padEnd(25)} = (not set)`);
  }
}

console.log('');
console.log('─'.repeat(63));
console.log('');

// Determine authentication method
const hasNavUserPassword = !!(process.env.BC_USERNAME && process.env.BC_PASSWORD);
const hasOAuth = !!(process.env.AZURE_CLIENT_ID);

if (hasNavUserPassword) {
  console.log('✅ NavUserPassword authentication detected');
  console.log('   Username:', process.env.BC_USERNAME);
  if (process.env.BC_TENANT_ID) {
    console.log('   Tenant:  ', process.env.BC_TENANT_ID);
    console.log('   Format:  ', `${process.env.BC_TENANT_ID}\\${process.env.BC_USERNAME}`);
  }
  console.log('');
  console.log('✓ Configuration looks good! Try running:');
  console.log('  npm run dev');
} else if (hasOAuth) {
  console.log('✅ OAuth/Azure AD authentication detected');
  console.log('   Client ID:', process.env.AZURE_CLIENT_ID);
  console.log('   Tenant ID:', process.env.AZURE_TENANT_ID);
  console.log('');
  console.log('✓ Configuration looks good! Try running:');
  console.log('  npm run dev');
} else if (hasValues) {
  console.log('⚠️  Variables loaded, but incomplete configuration');
  console.log('');
  console.log('For NavUserPassword, you need:');
  console.log('  - BC_BASE_URL');
  console.log('  - BC_USERNAME');
  console.log('  - BC_PASSWORD');
  console.log('');
  console.log('For OAuth/Azure AD, you need:');
  console.log('  - BC_BASE_URL');
  console.log('  - AZURE_CLIENT_ID');
  console.log('  - AZURE_TENANT_ID');
  console.log('  - AZURE_AUTHORITY');
} else {
  console.log('❌ No environment variables loaded!');
  console.log('');
  console.log('This means your .env file is missing or not being loaded.');
  console.log('');
  console.log('Steps to fix:');
  console.log('  1. Check if .env file exists:');
  console.log('     ls -la .env         (Linux/Mac)');
  console.log('     dir .env            (Windows)');
  console.log('');
  console.log('  2. If missing, create it:');
  console.log('     cp .env.example .env');
  console.log('');
  console.log('  3. Edit .env and add your credentials:');
  console.log('     nano .env           (Linux/Mac)');
  console.log('     notepad .env        (Windows)');
  console.log('');
  console.log('  4. Run this test again:');
  console.log('     node test-env.js');
}

console.log('');
console.log('═'.repeat(63));
