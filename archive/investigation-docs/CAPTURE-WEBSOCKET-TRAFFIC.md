# How to Capture BC WebSocket Traffic

**Goal**: Discover the correct way BC closes forms by observing the official web client.

## Procedure

### Step 1: Open BC in Browser with DevTools

1. Open Chrome or Edge browser
2. Navigate to: `http://Cronus27/BC/?tenant=default`
3. Press `F12` to open Developer Tools
4. Click on the **Network** tab
5. Filter by `WS` (WebSocket) - you should see an active WebSocket connection

### Step 2: View WebSocket Messages

1. Click on the WebSocket connection (should be named something like `csh`)
2. Click on the **Messages** tab
3. You will now see all JSON-RPC messages going back and forth

### Step 3: Perform the Test Sequence

Perform these actions in BC while watching the Messages tab:

#### Action 1: Open Customer List (Page 22)
1. In BC, click on "Customers" to open Page 22
2. In DevTools Messages tab, find the `OpenForm` message sent (green arrow ↑)
3. **Copy the entire JSON message** - this shows how to open Page 22

#### Action 2: Close Customer List
1. In BC, close the Customer List page (click X or press Escape)
2. In DevTools Messages tab, find the message sent when closing
3. **Copy this message** - this is the KEY we're looking for!
   - Is it `CloseForm`?
   - Is it `DisposeForm`?
   - Something else?
   - What parameters does it send?

#### Action 3: Open Item Card (Page 30)
1. In BC, navigate to open Page 30 (Items)
2. In DevTools, find the second `OpenForm` message
3. **Copy this message** - compare with the first OpenForm

### Step 4: Analyze the Messages

Compare the captured messages with what our code sends:

#### Questions to Answer:

1. **Form Closing:**
   - What is the exact method name? (`CloseForm`, `DisposeForm`, other?)
   - What parameters are sent? (`ServerId`, `ServerFormHandle`, `FormId`, other?)
   - Is there any other message sent besides the close call?

2. **Form Opening:**
   - Does the second `OpenForm` (Page 30) have different parameters than the first (Page 22)?
   - Is there a `clientInstanceId` or unique identifier?
   - What is in the `openFormIds` array?

3. **Session State:**
   - Are there any messages between closing and opening forms?
   - Does BC send any automatic messages after closing?

### Step 5: Update Code

Based on the captured messages, update `src/connection/bc-session-connection.ts`:

```typescript
// Example based on findings:
await this.client.invoke({
  interactionName: '<ACTUAL_INTERACTION_NAME>',  // From captured traffic
  namedParameters: {
    '<ACTUAL_PARAMETER_NAME>': this.currentFormHandle  // From captured traffic
  },
  openFormIds: [],  // Or based on captured pattern
  lastClientAckSequenceNumber: -1,
});
```

---

## Expected Output

You should see something like this in DevTools:

```json
// Example of what we might find:
{
  "jsonrpc": "2.0",
  "method": "Invoke",
  "params": [{
    "openFormIds": ["39A"],
    "interactionsToInvoke": [{
      "interactionName": "CloseForm",
      "namedParameters": "{\"serverId\":\"39A\"}"  // Might be different!
    }]
  }],
  "id": 123
}
```

The key is to see the **exact** format BC uses when the web client closes a form.

---

## Alternative: Capture with Fiddler or Wireshark

If browser DevTools don't show WebSocket message contents:

1. Install Fiddler Classic or Wireshark
2. Enable WebSocket decryption
3. Perform the same test sequence
4. Export the WebSocket frames
