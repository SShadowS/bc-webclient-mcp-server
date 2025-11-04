/**
 * Direct BC Connection Test (No MCP)
 *
 * Simple test to verify BCSessionClient works in isolation.
 */

import { spawn } from 'child_process';

console.log('Testing direct BC connection...\n');

// Just run the existing dev script which we know works
const proc = spawn('npm', ['run', 'dev:session'], {
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', (code) => {
  console.log(`\nDirect BC test exited with code ${code}`);
  process.exit(code || 0);
});
