/**
 * Decompress BC server responses
 * BC uses gzip compression on WebSocket frames
 */

import { readFileSync, writeFileSync } from 'fs';
import { gunzipSync } from 'zlib';

const allFrames = JSON.parse(readFileSync('websocket-cdp-capture.json', 'utf-8'));
const receivedFrames = allFrames.filter(frame => frame.direction === 'received');

console.log(`\n${'═'.repeat(80)}`);
console.log(`  Decompressing BC Server Responses`);
console.log(`  Total received frames: ${receivedFrames.length}`);
console.log(`${'═'.repeat(80)}\n`);

const decompressed = [];

receivedFrames.forEach((frame, i) => {
  const payload = frame.payload;
  if (!payload) return;

  let decompressedData = null;

  // Handle compressedResult (first response)
  if (payload.compressedResult) {
    try {
      const buffer = Buffer.from(payload.compressedResult, 'base64');
      const decompressed = gunzipSync(buffer);
      decompressedData = JSON.parse(decompressed.toString('utf-8'));
      console.log(`[${i + 1}] Decompressed compressedResult - ${decompressed.length} bytes`);
    } catch (e) {
      console.log(`[${i + 1}] Failed to decompress compressedResult: ${e.message}`);
    }
  }

  // Handle compressedData (subsequent responses)
  if (payload.params && payload.params[0] && payload.params[0].compressedData) {
    try {
      const buffer = Buffer.from(payload.params[0].compressedData, 'base64');
      const decompressed = gunzipSync(buffer);
      decompressedData = JSON.parse(decompressed.toString('utf-8'));
      console.log(`[${i + 1}] Decompressed ${payload.params[0].handler} - ${decompressed.length} bytes`);
    } catch (e) {
      console.log(`[${i + 1}] Failed to decompress: ${e.message}`);
    }
  }

  if (decompressedData) {
    decompressed.push({
      frameIndex: i,
      timestamp: frame.iso,
      handler: payload.params?.[0]?.handler || 'result',
      sequenceNumber: payload.params?.[0]?.sequenceNumber,
      data: decompressedData
    });
  }
});

console.log(`\nSuccessfully decompressed: ${decompressed.length} frames\n`);

// Save decompressed data
writeFileSync('decompressed-responses.json', JSON.stringify(decompressed, null, 2));
console.log('Saved to: decompressed-responses.json\n');

// Look for formId patterns
console.log(`${'═'.repeat(80)}`);
console.log(`  Searching for FormId Patterns`);
console.log(`${'═'.repeat(80)}\n`);

decompressed.forEach((item, i) => {
  const dataStr = JSON.stringify(item.data);
  const hasFormId = dataStr.includes('formId') ||
                    dataStr.includes('FormId') ||
                    dataStr.includes('ServerId') ||
                    dataStr.includes('265') || // Known formIds
                    dataStr.includes('264') ||
                    dataStr.includes('267') ||
                    dataStr.includes('268');

  if (hasFormId) {
    console.log(`[${i + 1}] ${item.handler} at ${item.timestamp}`);
    console.log(`    Has formId references: YES`);

    // Try to find specific formId values
    const matches = dataStr.match(/"(?:formId|FormId|ServerId)"\s*:\s*"([^"]+)"/g);
    if (matches) {
      console.log(`    FormIds found:`);
      matches.slice(0, 10).forEach(match => {
        console.log(`      ${match}`);
      });
      if (matches.length > 10) {
        console.log(`      ... and ${matches.length - 10} more`);
      }
    }
    console.log();
  }
});
