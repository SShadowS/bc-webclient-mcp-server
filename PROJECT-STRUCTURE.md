# BC WebClient MCP - Project Structure

## Root Directory Layout

```
bc-webclient-mcp/
├── README.md                    # Main project documentation
├── package.json                 # Node.js dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── src/                        # Source code (active)
├── docs/                       # Documentation
├── archive/                    # Archived files (historical)
├── dist/                       # Compiled JavaScript (generated)
├── node_modules/              # Dependencies (generated)
├── CopilotPatcher/            # BC Copilot API runtime patcher
├── test-results/              # Test output
└── tests/                     # Test files
```

## Source Code (`src/`)

Active TypeScript source code for the MCP server.

```
src/
├── connection/                # BC connection implementations
│   ├── bc-page-connection.ts  # Per-page connection (current)
│   └── ...
├── core/                      # Core utilities
│   ├── errors.ts             # Error types
│   ├── interfaces.ts         # TypeScript interfaces
│   └── result.ts             # Result<T, E> monad
├── parsers/                   # BC protocol parsers
│   ├── page-metadata-parser.ts      # Page metadata extraction
│   ├── control-parser.ts            # Control tree parsing
│   ├── handler-parser.ts            # Handler response parsing
│   ├── intelligent-metadata-parser.ts # AI-optimized parser
│   └── logical-form-parser.ts       # Tell Me search parser
├── protocol/                  # BC WebSocket protocol
│   ├── decompression.ts      # Gzip+base64 decompression
│   └── ...
├── services/                  # MCP server services
│   ├── mcp-server.ts         # Main MCP server
│   └── stdio-transport.ts    # JSON-RPC stdio transport
├── tools/                     # MCP tools
│   ├── search-pages-tool.ts  # search_pages tool (Tell Me)
│   ├── get-page-metadata-tool.ts   # get_page_metadata tool
│   ├── read-page-data-tool.ts      # read_page_data tool
│   ├── write-page-data-tool.ts     # write_page_data tool
│   ├── execute-action-tool.ts      # execute_action tool
│   └── base-tool.ts          # Base tool class
├── types/                     # TypeScript type definitions
│   ├── bc-types.ts           # BC protocol types
│   └── mcp-types.ts          # MCP protocol types
├── util/                      # Utility functions
├── BCRawWebSocketClient.ts   # Core WebSocket client
├── index-session.ts          # Session management entry point
└── test-mcp-server-real.ts   # MCP server test entry point
```

## Documentation (`docs/`)

```
docs/
├── current/                   # Current/active documentation
│   ├── ARCHITECTURE.md       # System architecture
│   ├── INTEGRATION-GUIDE.md  # Integration guide
│   ├── AUTHENTICATION.md     # Authentication methods
│   ├── SESSION-AUTH.md       # Session authentication details
│   ├── TELLME-SEARCH-STATUS.md  # Tell Me implementation status
│   └── DOCS-INDEX.md         # Documentation index
└── archive/                   # Historical documentation (not used)
```

## Archive (`archive/`)

Historical files from development process - NOT actively used.

```
archive/
├── legacy-src/                      # Old source files
│   ├── BCSessionClient.ts          # Old SignalR client
│   ├── bc-session-connection.ts    # Old session connection
│   └── index-websocket.ts          # Old WebSocket entry point
├── analysis-scripts/                # Protocol analysis scripts
│   ├── analyze-*.mjs               # WebSocket traffic analyzers
│   ├── capture-*.mjs               # Traffic capture scripts
│   ├── decompress-*.mjs            # Response decompression
│   └── examine-*.mjs               # Structure examination
├── test-scripts/                    # Development test scripts
│   ├── test-*.ts                   # TypeScript tests
│   ├── test-*.mjs                  # JavaScript tests
│   └── poc-*.ts                    # Proof-of-concept scripts
├── captured-data/                   # Captured WebSocket traffic
│   ├── *.json                      # Raw captures and responses
│   ├── bc-interaction-captures/    # Interaction captures
│   └── responses/                  # Server responses
└── investigation-docs/              # Investigation documentation
    ├── *-FINDINGS.md               # Discovery/investigation docs
    ├── *-ANALYSIS.md               # Analysis documents
    ├── *-SUMMARY.md                # Summary documents
    └── *.md                        # Other historical docs
```

## CopilotPatcher (`CopilotPatcher/`)

.NET 6.0 runtime patcher for BC Copilot API.

**Purpose**: Patches BC server at runtime to:
- Enable Copilot API on on-premises instances
- Replace S2S authentication with API key auth
- Configure Kestrel instead of HTTP.sys

See `CLAUDE.md` for deployment instructions.

## Key Files

### Active Development
- `src/BCRawWebSocketClient.ts` - Core WebSocket client implementation
- `src/tools/search-pages-tool.ts` - Tell Me search (fully functional)
- `src/tools/get-page-metadata-tool.ts` - Page metadata extraction
- `src/parsers/intelligent-metadata-parser.ts` - AI-optimized metadata

### Configuration
- `package.json` - Dependencies and npm scripts
- `tsconfig.json` - TypeScript compiler configuration
- `../CLAUDE.md` - Instructions for Claude Code assistant (parent dir)

### Testing
- `src/test-mcp-server-real.ts` - Real BC integration MCP server
- `test-mcp-client-real.mjs` - MCP client for testing

## NPM Scripts

```json
{
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "tsx src/index-session.ts",
  "test:mcp": "tsx src/test-mcp-server-real.ts",
  "test:mcp:client": "node test-mcp-client-real.mjs"
}
```

## Development Workflow

1. **Make changes** in `src/`
2. **Type-check**: Files compile successfully (legacy files have known errors)
3. **Test locally**: `npm run test:mcp` + `npm run test:mcp:client`
4. **Integration**: Test with real BC server

## What's NOT Used

❌ Files in `archive/` - Historical only, not part of active codebase
❌ `dist/mocks/` - Removed (now using real BC)
❌ SignalR implementation - Replaced with raw WebSocket
❌ Mock connections - All tests use real BC server

## Status

✅ **Working Features**:
- Tell Me search (`search_pages` tool)
- Page metadata extraction (`get_page_metadata` tool)
- WebSocket authentication (web login with cookies)
- Session state tracking
- BC27+ protocol support

🔧 **In Progress**:
- Data read/write tools (placeholders exist)
- Action execution tool
- Connection pooling

📝 **Documentation**: See `docs/current/` for architecture and guides.
