import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseConfig } from "./config.js";
import { createApiClients } from "./http/client.js";
import { ApiCache } from "./http/cache.js";
import { registerRepositoryTools } from "./tools/repositories.js";
import { registerBranchTools } from "./tools/branches.js";
import { registerPullRequestTools } from "./tools/pull-requests.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerReviewTools } from "./tools/reviews.js";
import { registerSearchTools } from "./tools/search.js";
import { registerInsightTools } from "./tools/insights.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import { initLogging } from "./logging.js";
import type { BitbucketServerOptions } from "./types.js";
import type { ToolContext } from "./tools/shared.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const SERVER_INSTRUCTIONS = `This server provides tools for Bitbucket Server (on-premise).
Most tools require 'project' and 'repository' params. If not provided, 'project' defaults to BITBUCKET_DEFAULT_PROJECT.

Workflow tips:
- Use list_projects and list_repositories to discover available targets.
- For code review: create draft comments with manage_comment (state: PENDING), then publish all at once with submit_review (action: publish).
- For cross-repo PRs from forks: use sourceProject/sourceRepository in create_pull_request.
- get_pr_activity returns reviews, comments, and events; use the filter param to narrow results.
- manage_comment consolidates create/edit/delete of comments. Use severity: BLOCKER to create tasks. Use state: RESOLVED/OPEN to resolve/reopen.
- submit_review consolidates approve/unapprove/publish actions.
- When reviewing PRs: use get_diff with stat=true first to see which files changed, then get the full diff or read files locally for context.
- get_build_status accepts either a commitId or a prId (resolves the latest commit automatically). Use it to check CI status before approving.
- upload_attachment uploads a local file and returns a markdown reference to embed in PR comments (images: ![name](ref), files: [name](ref)).

Response curation:
Read tools return curated (compact) responses by default. Use the 'fields' parameter to customize:
- Omit 'fields': returns a curated summary with the most useful fields.
- fields="*all": returns the complete raw API response (useful when you need fields not in the default set).
- fields="id,title,state,author.user.name": returns exactly those fields. Use dot notation for nested paths.

Available fields in the Bitbucket API (common across entities):
- PR: id, version, title, description, state, open, closed, locked, createdDate, updatedDate, closedDate, fromRef.id, fromRef.displayId, fromRef.latestCommit, fromRef.repository.slug, fromRef.repository.project.key, toRef.id, toRef.displayId, toRef.latestCommit, toRef.repository.slug, toRef.repository.project.key, author.user.name, author.user.displayName, author.user.emailAddress, author.status, author.approved, reviewers[].user.name, reviewers[].user.displayName, reviewers[].status, reviewers[].approved, reviewers[].lastReviewedCommit, participants[].user.name, participants[].status, properties.commentCount, properties.openTaskCount, properties.resolvedTaskCount, properties.mergeResult.outcome, links.self[].href
- Project: key, id, name, description, type, public, links.self[].href
- Repository: slug, id, name, description, state, forkable, public, archived, project.key, project.name, origin.slug, origin.project.key, links.clone[].href, links.self[].href
- Branch: id, displayId, type, latestCommit, isDefault, metadata
- Commit: id, displayId, message, author.name, author.emailAddress, authorTimestamp, committerTimestamp, parents[].id`;

export function createServer(options?: BitbucketServerOptions) {
  const config = parseConfig(options);
  const clients = createApiClients(config);
  const cache = new ApiCache({ defaultTtlMs: config.cacheTtlMs });

  const server = new McpServer(
    {
      name: "bitbucket-server-mcp",
      version,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  initLogging(server);

  const filteredServer = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (...args: [string, ...unknown[]]) => {
          const [name, toolConfig] = args;
          if (config.enabledTools && !config.enabledTools.includes(name)) {
            return;
          }
          const annotations = (toolConfig as Record<string, unknown>)
            ?.annotations as { readOnlyHint?: boolean } | undefined;
          if (config.readOnly && annotations?.readOnlyHint === false) {
            return;
          }
          const method = Reflect.get(target, prop, receiver) as (
            ...a: unknown[]
          ) => unknown;
          return method.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const ctx: ToolContext = {
    server: filteredServer,
    clients,
    cache,
    defaultProject: config.defaultProject,
    maxLinesPerFile: config.maxLinesPerFile,
  };

  registerRepositoryTools(ctx);
  registerBranchTools(ctx);
  registerPullRequestTools(ctx);
  registerCommentTools(ctx);
  registerReviewTools(ctx);
  registerSearchTools(ctx);
  registerInsightTools(ctx);

  registerResources(server, clients, cache);
  registerPrompts(server);

  return { server, config };
}
