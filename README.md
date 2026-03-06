# Bitbucket Server MCP

MCP (Model Context Protocol) server for Bitbucket Server Pull Request management. This server provides tools and resources to interact with the Bitbucket Server API through the MCP protocol.

[![smithery badge](https://smithery.ai/badge/@garc33/bitbucket-server-mcp-server)](https://smithery.ai/server/@garc33/bitbucket-server-mcp-server)
<a href="https://glama.ai/mcp/servers/jskr5c1zq3"><img width="380" height="200" src="https://glama.ai/mcp/servers/jskr5c1zq3/badge" alt="Bitbucket Server MCP server" /></a>

## ✨ New Features

- **🔧 Custom HTTP Headers**: Add custom headers to all requests via `BITBUCKET_CUSTOM_HEADERS` environment variable (useful for Zero Trust tokens or proxies)
- **📋 PR Discovery**: List and filter pull requests by state, author, or direction using `list_pull_requests` (fixes #14)
- **🌿 Branch Management**: List branches with default branch detection using `list_branches`, delete merged branches with `delete_branch`
- **📝 Commit History**: Browse commit history with branch and author filtering using `list_commits`
- **✅ PR Approval**: Approve and unapprove pull requests with `approve_pull_request` and `unapprove_pull_request`
- **🔍 Advanced Search**: Search code and files across repositories with project/repository filtering using the `search` tool
- **📄 File Operations**: Read file contents and browse repository directories with `get_file_content` and `browse_repository`
- **💬 Comment Management**: Extract and filter PR comments with `get_comments` tool
- **🔍 Project Discovery**: List all accessible Bitbucket projects with `list_projects`
- **📁 Repository Browsing**: Explore repositories across projects with `list_repositories`
- **🔧 Flexible Project Support**: Make the default project optional - specify per command or use `BITBUCKET_DEFAULT_PROJECT`
- **📖 Enhanced Documentation**: Improved README with usage examples and better configuration guidance

## Requirements

- Node.js >= 16

## Installation

### Installing via Smithery

To install Bitbucket Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@garc33/bitbucket-server-mcp-server):

```bash
npx -y @smithery/cli install @garc33/bitbucket-server-mcp-server --client claude
```

### Manual Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Features

The server provides the following tools for comprehensive Bitbucket Server integration:

### `list_projects`

**Discover and explore Bitbucket projects**: Lists all accessible projects with their details. Essential for project discovery and finding the correct project keys to use in other operations.

**Use cases:**

- Find available projects when you don't know the exact project key
- Explore project structure and permissions
- Discover new projects you have access to

Parameters:

- `limit`: Number of projects to return (default: 25, max: 1000)
- `start`: Start index for pagination (default: 0)

### `list_repositories`

**Browse and discover repositories**: Explore repositories within specific projects or across all accessible projects. Returns comprehensive repository information including clone URLs and metadata.

**Use cases:**

- Find repository slugs for other operations
- Explore codebase structure across projects
- Discover repositories you have access to
- Browse a specific project's repositories

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `limit`: Number of repositories to return (default: 25, max: 1000)
- `start`: Start index for pagination (default: 0)

### `create_pull_request`

**Propose code changes for review**: Creates a new pull request to submit code changes, request reviews, or merge feature branches. Automatically handles branch references and reviewer assignments.

**Use cases:**

- Submit feature development for review
- Propose bug fixes
- Request code integration from feature branches
- Collaborate on code changes

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `title` (required): Clear, descriptive PR title
- `description`: Detailed description with context (supports Markdown)
- `sourceBranch` (required): Source branch containing changes
- `targetBranch` (required): Target branch for merging
- `reviewers`: Array of reviewer usernames

### `get_pull_request`

**Comprehensive PR information**: Retrieves detailed pull request information including status, reviewers, commits, and all metadata. Essential for understanding PR state before taking actions.

**Use cases:**

- Check PR approval status
- Review PR details and progress
- Understand changes before merging
- Monitor PR status

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID

### `merge_pull_request`

**Integrate approved changes**: Merges an approved pull request into the target branch. Supports different merge strategies based on your workflow preferences.

**Use cases:**

- Complete the code review process
- Integrate approved features
- Apply bug fixes to main branches
- Release code changes

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID
- `message`: Custom merge commit message
- `strategy`: Merge strategy:
  - `merge-commit` (default): Creates merge commit preserving history
  - `squash`: Combines all commits into one
  - `fast-forward`: Moves branch pointer without merge commit

### `decline_pull_request`

**Reject unsuitable changes**: Declines a pull request that should not be merged, providing feedback to the author.

**Use cases:**

- Reject changes that don't meet standards
- Close PRs that conflict with project direction
- Request significant rework
- Prevent unwanted code integration

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID
- `message`: Reason for declining (helpful for author feedback)

### `add_comment`

**Participate in code review**: Adds comments to pull requests for review feedback, discussions, and collaboration. Supports threaded conversations.

**Use cases:**

- Provide code review feedback
- Ask questions about specific changes
- Suggest improvements
- Participate in technical discussions
- Document review decisions

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID
- `text` (required): Comment content (supports Markdown)
- `parentId`: Parent comment ID for threaded replies

### `get_diff`

**Analyze code changes**: Retrieves the code differences showing exactly what was added, removed, or modified in the pull request. Supports per-file truncation to manage large diffs effectively.

**Use cases:**

- Review specific code changes
- Understand scope of modifications
- Analyze impact before merging
- Inspect implementation details
- Code quality assessment
- Handle large files without overwhelming output

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID
- `contextLines`: Context lines around changes (default: 10)
- `maxLinesPerFile`: Maximum lines to show per file (optional, uses BITBUCKET_DIFF_MAX_LINES_PER_FILE env var if not specified, set to 0 for no limit)

**Large File Handling:**
When a file exceeds the `maxLinesPerFile` limit, it shows:

- File headers and metadata (always preserved)
- First 60% of allowed lines from the beginning
- Truncation message with file statistics
- Last 40% of allowed lines from the end
- Clear indication of how to see the complete diff

### `get_reviews`

**Track review progress**: Fetches review history, approval status, and reviewer feedback to understand the review state.

**Use cases:**

- Check if PR is ready for merging
- See who has reviewed the changes
- Understand review feedback
- Monitor approval requirements
- Track review progress

### `get_activities`

**Retrieve pull request activities**: Gets the complete activity timeline for a pull request including comments, reviews, commits, and other events.

**Use cases:**

- Read comment discussions and feedback
- Review the complete PR timeline
- Track commits added/removed from PR
- See approval and review history
- Understand the full PR lifecycle

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID

### `get_comments`

**Extract PR comments only**: Filters pull request activities to return only the comments, making it easier to focus on discussion content without reviews or other activities.

**Use cases:**

- Read PR discussion threads
- Extract feedback and questions
- Focus on comment content without noise
- Analyze conversation flow

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID

### `search`

**Advanced code and file search**: Search across repositories using the Bitbucket search API with support for project/repository filtering and query optimization. Searches both file contents and filenames. **Note**: Search only works on the default branch of repositories.

**Use cases:**

- Find specific code patterns across projects
- Locate files by name or content
- Search within specific projects or repositories
- Filter by file extensions

Parameters:

- `query` (required): Search query string
- `project`: Bitbucket project key to limit search scope
- `repository`: Repository slug for repository-specific search
- `type`: Query optimization - "file" (wraps query in quotes for exact filename matching) or "code" (default search behavior)
- `limit`: Number of results to return (default: 25, max: 100)
- `start`: Start index for pagination (default: 0)

**Query syntax examples:**

- `"README.md"` - Find exact filename
- `config ext:yml` - Find config in YAML files
- `function project:MYPROJECT` - Search for "function" in specific project
- `bug fix repo:PROJ/my-repo` - Search in specific repository

### `get_file_content`

**Read file contents with pagination**: Retrieve the content of specific files from repositories with support for large files through pagination.

**Use cases:**

- Read source code files
- View configuration files
- Extract documentation content
- Inspect specific file versions

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `filePath` (required): Path to the file in the repository
- `branch`: Branch or commit hash (optional, defaults to main/master)
- `limit`: Maximum lines per request (default: 100, max: 1000)
- `start`: Starting line number for pagination (default: 0)

### `browse_repository`

**Explore repository structure**: Browse files and directories in repositories to understand project organization and locate specific files.

**Use cases:**

- Explore repository structure
- Navigate directory trees
- Find files and folders
- Understand project organization

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `path`: Directory path to browse (optional, defaults to root)
- `branch`: Branch or commit hash (optional, defaults to main/master)
- `limit`: Maximum items to return (default: 50)

### `list_pull_requests`

**Discover and filter pull requests**: List pull requests in a repository with filtering by state, author, and direction. Returns PR metadata including title, author, branches, reviewers, and status.

**Use cases:**

- Find open PRs in a repository
- List your own pull requests
- See PRs awaiting review
- Get an overview of merged or declined PRs
- Monitor PR activity in a project

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `state`: Filter by PR state — `OPEN` (default), `MERGED`, `DECLINED`, or `ALL`
- `author`: Filter by author username (exact match)
- `direction`: `INCOMING` (PRs targeting this repo, default) or `OUTGOING` (PRs from this repo)
- `limit`: Number of PRs to return (default: 25, max: 1000)
- `start`: Start index for pagination (default: 0)

### `list_branches`

**Explore repository branches**: List branches in a repository with optional filtering. Identifies the default branch and shows latest commit information for each branch.

**Use cases:**

- Find branch names for PR creation or checkout
- Verify branch existence before operations
- Identify the default branch
- Search for branches by name

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `filterText`: Filter branches by name (case-insensitive partial match)
- `limit`: Number of branches to return (default: 25, max: 1000)
- `start`: Start index for pagination (default: 0)

### `list_commits`

**Browse commit history**: List commits in a repository with optional branch and author filtering. Use this to review changes, track contributions, or understand the evolution of a branch.

**Use cases:**

- Review recent changes on a branch
- Find commits by a specific author
- Track commit history before merging
- Understand branch evolution

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `branch`: Branch name to list commits from (defaults to the repository's default branch)
- `author`: Filter by author name or email (case-insensitive partial match, applied client-side)
- `limit`: Number of commits to return (default: 25, max: 1000)
- `start`: Start index for pagination (default: 0)

### `delete_branch`

**Clean up merged branches**: Delete a branch from a repository. Includes a safety check to prevent deletion of the default branch.

**Use cases:**

- Clean up feature branches after PR merge
- Remove stale or abandoned branches
- Repository maintenance and hygiene

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `branch` (required): Branch name to delete

### `approve_pull_request`

**Approve code changes**: Approve a pull request as the current authenticated user. Records your approval on the PR, signaling that changes are ready to merge.

**Use cases:**

- Approve reviewed pull requests
- Signal readiness for merge
- Complete code review workflow

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID to approve

### `unapprove_pull_request`

**Retract approval**: Remove your approval from a pull request. Use this when you need to retract a previous approval after discovering issues or when the PR has changed.

**Use cases:**

- Retract approval after discovering issues
- Remove approval when PR scope changes
- Correct accidental approvals

Parameters:

- `project`: Bitbucket project key (optional, uses BITBUCKET_DEFAULT_PROJECT if not provided)
- `repository` (required): Repository slug
- `prId` (required): Pull request ID to remove approval from

## Usage Examples

### Listing Projects and Repositories

```bash
# List all accessible projects
list_projects

# List repositories in the default project (if BITBUCKET_DEFAULT_PROJECT is set)
list_repositories

# List repositories in a specific project
list_repositories --project "MYPROJECT"

# List projects with pagination
list_projects --limit 10 --start 0
```

### Search and File Operations

```bash
# Search for README files across all projects
search --query "README" --type "file" --limit 10

# Search for specific code patterns in a project
search --query "function getUserData" --type "code" --project "MYPROJECT"

# Search with file extension filter
search --query "config ext:yml" --project "MYPROJECT"

# Browse repository structure
browse_repository --project "MYPROJECT" --repository "my-repo"

# Browse specific directory
browse_repository --project "MYPROJECT" --repository "my-repo" --path "src/components"

# Read file contents
get_file_content --project "MYPROJECT" --repository "my-repo" --filePath "package.json" --limit 20

# Read specific lines from a large file
get_file_content --project "MYPROJECT" --repository "my-repo" --filePath "docs/CHANGELOG.md" --start 100 --limit 50
```

### Working with Pull Requests

```bash
# Create a pull request (using default project)
create_pull_request --repository "my-repo" --title "Feature: New functionality" --sourceBranch "feature/new-feature" --targetBranch "main"

# Create a pull request with specific project
create_pull_request --project "MYPROJECT" --repository "my-repo" --title "Bugfix: Critical issue" --sourceBranch "bugfix/critical" --targetBranch "develop" --description "Fixes critical issue #123"

# Get pull request details
get_pull_request --repository "my-repo" --prId 123

# Get only comments from a PR (no reviews/commits)
get_comments --project "MYPROJECT" --repository "my-repo" --prId 123

# Get full PR activity timeline
get_activities --repository "my-repo" --prId 123

# Merge a pull request with squash strategy
merge_pull_request --repository "my-repo" --prId 123 --strategy "squash" --message "Feature: New functionality (#123)"
```

### Discovering Pull Requests

```bash
# List open PRs in a repository (default state: OPEN)
list_pull_requests --repository "my-repo"

# List all PRs regardless of state
list_pull_requests --repository "my-repo" --state "ALL"

# Find PRs by a specific author
list_pull_requests --repository "my-repo" --author "john.doe"

# List merged PRs with pagination
list_pull_requests --repository "my-repo" --state "MERGED" --limit 10 --start 0
```

### Branch Management

```bash
# List all branches in a repository
list_branches --repository "my-repo"

# Filter branches by name
list_branches --project "MYPROJECT" --repository "my-repo" --filterText "feature"

# Delete a merged branch
delete_branch --repository "my-repo" --branch "feature/completed-work"
```

### Commit History

```bash
# List recent commits on the default branch
list_commits --repository "my-repo"

# List commits on a specific branch
list_commits --repository "my-repo" --branch "develop" --limit 10

# Filter commits by author
list_commits --repository "my-repo" --author "john.doe"

# Combine branch and author filters
list_commits --project "MYPROJECT" --repository "my-repo" --branch "main" --author "jane"
```

### PR Approval Workflow

```bash
# Approve a pull request
approve_pull_request --repository "my-repo" --prId 123

# Remove your approval
unapprove_pull_request --repository "my-repo" --prId 123

# Full workflow: review diff, approve, merge
get_diff --repository "my-repo" --prId 123
approve_pull_request --repository "my-repo" --prId 123
merge_pull_request --repository "my-repo" --prId 123 --strategy "squash"
```

## Dependencies

- `@modelcontextprotocol/sdk` - SDK for MCP protocol implementation
- `axios` - HTTP client for API requests
- `winston` - Logging framework

## Configuration

The server requires configuration in the VSCode MCP settings file. Here's a sample configuration:

```json
{
  "mcpServers": {
    "bitbucket": {
      "command": "node",
      "args": ["/path/to/bitbucket-server/build/index.js"],
      "env": {
        "BITBUCKET_URL": "https://your-bitbucket-server.com",
        // Authentication (choose one):
        // Option 1: Personal Access Token
        "BITBUCKET_TOKEN": "your-access-token",
        // Option 2: Username/Password
        "BITBUCKET_USERNAME": "your-username",
        "BITBUCKET_PASSWORD": "your-password",
        // Optional: Default project
        "BITBUCKET_DEFAULT_PROJECT": "your-default-project"
      }
    }
  }
}
```

### Environment Variables

- `BITBUCKET_URL` (required): Base URL of your Bitbucket Server instance
- Authentication (one of the following is required):
  - `BITBUCKET_TOKEN`: Personal access token
  - `BITBUCKET_USERNAME` and `BITBUCKET_PASSWORD`: Basic authentication credentials
- `BITBUCKET_DEFAULT_PROJECT` (optional): Default project key to use when not specified in tool calls
- `BITBUCKET_DIFF_MAX_LINES_PER_FILE` (optional): Default maximum lines to show per file in diffs. Set to prevent large files from overwhelming output. Can be overridden by the `maxLinesPerFile` parameter in `get_diff` calls.
- `BITBUCKET_LOG_PATH` (optional): Custom path for the log file (default: `~/.bitbucket-server-mcp/bitbucket.log`)
- `BITBUCKET_READ_ONLY` (optional): Set to `true` to enable read-only mode
- `BITBUCKET_CUSTOM_HEADERS` (optional): Comma-separated list of custom HTTP headers to add to all requests (format: `Header-Name=value,Another-Header=value2`). Useful for Zero Trust tokens or proxy headers

**Note**: With the new optional project support, you can now:

- Set `BITBUCKET_DEFAULT_PROJECT` to work with a specific project by default
- Use `list_projects` to discover available projects
- Use `list_repositories` to browse repositories across projects
- Override the default project by specifying the `project` parameter in any tool call

### Read-Only Mode

The server supports a read-only mode for deployments where you want to prevent any modifications to your Bitbucket repositories. When enabled, only safe, non-modifying operations are available.

**To enable read-only mode**: Set the environment variable `BITBUCKET_READ_ONLY=true`

**Available tools in read-only mode:**

- `list_projects` - Browse and list projects
- `list_repositories` - Browse and list repositories
- `get_pull_request` - View pull request details
- `list_pull_requests` - List and filter pull requests
- `get_diff` - View code changes and diffs
- `get_reviews` - View review history and status
- `get_activities` - View pull request timeline
- `get_comments` - View pull request comments
- `search` - Search code and files across repositories
- `get_file_content` - Read file contents
- `browse_repository` - Browse repository structure
- `list_branches` - List repository branches
- `list_commits` - Browse commit history

**Disabled tools in read-only mode:**

- `create_pull_request` - Creating new pull requests
- `merge_pull_request` - Merging pull requests
- `decline_pull_request` - Declining pull requests
- `add_comment` - Adding comments to pull requests
- `delete_branch` - Deleting branches
- `approve_pull_request` - Approving pull requests
- `unapprove_pull_request` - Removing PR approvals

**Behavior:**

- When `BITBUCKET_READ_ONLY` is not set or set to any value other than `true`, all tools function normally (backward compatible)
- When `BITBUCKET_READ_ONLY=true`, write operations are filtered out and will return an error if called
- This is perfect for production deployments, CI/CD integration, or any scenario where you need safe, read-only Bitbucket access

## Logging

The server logs all operations using Winston for debugging and monitoring purposes.

**Log file location** (in order of priority):

1. `BITBUCKET_LOG_PATH` environment variable — custom path
2. `~/.bitbucket-server-mcp/bitbucket.log` — default location

The log directory is created automatically if it doesn't exist.

**Example**: Set a custom log path in your MCP configuration:

```json
{
  "env": {
    "BITBUCKET_LOG_PATH": "/var/log/bitbucket-mcp/server.log"
  }
}
```

### Custom HTTP Headers

You can add custom HTTP headers to all API requests using the `BITBUCKET_CUSTOM_HEADERS` environment variable. This is useful for Zero Trust security tokens, proxy headers, or any other headers required by your infrastructure.

**Format**: Comma-separated key-value pairs where values can contain equals signs:

```
Header-Name=value,Another-Header=value2
```

**Single header example**:

```json
{
  "env": {
    "BITBUCKET_CUSTOM_HEADERS": "X-Zero-Trust-Token=your-token-here"
  }
}
```

**Multiple headers example**:

```json
{
  "env": {
    "BITBUCKET_CUSTOM_HEADERS": "X-Custom-Header=value1,X-Proxy-Auth=token123"
  }
}
```
