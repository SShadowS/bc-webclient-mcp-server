# Enhanced BC Traffic Capture - Usage Guide

## Quick Start

```bash
cd "C:\bc4ubuntu\Decompiled\bc-poc"
node capture-all-traffic.mjs
```

## What This Captures

### WebSocket Traffic (Both Directions)
- ✅ Client → Server (sent messages)
- ✅ Server → Client (received messages)
- ✅ Parsed JSON payloads
- ✅ Timestamps and metadata

### HTTP Traffic (BC-related only)
- ✅ POST requests (with request bodies)
- ✅ PUT requests (with request bodies)
- ✅ PATCH requests (with request bodies)
- ✅ Response status codes
- ✅ Response bodies (parsed as JSON when possible)
- ❌ GET requests (excluded to reduce noise)
- ❌ OPTIONS requests (excluded)

## Capture Session Steps

1. **Start the script**:
   ```bash
   node capture-all-traffic.mjs
   ```

2. **Wait for the browser to open and login to complete**

3. **When you see "📋 READY TO CAPTURE"**, perform these actions in the browser:

   ### Recommended Actions (Focused)

   **For ChangeField Capture**:
   - Click "Edit" button
   - Wait 2 seconds
   - Change "Name" field (type new value + press Tab or Enter)
   - Wait 2 seconds
   - Change "Payment Terms Code" (dropdown)
   - Wait 2 seconds

   **For InvokeAction Capture**:
   - Click "New" button
   - Wait 2 seconds
   - Click "Delete" button (if prompted, cancel)
   - Wait 2 seconds

4. **Press ENTER in the terminal** when done

5. **Check output files**:
   ```bash
   ls -lh captured-*.json
   ```

## Output Files

### captured-websocket.json
Contains all WebSocket messages with structure:
```json
{
  "source": "websocket",
  "direction": "sent" | "received",
  "timestamp": 1730505600000,
  "iso": "2025-11-01T12:00:00.000Z",
  "url": "ws://Cronus27/BC/...",
  "opcode": 1,
  "masked": true,
  "payloadText": "...",
  "payload": { /* parsed JSON */ }
}
```

### captured-http.json
Contains all HTTP requests/responses with structure:
```json
{
  "source": "http",
  "direction": "request",
  "timestamp": 1730505600000,
  "iso": "2025-11-01T12:00:00.000Z",
  "requestId": "...",
  "method": "POST",
  "url": "http://Cronus27/BC/...",
  "postData": "...",
  "postDataParsed": { /* parsed JSON */ },
  "responseStatus": 200,
  "responseStatusText": "OK",
  "responseMimeType": "application/json",
  "responseBody": { /* parsed JSON */ }
}
```

## Why Both WebSocket AND HTTP?

BC may use different protocols for different operations:

1. **WebSocket (SignalR)**: Real-time interactions, form loading, notifications
2. **HTTP POST/PUT/PATCH**: Possible field updates, batch operations, data submission

By capturing both, we ensure we don't miss interactions that might use HTTP instead of WebSocket.

## Troubleshooting

### Script fails to start
```bash
# Check if Playwright is installed
npm list playwright

# Install if missing
npm install playwright
```

### Browser doesn't open
```bash
# Check if chromium is installed
npx playwright install chromium
```

### No data captured
- Ensure you performed actions AFTER seeing "📋 READY TO CAPTURE"
- Wait 2 seconds between actions to ensure messages are sent
- Check if BC is accessible at http://Cronus27/BC/?tenant=default

### Output files are empty
- Verify BC WebSocket connection was established (check browser DevTools)
- Ensure actions were performed (field changes, button clicks)
- Try waiting longer before pressing ENTER (5-10 seconds after last action)

## Next Steps After Capture

1. **Analyze WebSocket traffic**:
   ```bash
   node analyze-full-capture.mjs
   ```

2. **Check HTTP traffic manually**:
   ```bash
   cat captured-http.json | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf-8')).length + ' HTTP requests captured')"
   ```

3. **Search for specific keywords**:
   ```bash
   # Search WebSocket
   cat captured-websocket.json | grep -i "ChangeField"
   cat captured-websocket.json | grep -i "InvokeAction"

   # Search HTTP
   cat captured-http.json | grep -i "Name"
   cat captured-http.json | grep -i "field"
   ```

4. **Compare with tool implementations**:
   - Check if ChangeField interactions match `update-field-tool.ts:179-188`
   - Check if InvokeAction interactions match `execute-action-tool.ts:147-155`

## What We're Looking For

### ChangeField Pattern (Hypothesized)
```json
{
  "interactionName": "ChangeField",
  "namedParameters": {
    "fieldName": "Name",
    "newValue": "Updated Customer Name"
  },
  "callbackId": "...",
  "formId": "...",
  "controlPath": "..."
}
```

### InvokeAction Pattern (Hypothesized)
```json
{
  "interactionName": "InvokeAction",
  "namedParameters": {
    "actionName": "Edit"
  },
  "callbackId": "...",
  "formId": "...",
  "controlPath": "..."
}
```

### Alternative HTTP Patterns
If interactions are not in WebSocket, check HTTP for:
- POST to `/api/...` with field update payloads
- PUT to `/api/...` with entity updates
- PATCH to `/api/...` with partial updates

## Known Limitations

- Captures only BC-related traffic (filters by "Cronus27" or "BC/" in URL)
- Truncates very large response bodies (>10KB) to prevent file bloat
- Requires manual browser interaction (not automated)
- Must be run locally (not via Docker container)
