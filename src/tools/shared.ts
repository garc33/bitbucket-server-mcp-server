import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClients } from "../http/client.js";
import type { ApiCache } from "../http/cache.js";

export interface ToolContextParams {
  server: McpServer;
  clients: ApiClients;
  cache: ApiCache;
  defaultProject?: string;
  maxLinesPerFile?: number;
}

export class ToolContext {
  readonly server: McpServer;
  readonly clients: ApiClients;
  readonly cache: ApiCache;
  readonly defaultProject?: string;
  readonly maxLinesPerFile: number;

  constructor(params: ToolContextParams) {
    this.server = params.server;
    this.clients = params.clients;
    this.cache = params.cache;
    this.defaultProject = params.defaultProject;
    this.maxLinesPerFile = params.maxLinesPerFile ?? 500;
  }

  resolveProject(provided?: string): string {
    const project = provided || this.defaultProject;
    if (!project) {
      throw new Error(
        "Project is required. Provide it as a parameter or set BITBUCKET_DEFAULT_PROJECT.",
      );
    }
    return project;
  }
}

export interface ReviewerEntry {
  user: { name: string };
}

interface DefaultReviewerParams {
  clients: ApiClients;
  resolvedProject: string;
  repository: string;
  srcProject: string;
  srcRepo: string;
  sourceBranch: string;
  targetBranch: string;
  existingReviewers: ReviewerEntry[];
}

export async function mergeDefaultReviewers(
  params: DefaultReviewerParams,
): Promise<ReviewerEntry[]> {
  const {
    clients,
    resolvedProject,
    repository,
    srcProject,
    srcRepo,
    sourceBranch,
    targetBranch,
    existingReviewers,
  } = params;
  const allReviewers = [...existingReviewers];

  try {
    const [sourceRepoData, targetRepoData] = await Promise.all([
      clients.api
        .get(`projects/${srcProject}/repos/${srcRepo}`)
        .json<{ id: number }>(),
      srcProject === resolvedProject && srcRepo === repository
        ? Promise.resolve(null)
        : clients.api
            .get(`projects/${resolvedProject}/repos/${repository}`)
            .json<{ id: number }>(),
    ]);

    const sourceRepoId = sourceRepoData.id;
    const targetRepoId = targetRepoData ? targetRepoData.id : sourceRepoData.id;

    const defaultReviewersList = await clients.defaultReviewers
      .get(`projects/${resolvedProject}/repos/${repository}/reviewers`, {
        searchParams: {
          sourceRepoId,
          targetRepoId,
          sourceRefId: `refs/heads/${sourceBranch}`,
          targetRefId: `refs/heads/${targetBranch}`,
        },
      })
      .json<Array<{ name: string }>>();

    if (Array.isArray(defaultReviewersList)) {
      const existingNames = new Set(allReviewers.map((r) => r.user.name));
      for (const reviewer of defaultReviewersList) {
        if (!existingNames.has(reviewer.name)) {
          allReviewers.push({ user: { name: reviewer.name } });
          existingNames.add(reviewer.name);
        }
      }
    }
  } catch {
    // Proceed without default reviewers on error
  }

  return allReviewers;
}
