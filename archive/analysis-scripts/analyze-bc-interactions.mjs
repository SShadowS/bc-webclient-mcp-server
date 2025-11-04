#!/usr/bin/env node
/**
 * Analyze Captured BC Interactions
 *
 * Analyzes the JSON files created by capture-bc-interactions.mjs
 * and extracts patterns for implementing MCP tools.
 *
 * Usage:
 *   node analyze-bc-interactions.mjs [capture-file.json]
 *   or
 *   node analyze-bc-interactions.mjs  (analyzes all files in bc-interaction-captures/)
 */

import fs from 'fs/promises';
import path from 'path';

const CAPTURES_DIR = './bc-interaction-captures';

async function main() {
  const args = process.argv.slice(2);

  let files = [];

  if (args.length > 0) {
    // Analyze specific file
    files = args;
  } else {
    // Analyze all files in captures directory
    try {
      const entries = await fs.readdir(CAPTURES_DIR);
      files = entries
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(CAPTURES_DIR, f));
    } catch (e) {
      console.error(`❌ Could not read ${CAPTURES_DIR}: ${e.message}`);
      console.error('\nMake sure to run capture-bc-interactions.mjs first!');
      process.exit(1);
    }
  }

  if (files.length === 0) {
    console.error('❌ No capture files found!');
    console.error('\nRun: node capture-bc-interactions.mjs');
    process.exit(1);
  }

  console.log('🔍 BC Interaction Analysis');
  console.log('════════════════════════════════════════════════════════════\n');
  console.log(`Found ${files.length} capture file(s)\n`);

  // Analyze each file
  for (const file of files) {
    await analyzeFile(file);
  }
}

async function analyzeFile(filepath) {
  console.log(`\n📄 Analyzing: ${path.basename(filepath)}`);
  console.log('─'.repeat(60));

  const content = await fs.readFile(filepath, 'utf-8');
  const data = JSON.parse(content);

  console.log(`Captured at: ${data.capturedAt}`);
  console.log(`Total messages: ${data.totalMessages}`);
  console.log(`Interaction groups: ${data.interactionCount}\n`);

  // Extract unique interaction names
  const interactionNames = new Set();
  const interactionExamples = new Map();

  for (const group of data.interactions || []) {
    for (const msg of group) {
      if (msg.direction === 'sent' &&
          msg.payload.arguments &&
          msg.payload.arguments[0] &&
          msg.payload.arguments[0].interactionName) {

        const interaction = msg.payload.arguments[0];
        const name = interaction.interactionName;

        interactionNames.add(name);

        // Store first example of each interaction type
        if (!interactionExamples.has(name)) {
          interactionExamples.set(name, {
            sent: interaction,
            responses: [],
          });
        }

        // Find responses for this interaction
        const example = interactionExamples.get(name);
        for (const respMsg of group) {
          if (respMsg.direction === 'received') {
            example.responses.push(respMsg.payload);
          }
        }
      }
    }
  }

  console.log('🎯 Interaction Types Found:');
  for (const name of Array.from(interactionNames).sort()) {
    console.log(`   - ${name}`);
  }

  console.log('\n📋 Detailed Analysis:\n');

  for (const [name, example] of interactionExamples.entries()) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Interaction: ${name}`);
    console.log('═'.repeat(60));

    console.log('\n📤 Sent:');
    console.log(JSON.stringify(example.sent, null, 2));

    console.log('\n📥 Responses:');
    if (example.responses.length === 0) {
      console.log('  (No responses captured)');
    } else {
      for (let i = 0; i < Math.min(example.responses.length, 3); i++) {
        console.log(`\n  Response ${i + 1}:`);
        console.log(JSON.stringify(example.responses[i], null, 2));
      }

      if (example.responses.length > 3) {
        console.log(`\n  ... and ${example.responses.length - 3} more responses`);
      }
    }

    // Extract pattern insights
    console.log('\n💡 Pattern Insights:');
    analyzePattern(name, example.sent);
  }

  // Build and save control index from all handlers
  console.log('\n🧭 Building control index from handlers...');
  const allHandlers = [];
  for (const group of data.interactions || []) {
    for (const msg of group) {
      if (msg.direction === 'received' && msg.payload && Array.isArray(msg.payload.arguments)) {
        const arr = msg.payload.arguments[0];
        if (Array.isArray(arr)) allHandlers.push(...arr);
      }
    }
  }

  const controlIndex = buildControlIndexFromHandlers(allHandlers);
  console.log(`   Found ${Object.keys(controlIndex.fieldsByName).length} fields`);
  console.log(`   Found ${Object.keys(controlIndex.actionsByName).length} actions`);
  console.log(`   Found ${Object.keys(controlIndex.subpagesByName).length} subpages`);

  await writeControlIndexSidecar(filepath, data, controlIndex);
}

function analyzePattern(interactionName, interaction) {
  const insights = [];

  // Check for common patterns
  if (interaction.namedParameters) {
    insights.push(`Uses namedParameters: ${Object.keys(interaction.namedParameters).join(', ')}`);
  }

  if (interaction.controlPath) {
    insights.push(`Control path: ${interaction.controlPath}`);
  }

  if (interaction.formId) {
    insights.push(`Requires formId: ${interaction.formId}`);
  }

  if (interaction.systemAction !== undefined) {
    insights.push(`System action: ${interaction.systemAction}`);
  }

  // Specific interaction insights (updated to camelCase)
  switch (interactionName) {
    case 'InvokeAction':
      insights.push('🔘 Button/Action Click');
      insights.push('MCP Tool: executeAction(pageId, actionName)');
      break;

    case 'ChangeField':
    case 'UpdateControl':
      insights.push('📝 Field Update');
      insights.push('MCP Tool: updateField(pageId, fieldName, value)');
      break;

    case 'Navigate':
      insights.push('🧭 Record Navigation');
      insights.push('MCP Tool: navigateRecord(pageId, direction)');
      break;

    case 'SetFilter':
    case 'ApplyFilter':
      insights.push('🔍 Filter Operation');
      insights.push('MCP Tool: applyColumnFilter(pageId, fieldName, filterExpression)');
      break;

    case 'SelectRow':
    case 'SetSelection':
      insights.push('✅ Row Selection');
      insights.push('MCP Tool: selectRow(pageId, rowIndex)');
      break;

    case 'InsertRecord':
    case 'CreateNew':
      insights.push('➕ Record Creation');
      insights.push('MCP Tool: createRecord(pageId, fields)');
      break;

    case 'DeleteRecord':
      insights.push('🗑️ Record Deletion');
      insights.push('MCP Tool: deleteRecord(pageId, recordId)');
      break;
  }

  for (const insight of insights) {
    console.log(`   ${insight}`);
  }

  if (insights.length === 0) {
    console.log('   (No specific pattern insights)');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ControlPath Mapping/Indexer
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Builds a control index from DN.UpdateFormProperties handlers.
 * Extracts fields, actions, and subpages with their controlPaths for name resolution.
 */
function buildControlIndexFromHandlers(handlers) {
  const index = {
    fieldsByName: {},     // e.g., Name -> { controlPath, serverId, dataType?, sourceExpr?, caption? }
    actionsByName: {},    // e.g., Edit -> { controlPath, serverId, caption? }
    subpagesByName: {},   // e.g., "Sales Lines" -> { controlPath, serverId, columnsByName: { Quantity: {...} } }
    aliases: {            // lowercased/slugified lookup to canonical key
      fields: {},
      actions: {},
      subpages: {}
    }
  };

  const updateHandlers = (handlers || []).filter(h => h && h.handlerType === 'DN.UpdateFormProperties');

  for (const h of updateHandlers) {
    const params = Array.isArray(h.parameters) ? h.parameters : [];
    for (const p of params) {
      walkAndCollect(p, index);
    }
  }
  return index;
}

function walkAndCollect(node, index, parent = null) {
  if (!node || typeof node !== 'object') return;

  // Detect control-like nodes (heuristics)
  // We look for any combination of: Name/Caption, serverId/formId, controlPath/path, kind/type
  const name = node.Name || node.Caption || node.DisplayName;
  const controlPath = node.controlPath || node.ControlPath || node.Path;
  const serverId = node.serverId || node.ServerId || node.formId || node.FormId;
  const kind = (node.kind || node.Kind || node.controlType || node.Type || '').toString();

  // Classify: action vs field vs subpage/part
  if (name && controlPath) {
    if (isActionNode(node, kind)) {
      addAction(index, name, { controlPath, serverId, caption: node.Caption || node.Name });
    } else if (isSubpageNode(node, kind)) {
      addSubpage(index, name, { controlPath, serverId, caption: node.Caption || node.Name });
    } else if (isFieldNode(node, kind)) {
      addField(index, name, {
        controlPath,
        serverId,
        caption: node.Caption || node.Name,
        dataType: node.DataType || undefined,
        sourceExpr: node.SourceExpr || node.FieldName || undefined
      });
    }
  }

  // Repeater/subpage columns (common patterns: Columns/Fields/Children/Controls)
  if (isSubpageNode(node, kind)) {
    const cols = node.Columns || node.Fields || node.Children || node.Controls || [];
    for (const col of (Array.isArray(cols) ? cols : [])) {
      const colName = col.Name || col.Caption;
      const colPath = col.controlPath || col.ControlPath || col.Path;
      const colServerId = col.serverId || col.ServerId;
      if (colName && colPath) {
        addSubpageColumn(index, name, colName, { controlPath: colPath, serverId: colServerId, caption: col.Caption || col.Name });
      }
    }
  }

  // Recurse arrays and child containers
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) walkAndCollect(child, index, node);
    } else if (val && typeof val === 'object') {
      walkAndCollect(val, index, node);
    }
  }
}

function isActionNode(node, kind) {
  // Heuristics: Action controls often have Kind/Type containing 'Action' or an 'OnAction' trigger.
  return /action/i.test(kind) || node.OnAction || node.ActionName;
}

function isSubpageNode(node, kind) {
  // Heuristics: Parts/Subpages/FactBoxes
  return /part|subpage|factbox/i.test(kind) || node.SubPageLink || node.PagePartID || node.PartType;
}

function isFieldNode(node, kind) {
  // Exclude explicit Actions/Parts
  if (isActionNode(node, kind) || isSubpageNode(node, kind)) return false;
  // Heuristics: fields often have SourceExpr/FieldName/DataType
  return !!(node.SourceExpr || node.FieldName || node.DataType || /field|textbox|dropdown|boolean|date|decimal/i.test(kind));
}

function addAction(index, name, info) {
  const key = canonicalKey(name);
  index.actionsByName[name] = info;
  index.aliases.actions[key] = name;
}

function addField(index, name, info) {
  const key = canonicalKey(name);
  index.fieldsByName[name] = info;
  index.aliases.fields[key] = name;
}

function addSubpage(index, name, info) {
  const key = canonicalKey(name);
  if (!index.subpagesByName[name]) {
    index.subpagesByName[name] = { ...info, columnsByName: {}, aliases: {} };
  }
  index.aliases.subpages[key] = name;
}

function addSubpageColumn(index, subpageName, colName, info) {
  if (!index.subpagesByName[subpageName]) return;
  index.subpagesByName[subpageName].columnsByName[colName] = info;
  const key = canonicalKey(colName);
  index.subpagesByName[subpageName].aliases[key] = colName;
}

function canonicalKey(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s/g, '_');
}

function extractFormIdFromHandlers(data) {
  for (const group of data.interactions || []) {
    for (const msg of group) {
      if (msg.direction === 'received' && msg.payload?.arguments?.[0]) {
        const arr = msg.payload.arguments[0];
        for (const h of (Array.isArray(arr) ? arr : [])) {
          if (h.handlerType === 'DN.CallbackResponseProperties') {
            const p0 = h.parameters?.[0];
            const ci = p0?.CompletedInteractions;
            if (Array.isArray(ci) && ci[0]?.Result?.value) return ci[0].Result.value;
          }
        }
      }
    }
  }
  return null;
}

// Best-effort page id from first OpenForm sent
function tryExtractPageIdFromOpenForm(data) {
  for (const group of data.interactions || []) {
    for (const msg of group) {
      const arg0 = msg?.payload?.arguments?.[0];
      if (msg.direction === 'sent' && arg0?.interactionName === 'OpenForm') {
        const q = arg0?.namedParameters?.query || '';
        const m = String(q).match(/page=(\d+)/);
        if (m) return m[1];
      }
    }
  }
  return null;
}

async function writeControlIndexSidecar(filepath, data, controlIndex) {
  const dir = path.dirname(filepath);
  const base = path.basename(filepath, '.json');
  const out = path.join(dir, `${base}-controls.json`);

  // Try to extract a formId from any CallbackResponseProperties
  const formId = extractFormIdFromHandlers(data);
  const sidecar = {
    meta: {
      captureFile: path.basename(filepath),
      capturedAt: data.capturedAt,
      pageId: tryExtractPageIdFromOpenForm(data) || null,
      formId: formId || null
    },
    maps: controlIndex
  };
  await fs.writeFile(out, JSON.stringify(sidecar, null, 2));
  console.log(`🧭 Wrote control map: ${path.basename(out)}`);
}

main().catch(console.error);
