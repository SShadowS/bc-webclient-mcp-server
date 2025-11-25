/**
 * Run All BC Flow Tests
 *
 * Executes all test phases in sequence.
 * Usage: node tests/integration/bc-flows/run-all.mjs [phase]
 *
 * Examples:
 *   node tests/integration/bc-flows/run-all.mjs        # Run all phases
 *   node tests/integration/bc-flows/run-all.mjs 1     # Run only Phase 1
 *   node tests/integration/bc-flows/run-all.mjs 1,2   # Run Phases 1 and 2
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const PHASES = [
  { num: 1, name: 'Core Read Operations', file: 'phase1-read-core.mjs' },
  { num: 2, name: 'Filter & Navigation', file: 'phase2-filter-navigation.mjs' },
  { num: 3, name: 'Write Operations', file: 'phase3-write-update.mjs' },
  { num: 4, name: 'Action & Refetch', file: 'phase4-action-refetch.mjs' },
  { num: 5, name: 'Document Operations', file: 'phase5-documents.mjs' },
  { num: 6, name: 'Create/Delete Operations', file: 'phase6-create-delete.mjs' },
  { num: 7, name: 'Advanced Actions', file: 'phase7-advanced-actions.mjs' },
  { num: 8, name: 'Advanced Filtering', file: 'phase8-advanced-filtering.mjs' },
  { num: 9, name: 'Field Validation', file: 'phase9-field-validation.mjs' },
  { num: 10, name: 'Edge Cases & Errors', file: 'phase10-edge-cases.mjs' },
];

async function runPhase(phase) {
  return new Promise((resolve) => {
    console.log('\n' + colors.cyan + '━'.repeat(70) + colors.reset);
    console.log(colors.cyan + `  Running Phase ${phase.num}: ${phase.name}` + colors.reset);
    console.log(colors.cyan + '━'.repeat(70) + colors.reset);

    const scriptPath = path.join(__dirname, phase.file);
    const proc = spawn('node', [scriptPath], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '../../..'), // bc-poc root
      shell: true,
    });

    proc.on('exit', (code) => {
      resolve({ phase: phase.num, success: code === 0 });
    });

    proc.on('error', (error) => {
      console.error(`Failed to run phase ${phase.num}:`, error.message);
      resolve({ phase: phase.num, success: false });
    });
  });
}

async function main() {
  const args = process.argv[2];
  let phasesToRun = PHASES;

  if (args) {
    const requestedPhases = args.split(',').map(n => parseInt(n.trim()));
    phasesToRun = PHASES.filter(p => requestedPhases.includes(p.num));

    if (phasesToRun.length === 0) {
      console.error('No valid phases specified');
      process.exit(1);
    }
  }

  console.log(colors.blue + '\n╔═══════════════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.blue + '║              BC MCP Integration Test Suite                        ║' + colors.reset);
  console.log(colors.blue + '╚═══════════════════════════════════════════════════════════════════╝' + colors.reset);
  console.log('\nPhases to run:', phasesToRun.map(p => `${p.num} (${p.name})`).join(', '));

  const results = [];

  for (const phase of phasesToRun) {
    const result = await runPhase(phase);
    results.push(result);
  }

  // Summary
  console.log('\n' + colors.blue + '╔═══════════════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.blue + '║                        FINAL SUMMARY                              ║' + colors.reset);
  console.log(colors.blue + '╚═══════════════════════════════════════════════════════════════════╝' + colors.reset);

  let allPassed = true;
  for (const result of results) {
    const phase = PHASES.find(p => p.num === result.phase);
    const status = result.success
      ? colors.green + '✓ PASSED' + colors.reset
      : colors.red + '✗ FAILED' + colors.reset;
    console.log(`  Phase ${result.phase} (${phase.name}): ${status}`);
    if (!result.success) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log(colors.green + '  All phases passed!' + colors.reset);
    process.exit(0);
  } else {
    console.log(colors.red + '  Some phases failed.' + colors.reset);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(colors.red + 'Fatal error:' + colors.reset, error);
  process.exit(1);
});
