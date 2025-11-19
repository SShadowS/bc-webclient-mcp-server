#!/usr/bin/env node
/**
 * Generate BC protocol message fixtures with compressed handlers
 */
import { gzipSync } from 'zlib';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function compress(data) {
  const json = JSON.stringify(data);
  const compressed = gzipSync(json);
  return compressed.toString('base64');
}

// 1. Message with compressedResult
const messageCompressedResult = {
  method: 'Message',
  params: [
    {
      sequenceNumber: 42,
      openFormIds: ['page21'],
      compressedResult: compress([
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: ['FormToShow', { ServerId: 'page21', Caption: 'Customer Card' }],
        },
      ]),
    },
  ],
};

// 2. Message with compressedData (LoadForm async response)
const messageCompressedData = {
  method: 'Message',
  params: [
    {
      sequenceNumber: 43,
      compressedData: compress([
        {
          handlerType: 'DN.LoadFormHandler',
          parameters: [
            'formId',
            {
              controls: [],
              caption: 'Customer List',
            },
          ],
        },
      ]),
    },
  ],
};

// 3. Top-level compressedResult
const topLevelCompressed = {
  compressedResult: compress([
    {
      handlerType: 'DN.TopLevelHandler',
      parameters: ['test'],
    },
  ]),
};

// 4. JSON-RPC result.compressedResult
const jsonrpcCompressed = {
  jsonrpc: '2.0',
  id: 'request-123',
  result: {
    compressedResult: compress([
      {
        handlerType: 'DN.JsonRpcHandler',
        parameters: ['rpc'],
      },
    ]),
  },
};

// 5. Malformed message (invalid base64)
const malformedMessage = {
  method: 'Message',
  params: [
    {
      sequenceNumber: 44,
      compressedResult: 'invalid-base64!!!',
    },
  ],
};

// 6. Session info handlers
const sessionInfoHandlers = {
  method: 'Message',
  params: [
    {
      sequenceNumber: 1,
      compressedResult: compress([
        {
          handlerType: 'DN.LogicalClientSetupHandler',
          parameters: [
            {
              ServerSessionId: 'session-abc-123',
              SessionKey: 'key-xyz-789',
              CompanyName: 'CRONUS USA, Inc.',
              nested: {
                deeper: {
                  extraData: true,
                },
              },
            },
          ],
        },
        {
          handlerType: 'DN.LogicalClientEventRaisingHandler',
          parameters: [
            'FormToShow',
            { ServerId: 'page9022', Caption: 'Role Center' },
          ],
        },
      ]),
    },
  ],
};

// Write fixtures
writeFileSync(
  join(__dirname, 'message-compressed-result.json'),
  JSON.stringify(messageCompressedResult, null, 2)
);

writeFileSync(
  join(__dirname, 'message-compressed-data.json'),
  JSON.stringify(messageCompressedData, null, 2)
);

writeFileSync(
  join(__dirname, 'top-level-compressed.json'),
  JSON.stringify(topLevelCompressed, null, 2)
);

writeFileSync(
  join(__dirname, 'jsonrpc-compressed.json'),
  JSON.stringify(jsonrpcCompressed, null, 2)
);

writeFileSync(
  join(__dirname, 'malformed-message.json'),
  JSON.stringify(malformedMessage, null, 2)
);

writeFileSync(
  join(__dirname, 'session-info-handlers.json'),
  JSON.stringify(sessionInfoHandlers, null, 2)
);

console.log('✅ Fixtures generated successfully');
