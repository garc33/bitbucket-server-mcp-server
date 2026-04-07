# Contributing

## Development setup

```console
npm install
npm run build
npm test
npm run lint
```

With Bun you can skip the build step and run TypeScript directly:

```console
bun install
bunx vitest run       # runs tests via vitest (not bun:test)
bun run src/entry.ts  # starts the server (no tsc needed)
```

> [!NOTE]
> `npm run build` (tsc) is still needed to generate `.d.ts` files for publishing.

## Architecture

```
src/
  entry.ts          # Entry point (STDIO transport)
  server.ts         # McpServer setup, tool/resource/prompt registration
  config.ts         # Environment variable parsing and validation
  client.ts         # HTTP client factory (ky instances per API base URL)
  types.ts          # Shared TypeScript interfaces
  tools/            # Tool implementations by domain
  resources/        # MCP Resources
  prompts/          # MCP Prompts (e.g. review-pr)
  utils/            # Cache, error handling, response formatting, diff truncation
```

## Adding a new tool

Each tool module in `src/tools/` exports a registration function that receives the McpServer instance, API clients, cache, and default config. To add a new tool:

1. **Write the test first** in `src/__tests__/tools/yourmodule.test.ts`. Follow the pattern in any existing test file (mock ky, use InMemoryTransport, assert on response content and API calls).

2. **Implement the tool** using `server.registerTool()`:

```typescript
server.registerTool('my_tool', {
  description: 'What this tool does. Lead with a verb.',
  inputSchema: {
    project: z.string().optional().describe('Project key. Defaults to BITBUCKET_DEFAULT_PROJECT.'),
    repository: z.string().describe('Repository slug.'),
    // ... other params with Zod schemas
  },
  annotations: { readOnlyHint: true },  // or destructiveHint, openWorldHint, etc.
}, async ({ project, repository }) => {
  try {
    const resolvedProject = resolveProject(project, defaultProject);
    const data = await clients.api.get(`projects/${resolvedProject}/repos/${repository}/...`).json();
    return formatResponse(data);
  } catch (error) {
    return handleToolError(error);
  }
});
```

3. **Register it** by importing and calling your registration function in `src/server.ts`.

4. **Verify**: `npm test`, `npm run lint`, `npm run build`.

## HTTP clients

The server uses [ky](https://github.com/sindresorhus/ky) with pre-configured instances for each Bitbucket API base URL:

- `clients.api`: `/rest/api/1.0` (main API)
- `clients.insights`: `/rest/insights/latest` (Code Insights)
- `clients.search`: `/rest/search/latest` (search)
- `clients.branchUtils`: `/rest/branch-utils/1.0` (branch operations)
- `clients.defaultReviewers`: `/rest/default-reviewers/1.0` (default reviewer queries)

All instances share auth headers, custom headers, timeout (30s), and retry config (2 retries for GET on 408/429/5xx).

## Caching

The `ApiCache` instance (from `src/utils/cache.ts`) is passed to every tool registration function. It wraps an LRU cache with TTL (configurable via `BITBUCKET_CACHE_TTL`, default 5 minutes).

Use it for data that changes infrequently (repo metadata, project lists, default reviewers):

```typescript
const cacheKey = `repos:${project}:${repository}`;
let repoId = cache.get<number>(cacheKey);
if (repoId === undefined) {
  const data = await clients.api.get(`projects/${project}/repos/${repository}`).json();
  repoId = data.id;
  cache.set(cacheKey, repoId);
}
```

When a write operation changes state (e.g., creating a PR, merging), invalidate related entries:

```typescript
cache.invalidateByPrefix(`repos:${project}`);
```

Do not cache volatile data like PR details, comments, or activities.

## Error handling

Tools should never throw. Wrap the handler body in try/catch and return `handleToolError(error)` from `src/utils/errors.ts`. This returns `isError: true` with a recovery-oriented message that helps the LLM retry or adjust.

## Response formatting

Use `formatResponse(data)` for simple JSON responses, or `formatCompactResponse(summary, details)` for audience-annotated responses (compact summary for the user, full details for the assistant).

## Testing

Tests use vitest with mocked ky instances. The mock pattern:

```typescript
(mockClients.api.get as ReturnType<typeof vi.fn>).mockReturnValue({
  json: () => Promise.resolve({ /* mock data */ }),
});
```

Run all tests: `npm test`
Run a specific file: `npx vitest run src/__tests__/tools/yourfile.test.ts`
