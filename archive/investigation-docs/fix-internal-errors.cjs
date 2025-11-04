const fs = require('fs');
const path = require('path');

// Files to fix
const files = [
  'src/services/mcp-server.ts',
  'src/services/stdio-transport.ts'
];

files.forEach(filePath => {
  const fullPath = path.join(__dirname, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');

  // Fix InternalError calls with 3 arguments
  // Pattern: new InternalError('message', 'CODE', { context })
  // Replace with: new InternalError('message', { code: 'CODE', ...context })

  // Match: new InternalError(\n  'message',\n  'CODE',\n  { context }\n)
  const regex = /new InternalError\(\s*'([^']+)',\s*'([^']+)',\s*(\{[^}]+\})\s*\)/gs;

  content = content.replace(regex, (match, message, code, context) => {
    // Parse the context object
    const contextContent = context.slice(1, -1).trim(); // Remove { }
    if (contextContent) {
      return `new InternalError(\n            '${message}',\n            { code: '${code}', ${contextContent} }\n          )`;
    } else {
      return `new Internal Error(\n            '${message}',\n            { code: '${code}' }\n          )`;
    }
  });

  // Also handle cases without context object
  const regex2 = /new InternalError\(\s*'([^']+)',\s*'([^']+)'\s*\)/gs;
  content = content.replace(regex2, (match, message, code) => {
    return `new InternalError(\n            '${message}',\n            { code: '${code}' }\n          )`;
  });

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`Fixed ${filePath}`);
});

console.log('Done!');
