# Next Steps for BC MCP Server

## What We've Accomplished ✅

### 1. Working WebSocket PoC
- ✅ Session-based authentication (cookies + CSRF token)
- ✅ Raw WebSocket connection to `/csh` endpoint
- ✅ OpenSession with exact browser format
- ✅ Gzip decompression of handler arrays
- ✅ Generic Invoke method for BC operations
- ✅ Session state tracking (SessionId, SessionKey, CompanyName)

**Files**: `BCRawWebSocketClient.ts`, `index-session.ts`, `test-invoke.ts`

### 2. Major Discovery: BC's AI Agent Framework
- ✅ Found BC's native AI agent implementation
- ✅ Identified structured metadata APIs (IClientMetadataApi)
- ✅ Documented MasterPage class structure
- ✅ Analyzed BC's approach to exposing UI to AI
- ✅ Mapped comparison between BC agents and our MCP

**File**: `BC-AI-AGENT-ANALYSIS.md`

### 3. Comprehensive Documentation
- ✅ Updated ARCHITECTURE.md with metadata API discovery
- ✅ Updated README.md with key findings
- ✅ Created detailed analysis of BC's agent framework
- ✅ Documented all file references and code examples

---

## Immediate Next Steps (This Week)

### Step 1: Test Metadata API Access ⚡ CRITICAL

**Goal**: Determine if we can call `GetMasterPage()` via WebSocket Invoke

**Tasks**:
1. Create test script to call metadata APIs
2. Try different interactionName values:
   - `InvokeMethod` with `methodName: 'GetMasterPage'`
   - `InvokeSessionAction` with metadata request
   - Check if there's a dedicated handler for metadata
3. Document request/response format
4. Compare to handler array approach

**Expected Result**: Either:
- ✅ Metadata APIs work → Use them!
- ❌ Metadata APIs blocked → Continue with handler parsing

**File to Create**: `test-metadata-api.ts`

**Sample Code**:
```typescript
// Test calling GetMasterPage via WebSocket
const result = await client.invoke({
  interactionName: 'InvokeMethod',
  namedParameters: {
    methodName: 'GetMasterPage',
    pageId: 21,  // Customer Card
    dataSourceType: 'Table'
  }
});

console.log('Metadata API result:', result);
```

### Step 2: Search BC Web Client Code

**Goal**: Find how the BC web client calls metadata APIs

**Tasks**:
1. Search decompiled web client for `GetMasterPage` calls
2. Look for how pages are loaded in browser
3. Check network traffic in browser DevTools
4. Document the exact protocol messages

**Files to Search**:
- `Prod.Client.WebCoreApp/wwwroot/` - Client-side JavaScript
- Look for `.js` files calling metadata methods
- Search for `GetMasterPage`, `SearchClientObjects`, etc.

### Step 3: Parse OpenSession Response

**Goal**: Extract useful metadata from OpenSession handlers

**Tasks**:
1. Parse NavigationServiceInitHandler for page list
2. Extract available pages user can access
3. Map page IDs to names and captions
4. Test Tell Me search functionality

**File to Create**: `src/parsers/NavigationParser.ts`

---

## Short-Term Goals (Next 2 Weeks)

### Week 1: Metadata Foundation

**If Metadata APIs Work**:
1. Implement `BCMetadataClient` class
2. Add methods: `getMasterPage()`, `searchPages()`, `getFields()`
3. Create MasterPage → LLM JSON converter
4. Test with multiple page types (Card, List, Document)

**If Metadata APIs Don't Work**:
1. Implement handler parser infrastructure
2. Create parsers for key handler types:
   - FormMetadataHandler
   - DataSetHandler
   - ActionBarHandler
   - NavigationServiceInitHandler
3. Test parser robustness with golden responses
4. Document handler structures

### Week 2: MCP Tool Implementation

1. Implement `search_pages` tool
   - Try Tell Me search via Invoke
   - Or parse NavigationServiceInitHandler
   - Return LLM-friendly page list

2. Implement `get_page_metadata` tool
   - Use metadata API or OpenForm + parsing
   - Convert to clean JSON structure
   - Include actions, fields, permissions

3. Test with Claude Desktop
   - Create MCP server scaffold
   - Register tools
   - Test LLM interaction

---

## Medium-Term Goals (Weeks 3-4)

### Week 3: Data Access

1. Implement `read_page_data` tool
   - Open list pages
   - Extract initial dataset (20-50 rows)
   - Format as table for LLM
   - Handle empty results

2. Explore pagination
   - Try "scroll down" interactions
   - Document complexity
   - Decide if worth implementing

### Week 4: Write Operations

1. Research BC OData endpoints
   - Map page IDs to entity names
   - Test CRUD operations
   - Handle validation errors

2. Implement `write_page_data` tool
   - POST for new records
   - PATCH for updates
   - DELETE for removals
   - Return success/error

3. Create page-to-entity mapping
   - Standard pages (Customer, Item, Vendor, etc.)
   - Allow user overrides
   - Document mapping strategy

---

## Long-Term Goals (Weeks 5-8)

### Week 5-6: Actions

1. Parse action bar from metadata
2. Implement safe action subset:
   - Refresh
   - New
   - Edit
   - Delete
3. Handle dialogs and confirmations
4. Test navigation actions

### Week 7-8: Polish & Harden

1. Error handling
   - Network failures
   - Session timeouts
   - Invalid page IDs
   - Permission errors

2. Connection management
   - Connection pooling
   - Automatic reconnection
   - Session refresh

3. Caching
   - Page metadata cache
   - Navigation tree cache
   - Cache invalidation

4. Testing
   - Unit tests for parsers
   - Integration tests for tools
   - Golden response tests
   - Error scenario tests

5. Documentation
   - API documentation
   - Setup guide
   - Troubleshooting guide
   - Examples

---

## Key Decisions to Make

### Decision 1: Metadata APIs vs Handler Parsing

**Question**: Can we call IClientMetadataApi methods via WebSocket?

**Test**: Create `test-metadata-api.ts` and try calling `GetMasterPage()`

**If YES**:
- ✅ Use structured APIs (preferred)
- ✅ Much easier to maintain
- ✅ Stable across BC versions

**If NO**:
- ⚠️ Build handler parsers
- ⚠️ More complex, more fragile
- ⚠️ Need golden response tests

### Decision 2: Handler Parsing Depth

**Question**: How deep should we parse handler arrays?

**Options**:
- **Option A**: Parse everything (control tree, all fields, all actions)
  - Pro: Complete information
  - Con: Complex, fragile, slow

- **Option B**: Parse key handlers only (metadata, dataset, actions)
  - Pro: Simpler, faster
  - Con: May miss some features

- **Option C**: Hybrid - Use metadata APIs where possible, parse specific handlers when needed
  - Pro: Best of both worlds
  - Con: More code paths

**Recommendation**: Option C (hybrid)

### Decision 3: Tell Me Search vs Navigation Tree

**Question**: How should `search_pages` work?

**Options**:
- **Option A**: Parse NavigationServiceInitHandler (one-time, complete)
  - Pro: Fast, all pages at once
  - Con: Large response, may not reflect search relevance

- **Option B**: Use Tell Me search interaction
  - Pro: Matches user experience, relevant results
  - Con: Requires interaction parsing

- **Option C**: Both - NavigationTree for `list_pages`, Tell Me for `search_pages`
  - Pro: Best user experience
  - Con: Two implementations

**Recommendation**: Option C (both)

### Decision 4: Action Safety

**Question**: Which actions should LLMs be allowed to execute?

**Safe Actions**:
- ✅ Refresh (read-only)
- ✅ View/Edit (opens page)
- ✅ Navigate to related (opens page)

**Risky Actions**:
- ⚠️ New (creates record)
- ⚠️ Delete (destructive)
- ⚠️ Post (commits transaction)
- ⚠️ Custom actions (unknown effects)

**Recommendation**:
- Implement allowlist approach
- Require user confirmation for risky actions
- Log all action executions
- Allow user to configure action policy

---

## Research Questions

### Question 1: How does BC web client get page metadata?

**Need to find**:
- What messages does browser send?
- Are there metadata-specific handlers?
- Can we replicate the exact flow?

**Action**: Use browser DevTools Network tab, filter for WebSocket messages when opening pages

### Question 2: How does Tell Me search work?

**Need to find**:
- What interactionName is used?
- What parameters are sent?
- How are results returned?

**Action**: Use browser DevTools while using Tell Me (Ctrl+Q)

### Question 3: What are all the systemAction codes?

**Need to document**:
- Complete enum of SystemActionType
- What each code does
- Which are safe for LLMs

**Action**: Search decompiled code for `SystemActionType` enum definition

### Question 4: How does pagination work?

**Need to understand**:
- Scroll/load more interactions
- How to request specific row ranges
- Dataset bookmarking

**Action**: Use browser DevTools while scrolling long lists

---

## Success Metrics

### Phase 1 Success (Week 2)
- ✅ Can search for pages
- ✅ Can get metadata for a page
- ✅ Metadata includes actions, fields, permissions
- ✅ LLM can understand page structure

### Phase 2 Success (Week 4)
- ✅ Can read data from list pages
- ✅ Can write data via OData API
- ✅ Can execute safe actions
- ✅ Error handling works

### Phase 3 Success (Week 8)
- ✅ Full MCP server running
- ✅ All tools implemented
- ✅ Comprehensive tests passing
- ✅ Documentation complete
- ✅ Claude can use BC effectively

---

## Resources

### Decompiled Code References

**Metadata APIs**:
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\IClientMetadataApi.cs`
- `Microsoft.Dynamics.Nav.Types\Microsoft\Dynamics\Nav\Types\Metadata\MasterPage.cs`

**Agent Framework**:
- `Microsoft.Dynamics.Nav.Ncl\Microsoft\Dynamics\Nav\Runtime\Agents\`
- `Microsoft.Dynamics.Nav.Agents\Clients\AgentServiceClient.cs`

**Web Client**:
- `Prod.Client.WebCoreApp\Controllers\ClientServiceHub.cs`
- `Prod.Client.WebCoreApp\Controllers\CopilotController.cs`

### Documentation

- `BC-AI-AGENT-ANALYSIS.md` - Complete agent framework analysis
- `ARCHITECTURE.md` - MCP server architecture
- `README.md` - PoC documentation
- `ai-agent.md` - Client API analysis

### External Resources

- [BC API Documentation](https://docs.microsoft.com/dynamics365/business-central/dev-itpro/)
- [BC REST API v2.0](https://docs.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/)
- [MCP Protocol](https://modelcontextprotocol.io/)

---

## Final Note

**The major discovery of BC's native AI agent framework changes everything!**

We now know:
1. ✅ External AI integration is **officially supported** (BC does it!)
2. ✅ Structured metadata APIs **exist and work** (BC uses them internally)
3. ✅ Our approach is **validated** (BC solves the same problem)
4. ✅ We should **use BC's APIs** instead of parsing handlers

**Next immediate action**: Test if we can call `GetMasterPage()` via WebSocket Invoke from our external MCP server. This single test will determine our entire implementation strategy!
