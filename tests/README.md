# Test Suite Organization

## Directory Structure

```
tests/
├── unit/                   # Unit tests (no external dependencies)
│   ├── parsers/           # Parser tests (logical-form-parser, etc.)
│   ├── services/          # Service tests (connection-manager, cache, etc.)
│   ├── tools/             # Tool tests (consent, validation, etc.)
│   ├── util/              # Utility function tests
│   └── validation/        # Zod schema validation tests
├── integration/           # Integration tests (require BC server)
│   ├── bc-protocol/       # BC WebSocket protocol tests
│   └── mcp-client/        # MCP client integration tests
└── fixtures/              # Test data and mock responses
```

## Test Types

### Unit Tests (`tests/unit/`)
- Fast, isolated tests with no external dependencies
- Mock BC connections and responses
- Focus on individual functions, classes, and modules
- Run with: `npm run test:unit`

### Integration Tests (`tests/integration/`)
- Test against real BC server (requires Cronus27 container)
- Verify protocol compliance and end-to-end workflows
- Slower but catch real-world issues
- Run with: `npm run test:integration`

## Running Tests

```bash
# All tests
npm test

# Unit tests only (fast)
npm run test:unit

# Integration tests only (requires BC server)
npm run test:integration

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Writing Tests

### Unit Test Example
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '@/util/my-module';

describe('myFunction', () => {
  it('should return expected result', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### Integration Test Example
```typescript
import { describe, it, expect } from 'vitest';
import { BCRawWebSocketClient } from '@/connection/clients/BCRawWebSocketClient';

describe('BC Authentication', () => {
  it('should authenticate successfully', async () => {
    const client = new BCRawWebSocketClient(/* config */);
    const result = await client.authenticateWeb();
    expect(result.ok).toBe(true);
  });
});
```

## Test Naming Conventions

- Unit tests: `<module-name>.test.ts`
- Integration tests: `<feature-name>.test.ts` or keep legacy names
- Fixtures: `<data-type>.json` or `<scenario>.fixture.ts`

## Coverage Goals

- **Lines**: 60%+
- **Functions**: 60%+
- **Branches**: 60%+
- **Statements**: 60%+

Focus on testing:
- Critical path code (authentication, protocol handling)
- Complex business logic (parsers, validators)
- Error handling paths
- Public APIs (tools, services)
