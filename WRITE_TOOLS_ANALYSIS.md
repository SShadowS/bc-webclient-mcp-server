# BC Write Tools Analysis - GPT-5 Pro Expert Review

**Date**: 2025-01-02
**Analyst**: GPT-5 Pro (via Zen MCP thinkdeep)
**Status**: ✅ Root cause identified, solution designed

---

## Executive Summary

The `write_page_data` and `execute_action` tools **ARE WORKING CORRECTLY** at the protocol level. The issue is **architectural** - each tool creates a new BC session, causing state loss between operations.

### Test Results
- ✅ `execute_action` successfully executes Edit action
- ✅ `write_page_data` successfully updates fields via SaveValue
- ❌ Verification fails because re-reading opens a NEW session with a fresh empty record

### Root Cause
**Each MCP tool invocation creates a disposable BC session:**
```
Tool Call 1 (get_page_metadata): Session A → formId 7CA → Close
Tool Call 2 (read_page_data):    Session B → formId 7E8 → Close
Tool Call 3 (write_page_data):   Session B → formId 7E8 → Write → Close
Tool Call 4 (read_page_data):    Session C → formId 806 → NEW RECORD!
```

**Real BC Web Client behavior:**
- Maintains single WebSocket for entire user session
- Pages remain open (tracked by formId)
- Multiple operations use same formId
- Changes committed via explicit Save/OK

---

## GPT-5 Pro Analysis

### Problem Context

BC uses a "Logical Client" architecture where:
- **FormIds are NOT stable across sessions** (7CA vs 7E8 vs 806)
- **Control paths are NOT stable across sessions** (c[2]/c[2]/c[1] fails randomly)
- **Each new session opens fresh page state** (empty records for cards, unfiltered lists)

### What IS Stable vs NOT Stable

| Stable Across Sessions | NOT Stable Across Sessions |
|------------------------|----------------------------|
| Table IDs (18 = Customer) | FormId (7CA, 7E8, 806, ...) |
| Field numbers (No.=1, Name=2) | Control paths (c[x]/c[y]) |
| Field names | Per-instance column IDs |
| Page IDs (21, 22) | Session state (filters, edits) |

---

## Recommended Solution: Connection Pooling + Session Context

GPT-5 Pro evaluated 4 options and recommends **combining Options 1 & 4**:

### Option 1: Connection Pooling ⭐ **RECOMMENDED PRIMARY**

**Pros:**
- Keeps single BC session alive across tool calls
- Stabilizes formId, control paths, and in-flight state
- Matches real BC web client behavior
- Solves both write-and-verify AND path instability

**Cons:**
- Requires session manager component
- Need lifecycle/TTL handling

**Fit:** ✅ Best match for MCP multi-tool workflows

### Option 4: Session Context Parameter ⭐ **RECOMMENDED COMPLEMENT**

**Pros:**
- Makes session reuse explicit
- Each tool accepts `sessionId` to attach to existing connection
- Gives deterministic control over when tools share state

**Cons:**
- Requires plumbing parameter through orchestration

**Fit:** ✅ Complements pooling with explicit control

### Option 2: Bookmark-Based Navigation ⚠️ **FALLBACK**

**Pros:**
- Good for reopening specific records

**Cons:**
- Doesn't solve control path instability
- Doesn't preserve transient UI state (filters)
- Still creates new form instance

**Fit:** Use when session reuse impossible

### Option 3: Auto-Save on Write ✅ **ENABLE REGARDLESS**

**Pros:**
- Ensures data committed even if session dies
- Helps if verification uses data API

**Cons:**
- Doesn't solve UI verification flakiness
- Still subject to new-session states

**Fit:** Good addition but not substitute for pooling

---

## Recommended Implementation Design

### 1. ConnectionManager (Session Pooling)

Create a singleton manager that pools BC sessions:

```typescript
// src/connection/connection-manager.ts

interface SessionInfo {
  sessionId: string;
  client: BCRawWebSocketClient;
  connection: BCPageConnection;
  formRegistry: Map<string, FormInfo>; // pageId -> FormInfo
  lastUsed: Date;
  environment: string; // baseUrl + tenant + user
}

interface FormInfo {
  formId: string;
  pageId: string;
  caption: string;
  listControlPath?: string;
  quickFilterPath?: string;
  openedAt: Date;
}

export class ConnectionManager {
  private static instance: ConnectionManager;
  private sessions: Map<string, SessionInfo> = new Map();
  private readonly SESSION_TTL = 15 * 60 * 1000; // 15 min (below BC idle timeout)

  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  /**
   * Get or create a BC session for the given environment.
   * Returns sessionId that can be passed to subsequent tool calls.
   */
  public async getOrCreateSession(
    baseUrl: string,
    username: string,
    password: string,
    tenantId: string
  ): Promise<{ sessionId: string; connection: BCPageConnection }> {
    const envKey = `${baseUrl}|${tenantId}|${username}`;

    // Check for existing session
    const existing = this.sessions.get(envKey);
    if (existing && !this.isExpired(existing)) {
      existing.lastUsed = new Date();
      console.error(`[ConnectionManager] ♻️ Reusing session: ${existing.sessionId}`);
      return {
        sessionId: existing.sessionId,
        connection: existing.connection
      };
    }

    // Create new session
    console.error(`[ConnectionManager] 🆕 Creating new session for ${envKey}`);
    const connection = new BCPageConnection({
      baseUrl,
      username,
      password,
      tenantId
    });

    const connectResult = await connection.connect();
    if (!connectResult.ok) {
      throw new Error(`Failed to create session: ${connectResult.error.message}`);
    }

    const sessionId = this.generateSessionId();
    const sessionInfo: SessionInfo = {
      sessionId,
      client: (connection as any).client, // Access underlying client
      connection,
      formRegistry: new Map(),
      lastUsed: new Date(),
      environment: envKey
    };

    this.sessions.set(envKey, sessionInfo);

    // Start TTL cleanup
    this.scheduleCleanup(envKey);

    return { sessionId, connection };
  }

  /**
   * Get existing session by sessionId.
   */
  public getSession(sessionId: string): BCPageConnection | null {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        if (this.isExpired(session)) {
          console.error(`[ConnectionManager] ⏰ Session expired: ${sessionId}`);
          this.closeSession(sessionId);
          return null;
        }
        session.lastUsed = new Date();
        return session.connection;
      }
    }
    return null;
  }

  /**
   * Register an open form in the session's form registry.
   */
  public registerForm(sessionId: string, pageId: string, formInfo: Omit<FormInfo, 'openedAt'>): void {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        session.formRegistry.set(pageId, {
          ...formInfo,
          openedAt: new Date()
        });
        console.error(`[ConnectionManager] 📝 Registered form: Page ${pageId} → formId ${formInfo.formId}`);
        break;
      }
    }
  }

  /**
   * Get form info from session registry.
   */
  public getForm(sessionId: string, pageId: string): FormInfo | null {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) {
        return session.formRegistry.get(pageId) || null;
      }
    }
    return null;
  }

  /**
   * Close a specific session.
   */
  public async closeSession(sessionId: string): Promise<void> {
    for (const [envKey, session] of this.sessions.entries()) {
      if (session.sessionId === sessionId) {
        console.error(`[ConnectionManager] 🔌 Closing session: ${sessionId}`);
        await session.connection.close();
        this.sessions.delete(envKey);
        break;
      }
    }
  }

  private isExpired(session: SessionInfo): boolean {
    const now = new Date().getTime();
    const lastUsed = session.lastUsed.getTime();
    return (now - lastUsed) > this.SESSION_TTL;
  }

  private scheduleCleanup(envKey: string): void {
    setTimeout(() => {
      const session = this.sessions.get(envKey);
      if (session && this.isExpired(session)) {
        console.error(`[ConnectionManager] 🧹 Auto-closing expired session: ${session.sessionId}`);
        this.closeSession(session.sessionId);
      }
    }, this.SESSION_TTL + 1000);
  }

  private generateSessionId(): string {
    return `mcp-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}
```

### 2. Update Tool Signatures to Accept sessionId

**Before:**
```typescript
interface ReadPageDataInput {
  pageId: string;
  filters?: Record<string, unknown>;
}
```

**After:**
```typescript
interface ReadPageDataInput {
  pageId: string;
  sessionId?: string; // Optional: reuse existing session
  filters?: Record<string, unknown>;
}
```

### 3. Update Tool Implementation Pattern

**Pattern for all tools:**

```typescript
export class ReadPageDataTool extends BaseMCPTool {
  protected async executeInternal(input: unknown): Promise<Result<ReadPageDataOutput, BCError>> {
    const { pageId, sessionId } = validatedInput.value;
    const manager = ConnectionManager.getInstance();

    // Get or create connection
    let connection: BCPageConnection;
    let isNewSession = false;

    if (sessionId) {
      // Try to reuse existing session
      const existing = manager.getSession(sessionId);
      if (existing) {
        console.error(`[ReadPageDataTool] ♻️ Reusing session: ${sessionId}`);
        connection = existing;
      } else {
        console.error(`[ReadPageDataTool] ⚠️ Session ${sessionId} not found, creating new`);
        const result = await manager.getOrCreateSession(baseUrl, username, password, tenantId);
        connection = result.connection;
        isNewSession = true;
      }
    } else {
      // Create new session (default behavior)
      const result = await manager.getOrCreateSession(baseUrl, username, password, tenantId);
      connection = result.connection;
      isNewSession = true;
    }

    // Check if page is already open in this session
    const existingForm = sessionId ? manager.getForm(sessionId, pageId) : null;

    if (existingForm) {
      // Page is already open! Use existing formId
      console.error(`[ReadPageDataTool] ✓ Page ${pageId} already open: formId ${existingForm.formId}`);
      // Extract data from already-open form...
    } else {
      // Open page normally
      const openResult = await connection.invoke({ ... });
      // Register the form
      if (sessionId) {
        manager.registerForm(sessionId, pageId, {
          formId: extractedFormId,
          pageId,
          caption: extractedCaption
        });
      }
    }

    // ... rest of implementation
  }
}
```

### 4. Add Auto-Save Option to write_page_data

```typescript
interface WritePageDataInput {
  pageId: string;
  sessionId?: string;
  fields: Record<string, unknown>;
  autoSave?: boolean; // New: automatically execute OK/Save after writing
}

// In executeInternal:
if (input.autoSave) {
  // Execute OK or Save action to commit
  const executeActionTool = new ExecuteActionTool(connection);
  const saveResult = await executeActionTool.execute({
    pageId,
    actionName: 'OK', // or 'Save'
    sessionId
  });

  if (!isOk(saveResult)) {
    console.error(`[WritePageDataTool] ⚠️ Auto-save failed: ${saveResult.error.message}`);
  } else {
    console.error(`[WritePageDataTool] ✓ Changes saved automatically`);
  }
}
```

---

## Usage Patterns

### Pattern 1: Single-Session Multi-Step Workflow (RECOMMENDED)

```typescript
// Step 1: Create session and open page
const metadata = await mcp.call('get_page_metadata', {
  pageId: '21'
});
const sessionId = metadata.sessionId; // Tools return sessionId

// Step 2: Execute Edit (reuse session)
await mcp.call('execute_action', {
  pageId: '21',
  sessionId,
  actionName: 'Edit'
});

// Step 3: Write data (reuse session)
await mcp.call('write_page_data', {
  pageId: '21',
  sessionId,
  fields: {
    'Name': 'Updated Name',
    'Phone No.': '+1-555-TEST'
  },
  autoSave: false // Manual save
});

// Step 4: Verify (reuse session - reads same form!)
const data = await mcp.call('read_page_data', {
  pageId: '21',
  sessionId
});
console.log(data.records[0].fields['Name']); // "Updated Name" ✓

// Step 5: Save changes
await mcp.call('execute_action', {
  pageId: '21',
  sessionId,
  actionName: 'OK'
});

// Session auto-closes after TTL or explicit close
```

### Pattern 2: Auto-Save (Quick Updates)

```typescript
// Single call with auto-save
await mcp.call('write_page_data', {
  pageId: '21',
  fields: { 'Name': 'Quick Update' },
  autoSave: true // Automatically saves after writing
});
```

### Pattern 3: Backward Compatible (No sessionId)

```typescript
// Works like before - creates new session each time
// (Use for read-only operations where state doesn't matter)
const data = await mcp.call('read_page_data', {
  pageId: '22'
});
```

---

## Implementation Priority

### Phase 1: Connection Pooling ⭐ HIGH PRIORITY
1. Create `ConnectionManager` class
2. Add `sessionId` to tool input schemas
3. Update tool implementations to use manager
4. Test multi-step workflows

### Phase 2: Auto-Save Option ⭐ MEDIUM PRIORITY
1. Add `autoSave` parameter to `write_page_data`
2. Execute OK/Save action after writes
3. Handle save errors gracefully

### Phase 3: Enhanced Features 🔄 LOW PRIORITY
1. Bookmark-based navigation for cross-session record access
2. Connection health checks and auto-reconnect
3. Concurrent operation locking per page
4. Session metrics and monitoring

---

## Expected Benefits

### Before (Current State):
```
❌ Each tool creates new session
❌ FormIds change between calls
❌ State lost between operations
❌ Verification fails
❌ Cannot do multi-step CRUD workflows
```

### After (With Connection Pooling):
```
✅ Single session spans multiple tool calls
✅ Stable formIds within session
✅ State preserved (edits, filters, navigation)
✅ Verification works
✅ Complete CRUD workflows possible
✅ Matches real BC web client behavior
```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session state corruption | High | TTL cleanup + health checks |
| Concurrent access | Medium | Per-page mutex locks |
| Memory leaks | Medium | Aggressive TTL + max session limit |
| Connection drops | High | Auto-reconnect on error |
| Wrong sessionId provided | Low | Graceful fallback to new session |

---

## Testing Strategy

### Test 1: Single-Session CRUD
```typescript
// Create, edit, verify in one session
const sessionId = await createSession();
await write(sessionId, fields);
const data = await read(sessionId);
assert(data === fields); // Should pass!
```

### Test 2: Session Reuse
```typescript
// Verify formId stability
const meta1 = await getMetadata(sessionId, '21');
const meta2 = await getMetadata(sessionId, '21');
assert(meta1.formId === meta2.formId); // Should pass!
```

### Test 3: Session Expiry
```typescript
// Verify TTL cleanup
const sessionId = await createSession();
await sleep(16 * 60 * 1000); // Wait past TTL
const connection = manager.getSession(sessionId);
assert(connection === null); // Should pass!
```

### Test 4: Backward Compatibility
```typescript
// Verify no sessionId still works
const data = await read(undefined, '22');
assert(data !== null); // Should pass!
```

---

## Conclusion

The write tools are **working correctly**. The issue is **architectural** - tools need to share sessions for multi-step workflows.

**GPT-5 Pro Recommendation:**
Implement **Connection Pooling + Session Context** as the primary solution. This matches real BC web client behavior and solves both state management and control path instability issues.

**Immediate Actions:**
1. Create `ConnectionManager` class
2. Add `sessionId` parameter to all tools
3. Update tool implementations to use pooled connections
4. Add `autoSave` option to `write_page_data`

**Timeline Estimate:** 4-6 hours for full implementation + testing

**Risk Level:** Low - well-understood pattern with clear implementation path
