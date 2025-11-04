<div align="center">

# 🚀 Business Central AI Agent 3rd Party MCP Server

**AI-powered integration for Microsoft Dynamics 365 Business Central WebUI**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-purple)](https://modelcontextprotocol.io/)

[Features](#-features) • [Quick Start](#-quick-start) • [Tools](#-available-tools) • [Documentation](#-documentation) • [Architecture](#-architecture)

</div>

---

## 📖 Overview

**bc-mcp-server** is a Model Context Protocol (MCP) server that enables AI assistants like Claude to interact with Microsoft Dynamics 365 Business Central through a clean, intuitive interface. Built on BC's native WebSocket protocol, it provides real-time access to ERP data, business logic, and operations.

### What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that enables AI assistants to securely connect with external data sources and tools. This server implements MCP to bridge Claude with Business Central's internal APIs.

### Why This Matters

Business Central's web client uses an undocumented WebSocket protocol for all UI operations. This project reverse-engineers that protocol to:

- ✅ **Enable AI-driven ERP automation** - Let Claude interact with BC data naturally
- ✅ **No custom extensions required** - Works with vanilla BC installations
- ✅ **Real-time operations** - Leverage BC's live WebSocket connection
- ✅ **Production-ready** - Built on BC's actual internal protocol (the same one the web UI uses)

---

## ✨ Features

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

### Prerequisites

- **Node.js** 18 or higher
- **Business Central** v24.0+ (tested on v27.0)
- Valid BC credentials with web client access

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd bc-poc

# Install dependencies
npm install

# Create environment configuration
cp .env.example .env

# Edit with your BC credentials
notepad .env  # Windows
nano .env     # Linux/macOS
```

### Configuration

Edit `.env` with your Business Central details:

```env
# Business Central Server
BC_BASE_URL=http://your-bc-server/BC/
BC_TENANT_ID=default

# Credentials (username only, NO domain prefix!)
BC_USERNAME=your-username
BC_PASSWORD=your-password

# Optional
BC_COMPANY_NAME=CRONUS International Ltd.
ROLE_CENTER_PAGE_ID=9022
```

> **⚠️ Important:** Use `BC_USERNAME=username`, **NOT** `domain\username`. The tenant is handled automatically in the URL parameter.

### Run the Server

```bash
# Start MCP server (for Claude Desktop)
npm start

# Development mode with auto-reload
npm run dev

# Run tests
npm test
```

### Connect with Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "business-central": {
      "command": "node",
      "args": ["C:\\path\\to\\bc-poc\\dist\\index.js"],
      "env": {
        "BC_BASE_URL": "http://your-server/BC/",
        "BC_USERNAME": "your-username",
        "BC_PASSWORD": "your-password",
        "BC_TENANT_ID": "default"
      }
    }
  }
}
```

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

- ✅ Business Central v27.0 (tested)
- ✅ Business Central v26.0
- ✅ Business Central v24.x - v25.x (likely compatible)
- ✅ On-Premises installations
- ✅ Business Central Online

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

**[⬆ back to top](#-business-central-mcp-server)**

Made with ❤️ for the Business Central community

</div>
