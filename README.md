<div align="center">

# 🚀 BC WebClient MCP

**Model Context Protocol server for Microsoft Dynamics 365 Business Central via WebUI protocol**

[![npm version](https://img.shields.io/npm/v/bc-webclient-mcp.svg)](https://www.npmjs.com/package/bc-webclient-mcp)
[![npm downloads](https://img.shields.io/npm/dm/bc-webclient-mcp.svg)](https://www.npmjs.com/package/bc-webclient-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-2025--06--18-purple)](https://modelcontextprotocol.io/)

[Features](#-features) • [Quick Start](#-quick-start) • [Tools](#-available-tools) • [Documentation](#-documentation) • [Architecture](#-architecture)

</div>

---

## 📖 Overview

**BC WebClient MCP** is a Model Context Protocol (MCP) server that enables AI assistants like Claude to interact with Microsoft Dynamics 365 Business Central through a clean, intuitive interface. Built by reverse-engineering BC's WebUI WebSocket protocol, it provides real-time access to ERP data, business logic, and operations.

### What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that enables AI assistants to securely connect with external data sources and tools. This server implements MCP to bridge Claude with Business Central's internal APIs.

### Why This Matters

Business Central's web client uses an undocumented WebSocket protocol for all UI operations. This project reverse-engineers the **WebUI protocol** (not official APIs) to:

- ✅ **Enable AI-driven ERP automation** - Let Claude interact with BC data naturally
- ✅ **No custom extensions required** - Works with vanilla BC installations
- ✅ **Real-time operations** - Leverage BC's live WebSocket connection
- ✅ **Production-ready** - Built on BC's actual internal protocol (the same one the web UI uses)

---

## ✨ Features

### 🆕 **Version 2 Highlights**

- **📄 Document Pages** - Full support for Sales Orders, Purchase Orders with header + line items
- **📚 MCP Resources** - Access BC schema, workflows, and session state
- **🎯 MCP Prompts** - Guided workflows for common operations
- **✏️ User-Friendly Fields** - No more internal IDs - clean field names like "Type", "No.", "Description"
- **🔄 Multi-Page Support** - Card, List, and Document pages all work reliably

<table>
<tr>
<td width="50%">

### 🔍 **Discovery & Search**
- Tell Me search integration (Alt+Q)
- Page metadata extraction
- Field and action discovery
- Dynamic form inspection

</td>
<td width="50%">

### 📊 **Data Operations**
- Read page data in real-time
- Filter and query list pages
- Create and update records
- Execute page actions
- **NEW:** Document pages with line items

</td>
</tr>
<tr>
<td width="50%">

### 🔐 **Authentication**
- Session-based web authentication
- Support for all BC auth types
- CSRF token management
- Automatic session handling

</td>
<td width="50%">

### ⚡ **Performance**
- Event-driven architecture
- Gzip compression support
- Connection pooling ready
- Efficient state management

</td>
</tr>
</table>

---

## 🚀 Quick Start

Get up and running with BC WebClient MCP in 5 minutes.

### Prerequisites

- **Node.js** 18 or higher ([Download](https://nodejs.org/))
- **Business Central v27.0** (other versions may work but are not tested - protocol specifics are BC 27)
- Valid BC credentials with web client access
- **Claude Desktop** ([Download](https://claude.ai/download)) or any MCP-compatible client

### Step 1: No Installation Required!

The MCP server runs directly via `npx` - no installation needed. Just configure Claude Desktop in the next step.

### Step 2: Configure Claude Desktop

**Find your Claude Desktop config file:**

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Edit the config file** and add the MCP server (replace with your BC credentials):

```json
{
  "mcpServers": {
    "business-central": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "bc-webclient-mcp@latest"
      ],
      "env": {
        "BC_BASE_URL": "http://your-bc-server/BC/",
        "BC_USERNAME": "your-username",
        "BC_PASSWORD": "your-password",
        "BC_TENANT_ID": "default"
      }
    }
  }
}
```

> **Note**: On macOS/Linux, use `"command": "sh"` and `"args": ["-c", "npx bc-webclient-mcp@latest"]` instead.

**Why `npx`?**
- ✅ No installation required - runs directly from npm
- ✅ Always uses the latest version automatically
- ✅ No need to manage global packages

**Important notes:**
- Use `BC_USERNAME=username`, **NOT** `domain\username`
- The tenant is handled automatically in the URL parameter
- For BC Online, use your full BC URL (e.g., `https://businesscentral.dynamics.com/...`)

### Step 3: Restart Claude Desktop

**Restart Claude Desktop completely** to load the MCP server.

### Step 4: Verify It's Working

Open a new chat in Claude Desktop and try:

```
Search for customer pages
```

You should see Claude using the `search_pages` tool and returning BC pages. If the MCP server appears in the tools list (🔧 icon), you're all set!

### 🎉 What You Can Do Now

Try these commands to explore v2 capabilities:

**Document Pages with Line Items:**
```
Read Sales Order 101001 with all line items
```

**Smart Search:**
```
Find all pages related to inventory management
```

**Resources (Schema Discovery):**
```
What BC pages are available?
```
*(Uses the `bc://schema/pages` resource)*

**Guided Workflows (Prompts):**
```
Create a new customer named Acme Corporation
```
*(Uses the `create_bc_customer` prompt for step-by-step guidance)*

**Data Operations:**
```
Show me customers where balance is over 10000
```

**Field Updates:**
```
Update customer 10000's credit limit to 50000
```

### 🔧 Quick Troubleshooting

**MCP server not showing up in Claude Desktop?**
- Check the config file syntax is valid JSON
- Restart Claude Desktop completely (close all windows)
- Verify Node.js is installed: `node --version` (requires 18+)
- Check Claude Desktop logs: View → Developer → Toggle Developer Tools → Console

**Connection failed?**
- Verify BC is accessible: Open `http://your-bc-server/BC/` in a browser
- Check `BC_BASE_URL` includes the `/BC/` path
- Ensure firewall allows WebSocket connections

**Authentication error?**
- Test login in browser first
- Use username WITHOUT domain prefix (just `username`)
- Verify tenant ID matches your BC installation (`default` for on-prem)

**"TypeScript errors" when building?**
- Run `npx tsc --noEmit` to see detailed errors
- Ensure Node.js version is 18 or higher: `node --version`

For more troubleshooting, see [`CLAUDE.md`](./CLAUDE.md#troubleshooting)

### 📦 Alternative: Install from Source

For development, testing unreleased features, or contributing to the project:

```bash
# Clone the repository
git clone https://github.com/SShadowS/bc-webclient-mcp-server.git
cd bc-webclient-mcp-server

# Install dependencies
npm install

# Build the TypeScript project
npm run build
```

Then in Claude Desktop config, use the local path:

```json
{
  "mcpServers": {
    "business-central": {
      "command": "node",
      "args": ["C:\\path\\to\\bc-webclient-mcp-server\\dist\\index.js"],
      "env": {
        "BC_BASE_URL": "http://your-bc-server/BC/",
        "BC_USERNAME": "your-username",
        "BC_PASSWORD": "your-password",
        "BC_TENANT_ID": "default"
      }
    }
  }
}
```

**Note**: Use full absolute paths with double backslashes on Windows.

---

## 🛠️ Available Tools

The MCP server provides the following tools for AI interaction:

| Tool | Description | Level | Status |
|------|-------------|-------|--------|
| **`search_pages`** | Search for pages using Tell Me (Alt+Q) | Discovery | ✅ Complete |
| **`get_page_metadata`** | Get page structure, fields, and actions | Discovery | ✅ Complete |
| **`read_page_data`** | Read data from a page | Read | ✅ Complete |
| **`filter_list`** | Filter list pages by column values | Read | ✅ Complete |
| **`find_record`** | Find records by criteria | Read | ✅ Complete |
| **`write_page_data`** | Write field values with validation (low-level) | Write | ✅ Complete |
| **`create_record`** | Create new records | Write | ✅ Complete |
| **`update_record`** | Update records with auto Edit/Save (high-level) | Write | ✅ Complete |
| **`execute_action`** | Execute page actions (New, Edit, Post, etc.) | Action | ✅ Complete |

### Tool Architecture

The MCP server provides **two levels of tools** for maximum flexibility:

**🔧 Low-Level Tools** - Precise control, explicit parameters:
- `write_page_data` - Write fields with immediate validation, controlPath support, stopOnError options

**🎯 High-Level Tools** - Convenience wrappers that orchestrate multiple operations:
- `update_record` - Opens page → Executes Edit → Writes fields → Executes Save (all automatic)

This two-tier design gives LLMs both **precision** (low-level) and **convenience** (high-level) while keeping the API simple and predictable.

### Example Usage

Once connected, you can interact with Business Central through Claude:

```
You: "Search for customer-related pages"
Claude: [Uses search_pages tool]
Found 21 customer pages:
- Page 21: Customer Card
- Page 22: Customer List
...

You: "Show me customers where balance is over 10000"
Claude: [Uses filter_list + read_page_data tools]
Found 5 customers with balance > 10000:
1. Contoso Ltd - Balance: 15,234.50
2. Fabrikam Inc - Balance: 12,890.00
...

You: "Update customer 'Contoso Ltd' to set credit limit to 50000"
Claude: [Uses update_record tool - handles everything automatically]
Updated customer successfully:
- Opened Customer Card
- Switched to Edit mode
- Updated Credit Limit: 50,000.00
- Saved changes
✓ Record saved

You: "Set just the phone number field on the current customer"
Claude: [Uses write_page_data for precise control]
Updated field successfully:
- Phone No.: +45 12345678
✓ Validation passed
```

---

## 🔐 Security & User Consent

### User Consent Flow

This MCP server implements the **MCP 2025 user consent requirement** to ensure users maintain control over all data-modifying operations.

#### How It Works

1. **Tool Classification**: Each tool is classified by risk level:
   - 🟢 **Low Risk** (read-only) - No consent required
   - 🟡 **Medium Risk** (writes) - User approval required
   - 🔴 **High Risk** (irreversible) - User approval + warning

2. **Consent Enforcement**: Claude Desktop shows approval dialog before executing write operations:
   ```
   ⚠️  Tool Execution Request

   Claude wants to execute: create_record

   Create a new record in Business Central?
   This will add data to your Business Central database.

   [Deny]  [Allow]
   ```

3. **Audit Trail**: All approved operations are logged with:
   - Timestamp
   - Tool name
   - Input summary (sanitized)
   - Execution result

#### Tool Consent Requirements

| Tool | Requires Consent | Risk Level | Reason |
|------|------------------|------------|--------|
| search_pages | ❌ No | Low | Read-only discovery |
| get_page_metadata | ❌ No | Low | Read metadata only |
| read_page_data | ❌ No | Low | Read-only data access |
| find_record | ❌ No | Low | Search/filter only |
| filter_list | ❌ No | Low | Read-only filtering |
| create_record | ✅ Yes | Medium | Creates new data |
| update_record | ✅ Yes | Medium | Modifies existing data |
| write_page_data | ✅ Yes | Medium | Direct field writes |
| handle_dialog | ✅ Yes | Medium | Can bypass safety prompts |
| execute_action | ✅ Yes | High | Can trigger Post/Delete |

#### Audit Log Access

Audit logs are available via structured logging (Pino). Example log entry:

```json
{
  "level": "info",
  "msg": "Tool execution audit",
  "toolName": "create_record",
  "userApproved": true,
  "result": "success",
  "timestamp": "2025-11-08T10:30:45.123Z",
  "inputSummary": {
    "pageId": "21",
    "fields": "[Object]"
  }
}
```

**Sensitive Data Protection**: The audit logger automatically redacts passwords, tokens, API keys, secrets, and other credential fields.

For more details, see [docs/TOOL-CONSENT-CLASSIFICATION.md](./docs/TOOL-CONSENT-CLASSIFICATION.md) and [docs/USER-CONSENT-GUIDE.md](./docs/USER-CONSENT-GUIDE.md).

---

## 🏗️ Architecture

### Protocol Stack

```
┌─────────────────────────────────────┐
│     Claude Desktop (AI Client)      │
└──────────────┬──────────────────────┘
               │ MCP Protocol
               │ (JSON-RPC over stdio)
┌──────────────▼──────────────────────┐
│         MCP Server (Node.js)        │
│  ┌────────────────────────────┐    │
│  │   Tool Registry            │    │
│  │   - search_pages           │    │
│  │   - filter_list            │    │
│  │   - get_page_metadata      │    │
│  │   - ...                    │    │
│  └────────────┬───────────────┘    │
│               │                     │
│  ┌────────────▼───────────────┐    │
│  │  BCRawWebSocketClient      │    │
│  │  - Session management      │    │
│  │  - Event-driven handlers   │    │
│  │  - Gzip compression        │    │
│  └────────────┬───────────────┘    │
└───────────────┼─────────────────────┘
                │ WebSocket + JSON-RPC
                │ (BC Internal Protocol)
┌───────────────▼─────────────────────┐
│  Business Central Web Service       │
│  /BC/csh endpoint (WebSocket)       │
└─────────────────────────────────────┘
```

### Key Components

- **`BCRawWebSocketClient`** - Core WebSocket client that mimics browser behavior
- **`MCPServer`** - MCP protocol implementation (JSON-RPC over stdio)
- **`BaseMCPTool`** - Base class for all MCP tools with error handling
- **Protocol Parsers** - Decode BC's internal handler arrays
- **Event Emitters** - Handle asynchronous BC responses

### How It Works

1. **Authentication**: Web login flow → Session cookies + CSRF token
2. **WebSocket Connection**: Connect to `/csh` with session credentials
3. **Session Opening**: OpenSession request → Extract session identifiers
4. **Event-Driven Operations**: Send Invoke requests → Wait for handler arrays
5. **Response Parsing**: Decompress gzip → Parse handler structures → Extract data

For deep technical details, see:
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - Complete architecture analysis
- [`BC-COPILOT-IMPLEMENTATION.md`](./BC-COPILOT-IMPLEMENTATION.md) - BC's internal Copilot protocol
- [`docs/FILTER_METADATA_SOLUTION.md`](./docs/FILTER_METADATA_SOLUTION.md) - Filter implementation

---

## 📚 Documentation

### Quick Reference

- **[CLAUDE.md](./CLAUDE.md)** - Essential guide for development and troubleshooting
- **[SETUP.md](./SETUP.md)** - Step-by-step setup instructions
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System architecture and design decisions

### Deep Dives

- **[BC-COPILOT-IMPLEMENTATION.md](./BC-COPILOT-IMPLEMENTATION.md)** - 🔥 **Must Read!** - BC's exact Copilot protocol
- **[BC-AI-AGENT-ANALYSIS.md](./BC-AI-AGENT-ANALYSIS.md)** - BC's built-in AI agent framework
- **[docs/FILTER_METADATA_SOLUTION.md](./docs/FILTER_METADATA_SOLUTION.md)** - Filter tool implementation
- **[docs/current/TELLME-SEARCH-STATUS.md](./docs/current/TELLME-SEARCH-STATUS.md)** - Tell Me search implementation

### External Resources

- [Business Central API Documentation](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/api-reference/v2.0/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [WebSocket Protocol RFC 6455](https://tools.ietf.org/html/rfc6455)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)

---

## 🧪 Development

### Project Structure

```
bc-poc/
├── src/
│   ├── core/                    # Core infrastructure
│   │   ├── errors.ts            # Error types and handling
│   │   ├── result.ts            # Result monad for error handling
│   │   └── interfaces.ts        # TypeScript interfaces
│   ├── services/                # Business logic
│   │   ├── BCRawWebSocketClient.ts   # ⭐ Main WebSocket client
│   │   ├── mcp-server.ts        # MCP protocol server
│   │   └── stdio-transport.ts   # stdin/stdout JSON-RPC transport
│   ├── tools/                   # MCP tool implementations
│   │   ├── search-pages-tool.ts
│   │   ├── filter-list-tool.ts
│   │   ├── get-page-metadata-tool.ts
│   │   └── ...
│   ├── protocol/                # BC protocol parsers
│   │   ├── logical-form-parser.ts
│   │   └── handler-types.ts
│   └── types/                   # TypeScript type definitions
├── test/                        # Test scripts
├── docs/                        # Detailed documentation
└── dist/                        # Compiled JavaScript (generated)
```

### Development Commands

```bash
# Type checking (run frequently!)
npx tsc --noEmit

# Build the project
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
npm run test:coverage

# Test specific functionality
npm run test:invoke        # Test Invoke method
npm run test:mcp          # Test MCP server
```

### Code Quality Standards

**⚠️ NO STUBS POLICY**: This is a production codebase. Do NOT create:
- Stub implementations
- Mock functions that don't actually work
- Placeholder code with "not yet implemented" errors
- Tools that are registered but non-functional

Every feature MUST be fully implemented and functional before being committed.

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:mcp:client          # MCP client integration tests
npm run test:mcp:real           # Real BC integration tests

# Test Tell Me search
npx tsx test-tellme-search.ts "customer"

# Test MCP server with real BC connection
npm run test:mcp:real:client
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Read the architecture documentation first
2. Follow the existing code style and patterns
3. Ensure TypeScript compilation passes (`npx tsc --noEmit`)
4. Add tests for new functionality
5. Update documentation as needed

### Key Guidelines

- **Use Windows paths** when working on Windows
- **Run type checking regularly** with `npx tsc --noEmit`
- **No stubs or mocks** - all implementations must be fully functional
- **Read [`CLAUDE.md`](./CLAUDE.md)** for development guidelines
- **Check existing docs** before implementing new features

---

## 📋 Requirements

### Supported Business Central Versions

- ✅ **Business Central v27.0** (fully tested and supported)
- ⚠️ **Other versions** (v24-v26, v28+) may work but are **not tested**
  - Protocol specifics are hardcoded for BC 27
  - Older/newer versions may have different WebSocket protocol implementations
  - Use at your own risk - contributions for other versions welcome!
- ✅ **On-Premises installations** (BC 27)
- ✅ **Business Central Online** (BC 27)

### Authentication Support

- ✅ NavUserPassword (username/password)
- ✅ Windows Authentication
- ✅ Azure AD (via web login)

**No special BC configuration required!** The server mimics browser login behavior.

---

## 🐛 Troubleshooting

### Connection Issues

```bash
# Test BC connectivity
curl http://your-server/BC/

# Check BC service status (on-prem)
docker exec Cronus27 powershell "Get-Service 'MicrosoftDynamicsNavServer*'"

# Verify WebSocket endpoint
wscat -c ws://your-server/BC/csh
```

### Common Issues

**"WebSocket connection failed"**
- Verify `BC_BASE_URL` is correct and includes `/BC/` path
- Ensure BC web client is accessible in browser first
- Check firewall rules

**"Authentication failed"**
- Test login in browser: `http://your-server/BC/`
- Use username WITHOUT domain prefix (just `username`, not `domain\username`)
- Verify tenant ID is correct

**"CSRF token not found"**
- Ensure BC web client is accessible
- Check if BC requires different authentication
- Clear BC cache and restart services

**"OpenSession timeout"**
- Verify tenant ID matches your BC installation
- Check BC server logs for errors
- Increase timeout in BCRawWebSocketClient

For more troubleshooting tips, see [`CLAUDE.md`](./CLAUDE.md#troubleshooting).

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built on Microsoft Dynamics 365 Business Central
- Implements the [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- Inspired by BC's internal Copilot implementation

---

## 📞 Support

- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)
- **Documentation**: [Project Wiki](../../wiki)

---

<div align="center">

**[⬆ back to top](#-bc-webclient-mcp)**

Made with ❤️ for the Business Central community

</div>
