# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do not open a public issue.**
2. Use [GitHub's private vulnerability reporting](https://github.com/pavel-kalmykov/bitbucket-server-mcp/security/advisories/new) to submit your report.
3. Include as much detail as possible: steps to reproduce, affected versions, and potential impact.

You should receive an initial response within 72 hours. Once the issue is confirmed, a fix will be developed and released as a patch version.

## Security Design

This MCP server acts as a bridge between AI assistants and Bitbucket Server. Key security considerations:

- **Authentication**: credentials (token or username/password) are provided exclusively via environment variables. They are never logged, stored on disk, or included in error messages.
- **Read-only mode**: the `BITBUCKET_READ_ONLY` environment variable restricts the server to read-only operations, preventing any modifications to Bitbucket resources.
- **Tool filtering**: the `BITBUCKET_ENABLED_TOOLS` variable allows operators to expose only a specific subset of tools.
- **Input validation**: all tool inputs are validated with [Zod](https://zod.dev/) schemas before reaching the Bitbucket API.
- **Minimal dependencies**: the runtime depends on only four packages (`@modelcontextprotocol/sdk`, `ky`, `lru-cache`, `zod`).
- **CI security**: CodeQL static analysis runs on every push and PR. Dependabot and secret scanning are enabled.
