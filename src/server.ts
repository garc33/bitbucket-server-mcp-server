import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import winston from "winston";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";

// Configuration du logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "bitbucket.log" })],
});

interface BitbucketActivity {
  action: string;
  [key: string]: unknown;
}

interface BitbucketConfig {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  defaultProject?: string;
  maxLinesPerFile?: number;
  readOnly?: boolean;
}

interface RepositoryParams {
  project?: string;
  repository?: string;
}

interface PullRequestParams extends RepositoryParams {
  prId?: number;
}

interface PullRequestDiffParams extends PullRequestParams {
  contextLines?: number;
  maxLinesPerFile?: number;
}

interface DeclinePullRequestParams extends PullRequestParams {
  message?: string;
}

interface MergePullRequestParams extends PullRequestParams {
  message?: string;
  strategy?: "merge-commit" | "squash" | "fast-forward";
}

interface AddCommentOptions extends PullRequestParams {
  text: string;
  parentId?: number;
}

interface PullRequestInput extends RepositoryParams {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  reviewers?: string[];
}

interface ListOptions {
  limit?: number;
  start?: number;
}

interface ListRepositoriesOptions extends ListOptions {
  project?: string;
}

interface SearchOptions extends ListOptions {
  project?: string;
  repository?: string;
  query: string;
  type?: "code" | "file";
}

interface FileContentOptions extends ListOptions {
  project?: string;
  repository?: string;
  filePath: string;
  branch?: string;
}

class BitbucketServer {
  private readonly server: McpServer;
  private readonly api: AxiosInstance;
  private readonly config: BitbucketConfig;

  constructor() {
    this.server = new McpServer({
      name: "bitbucket-server-mcp-server",
      version: "1.0.0",
    });

    // Configuration initiale à partir des variables d'environnement
    this.config = {
      baseUrl: process.env.BITBUCKET_URL ?? "",
      token: process.env.BITBUCKET_TOKEN,
      username: process.env.BITBUCKET_USERNAME,
      password: process.env.BITBUCKET_PASSWORD,
      defaultProject: process.env.BITBUCKET_DEFAULT_PROJECT,
      maxLinesPerFile: process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE
        ? parseInt(process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE, 10)
        : undefined,
      readOnly: process.env.BITBUCKET_READ_ONLY === "true",
    };

    if (!this.config.baseUrl) {
      throw new Error("BITBUCKET_URL is required");
    }

    if (!this.config.token && !(this.config.username && this.config.password)) {
      throw new Error(
        "Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required",
      );
    }

    // Configuration de l'instance Axios
    this.api = axios.create({
      baseURL: `${this.config.baseUrl}/rest/api/1.0`,
      headers: this.config.token
        ? { Authorization: `Bearer ${this.config.token}` }
        : {},
      auth:
        this.config.username && this.config.password
          ? { username: this.config.username, password: this.config.password }
          : undefined,
    });

    this.setupToolHandlers();
  }

  private getProject(providedProject?: string): string {
    const project = providedProject || this.config.defaultProject;
    if (!project) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project must be provided either as a parameter or through BITBUCKET_DEFAULT_PROJECT environment variable",
      );
    }
    return project;
  }

  private setupToolHandlers() {
    const readOnlyTools = [
      "list_projects",
      "list_repositories",
      "get_pull_request",
      "get_diff",
      "get_reviews",
      "get_activities",
      "get_comments",
      "search",
      "get_file_content",
      "browse_repository",
    ];

    const tools: { name: string; config: any; handler: any }[] = [
      {
        name: "list_projects",
        config: {
          title: "List Bitbucket Projects",
          description:
            "Discover and list all Bitbucket projects you have access to. Use this first to explore available projects, find project keys, or when you need to work with a specific project but don't know its exact key. Returns project keys, names, descriptions and visibility settings.",
          inputSchema: z.object({
            limit: z
              .number()
              .optional()
              .describe(
                "Number of projects to return (default: 25, max: 1000)",
              ),
            start: z
              .number()
              .optional()
              .describe("Start index for pagination (default: 0)"),
          }).shape,
        },
        handler: this.listProjects,
      },
      {
        name: "list_repositories",
        config: {
          title: "List Bitbucket Repositories",
          description:
            "Browse and discover repositories within a specific project or across all accessible projects. Use this to find repository slugs, explore codebases, or understand the repository structure. Returns repository names, slugs, clone URLs, and project associations.",
          inputSchema: z.object({
            project: z
              .string()
              .optional()
              .describe(
                "Bitbucket project key to list repositories from. If omitted, uses BITBUCKET_DEFAULT_PROJECT or lists all accessible repositories across projects.",
              ),
            limit: z
              .number()
              .optional()
              .describe(
                "Number of repositories to return (default: 25, max: 1000)",
              ),
            start: z
              .number()
              .optional()
              .describe("Start index for pagination (default: 0)"),
          }).shape,
        },
        handler: this.listRepositories,
      },
      {
        name: "create_pull_request",
        config: {
          title: "Create Pull Request",
          description:
            "Create a new pull request to propose code changes, request reviews, or merge feature branches. Use this when you want to submit code for review, merge a feature branch, or contribute changes to a repository. Automatically sets up branch references and can assign reviewers.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable. Use list_projects to discover available projects.",
                ),
              repository: z
                .string()
                .describe(
                  "Repository slug where the pull request will be created. Use list_repositories to find available repositories.",
                ),
              title: z
                .string()
                .describe(
                  "Clear, descriptive title for the pull request that summarizes the changes.",
                ),
              description: z
                .string()
                .optional()
                .describe(
                  "Detailed description of changes, context, and any relevant information for reviewers. Supports Markdown formatting.",
                ),
              sourceBranch: z
                .string()
                .describe(
                  'Source branch name containing the changes to be merged (e.g., "feature/new-login", "bugfix/security-patch").',
                ),
              targetBranch: z
                .string()
                .describe(
                  'Target branch where changes will be merged (e.g., "main", "develop", "release/v1.2").',
                ),
              reviewers: z
                .array(z.string())
                .optional()
                .describe(
                  "Array of Bitbucket usernames to assign as reviewers for this pull request.",
                ),
            })
            .required({
              repository: true,
              title: true,
              sourceBranch: true,
              targetBranch: true,
            }).shape,
        },
        handler: this.createPullRequest,
      },
      {
        name: "get_pull_request",
        config: {
          title: "Get Pull Request Details",
          description:
            "Retrieve comprehensive details about a specific pull request including status, reviewers, commits, and metadata. Use this to check PR status, review progress, understand changes, or gather information before performing actions like merging or commenting.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z
                .number()
                .describe("Unique pull request ID number (e.g., 123, 456)."),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.getPullRequest,
      },
      {
        name: "merge_pull_request",
        config: {
          title: "Merge Pull Request",
          description:
            "Merge an approved pull request into the target branch. Use this when a PR has been reviewed, approved, and is ready to be integrated. Choose the appropriate merge strategy based on your team's workflow and repository history preferences.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z.number().describe("Pull request ID to merge."),
              message: z
                .string()
                .optional()
                .describe(
                  "Custom merge commit message. If not provided, uses default merge message format.",
                ),
              strategy: z
                .enum(["merge-commit", "squash", "fast-forward"])
                .optional()
                .describe(
                  'Merge strategy: "merge-commit" creates a merge commit preserving branch history, "squash" combines all commits into one, "fast-forward" moves the branch pointer without creating a merge commit.',
                ),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.mergePullRequest,
      },
      {
        name: "decline_pull_request",
        config: {
          title: "Decline Pull Request",
          description:
            "Decline or reject a pull request that should not be merged. Use this when changes are not acceptable, conflicts with project direction, or when the PR needs significant rework. This closes the PR without merging.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z.number().describe("Pull request ID to decline."),
              message: z
                .string()
                .optional()
                .describe(
                  "Reason for declining the pull request. Helps the author understand why it was rejected.",
                ),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.declinePullRequest,
      },
      {
        name: "add_comment",
        config: {
          title: "Add Comment to Pull Request",
          description:
            "Add a comment to a pull request for code review, feedback, questions, or discussion. Use this to provide review feedback, ask questions about specific changes, suggest improvements, or participate in code review discussions. Supports threaded conversations.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z.number().describe("Pull request ID to comment on."),
              text: z
                .string()
                .describe(
                  "Comment text content. Supports Markdown formatting for code blocks, links, and emphasis.",
                ),
              parentId: z
                .number()
                .optional()
                .describe(
                  "ID of parent comment to reply to. Omit for top-level comments.",
                ),
            })
            .required({
              repository: true,
              prId: true,
              text: true,
            }).shape,
        },
        handler: this.addComment,
      },
      {
        name: "get_diff",
        config: {
          title: "Get Pull Request Diff",
          description:
            "Retrieve the code differences (diff) for a pull request showing what lines were added, removed, or modified. Use this to understand the scope of changes, review specific code modifications, or analyze the impact of proposed changes before merging.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z.number().describe("Pull request ID to get diff for."),
              contextLines: z
                .number()
                .optional()
                .default(10)
                .describe(
                  "Number of context lines to show around changes (default: 10). Higher values provide more surrounding code context.",
                ),
              maxLinesPerFile: z
                .number()
                .optional()
                .describe(
                  "Maximum number of lines to show per file (default: uses BITBUCKET_DIFF_MAX_LINES_PER_FILE env var). Set to 0 for no limit. Prevents large files from overwhelming the diff output.",
                ),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.getDiff,
      },
      {
        name: "get_reviews",
        config: {
          title: "Get Pull Request Reviews",
          description:
            "Fetch the review history and approval status of a pull request. Use this to check who has reviewed the PR, see approval status, understand review feedback, or determine if the PR is ready for merging based on review requirements.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z.number().describe("Pull request ID to get reviews for."),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.getReviews,
      },
      {
        name: "get_activities",
        config: {
          title: "Get Pull Request Activities",
          description:
            "Retrieve all activities for a pull request including comments, reviews, commits, and other timeline events. Use this to get the complete activity history and timeline of the pull request.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z
                .number()
                .describe("Pull request ID to get activities for."),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.getActivities,
      },
      {
        name: "get_comments",
        config: {
          title: "Get Pull Request Comments",
          description:
            "Retrieve only the comments from a pull request. Use this when you specifically want to read the discussion and feedback comments without other activities like reviews or commits.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the pull request."),
              prId: z.number().describe("Pull request ID to get comments for."),
            })
            .required({
              repository: true,
              prId: true,
            }).shape,
        },
        handler: this.getComments,
      },
      {
        name: "search",
        config: {
          title: "Search Code or Files",
          description:
            "Search for code or files across repositories. Use this to find specific code patterns, file names, or content within projects and repositories. Searches both file contents and filenames. Supports filtering by project, repository, and query optimization.",
          inputSchema: z
            .object({
              query: z
                .string()
                .describe(
                  "Search query string to look for in code or file names.",
                ),
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key to limit search scope. If omitted, searches across accessible projects.",
                ),
              repository: z
                .string()
                .optional()
                .describe(
                  "Repository slug to limit search to a specific repository within the project.",
                ),
              type: z
                .enum(["code", "file"])
                .optional()
                .describe(
                  'Query optimization: "file" wraps query in quotes for exact filename matching, "code" uses default search behavior. Both search file contents and filenames.',
                ),
              limit: z
                .number()
                .optional()
                .describe(
                  "Number of results to return (default: 25, max: 100)",
                ),
              start: z
                .number()
                .optional()
                .describe("Start index for pagination (default: 0)"),
            })
            .required({
              query: true,
            }).shape,
        },
        handler: this.search,
      },
      {
        name: "get_file_content",
        config: {
          title: "Get File Content",
          description:
            "Retrieve the content of a specific file from a Bitbucket repository with pagination support. Use this to read source code, configuration files, documentation, or any text-based files. For large files, use start parameter to paginate through content.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z
                .string()
                .describe("Repository slug containing the file."),
              filePath: z
                .string()
                .describe(
                  'Path to the file in the repository (e.g., "src/main.py", "README.md", "config/settings.json").',
                ),
              branch: z
                .string()
                .optional()
                .describe(
                  "Branch or commit hash to read from (defaults to main/master branch if not specified).",
                ),
              limit: z
                .number()
                .optional()
                .describe(
                  "Maximum number of lines to return per request (default: 100, max: 1000).",
                ),
              start: z
                .number()
                .optional()
                .describe(
                  "Starting line number for pagination (0-based, default: 0).",
                ),
            })
            .required({
              repository: true,
              filePath: true,
            }).shape,
        },
        handler: this.getFileContent,
      },
      {
        name: "browse_repository",
        config: {
          title: "Browse Repository",
          description:
            "Browse and list files and directories in a Bitbucket repository. Use this to explore repository structure, find files, or navigate directories.",
          inputSchema: z
            .object({
              project: z
                .string()
                .optional()
                .describe(
                  "Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.",
                ),
              repository: z.string().describe("Repository slug to browse."),
              path: z
                .string()
                .optional()
                .describe(
                  'Directory path to browse (empty or "/" for root directory).',
                ),
              branch: z
                .string()
                .optional()
                .describe(
                  "Branch or commit hash to browse (defaults to main/master branch if not specified).",
                ),
              limit: z
                .number()
                .optional()
                .describe("Maximum number of items to return (default: 50)."),
            })
            .required({
              repository: true,
            }).shape,
        },
        handler: this.browseRepository,
      },
    ].filter(
      (tool) => !this.config.readOnly || readOnlyTools.includes(tool.name),
    );
    tools.forEach((tool) => {
      this.server.registerTool(tool.name, tool.config, tool.handler.bind(this));
    });
  }

  async listProjects(options: ListOptions = {}) {
    const { limit = 25, start = 0 } = options;
    const response = await this.api.get("/projects", {
      params: { limit, start },
    });

    const projects = response.data.values || [];
    const summary = {
      total: response.data.size || projects.length,
      showing: projects.length,
      projects: projects.map(
        (project: {
          key: string;
          name: string;
          description?: string;
          public: boolean;
          type: string;
        }) => ({
          key: project.key,
          name: project.name,
          description: project.description,
          public: project.public,
          type: project.type,
        }),
      ),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  async listRepositories(options: ListRepositoriesOptions = {}) {
    const { project, limit = 25, start = 0 } = options;

    let endpoint: string;
    const params = { limit, start };

    if (project || this.config.defaultProject) {
      // List repositories for a specific project
      const projectKey = project || this.config.defaultProject;
      endpoint = `/projects/${projectKey}/repos`;
    } else {
      // List all accessible repositories
      endpoint = "/repos";
    }

    const response = await this.api.get(endpoint, { params });

    const repositories = response.data.values || [];
    const summary = {
      project: project || this.config.defaultProject || "all",
      total: response.data.size || repositories.length,
      showing: repositories.length,
      repositories: repositories.map(
        (repo: {
          slug: string;
          name: string;
          description?: string;
          project?: { key: string };
          public: boolean;
          links?: { clone?: { name: string; href: string }[] };
          state: string;
        }) => ({
          slug: repo.slug,
          name: repo.name,
          description: repo.description,
          project: repo.project?.key,
          public: repo.public,
          cloneUrl: repo.links?.clone?.find(
            (link: { name: string; href: string }) => link.name === "http",
          )?.href,
          state: repo.state,
        }),
      ),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  async createPullRequest(input: PullRequestInput) {
    input.project = this.getProject(input.project);
    const response = await this.api.post(
      `/projects/${input.project}/repos/${input.repository}/pull-requests`,
      {
        title: input.title,
        description: input.description,
        fromRef: {
          id: `refs/heads/${input.sourceBranch}`,
          repository: {
            slug: input.repository,
            project: { key: input.project },
          },
        },
        toRef: {
          id: `refs/heads/${input.targetBranch}`,
          repository: {
            slug: input.repository,
            project: { key: input.project },
          },
        },
        reviewers: input.reviewers?.map((username) => ({
          user: { name: username },
        })),
      },
    );

    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    };
  }

  async getPullRequest(params: PullRequestParams) {
    params.project = this.getProject(params.project);
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}`,
    );

    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    };
  }

  async mergePullRequest(params: MergePullRequestParams) {
    params.project = this.getProject(params.project);
    const {
      project,
      repository,
      prId,
      message,
      strategy = "merge-commit",
    } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/merge`,
      {
        version: -1,
        message,
        strategy,
      },
    );

    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    };
  }

  async declinePullRequest(params: DeclinePullRequestParams) {
    params.project = this.getProject(params.project);
    const { project, repository, prId, message } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/decline`,
      {
        version: -1,
        message,
      },
    );

    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    };
  }

  async addComment(params: AddCommentOptions) {
    params.project = this.getProject(params.project);
    const { project, repository, prId, text, parentId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/comments`,
      {
        text,
        parent: parentId ? { id: parentId } : undefined,
      },
    );

    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    };
  }

  private truncateDiff(diffContent: string, maxLinesPerFile: number): string {
    if (!maxLinesPerFile || maxLinesPerFile <= 0) {
      return diffContent;
    }

    const lines = diffContent.split("\n");
    const result: string[] = [];
    let currentFileLines: string[] = [];
    let currentFileName = "";
    let inFileContent = false;

    for (const line of lines) {
      // Detect file headers (diff --git, index, +++, ---)
      if (line.startsWith("diff --git ")) {
        // Process previous file if any
        if (currentFileLines.length > 0) {
          result.push(
            ...this.truncateFileSection(
              currentFileLines,
              currentFileName,
              maxLinesPerFile,
            ),
          );
          currentFileLines = [];
        }

        // Extract filename for context
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        currentFileName = match ? match[2] : "unknown";
        inFileContent = false;

        // Always include file headers
        result.push(line);
      } else if (
        line.startsWith("index ") ||
        line.startsWith("+++") ||
        line.startsWith("---")
      ) {
        // Always include file metadata
        result.push(line);
      } else if (line.startsWith("@@")) {
        // Hunk header - marks start of actual file content
        inFileContent = true;
        currentFileLines.push(line);
      } else if (inFileContent) {
        // Collect file content lines for potential truncation
        currentFileLines.push(line);
      } else {
        // Other lines (empty lines between files, etc.)
        result.push(line);
      }
    }

    // Process the last file
    if (currentFileLines.length > 0) {
      result.push(
        ...this.truncateFileSection(
          currentFileLines,
          currentFileName,
          maxLinesPerFile,
        ),
      );
    }

    return result.join("\n");
  }

  private truncateFileSection(
    fileLines: string[],
    fileName: string,
    maxLines: number,
  ): string[] {
    if (fileLines.length <= maxLines) {
      return fileLines;
    }

    // Count actual content lines (excluding hunk headers)
    const contentLines = fileLines.filter((line) => !line.startsWith("@@"));
    const hunkHeaders = fileLines.filter((line) => line.startsWith("@@"));

    if (contentLines.length <= maxLines) {
      return fileLines; // No need to truncate if content is within limit
    }

    // Smart truncation: show beginning and end
    const showAtStart = Math.floor(maxLines * 0.6); // 60% at start
    const showAtEnd = Math.floor(maxLines * 0.4); // 40% at end
    const truncatedCount = contentLines.length - showAtStart - showAtEnd;

    const result: string[] = [];

    // Add hunk headers first
    result.push(...hunkHeaders);

    // Add first portion
    result.push(...contentLines.slice(0, showAtStart));

    // Add truncation message
    result.push("");
    result.push(
      `[*** FILE TRUNCATED: ${truncatedCount} lines hidden from ${fileName} ***]`,
    );
    result.push(
      `[*** File had ${contentLines.length} total lines, showing first ${showAtStart} and last ${showAtEnd} ***]`,
    );
    result.push(`[*** Use maxLinesPerFile=0 to see complete diff ***]`);
    result.push("");

    // Add last portion
    result.push(...contentLines.slice(-showAtEnd));

    return result;
  }

  async getDiff(params: PullRequestDiffParams) {
    params.project = this.getProject(params.project);
    const { project, repository, prId, contextLines, maxLinesPerFile } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/diff`,
      {
        params: { contextLines },
        headers: { Accept: "text/plain" },
      },
    );

    // Determine max lines per file: parameter > env var > no limit
    const effectiveMaxLines =
      maxLinesPerFile !== undefined
        ? maxLinesPerFile
        : this.config.maxLinesPerFile;

    const diffContent = effectiveMaxLines
      ? this.truncateDiff(response.data, effectiveMaxLines)
      : response.data;

    return {
      content: [{ type: "text", text: diffContent }],
    };
  }

  async getReviews(params: PullRequestParams) {
    params.project = this.getProject(params.project);
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`,
    );

    const reviews = response.data.values.filter(
      (activity: BitbucketActivity) =>
        activity.action === "APPROVED" || activity.action === "REVIEWED",
    );

    return {
      content: [{ type: "text", text: JSON.stringify(reviews, null, 2) }],
    };
  }

  async getActivities(params: PullRequestParams) {
    params.project = this.getProject(params.project);
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`,
    );

    return {
      content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
    };
  }

  async getComments(params: PullRequestParams) {
    params.project = this.getProject(params.project);
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and prId are required",
      );
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`,
    );

    const comments = response.data.values.filter(
      (activity: BitbucketActivity) => activity.action === "COMMENTED",
    );

    return {
      content: [{ type: "text", text: JSON.stringify(comments, null, 2) }],
    };
  }

  async search(options: SearchOptions) {
    options.project = this.getProject(options.project);
    const { query, project, repository, type, limit = 25, start = 0 } = options;

    if (!query) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Query parameter is required",
      );
    }

    // Build the search query with filters
    let searchQuery = query;

    // Add project filter if specified
    if (project) {
      searchQuery = `${searchQuery} project:${project}`;
    }

    // Add repository filter if specified (requires project)
    if (repository && project) {
      searchQuery = `${searchQuery} repo:${project}/${repository}`;
    }

    // Add file extension filter if type is specified
    if (type === "file") {
      // For file searches, wrap query in quotes for exact filename matching
      if (!query.includes("ext:") && !query.startsWith('"')) {
        searchQuery = `"${query}"`;
        if (project) searchQuery += ` project:${project}`;
        if (repository && project)
          searchQuery += ` repo:${project}/${repository}`;
      }
    } else if (type === "code" && !query.includes("ext:")) {
      // For code searches, add common extension filters if not specified
      // This can be enhanced based on user needs
    }

    const requestBody = {
      query: searchQuery,
      entities: {
        code: {
          start,
          limit: Math.min(limit, 100),
        },
      },
    };

    try {
      // Use full URL for search API since it uses different base path
      const searchUrl = `${this.config.baseUrl}/rest/search/latest/search`;
      const response = await axios.post(searchUrl, requestBody, {
        headers: this.config.token
          ? {
              Authorization: `Bearer ${this.config.token}`,
              "Content-Type": "application/json",
            }
          : { "Content-Type": "application/json" },
        auth:
          this.config.username && this.config.password
            ? { username: this.config.username, password: this.config.password }
            : undefined,
      });

      const codeResults = response.data.code || {};
      const searchResults = {
        query: searchQuery,
        originalQuery: query,
        project: project || "global",
        repository: repository || "all",
        type: type || "code",
        scope: response.data.scope || {},
        total: codeResults.count || 0,
        showing: codeResults.values?.length || 0,
        isLastPage: codeResults.isLastPage || true,
        nextStart: codeResults.nextStart || null,
        results:
          codeResults.values?.map((result: any) => ({
            repository: result.repository,
            file: result.file,
            hitCount: result.hitCount || 0,
            pathMatches: result.pathMatches || [],
            hitContexts: result.hitContexts || [],
          })) || [],
      };

      return {
        content: [
          { type: "text", text: JSON.stringify(searchResults, null, 2) },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new McpError(
            ErrorCode.InternalError,
            "Search API endpoint not available on this Bitbucket instance",
          );
        }
        // Handle specific search API errors
        const errorData = error.response?.data;
        if (errorData?.errors && errorData.errors.length > 0) {
          const firstError = errorData.errors[0];
          throw new McpError(
            ErrorCode.InvalidParams,
            `Search error: ${firstError.message || "Invalid search query"}`,
          );
        }
      }
      throw error;
    }
  }

  async getFileContent(options: FileContentOptions) {
    options.project = this.getProject(options.project);
    const {
      project,
      repository,
      filePath,
      branch,
      limit = 100,
      start = 0,
    } = options;

    if (!project || !repository || !filePath) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project, repository, and filePath are required",
      );
    }

    const params: Record<string, string | number> = {
      limit: Math.min(limit, 1000),
      start,
    };

    if (branch) {
      params.at = branch;
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/browse/${filePath}`,
      { params },
    );

    const fileContent = {
      project,
      repository,
      filePath,
      branch: branch || "default",
      isLastPage: response.data.isLastPage,
      size: response.data.size,
      showing: response.data.lines?.length || 0,
      startLine: start,
      lines:
        response.data.lines?.map((line: { text: string }) => line.text) || [],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(fileContent, null, 2) }],
    };
  }

  async browseRepository(options: {
    project: string;
    repository: string;
    path?: string;
    branch?: string;
    limit?: number;
  }) {
    options.project = this.getProject(options.project);
    const { project, repository, path = "", branch, limit = 50 } = options;

    if (!project || !repository) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project and repository are required",
      );
    }

    const params: Record<string, string | number> = {
      limit,
    };

    if (branch) {
      params.at = branch;
    }

    const browsePath = path ? `/${path}` : "";
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/browse${browsePath}`,
      { params },
    );

    const children = response.data.children || {};
    const browseResults = {
      project,
      repository,
      path: path || "root",
      branch: branch || response.data.revision || "default",
      isLastPage: children.isLastPage || false,
      size: children.size || 0,
      showing: children.values?.length || 0,
      items:
        children.values?.map(
          (item: {
            path: { name: string; toString: string };
            type: string;
            size?: number;
          }) => ({
            name: item.path.name,
            path: item.path.toString,
            type: item.type,
            size: item.size,
          }),
        ) || [],
    };

    return {
      content: [{ type: "text", text: JSON.stringify(browseResults, null, 2) }],
    };
  }

  async run(mode: "stdio" | "http" = "stdio") {
    if (mode === "stdio") {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info("Bitbucket MCP server running on stdio");
    } else if (mode === "http") {
      const app = express();
      app.use(cors());
      app.use(express.json());

      const mcpEndpoint = "/mcp";
      logger.debug(`MCP endpoint: ${mcpEndpoint}`);

      // Create transport instance
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      // Connect server to transport
      await this.server.connect(transport);

      // Handle all MCP requests
      app.all(mcpEndpoint, (req: Request, res: Response) => {
        transport.handleRequest(req, res, req.body).catch((err: unknown) => {
          logger.error("Error in transport.handleRequest", err);
          if (!res.headersSent) {
            res.status(500).json({
              error: "Internal Server Error",
            });
          }
        });
      });

      // Health check endpoint
      app.get("/", (_req: Request, res: Response) => {
        res.send(`Bitbucket MCP Server is running`);
      });

      // Start HTTP server
      const PORT = Number(process.env.PORT ?? 3000);
      await new Promise<void>((resolve) => {
        app.listen(PORT, () => {
          logger.info(
            `HTTP transport listening on http://localhost:${PORT}${mcpEndpoint}`,
          );
          resolve();
        });
      });
    }
  }
}

export { BitbucketServer, logger };
