# Bitbucket Server MCP

MCP (Model Context Protocol) server for Bitbucket Server / Data Center. Provides AI assistants with tools to interact with pull requests, branches, repositories, code review, and CI/CD insights through the MCP protocol.

[![npm version](https://img.shields.io/npm/v/@pavel-kalmykov/bitbucket-server-mcp)](https://www.npmjs.com/package/@pavel-kalmykov/bitbucket-server-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@pavel-kalmykov/bitbucket-server-mcp)](https://www.npmjs.com/package/@pavel-kalmykov/bitbucket-server-mcp)
[![CI](https://github.com/pavel-kalmykov/bitbucket-server-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pavel-kalmykov/bitbucket-server-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/pavel-kalmykov/bitbucket-server-mcp/graph/badge.svg)](https://codecov.io/gh/pavel-kalmykov/bitbucket-server-mcp)
[![Node](https://img.shields.io/node/v/@pavel-kalmykov/bitbucket-server-mcp)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@pavel-kalmykov/bitbucket-server-mcp)](LICENSE)

## Requirements

One of:
- [Node.js](https://nodejs.org) >= 22.14 (via `npx`)
- [Bun](https://bun.sh) (via `bunx`)
- [Docker](https://www.docker.com)

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "@pavel-kalmykov/bitbucket-server-mcp"],
      "env": {
        "BITBUCKET_URL": "https://your-bitbucket-server.com",
        "BITBUCKET_TOKEN": "your-access-token"
      }
    }
  }
}
```

### Claude Code

```console
claude mcp add bitbucket \
  -e BITBUCKET_URL=https://your-bitbucket-server.com \
  -e BITBUCKET_TOKEN=your-token \
  -- npx -y @pavel-kalmykov/bitbucket-server-mcp
```

### VS Code

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "bitbucket": {
      "command": "npx",
      "args": ["-y", "@pavel-kalmykov/bitbucket-server-mcp"],
      "env": {
        "BITBUCKET_URL": "https://your-bitbucket-server.com",
        "BITBUCKET_TOKEN": "your-access-token"
      }
    }
  }
}
```

### Docker

For environments without Node.js:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "BITBUCKET_URL=https://your-bitbucket-server.com",
        "-e", "BITBUCKET_TOKEN=your-access-token",
        "ghcr.io/pavel-kalmykov/bitbucket-server-mcp"
      ]
    }
  }
}
```

Or build locally: `docker build -t bitbucket-mcp .`

### Bun

If you have [Bun](https://bun.sh) installed, you can use it as an alternative runtime:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "bunx",
      "args": ["@pavel-kalmykov/bitbucket-server-mcp"],
      "env": {
        "BITBUCKET_URL": "https://your-bitbucket-server.com",
        "BITBUCKET_TOKEN": "your-access-token"
      }
    }
  }
}
```

See the [Environment Variables](#environment-variables) section for all configuration options.

## Tools

### Repositories

| Tool | Description |
|------|-------------|
| `list_projects` | List all accessible Bitbucket projects |
| `list_repositories` | List repositories in a project |
| `browse_repository` | Browse files and directories |
| `get_file_content` | Read file contents with pagination |

### Pull Requests

| Tool | Description |
|------|-------------|
| `create_pull_request` | Create a PR, including cross-repo from forks (`sourceProject`/`sourceRepository`). Auto-fetches default reviewers unless `includeDefaultReviewers: false`. |
| `get_pull_request` | Get PR details |
| `update_pull_request` | Safely update title, description, or reviewers (read-modify-write, preserves fields not explicitly changed) |
| `merge_pull_request` | Merge a PR with optional strategy (`merge-commit`, `squash`, `fast-forward`) |
| `decline_pull_request` | Decline a PR |
| `list_pull_requests` | List PRs with filtering by state, author, direction |
| `get_dashboard_pull_requests` | List PRs across all repos for the authenticated user, filtered by role (`AUTHOR`/`REVIEWER`/`PARTICIPANT`), state, and review status |
| `get_pr_activity` | Get PR activity timeline, filtered by type (`all`, `reviews`, `comments`) |
| `get_diff` | Get PR diff with per-file truncation support |

### Code Review

| Tool | Description |
|------|-------------|
| `manage_comment` | Unified create/edit/delete for PR comments. Supports inline anchoring (`filePath`/`line`/`lineType`), draft state (`state: PENDING`), and task creation (`severity: BLOCKER`). |
| `submit_review` | Unified approve/unapprove/publish. Publish transitions all `PENDING` comments to visible and optionally sets `participantStatus` (`APPROVED`/`NEEDS_WORK`). |

### Branches & Commits

| Tool | Description |
|------|-------------|
| `list_branches` | List branches with default branch detection |
| `list_commits` | Browse commit history with branch and author filtering |
| `delete_branch` | Delete a branch (safety check prevents deleting default branch) |

### Search & Insights

| Tool | Description |
|------|-------------|
| `search` | Search code and files across repositories |
| `get_code_insights` | Fetch Code Insights reports (SonarQube, security scans) and annotations |

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BITBUCKET_URL` | Yes | Base URL of your Bitbucket Server instance |
| `BITBUCKET_TOKEN` | Yes* | Personal access token |
| `BITBUCKET_USERNAME` | Yes* | Username for basic auth |
| `BITBUCKET_PASSWORD` | Yes* | Password for basic auth |
| `BITBUCKET_DEFAULT_PROJECT` | No | Default project key when not specified in tool calls |
| `BITBUCKET_READ_ONLY` | No | Set to `true` to disable all write operations |
| `BITBUCKET_CUSTOM_HEADERS` | No | Extra headers for all requests (`Key=Value,Key2=Value2`). Useful for Zero Trust tokens. |
| `BITBUCKET_DIFF_MAX_LINES_PER_FILE` | No | Max lines per file in diffs. Set to `0` for no limit. |
| `BITBUCKET_CACHE_TTL` | No | Cache duration in seconds (default: 300). Set to `0` to disable caching. |
| `BITBUCKET_ENABLED_TOOLS` | No | Comma-separated list of tool names to enable. If not set, all tools are available. |

*Either `BITBUCKET_TOKEN` or both `BITBUCKET_USERNAME` and `BITBUCKET_PASSWORD` are required.

### Read-Only Mode

Set `BITBUCKET_READ_ONLY=true` to restrict the server to read-only operations. Write tools (`create_pull_request`, `update_pull_request`, `merge_pull_request`, `decline_pull_request`, `manage_comment`, `submit_review`, `delete_branch`) are disabled.

### Tool Filtering

Set `BITBUCKET_ENABLED_TOOLS` to load only specific tools, reducing context window usage:

```console
BITBUCKET_ENABLED_TOOLS=get_pull_request,get_diff,manage_comment,submit_review
```

### Caching

The server caches frequently accessed data in memory (project lists, repository metadata, default reviewers) to reduce API calls. The cache uses LRU eviction (max 500 entries) so memory stays bounded, and write operations automatically invalidate related entries.

By default, cached entries expire after 5 minutes. Configure with `BITBUCKET_CACHE_TTL` (in seconds), or set to `0` to disable caching entirely.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and how to add new tools.

## License

Apache 2.0
