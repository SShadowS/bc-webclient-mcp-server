/**
 * Parse MCP test logs to extract BC interactions
 */
import { readFileSync, writeFileSync } from 'fs';

const testLogFile = process.argv[2] || 'C:\\bc4ubuntu\\Decompiled\\bc-poc\\test-true-user-simulation.txt';
const content = readFileSync(testLogFile, 'utf-8');

const lines = content.split('\n');
const interactions = [];

let currentPageRequest = null;

for (const line of lines) {
  // When moving to next page request, save current one FIRST (before creating new one)
  if (line.includes('[GetPageMetadataTool] Requesting metadata for BC Page:') && currentPageRequest && currentPageRequest.interactions.length > 0) {
    interactions.push(currentPageRequest);
    currentPageRequest = null; // Clear so we create fresh one below
  }

  // Capture page metadata requests
  if (line.includes('[GetPageMetadataTool] Requesting metadata for BC Page:')) {
    const match = line.match(/Page: "(\d+)"/);
    if (match) {
      currentPageRequest = { pageId: match[1], interactions: [] };
    }
  }

  // Capture OpenForm interactions
  if (line.includes('🔧 OpenForm:') || line.includes('🔧 LoadForm:') || line.includes('🔧 CloseForm:')) {
    const interactionMatch = line.match(/🔧 (\w+):/);
    const openFormIdsMatch = line.match(/openFormIds=\[(.*?)\]/);
    const trackedFormsMatch = line.match(/tracked forms: (\d+)/);

    if (interactionMatch && currentPageRequest) {
      currentPageRequest.interactions.push({
        type: interactionMatch[1],
        openFormIds: openFormIdsMatch ? openFormIdsMatch[1].split(', ').filter(id => id) : [],
        trackedForms: trackedFormsMatch ? parseInt(trackedFormsMatch[1]) : 0,
      });
    }
  }

  // Capture formId tracking
  if (line.includes('📋 Tracking form:')) {
    const match = line.match(/Page (\d+) → formId (\w+)/);
    if (match && currentPageRequest) {
      const lastInteraction = currentPageRequest.interactions[currentPageRequest.interactions.length - 1];
      if (lastInteraction) {
        lastInteraction.resultFormId = match[2];
        lastInteraction.forPage = match[1];
      }
    }
  }

  // Capture extracted formId
  if (line.includes('Extracted formId from callback:')) {
    const match = line.match(/callback: (\w+)/);
    if (match && currentPageRequest) {
      const lastInteraction = currentPageRequest.interactions[currentPageRequest.interactions.length - 1];
      if (lastInteraction) {
        lastInteraction.extractedFormId = match[1];
      }
    }
  }

  // Capture selected form caption
  if (line.includes('PageMetadataParser] Selected form')) {
    const match = line.match(/Caption: (.+)$/);
    if (match && currentPageRequest) {
      currentPageRequest.resultCaption = match[1].trim();
    }
  }
}

// Save the last page request
if (currentPageRequest && currentPageRequest.interactions.length > 0) {
  interactions.push(currentPageRequest);
}

// Format output
let output = '═══════════════════════════════════════════════════════════\n';
output += 'OUR MCP BC INTERACTIONS\n';
output += '═══════════════════════════════════════════════════════════\n\n';

for (let i = 0; i < interactions.length; i++) {
  const pageReq = interactions[i];
  output += `\n${i + 1}. GET_PAGE_METADATA Request: Page ${pageReq.pageId}\n`;
  output += `   Result: "${pageReq.resultCaption}"\n`;
  output += `───────────────────────────────────────────────────────────\n`;

  for (let j = 0; j < pageReq.interactions.length; j++) {
    const interaction = pageReq.interactions[j];
    output += `\n   ${i + 1}.${j + 1} ${interaction.type}\n`;
    output += `       openFormIds: [${interaction.openFormIds.join(', ')}]\n`;
    output += `       tracked forms: ${interaction.trackedForms}\n`;
    if (interaction.extractedFormId) {
      output += `       → returned formId: ${interaction.extractedFormId}\n`;
    }
    if (interaction.resultFormId) {
      output += `       → tracked as: Page ${interaction.forPage} → formId ${interaction.resultFormId}\n`;
    }
  }
  output += '\n';
}

// Summary statistics
output += '\n═══════════════════════════════════════════════════════════\n';
output += 'SUMMARY\n';
output += '═══════════════════════════════════════════════════════════\n\n';

const totalInteractions = interactions.reduce((sum, req) => sum + req.interactions.length, 0);
const interactionTypes = {};
interactions.forEach(req => {
  req.interactions.forEach(int => {
    interactionTypes[int.type] = (interactionTypes[int.type] || 0) + 1;
  });
});

output += `Total page requests: ${interactions.length}\n`;
output += `Total BC interactions: ${totalInteractions}\n\n`;
output += 'Interaction breakdown:\n';
for (const [type, count] of Object.entries(interactionTypes)) {
  output += `  ${type}: ${count}\n`;
}

// Write to file
writeFileSync('our-bc-calls.txt', output);
console.log('✓ Analysis written to our-bc-calls.txt');
console.log(`  ${interactions.length} page requests analyzed`);
console.log(`  ${totalInteractions} BC interactions captured`);
