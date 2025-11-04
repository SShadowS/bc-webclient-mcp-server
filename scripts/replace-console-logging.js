/**
 * Script to replace console.* calls with structured logging
 * Run with: node scripts/replace-console-logging.js
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Files to update
const filesToUpdate = [
  'src/tools/*.ts',
  'src/parsers/*.ts',
  'src/util/*.ts',
  'src/connection/*.ts',
  'src/index.ts',
  'src/index-session.ts',
  'src/index-signalr.ts',
  'src/BCRawWebSocketClient.ts',
  'src/BCWebSocketClient.ts',
  'src/BCSignalRClient.ts',
  'src/auth.ts',
  'src/test-mcp-server-real.ts'
];

// Map console methods to logger methods
const methodMap = {
  'console.error': 'logger.error',
  'console.log': 'logger.info',
  'console.warn': 'logger.warn',
  'console.debug': 'logger.debug',
  'console.info': 'logger.info'
};

function processFile(filePath) {
  console.log(`Processing ${filePath}...`);

  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;

  // Check if file uses console.*
  const hasConsoleUsage = /console\.(log|error|warn|debug|info)/.test(content);
  if (!hasConsoleUsage) {
    return false;
  }

  // Add logger import if not present and file uses console
  const hasLoggerImport = content.includes("from '../core/logger");
  if (!hasLoggerImport) {
    // Determine the correct import path based on file location
    const fileDir = path.dirname(filePath);
    const relativePath = path.relative(fileDir, path.join(__dirname, '../src/core/logger.js'));
    const importPath = relativePath.replace(/\\/g, '/').replace(/\.js$/, '');

    // Add import after last import statement
    const lastImportMatch = content.match(/(import[^;]+;)(?![\s\S]*import[^;]+;)/);
    if (lastImportMatch) {
      const lastImport = lastImportMatch[0];
      const importStatement = `\nimport { logger, createToolLogger } from '${importPath.startsWith('.') ? importPath : './' + importPath}.js';`;
      content = content.replace(lastImport, lastImport + importStatement);
    }
  }

  // For tool files, create a logger instance at the start of executeInternal
  if (filePath.includes('/tools/') && !filePath.includes('base-tool')) {
    // Find the executeInternal method
    const executeInternalRegex = /(protected async executeInternal\([^)]*\)[^{]*{)/g;
    content = content.replace(executeInternalRegex, (match, methodStart) => {
      // Check if logger is already created
      if (content.includes('const logger = createToolLogger')) {
        return match;
      }

      // Extract tool name from class
      const classMatch = filePath.match(/([^/\\]+)-tool\.ts$/);
      const toolName = classMatch ? classMatch[1].replace(/-/g, '_') : 'unknown';

      // Add logger creation
      return `${methodStart}
    const logger = createToolLogger('${toolName}', (input as any)?.pageContextId);
`;
    });
  }

  // Replace console.* calls
  Object.entries(methodMap).forEach(([consoleMethod, loggerMethod]) => {
    // Handle console.error with [ToolName] prefix
    if (consoleMethod === 'console.error') {
      // Pattern 1: console.error(`[ToolName] message`)
      const pattern1 = /console\.error\(`\[([^\]]+)\]\s*([^`]*)`/g;
      content = content.replace(pattern1, (match, toolName, message) => {
        // If in a tool file, use local logger, otherwise use global
        if (filePath.includes('/tools/') && !filePath.includes('base-tool')) {
          return `logger.info(\`${message}\``;
        }
        return `logger.info(\`${message}\``;
      });

      // Pattern 2: console.error('string') or console.error("string")
      const pattern2 = /console\.error\((['"`])([^'"`]*)\1/g;
      content = content.replace(pattern2, (match, quote, message) => {
        // Remove [ToolName] prefix if present
        const cleanMessage = message.replace(/^\[[^\]]+\]\s*/, '');
        return `${loggerMethod}(${quote}${cleanMessage}${quote}`;
      });

      // Pattern 3: console.error(expression) - for complex expressions
      const pattern3 = /console\.error\(([^)]+)\)/g;
      content = content.replace(pattern3, (match, expression) => {
        // Skip if already replaced
        if (match.includes('logger.')) {
          return match;
        }
        return `${loggerMethod}(${expression})`;
      });
    } else {
      // Simple replacement for other console methods
      const regex = new RegExp(consoleMethod.replace('.', '\\.'), 'g');
      content = content.replace(regex, loggerMethod);
    }
  });

  // Write back if changed
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated ${filePath}`);
    return true;
  }

  return false;
}

// Process all files
let totalUpdated = 0;
let totalFiles = 0;

filesToUpdate.forEach(pattern => {
  const files = glob.sync(pattern, {
    cwd: path.join(__dirname, '..'),
    absolute: true
  });

  files.forEach(file => {
    totalFiles++;
    if (processFile(file)) {
      totalUpdated++;
    }
  });
});

console.log(`\nCompleted: Updated ${totalUpdated} of ${totalFiles} files`);