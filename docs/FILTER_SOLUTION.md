# Filter Implementation Solution

## 🎯 Breakthrough: UI-Driven Column ID Discovery (GPT-5 Pro Analysis)

### The Problem We Solved

**Blocker:** How to map ephemeral cell column IDs (`1330459806_c2`) to canonical filter column IDs (`18_Customer.2`)?

**Why we were stuck:**
- Cell IDs are UI artifacts that change between sessions
- Filter IDs are canonical table/field identifiers
- No obvious way to reverse-engineer the mapping
- Metadata didn't expose the relationship

### The Solution: Let BC Do the Mapping!

**Instead of reverse-engineering, use BC's own UI to discover the mapping.**

---

## Strategy B: Filter Picker Discovery (RECOMMENDED)

### Why This Works

✅ **Robust** - BC tells us the correct IDs, no guessing
✅ **Stable** - Works across sessions, personalizations, localizations
✅ **Simple** - No need to parse complex metadata structures
✅ **Maintainable** - Adapts to BC changes automatically

### Implementation Flow

```
1. Open page (e.g., Customers - Page 22)
   ↓
2. Open Filter Pane (Shift+F3 command)
   ↓
3. Activate "Add filter" picker
   ↓
4. Type column caption (e.g., "Name")
   ↓
5. Inspect picker items payload
   → Items contain: { caption: "Name", id: "18_Customer.2" }
   ↓
6. Cache mapping: "Name" → "18_Customer.2"
   ↓
7. Select the field (creates filter input)
   ↓
8. SaveValue the search term into filter input
   ↓
9. Wait for DataRefreshChange (filtered results)
```

### Code Structure

```typescript
interface IFieldIdResolver {
  // Resolve column caption to canonical filter ID
  resolveByCaption(pageId: string, caption: string): Promise<string>;

  // Cache per session
  getCache(pageId: string): Map<string, string>;
}

class FilterPickerResolver implements IFieldIdResolver {
  private cache = new Map<string, Map<string, string>>();

  async resolveByCaption(pageId: string, caption: string): Promise<string> {
    // Check cache first
    const pageCache = this.cache.get(pageId);
    if (pageCache?.has(caption)) {
      return pageCache.get(caption)!;
    }

    // 1. Open filter pane
    await this.openFilterPane();

    // 2. Open "Add filter" picker
    const pickerItems = await this.openAddFilterPicker();

    // 3. Find item by caption
    const item = pickerItems.find(i =>
      i.caption.toLowerCase() === caption.toLowerCase()
    );

    if (!item) {
      throw new Error(`Column "${caption}" not found in filter picker`);
    }

    // 4. Cache and return
    if (!this.cache.has(pageId)) {
      this.cache.set(pageId, new Map());
    }
    this.cache.get(pageId)!.set(caption, item.id);

    return item.id;
  }
}
```

### Usage Example

```typescript
// Initialize resolver
const resolver = new FilterPickerResolver(connection);

// Open Customers page
await connection.openPage('22');

// Resolve "Name" column to filter ID
const nameFilterId = await resolver.resolveByCaption('22', 'Name');
// Returns: "18_Customer.2"

// Apply filter using discovered ID
await connection.invoke({
  interactionName: 'Filter',
  namedParameters: {
    filterOperation: 1,
    filterColumnId: nameFilterId,  // "18_Customer.2"
    // Optional: BC filter expression
    filterValue: '@*Adatum*',      // Case-insensitive contains
  },
  controlPath: listControlPath,    // From DataRefreshChange
  formId: currentFormId
});

// Wait for DataRefreshChange confirming filter applied
```

---

## Alternative: Strategy A - "Filter to This Value" Command

### When to Use
- Fallback if filter picker doesn't expose IDs
- When you want to filter on a specific cell's value

### Flow

```
1. Open page
   ↓
2. Locate target row and column in grid
   ↓
3. Set focus to that cell (FocusChange)
   ↓
4. Invoke "Filter to This Value" (Alt+F3)
   ↓
5. BC creates a filter entry
   ↓
6. Parse the created filter to extract canonical ID
   ↓
7. Cache the mapping
   ↓
8. Clear the auto-filter
   ↓
9. Apply your desired filter using discovered ID
```

### Trade-offs

**Pros:**
- Works even if picker doesn't expose IDs
- Leverages BC's own mapping logic

**Cons:**
- Requires row data to be present
- Creates temporary filter (must be cleared)
- More complex flow

---

## Implementation Priorities

### Phase 1: Proof of Concept ✅ (Current)
- [x] Validated control path instability
- [x] Discovered DataRefreshChange structure
- [x] Identified column ID formats
- [x] Got GPT-5 expert analysis
- [ ] **NEXT:** Capture filter pane interactions

### Phase 2: Filter Picker Discovery 🔄 (In Progress)
- [ ] Identify filter pane command/interaction
- [ ] Open "Add filter" picker programmatically
- [ ] Parse picker items for canonical IDs
- [ ] Implement FilterPickerResolver class
- [ ] Add session-scoped caching
- [ ] Test on Customers page

### Phase 3: Complete Filter Tool
- [ ] Implement Filter interaction sender
- [ ] Add BC filter expression builder (@*term* syntax)
- [ ] Wait for DataRefreshChange confirmation
- [ ] Handle edge cases (no results, errors)
- [ ] Add comprehensive logging

### Phase 4: Production Readiness
- [ ] Test on 4+ different pages
- [ ] Add Strategy A as fallback
- [ ] Handle personalization/localization
- [ ] Add retry logic and error recovery
- [ ] Performance optimization (cache warming)
- [ ] Documentation and examples

---

## Next Immediate Steps

### 1. Manual Browser Capture
```bash
# Use existing capture script
node capture-filter-interactions.mjs

# In browser:
# 1. Open Customers page
# 2. Press Shift+F3 (open filter pane)
# 3. Click "Add filter"
# 4. Type "Name"
# 5. Observe picker items
# 6. Select "Name" field
# 7. Type "Adatum"
# 8. Let script capture the interactions
```

### 2. Analyze Captured Data
- Find the command for opening filter pane
- Identify "Add filter" control path
- Examine picker item structure
- Confirm canonical IDs are present

### 3. Implement FilterPickerResolver
- Create class with IFieldIdResolver interface
- Implement resolveByCaption method
- Add session-scoped caching
- Handle errors gracefully

### 4. Integration Test
- Open page → resolve column → apply filter → verify results
- Test on Customers, Items, Vendors
- Validate caching works across multiple filters

---

## Key Insights from GPT-5 Analysis

### What We Learned

1. **Don't fight BC's architecture** - Use its UI to discover what we need
2. **Ephemeral IDs are OK** - We discover them fresh each session
3. **Caching is essential** - Store caption→ID mapping per session
4. **UI-driven is robust** - Adapts to personalization/localization automatically
5. **Multiple strategies** - Have fallbacks for different scenarios

### What We Avoided

❌ Trying to reverse-engineer cell ID → filter ID mapping
❌ Parsing complex raw metadata structures
❌ Hardcoding table IDs or field numbers
❌ Relying on positional indices or ordinals
❌ Language-specific or localization-dependent code

---

## BC Filter Expression Syntax

Once we have the canonical filter ID, we can use BC's powerful filter expressions:

```javascript
// Contains (case-insensitive)
filterValue: '@*Adatum*'

// Starts with
filterValue: 'Adatum*'

// Exact match
filterValue: 'Adatum'

// Range
filterValue: '10000..20000'

// Multiple values (OR)
filterValue: '10000|20000|30000'

// Exclusion
filterValue: '<>Adatum'

// Comparison
filterValue: '>10000'
```

**Escaping:** Escape special characters: `@`, `*`, `..`, `|`, `<`, `>`, `&`

---

## Success Criteria

✅ Filter works on Customers page
✅ Filter works on Items page
✅ Filter works on Vendors page
✅ Filter works on Sales Orders page
✅ Handles personalized column orders
✅ Handles localized column captions
✅ Caching reduces redundant discovery
✅ Graceful error handling
✅ Session resilience (reconnect on failure)
✅ Clear documentation and examples

---

## References

- **GPT-5 Pro Analysis:** `mcp__zen__thinkdeep` tool analysis (continuation_id: 9339bdba-e797-42fa-8da4-7f57edabab2d)
- **Investigation Files:**
  - `validate-filter-paths.ts` - Proved control path instability
  - `investigate-dataset-metadata.ts` - DataRefreshChange structure
  - `test-filter-picker-discovery.ts` - Filter picker testing
  - `docs/FILTER_IMPLEMENTATION_FINDINGS.md` - Complete investigation log
- **Captured Data:**
  - `all-interactions.json` - Manual filter capture
  - `dataset-metadata-investigation.json` - Page structure
  - `filter-websocket-capture.json` - Original capture

---

## Conclusion

**The breakthrough:** Stop trying to reverse-engineer BC's internal mappings. Instead, use BC's own UI (filter picker) to tell us the canonical column IDs we need.

**Next step:** Capture filter pane interactions to understand how to open the picker and parse its items.

**Expected timeline:**
- Phase 2 (Filter Picker Discovery): 2-3 hours
- Phase 3 (Complete Filter Tool): 2-3 hours
- Phase 4 (Production Ready): 4-6 hours

**Total: ~10 hours to production-ready filter_list tool**
