# WebSocket Capture Findings - Critical Discovery

**Date**: 2025-10-31
**Goal**: Capture real WebSocket traffic from BC web client to understand how pages are opened

## Executive Summary

**🚨 CRITICAL DISCOVERY**: The real BC web client **does NOT use Navigate or OpenForm** when navigating via URL parameters (e.g., `?page=22`). Instead, it:

1. Creates a **NEW WebSocket connection** for each page
2. Uses **LoadForm interactions** (NOT OpenForm!)
3. Loads **multiple formIds per page** (not just one)

**This completely invalidates our previous Navigate and OpenForm approaches.**

---

## Methodology

### CDP WebSocket Capture

Used improved script with:
- Chrome DevTools Protocol (CDP) for WebSocket frame capture
- Playwright fallback for worker-originated sockets
- Navigated to Pages 22, 31, and 30 via URL parameters

**Capture Results**:
- 82 WebSocket frames captured
- 17 Invoke calls identified
- **0 Navigate interactions found** ❌
- **14 LoadForm interactions found** ✅

---

## Key Findings

### 1. No Navigate Interactions

**Expected**: Navigate interactions with nodeId parameters
**Actual**: Navigate was NEVER used for URL-based navigation

**Interaction Types Found**:
```
InvokeSessionAction: 6
LoadForm: 14
```

### 2. New WebSocket Per Page

When navigating to a new page via URL:
- Browser **closes existing WebSocket**
- Browser **opens NEW WebSocket** with different CSRF token
- Each page gets its own session context

**Example** (Page 22 → Page 31):
```
[PW] WebSocket closed: ws://cronus27/BC/csh?...csrftoken=CfDJ8Ha8...
[PW] WebSocket open: ws://cronus27/BC/csh?...csrftoken=CfDJ8Ha8... (different token)
```

### 3. LoadForm Pattern for Page Loading

Real BC web client uses **LoadForm** to load page content, NOT OpenForm!

**Pattern for Each Page**:

#### Page 22 (Customers List)
```
Open Forms: [269]  ← Shell/container form

LoadForm interactions:
  1. LoadForm formId=265, controlPath="server:", namedParameters={delayed:true, openForm:true, loadData:true}
  2. LoadForm formId=264, controlPath="server:", ...
  3. LoadForm formId=267, controlPath="server:", ...
  4. LoadForm formId=268, controlPath="server:", ...
```

#### Page 31 (Items List)
```
Open Forms: [273]  ← Different shell form

LoadForm interactions:
  1. LoadForm formId=26A, controlPath="server:", ...
  2. LoadForm formId=26B, controlPath="server:", ...
  3. LoadForm formId=26C, controlPath="server:", ...
  4. LoadForm formId=271, controlPath="server:", ...
  5. LoadForm formId=272, controlPath="server:", ...
```

#### Page 30 (Item Card)
```
Open Forms: [27F]  ← Yet another shell form

LoadForm interactions:
  1. LoadForm formId=274, controlPath="server:", ...
  2. LoadForm formId=276, controlPath="server:", ...
  3. LoadForm formId=275, controlPath="server:", ...
  4. LoadForm formId=27C, controlPath="server:", ...
  5. LoadForm formId=27D, controlPath="server:", ...
```

### 4. LoadForm Parameters

Every LoadForm interaction has:
```javascript
{
  interactionName: "LoadForm",
  formId: "265",  // Specific form ID to load
  controlPath: "server:",  // Always "server:"
  callbackId: "3",
  namedParameters: {
    delayed: true,
    openForm: true,
    loadData: true
  }
}
```

### 5. InvokeSessionAction Telemetry

BC sends telemetry data including the page ID:
```javascript
{
  interactionName: "InvokeSessionAction",
  namedParameters: {
    systemAction: 640,
    data: {
      "URL pageId": "22",  // ← Page requested!
      "CompanyName": "CRONUS Danmark A/S",
      "Session Key": "sr63897525388358073328",
      "SpaInstanceId": "mhf0n9ur",
      ...
    }
  }
}
```

---

## Implications

### Why OpenForm Failed

**Our Approach**: `OpenForm` with `Page: "22"` parameter
**Result**: BC created shell/container form only, not actual page content

**Root Cause**: OpenForm creates the **outer shell**, but **LoadForm** loads the **actual page content** (data grids, fields, actions).

### Why Navigate Failed

**Our Approach**: `Navigate` with nodeId from Wireshark or browser URL
**Result**: Still returned shell form, not page content

**Root Cause**: Navigate is for **menu-based navigation**, but URL navigation uses a **completely different mechanism** (new WebSocket + LoadForm).

### The Chicken-and-Egg Problem

**Challenge**: We don't know which formIds correspond to which pages!

**Questions**:
1. How does BC determine formIds (265, 26A, 274, etc.)?
2. Are formIds session-specific or deterministic?
3. How can we discover formIds without browser instrumentation?

---

## Possible Solutions

### Option 1: OpenForm + Discover FormIds

```typescript
// 1. OpenForm creates shell
await connection.invoke({
  interactionName: 'OpenForm',
  namedParameters: { Page: '22' },
  ...
});

// 2. Parse response to extract formIds BC wants us to load
// (Need to examine FormToShow handlers more carefully)

// 3. LoadForm for each discovered formId
for (const formId of discoveredFormIds) {
  await connection.invoke({
    interactionName: 'LoadForm',
    formId: formId,
    controlPath: 'server:',
    namedParameters: {
      delayed: true,
      openForm: true,
      loadData: true
    },
    ...
  });
}
```

**Pros**:
- Uses BC's intended page-opening mechanism
- May work within single session (true user simulation)

**Cons**:
- Need to parse FormToShow handlers to discover formIds
- May require multiple round-trips

### Option 2: Examine FormToShow Handlers More Carefully

Looking at our test logs, BC returns FormToShow handlers with form structure. Maybe these handlers contain **references to child forms** that need LoadForm?

**Action**: Re-examine handler responses from OpenForm to see if formIds are embedded.

### Option 3: Use OData/API Instead

If raw WebSocket protocol is too complex, fall back to OData v4 API which BC exposes.

**Pros**:
- Well-documented REST API
- Direct access to business data

**Cons**:
- Not simulating real user interaction
- May have different permissions/behavior

---

## Next Steps

### Immediate: Examine Handler Responses

1. Re-run test with OpenForm for Page 22
2. Capture full handler response (all handler types, not just FormToShow)
3. Look for:
   - Child form references
   - LoadForm instructions
   - FormId listings

### Follow-up: Test LoadForm Hypothesis

If we can discover formIds from OpenForm response:
1. Parse formIds from handlers
2. Issue LoadForm for each formId
3. Test if this returns correct page metadata

### Alternative: Compare with Wireshark

Re-examine Wireshark capture (`WiresharkWebSocket2.txt`) to see if it shows:
- OpenForm followed by LoadForm pattern
- FormId discovery mechanism
- Different interaction flow than URL navigation

---

## Files Generated

- `websocket-cdp-capture.json` - All 82 WebSocket frames
- `invoke-calls-captured.json` - Filtered 17 Invoke calls
- `analyze-websocket-capture.mjs` - Analysis script
- `WEBSOCKET_CAPTURE_FINDINGS.md` - This document

---

## Conclusion

The WebSocket capture revealed that:

✅ BC web client uses **LoadForm**, not OpenForm or Navigate, for actual page content
✅ Each page requires **multiple LoadForm calls** (4-5 formIds per page)
✅ URL navigation creates **new WebSocket connections**, not in-session navigation
✅ FormIds are **page-specific** (265/264/267/268 for Page 22, 26A/26B/26C/271/272 for Page 31)

❌ Navigate is **NOT used** for URL-based navigation
❌ OpenForm alone is **insufficient** - it only creates the shell/container
❌ We need a **formId discovery mechanism** to know which forms to load

**Critical Next Action**: Examine OpenForm response handlers to see if BC tells us which formIds to LoadForm.
