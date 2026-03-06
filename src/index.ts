#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import { parseCustomHeaders } from "./headers.js";
import winston from 'winston';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Resolve log file path: BITBUCKET_LOG_PATH env var > default (~/.bitbucket-server-mcp/bitbucket.log)
const defaultLogDir = path.join(os.homedir(), '.bitbucket-server-mcp');
const logFilePath = process.env.BITBUCKET_LOG_PATH || path.join(defaultLogDir, 'bitbucket.log');

// Ensure log directory exists
const logDir = path.dirname(logFilePath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: logFilePath })
  ]
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
  customHeaders?: Record<string, string>;
}

interface RepositoryParams {
  project?: string;
  repository?: string;
}

interface PullRequestParams extends RepositoryParams {
  prId?: number;
}

interface MergeOptions {
  message?: string;
  strategy?: 'merge-commit' | 'squash' | 'fast-forward';
}

interface CommentOptions {
  text: string;
  parentId?: number;
}

interface InlineCommentOptions extends CommentOptions {
  filePath: string;
  line: number;
  lineType: 'ADDED' | 'REMOVED';
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
  type?: 'code' | 'file';
}

interface FileContentOptions extends ListOptions {
  project?: string;
  repository?: string;
  filePath: string;
  branch?: string;
}

interface BranchListOptions extends ListOptions {
  project?: string;
  repository?: string;
  filterText?: string;
}

interface CommitListOptions extends ListOptions {
  project?: string;
  repository?: string;
  branch?: string;
  author?: string;
}

interface PullRequestListOptions extends ListOptions {
  project?: string;
  repository?: string;
  state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL';
  author?: string;
  direction?: 'INCOMING' | 'OUTGOING';
}

export interface BitbucketServerOptions {
  baseUrl?: string;
  token?: string;
  username?: string;
  password?: string;
  defaultProject?: string;
  maxLinesPerFile?: number;
  readOnly?: boolean;
  customHeaders?: Record<string, string>;
}

export class BitbucketServer {
  private readonly server: Server;
  private readonly api: AxiosInstance;
  private readonly config: BitbucketConfig;

  constructor(options?: BitbucketServerOptions) {
    this.server = new Server(
      {
        name: 'bitbucket-server-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Configuration initiale à partir des variables d'environnement
    this.config = {
      baseUrl: options?.baseUrl ?? process.env.BITBUCKET_URL ?? '',
      token: options?.token ?? process.env.BITBUCKET_TOKEN,
      username: options?.username ?? process.env.BITBUCKET_USERNAME,
      password: options?.password ?? process.env.BITBUCKET_PASSWORD,
      defaultProject: options?.defaultProject ?? process.env.BITBUCKET_DEFAULT_PROJECT,
      maxLinesPerFile: process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE 
        ? parseInt(process.env.BITBUCKET_DIFF_MAX_LINES_PER_FILE, 10) 
        : undefined,
      readOnly: options?.readOnly ?? process.env.BITBUCKET_READ_ONLY === 'true',
      customHeaders: options?.customHeaders ?? parseCustomHeaders(process.env.BITBUCKET_CUSTOM_HEADERS),
    };

    if (!this.config.baseUrl) {
      throw new Error('BITBUCKET_URL is required');
    }

    if (!this.config.token && !(this.config.username && this.config.password)) {
      throw new Error('Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required');
    }

    // Configuration de l'instance Axios
    this.api = axios.create({
      baseURL: `${this.config.baseUrl}/rest/api/1.0`,
      headers: {
        ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        ...this.config.customHeaders,
      },
      auth: this.config.username && this.config.password
        ? { username: this.config.username, password: this.config.password }
        : undefined,
    });

    this.setupToolHandlers();
    
    this.server.onerror = (error) => logger.error('[MCP Error]', error);
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  private isPullRequestInput(args: unknown): args is PullRequestInput {
    const input = args as Partial<PullRequestInput>;
    return typeof args === 'object' &&
      args !== null &&
      (input.project === undefined || typeof input.project === 'string') &&
      typeof input.repository === 'string' &&
      typeof input.title === 'string' &&
      typeof input.sourceBranch === 'string' &&
      typeof input.targetBranch === 'string' &&
      (input.description === undefined || typeof input.description === 'string') &&
      (input.reviewers === undefined || Array.isArray(input.reviewers));
  }

  private setupToolHandlers() {
    const readOnlyTools = ['list_projects', 'list_repositories', 'get_pull_request', 'list_pull_requests', 'get_diff', 'get_reviews', 'get_activities', 'get_comments', 'search', 'get_file_content', 'browse_repository', 'list_branches', 'list_commits'];
    
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_projects',
          description: 'Discover and list all Bitbucket projects you have access to. Use this first to explore available projects, find project keys, or when you need to work with a specific project but don\'t know its exact key. Returns project keys, names, descriptions and visibility settings.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Number of projects to return (default: 25, max: 1000)' },
              start: { type: 'number', description: 'Start index for pagination (default: 0)' }
            }
          }
        },
        {
          name: 'list_repositories',
          description: 'Browse and discover repositories within a specific project or across all accessible projects. Use this to find repository slugs, explore codebases, or understand the repository structure. Returns repository names, slugs, clone URLs, and project associations.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key to list repositories from. If omitted, uses BITBUCKET_DEFAULT_PROJECT or lists all accessible repositories across projects.' },
              limit: { type: 'number', description: 'Number of repositories to return (default: 25, max: 1000)' },
              start: { type: 'number', description: 'Start index for pagination (default: 0)' }
            }
          }
        },
        {
          name: 'create_pull_request',
          description: 'Create a new pull request to propose code changes, request reviews, or merge feature branches. Use this when you want to submit code for review, merge a feature branch, or contribute changes to a repository. Automatically sets up branch references and can assign reviewers.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable. Use list_projects to discover available projects.' },
              repository: { type: 'string', description: 'Repository slug where the pull request will be created. Use list_repositories to find available repositories.' },
              title: { type: 'string', description: 'Clear, descriptive title for the pull request that summarizes the changes.' },
              description: { type: 'string', description: 'Detailed description of changes, context, and any relevant information for reviewers. Supports Markdown formatting.' },
              sourceBranch: { type: 'string', description: 'Source branch name containing the changes to be merged (e.g., "feature/new-login", "bugfix/security-patch").' },
              targetBranch: { type: 'string', description: 'Target branch where changes will be merged (e.g., "main", "develop", "release/v1.2").' },
              reviewers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Bitbucket usernames to assign as reviewers for this pull request.'
              }
            },
            required: ['repository', 'title', 'sourceBranch', 'targetBranch']
          }
        },
        {
          name: 'get_pull_request',
          description: 'Retrieve comprehensive details about a specific pull request including status, reviewers, commits, and metadata. Use this to check PR status, review progress, understand changes, or gather information before performing actions like merging or commenting.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Unique pull request ID number (e.g., 123, 456).' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'merge_pull_request',
          description: 'Merge an approved pull request into the target branch. Use this when a PR has been reviewed, approved, and is ready to be integrated. Choose the appropriate merge strategy based on your team\'s workflow and repository history preferences.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to merge.' },
              message: { type: 'string', description: 'Custom merge commit message. If not provided, uses default merge message format.' },
              strategy: {
                type: 'string',
                enum: ['merge-commit', 'squash', 'fast-forward'],
                description: 'Merge strategy: "merge-commit" creates a merge commit preserving branch history, "squash" combines all commits into one, "fast-forward" moves the branch pointer without creating a merge commit.'
              }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'decline_pull_request',
          description: 'Decline or reject a pull request that should not be merged. Use this when changes are not acceptable, conflicts with project direction, or when the PR needs significant rework. This closes the PR without merging.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to decline.' },
              message: { type: 'string', description: 'Reason for declining the pull request. Helps the author understand why it was rejected.' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'add_comment',
          description: 'Add a comment to a pull request for code review, feedback, questions, or discussion. Use this to provide review feedback, ask questions about specific changes, suggest improvements, or participate in code review discussions. Supports threaded conversations.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to comment on.' },
              text: { type: 'string', description: 'Comment text content. Supports Markdown formatting for code blocks, links, and emphasis.' },
              parentId: { type: 'number', description: 'ID of parent comment to reply to. Omit for top-level comments.' }
            },
            required: ['repository', 'prId', 'text']
          }
        },
        {
          name: 'add_comment_inline',
          description: 'Add an inline comment (to specific lines) to the diff of a pull request for code review, feedback, questions, or discussion. Use this to provide review feedback, ask questions about specific changes, suggest improvements, or participate in code review discussions. Supports threaded conversations.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to comment on.' },
              text: { type: 'string', description: 'Comment text content. Supports Markdown formatting for code blocks, links, and emphasis.' },
              parentId: { type: 'number', description: 'ID of parent comment to reply to. Omit for top-level comments.' },
              filePath: { type: 'string', description: 'Path to the file in the repository where the comment should be added (e.g., "src/main.py", "README.md").' },
              line: { type: 'number', description: 'Line number in the file to attach the comment to (1-based).' },
              lineType: { type: 'string', enum: ['ADDED', 'REMOVED'], description: 'Type of change the comment is associated with: ADDED for additions, REMOVED for deletions.' }
            },
            required: ['repository', 'prId', 'text', 'filePath', 'line', 'lineType']
          }
        },
        {
          name: 'get_diff',
          description: 'Retrieve the code differences (diff) for a pull request showing what lines were added, removed, or modified. Use this to understand the scope of changes, review specific code modifications, or analyze the impact of proposed changes before merging.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to get diff for.' },
              contextLines: { type: 'number', description: 'Number of context lines to show around changes (default: 10). Higher values provide more surrounding code context.' },
              maxLinesPerFile: { type: 'number', description: 'Maximum number of lines to show per file (default: uses BITBUCKET_DIFF_MAX_LINES_PER_FILE env var). Set to 0 for no limit. Prevents large files from overwhelming the diff output.' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'get_reviews',
          description: 'Fetch the review history and approval status of a pull request. Use this to check who has reviewed the PR, see approval status, understand review feedback, or determine if the PR is ready for merging based on review requirements.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to get reviews for.' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'get_activities',
          description: 'Retrieve all activities for a pull request including comments, reviews, commits, and other timeline events. Use this to get the complete activity history and timeline of the pull request.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to get activities for.' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'get_comments',
          description: 'Retrieve only the comments from a pull request. Use this when you specifically want to read the discussion and feedback comments without other activities like reviews or commits.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to get comments for.' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'search',
          description: 'Search for code or files across repositories. Use this to find specific code patterns, file names, or content within projects and repositories. Searches both file contents and filenames. Supports filtering by project, repository, and query optimization.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string to look for in code or file names.' },
              project: { type: 'string', description: 'Bitbucket project key to limit search scope. If omitted, searches across accessible projects.' },
              repository: { type: 'string', description: 'Repository slug to limit search to a specific repository within the project.' },
              type: { 
                type: 'string', 
                enum: ['code', 'file'],
                description: 'Query optimization: "file" wraps query in quotes for exact filename matching, "code" uses default search behavior. Both search file contents and filenames.'
              },
              limit: { type: 'number', description: 'Number of results to return (default: 25, max: 100)' },
              start: { type: 'number', description: 'Start index for pagination (default: 0)' }
            },
            required: ['query']
          }
        },
        {
          name: 'get_file_content',
          description: 'Retrieve the content of a specific file from a Bitbucket repository with pagination support. Use this to read source code, configuration files, documentation, or any text-based files. For large files, use start parameter to paginate through content.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the file.' },
              filePath: { type: 'string', description: 'Path to the file in the repository (e.g., "src/main.py", "README.md", "config/settings.json").' },
              branch: { type: 'string', description: 'Branch or commit hash to read from (defaults to main/master branch if not specified).' },
              limit: { type: 'number', description: 'Maximum number of lines to return per request (default: 100, max: 1000).' },
              start: { type: 'number', description: 'Starting line number for pagination (0-based, default: 0).' }
            },
            required: ['repository', 'filePath']
          }
        },
        {
          name: 'browse_repository',
          description: 'Browse and list files and directories in a Bitbucket repository. Use this to explore repository structure, find files, or navigate directories.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug to browse.' },
              path: { type: 'string', description: 'Directory path to browse (empty or "/" for root directory).' },
              branch: { type: 'string', description: 'Branch or commit hash to browse (defaults to main/master branch if not specified).' },
              limit: { type: 'number', description: 'Maximum number of items to return (default: 50).' }
            },
            required: ['repository']
          }
        },
        {
          name: 'list_pull_requests',
          description: 'List pull requests in a Bitbucket repository filtered by state, author, or direction. Use this to find open PRs, see your pending reviews, discover PRs awaiting merge, or get an overview of PR activity in a repository.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug to list pull requests from.' },
              state: {
                type: 'string',
                enum: ['OPEN', 'MERGED', 'DECLINED', 'ALL'],
                description: 'Filter by PR state (default: "OPEN"). Use "ALL" to see pull requests in any state.'
              },
              author: { type: 'string', description: 'Filter by author username (exact match). Only returns PRs created by this user.' },
              direction: {
                type: 'string',
                enum: ['INCOMING', 'OUTGOING'],
                description: 'Filter by direction: "INCOMING" for PRs targeting this repo (default), "OUTGOING" for PRs from this repo to other repos.'
              },
              limit: { type: 'number', description: 'Number of pull requests to return (default: 25, max: 1000).' },
              start: { type: 'number', description: 'Start index for pagination (default: 0).' }
            },
            required: ['repository']
          }
        },
        {
          name: 'list_branches',
          description: 'List branches in a Bitbucket repository. Shows branch names, latest commits, and identifies the default branch. Use this to explore available branches, find branch names for checkout or PR creation, or verify branch existence before operations.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug to list branches from.' },
              filterText: { type: 'string', description: 'Filter branches by name (case-insensitive partial match).' },
              limit: { type: 'number', description: 'Number of branches to return (default: 25, max: 1000).' },
              start: { type: 'number', description: 'Start index for pagination (default: 0).' }
            },
            required: ['repository']
          }
        },
        {
          name: 'list_commits',
          description: 'List commits in a Bitbucket repository, optionally filtered by branch and/or author. Use this to review commit history, find specific changes, track contributions, or understand the evolution of a branch.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug to list commits from.' },
              branch: { type: 'string', description: 'Branch name to list commits from (e.g., "main", "develop", "feature/xyz"). If omitted, lists commits from the default branch.' },
              author: { type: 'string', description: 'Filter commits by author name or email (case-insensitive partial match, applied client-side).' },
              limit: { type: 'number', description: 'Number of commits to return (default: 25, max: 1000).' },
              start: { type: 'number', description: 'Start index for pagination (default: 0).' }
            },
            required: ['repository']
          }
        },
        {
          name: 'delete_branch',
          description: 'Delete a branch from a Bitbucket repository. Cannot delete the default branch. Use this for cleanup after merging pull requests or removing stale feature branches.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the branch.' },
              branch: { type: 'string', description: 'Branch name to delete (e.g., "feature/old-feature", "bugfix/resolved-issue").' }
            },
            required: ['repository', 'branch']
          }
        },
        {
          name: 'approve_pull_request',
          description: 'Approve a pull request as the current user. Use this to signal that you have reviewed the changes and they are ready to be merged. The approval is recorded with your user identity.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to approve.' }
            },
            required: ['repository', 'prId']
          }
        },
        {
          name: 'unapprove_pull_request',
          description: 'Remove your approval from a pull request. Use this to retract a previous approval if you discover issues after approving or if the PR has changed since your review.',
          inputSchema: {
            type: 'object',
            properties: {
              project: { type: 'string', description: 'Bitbucket project key. If omitted, uses BITBUCKET_DEFAULT_PROJECT environment variable.' },
              repository: { type: 'string', description: 'Repository slug containing the pull request.' },
              prId: { type: 'number', description: 'Pull request ID to remove approval from.' }
            },
            required: ['repository', 'prId']
          }
        }
      ].filter(tool => !this.config.readOnly || readOnlyTools.includes(tool.name))
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        logger.info(`Called tool: ${request.params.name}`, { arguments: request.params.arguments });
        const args = request.params.arguments ?? {};

        // Check if tool is allowed in read-only mode
        if (this.config.readOnly && !readOnlyTools.includes(request.params.name)) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Tool ${request.params.name} is not available in read-only mode`
          );
        }

        // Helper function to get project with fallback to default
        const getProject = (providedProject?: string): string => {
          const project = providedProject || this.config.defaultProject;
          if (!project) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Project must be provided either as a parameter or through BITBUCKET_DEFAULT_PROJECT environment variable'
            );
          }
          return project;
        };

        switch (request.params.name) {
          case 'list_projects': {
            return await this.listProjects({
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'list_repositories': {
            return await this.listRepositories({
              project: args.project as string,
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'create_pull_request': {
            if (!this.isPullRequestInput(args)) {
              throw new McpError(
                ErrorCode.InvalidParams,
                'Invalid pull request input parameters'
              );
            }
            // Ensure project is set
            const createArgs = { ...args, project: getProject(args.project) };
            return await this.createPullRequest(createArgs);
          }

          case 'get_pull_request': {
            const getPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.getPullRequest(getPrParams);
          }

          case 'merge_pull_request': {
            const mergePrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.mergePullRequest(mergePrParams, {
              message: args.message as string,
              strategy: args.strategy as 'merge-commit' | 'squash' | 'fast-forward'
            });
          }

          case 'decline_pull_request': {
            const declinePrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.declinePullRequest(declinePrParams, args.message as string);
          }

          case 'add_comment': {
            const commentPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.addComment(commentPrParams, {
              text: args.text as string,
              parentId: args.parentId as number
            });
          }

           case 'add_comment_inline': {
            const commentPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.addCommentInline(commentPrParams, {
              text: args.text as string,
              parentId: args.parentId as number,
              filePath: args.filePath as string,
              line: args.line as number,
              lineType: args.lineType as 'ADDED' | 'REMOVED'
            });
          }

          case 'get_diff': {
            const diffPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.getDiff(
              diffPrParams, 
              args.contextLines as number, 
              args.maxLinesPerFile as number
            );
          }

          case 'get_reviews': {
            const reviewsPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.getReviews(reviewsPrParams);
          }

          case 'get_activities': {
            const activitiesPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.getActivities(activitiesPrParams);
          }

          case 'get_comments': {
            const commentsPrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.getComments(commentsPrParams);
          }

          case 'search': {
            return await this.search({
              query: args.query as string,
              project: args.project as string,
              repository: args.repository as string,
              type: args.type as 'code' | 'file',
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'get_file_content': {
            return await this.getFileContent({
              project: getProject(args.project as string),
              repository: args.repository as string,
              filePath: args.filePath as string,
              branch: args.branch as string,
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'browse_repository': {
            return await this.browseRepository({
              project: getProject(args.project as string),
              repository: args.repository as string,
              path: args.path as string,
              branch: args.branch as string,
              limit: args.limit as number
            });
          }

          case 'list_pull_requests': {
            return await this.listPullRequests({
              project: getProject(args.project as string),
              repository: args.repository as string,
              state: args.state as 'OPEN' | 'MERGED' | 'DECLINED' | 'ALL',
              author: args.author as string,
              direction: args.direction as 'INCOMING' | 'OUTGOING',
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'list_branches': {
            return await this.listBranches({
              project: getProject(args.project as string),
              repository: args.repository as string,
              filterText: args.filterText as string,
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'list_commits': {
            return await this.listCommits({
              project: getProject(args.project as string),
              repository: args.repository as string,
              branch: args.branch as string,
              author: args.author as string,
              limit: args.limit as number,
              start: args.start as number
            });
          }

          case 'delete_branch': {
            return await this.deleteBranch(
              getProject(args.project as string),
              args.repository as string,
              args.branch as string
            );
          }

          case 'approve_pull_request': {
            const approvePrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.approvePullRequest(approvePrParams);
          }

          case 'unapprove_pull_request': {
            const unapprovePrParams: PullRequestParams = {
              project: getProject(args.project as string),
              repository: args.repository as string,
              prId: args.prId as number
            };
            return await this.unapprovePullRequest(unapprovePrParams);
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        logger.error('Tool execution error', { error });
        if (axios.isAxiosError(error)) {
          throw new McpError(
            ErrorCode.InternalError,
            `Bitbucket API error: ${error.response?.data.message ?? error.message}`
          );
        }
        throw error;
      }
    });
  }

  private async listProjects(options: ListOptions = {}) {
    const { limit = 25, start = 0 } = options;
    const response = await this.api.get('/projects', {
      params: { limit, start }
    });

    const projects = response.data.values || [];
    const summary = {
      total: response.data.size || projects.length,
      showing: projects.length,
      projects: projects.map((project: { key: string; name: string; description?: string; public: boolean; type: string }) => ({
        key: project.key,
        name: project.name,
        description: project.description,
        public: project.public,
        type: project.type
      }))
    };

    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(summary, null, 2) 
      }]
    };
  }

  private async listRepositories(options: ListRepositoriesOptions = {}) {
    const { project, limit = 25, start = 0 } = options;
    
    let endpoint: string;
    const params = { limit, start };

    if (project || this.config.defaultProject) {
      // List repositories for a specific project
      const projectKey = project || this.config.defaultProject;
      endpoint = `/projects/${projectKey}/repos`;
    } else {
      // List all accessible repositories
      endpoint = '/repos';
    }

    const response = await this.api.get(endpoint, { params });

    const repositories = response.data.values || [];
    const summary = {
      project: project || this.config.defaultProject || 'all',
      total: response.data.size || repositories.length,
      showing: repositories.length,
      repositories: repositories.map((repo: { 
        slug: string; 
        name: string; 
        description?: string; 
        project?: { key: string }; 
        public: boolean; 
        links?: { clone?: { name: string; href: string }[] }; 
        state: string 
      }) => ({
        slug: repo.slug,
        name: repo.name,
        description: repo.description,
        project: repo.project?.key,
        public: repo.public,
        cloneUrl: repo.links?.clone?.find((link: { name: string; href: string }) => link.name === 'http')?.href,
        state: repo.state
      }))
    };

    return {
      content: [{ 
        type: 'text', 
        text: JSON.stringify(summary, null, 2) 
      }]
    };
  }

  private async createPullRequest(input: PullRequestInput) {
    const response = await this.api.post(
      `/projects/${input.project}/repos/${input.repository}/pull-requests`,
      {
        title: input.title,
        description: input.description,
        fromRef: {
          id: `refs/heads/${input.sourceBranch}`,
          repository: {
            slug: input.repository,
            project: { key: input.project }
          }
        },
        toRef: {
          id: `refs/heads/${input.targetBranch}`,
          repository: {
            slug: input.repository,
            project: { key: input.project }
          }
        },
        reviewers: input.reviewers?.map(username => ({ user: { name: username } }))
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async getPullRequest(params: PullRequestParams) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }
    
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}`
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async mergePullRequest(params: PullRequestParams, options: MergeOptions = {}) {
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }

    const { message, strategy = 'merge-commit' } = options;

    // Fetch current PR version for optimistic locking (required by Bitbucket Server API)
    const prResponse = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}`
    );
    const version = prResponse.data.version;

    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/merge`,
      {
        version,
        message,
        strategy
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async declinePullRequest(params: PullRequestParams, message?: string) {
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }

    // Fetch current PR version for optimistic locking (required by Bitbucket Server API)
    const prResponse = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}`
    );
    const version = prResponse.data.version;

    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/decline`,
      {
        version,
        message
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async addComment(params: PullRequestParams, options: CommentOptions) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }
    
    const { text, parentId } = options;
    
    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/comments`,
      {
        text,
        parent: parentId ? { id: parentId } : undefined
      }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async addCommentInline(params: PullRequestParams, options: InlineCommentOptions) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId || !options.filePath || !options.line || !options.lineType) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, prId, filePath, line, and lineType are required'
      );
    }
    
    const { text, parentId } = options;
    
    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/comments`,
      {
        text,
        parent: parentId ? { id: parentId } : undefined,
        anchor: {
          path: options.filePath,
          lineType: options.lineType,
          line: options.line,
          diffType: 'EFFECTIVE',
          fileType: 'TO',}
      }
    );

    logger.error(response);

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private truncateDiff(diffContent: string, maxLinesPerFile: number): string {
    if (!maxLinesPerFile || maxLinesPerFile <= 0) {
      return diffContent;
    }

    const lines = diffContent.split('\n');
    const result: string[] = [];
    let currentFileLines: string[] = [];
    let currentFileName = '';
    let inFileContent = false;

    for (const line of lines) {
      // Detect file headers (diff --git, index, +++, ---)
      if (line.startsWith('diff --git ')) {
        // Process previous file if any
        if (currentFileLines.length > 0) {
          result.push(...this.truncateFileSection(currentFileLines, currentFileName, maxLinesPerFile));
          currentFileLines = [];
        }
        
        // Extract filename for context
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        currentFileName = match ? match[2] : 'unknown';
        inFileContent = false;
        
        // Always include file headers
        result.push(line);
      } else if (line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
        // Always include file metadata
        result.push(line);
      } else if (line.startsWith('@@')) {
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
      result.push(...this.truncateFileSection(currentFileLines, currentFileName, maxLinesPerFile));
    }

    return result.join('\n');
  }

  private truncateFileSection(fileLines: string[], fileName: string, maxLines: number): string[] {
    if (fileLines.length <= maxLines) {
      return fileLines;
    }

    // Count actual content lines (excluding hunk headers)
    const contentLines = fileLines.filter(line => !line.startsWith('@@'));
    const hunkHeaders = fileLines.filter(line => line.startsWith('@@'));

    if (contentLines.length <= maxLines) {
      return fileLines; // No need to truncate if content is within limit
    }

    // Smart truncation: show beginning and end
    const showAtStart = Math.floor(maxLines * 0.6); // 60% at start
    const showAtEnd = Math.floor(maxLines * 0.4);   // 40% at end
    const truncatedCount = contentLines.length - showAtStart - showAtEnd;

    const result: string[] = [];
    
    // Add hunk headers first
    result.push(...hunkHeaders);
    
    // Add first portion
    result.push(...contentLines.slice(0, showAtStart));
    
    // Add truncation message
    result.push('');
    result.push(`[*** FILE TRUNCATED: ${truncatedCount} lines hidden from ${fileName} ***]`);
    result.push(`[*** File had ${contentLines.length} total lines, showing first ${showAtStart} and last ${showAtEnd} ***]`);
    result.push(`[*** Use maxLinesPerFile=0 to see complete diff ***]`);
    result.push('');
    
    // Add last portion
    result.push(...contentLines.slice(-showAtEnd));

    return result;
  }

  private async getDiff(params: PullRequestParams, contextLines: number = 10, maxLinesPerFile?: number) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }
    
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/diff`,
      {
        params: { contextLines },
        headers: { Accept: 'text/plain' }
      }
    );

    // Determine max lines per file: parameter > env var > no limit
    const effectiveMaxLines = maxLinesPerFile !== undefined 
      ? maxLinesPerFile 
      : this.config.maxLinesPerFile;

    const diffContent = effectiveMaxLines 
      ? this.truncateDiff(response.data, effectiveMaxLines)
      : response.data;

    return {
      content: [{ type: 'text', text: diffContent }]
    };
  }

  private async getReviews(params: PullRequestParams) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }
    
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`
    );

    const reviews = response.data.values.filter(
      (activity: BitbucketActivity) => activity.action === 'APPROVED' || activity.action === 'REVIEWED'
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(reviews, null, 2) }]
    };
  }

  private async getActivities(params: PullRequestParams) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }
    
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async getComments(params: PullRequestParams) {
    const { project, repository, prId } = params;
    
    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }
    
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/activities`
    );

    const comments = response.data.values.filter(
      (activity: BitbucketActivity) => activity.action === 'COMMENTED'
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }]
    };
  }

  private async search(options: SearchOptions) {
    const { query, project, repository, type, limit = 25, start = 0 } = options;
    
    if (!query) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Query parameter is required'
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
    if (type === 'file') {
      // For file searches, wrap query in quotes for exact filename matching
      if (!query.includes('ext:') && !query.startsWith('"')) {
        searchQuery = `"${query}"`;
        if (project) searchQuery += ` project:${project}`;
        if (repository && project) searchQuery += ` repo:${project}/${repository}`;
      }
    } else if (type === 'code' && !query.includes('ext:')) {
      // For code searches, add common extension filters if not specified
      // This can be enhanced based on user needs
    }

    const requestBody = {
      query: searchQuery,
      entities: {
        code: {
          start,
          limit: Math.min(limit, 100)
        }
      }
    };

    try {
      // Use full URL for search API since it uses different base path
      const searchUrl = `${this.config.baseUrl}/rest/search/latest/search`;
      const response = await axios.post(searchUrl, requestBody, {
        headers: this.config.token
          ? { 
              Authorization: `Bearer ${this.config.token}`,
              'Content-Type': 'application/json'
            }
          : { 'Content-Type': 'application/json' },
        auth: this.config.username && this.config.password
          ? { username: this.config.username, password: this.config.password }
          : undefined,
      });
      
      const codeResults = response.data.code || {};
      const searchResults = {
        query: searchQuery,
        originalQuery: query,
        project: project || 'global',
        repository: repository || 'all',
        type: type || 'code',
        scope: response.data.scope || {},
        total: codeResults.count || 0,
        showing: codeResults.values?.length || 0,
        isLastPage: codeResults.isLastPage || true,
        nextStart: codeResults.nextStart || null,
        results: codeResults.values?.map((result: any) => ({
          repository: result.repository,
          file: result.file,
          hitCount: result.hitCount || 0,
          pathMatches: result.pathMatches || [],
          hitContexts: result.hitContexts || []
        })) || []
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(searchResults, null, 2) }]
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new McpError(
            ErrorCode.InternalError,
            'Search API endpoint not available on this Bitbucket instance'
          );
        }
        // Handle specific search API errors
        const errorData = error.response?.data;
        if (errorData?.errors && errorData.errors.length > 0) {
          const firstError = errorData.errors[0];
          throw new McpError(
            ErrorCode.InvalidParams,
            `Search error: ${firstError.message || 'Invalid search query'}`
          );
        }
      }
      throw error;
    }
  }

  private async getFileContent(options: FileContentOptions) {
    const { project, repository, filePath, branch, limit = 100, start = 0 } = options;
    
    if (!project || !repository || !filePath) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and filePath are required'
      );
    }

    const params: Record<string, string | number> = {
      limit: Math.min(limit, 1000),
      start
    };

    if (branch) {
      params.at = branch;
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/browse/${filePath}`,
      { params }
    );

    const fileContent = {
      project,
      repository,
      filePath,
      branch: branch || 'default',
      isLastPage: response.data.isLastPage,
      size: response.data.size,
      showing: response.data.lines?.length || 0,
      startLine: start,
      lines: response.data.lines?.map((line: { text: string }) => line.text) || []
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(fileContent, null, 2) }]
    };
  }

  private async browseRepository(options: { project: string; repository: string; path?: string; branch?: string; limit?: number }) {
    const { project, repository, path = '', branch, limit = 50 } = options;
    
    if (!project || !repository) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project and repository are required'
      );
    }

    const params: Record<string, string | number> = {
      limit
    };

    if (branch) {
      params.at = branch;
    }

    const browsePath = path ? `/${path}` : '';
    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/browse${browsePath}`,
      { params }
    );

    const children = response.data.children || {};
    const browseResults = {
      project,
      repository,
      path: path || 'root',
      branch: branch || response.data.revision || 'default',
      isLastPage: children.isLastPage || false,
      size: children.size || 0,
      showing: children.values?.length || 0,
      items: children.values?.map((item: { 
        path: { name: string; toString: string }; 
        type: string; 
        size?: number 
      }) => ({
        name: item.path.name,
        path: item.path.toString,
        type: item.type,
        size: item.size
      })) || []
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(browseResults, null, 2) }]
    };
  }

  private async listPullRequests(options: PullRequestListOptions) {
    const { project, repository, state = 'OPEN', author, direction, limit = 25, start = 0 } = options;

    if (!project || !repository) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project and repository are required'
      );
    }

    const params: Record<string, string | number> = { limit, start };
    if (state) {
      params.state = state;
    }
    if (direction) {
      params.direction = direction;
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/pull-requests`,
      { params }
    );

    let pullRequests = response.data.values || [];

    // Client-side author filter (matches against name, slug, or displayName)
    if (author) {
      const authorLower = author.toLowerCase();
      pullRequests = pullRequests.filter((pr: { author: { user: { name: string; slug: string; displayName: string } } }) => {
        const nameMatch = pr.author?.user?.name?.toLowerCase() === authorLower;
        const slugMatch = pr.author?.user?.slug?.toLowerCase() === authorLower;
        const displayMatch = pr.author?.user?.displayName?.toLowerCase().includes(authorLower);
        return nameMatch || slugMatch || displayMatch;
      });
    }

    const summary = {
      project,
      repository,
      state: state || 'OPEN',
      authorFilter: author || null,
      total: response.data.size || response.data.values?.length || 0,
      showing: pullRequests.length,
      isLastPage: response.data.isLastPage,
      nextPageStart: response.data.nextPageStart,
      pullRequests: pullRequests.map((pr: {
        id: number;
        title: string;
        state: string;
        createdDate: number;
        updatedDate: number;
        author: { user: { name: string; displayName: string } };
        fromRef: { displayId: string };
        toRef: { displayId: string };
        reviewers: { user: { name: string }; status: string }[];
      }) => ({
        id: pr.id,
        title: pr.title,
        state: pr.state,
        author: pr.author?.user?.displayName || pr.author?.user?.name,
        sourceBranch: pr.fromRef?.displayId,
        targetBranch: pr.toRef?.displayId,
        createdDate: pr.createdDate,
        updatedDate: pr.updatedDate,
        reviewers: pr.reviewers?.map((r: { user: { name: string }; status: string }) => ({
          name: r.user?.name,
          status: r.status
        })) || []
      }))
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
    };
  }

  private async listBranches(options: BranchListOptions) {
    const { project, repository, filterText, limit = 25, start = 0 } = options;

    if (!project || !repository) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project and repository are required'
      );
    }

    const params: Record<string, string | number> = { limit, start };
    if (filterText) {
      params.filterText = filterText;
    }

    // Fetch branches and default branch in parallel
    const [branchesResponse, defaultBranchResponse] = await Promise.all([
      this.api.get(`/projects/${project}/repos/${repository}/branches`, { params }),
      this.api.get(`/projects/${project}/repos/${repository}/default-branch`).catch(() => null)
    ]);

    const defaultBranchId = defaultBranchResponse?.data?.id;
    const branches = branchesResponse.data.values || [];

    const summary = {
      project,
      repository,
      defaultBranch: defaultBranchResponse?.data?.displayId || null,
      total: branchesResponse.data.size || branches.length,
      showing: branches.length,
      isLastPage: branchesResponse.data.isLastPage,
      nextPageStart: branchesResponse.data.nextPageStart,
      branches: branches.map((branch: { displayId: string; id: string; latestCommit: string }) => ({
        name: branch.displayId,
        id: branch.id,
        latestCommit: branch.latestCommit,
        isDefault: branch.id === defaultBranchId
      }))
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
    };
  }

  private async listCommits(options: CommitListOptions) {
    const { project, repository, branch, author, limit = 25, start = 0 } = options;

    if (!project || !repository) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project and repository are required'
      );
    }

    const params: Record<string, string | number> = { limit, start };
    if (branch) {
      params.until = `refs/heads/${branch}`;
    }

    const response = await this.api.get(
      `/projects/${project}/repos/${repository}/commits`,
      { params }
    );

    let commits = response.data.values || [];

    // Client-side author filter (API doesn't support server-side author filtering)
    if (author) {
      const authorLower = author.toLowerCase();
      commits = commits.filter((commit: { author: { name: string; emailAddress?: string } }) => {
        const nameMatch = commit.author?.name?.toLowerCase().includes(authorLower);
        const emailMatch = commit.author?.emailAddress?.toLowerCase().includes(authorLower);
        return nameMatch || emailMatch;
      });
    }

    const summary = {
      project,
      repository,
      branch: branch || 'default',
      authorFilter: author || null,
      total: response.data.size || response.data.values?.length || 0,
      showing: commits.length,
      isLastPage: response.data.isLastPage,
      nextPageStart: response.data.nextPageStart,
      commits: commits.map((commit: { id: string; displayId: string; message: string; author: { name: string; emailAddress?: string }; authorTimestamp: number; parents?: { id: string }[] }) => ({
        id: commit.id,
        displayId: commit.displayId,
        message: commit.message,
        author: commit.author,
        authorTimestamp: commit.authorTimestamp,
        parents: commit.parents?.map((p: { id: string }) => p.id) || []
      }))
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
    };
  }

  private async deleteBranch(project: string, repository: string, branch: string) {
    if (!project || !repository || !branch) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and branch are required'
      );
    }

    // Pre-check: prevent deletion of default branch
    try {
      const defaultBranchResponse = await this.api.get(
        `/projects/${project}/repos/${repository}/default-branch`
      );
      if (defaultBranchResponse.data?.displayId === branch) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Cannot delete the default branch "${branch}". Change the default branch first.`
        );
      }
    } catch (error) {
      // Re-throw McpError (our own validation)
      if (error instanceof McpError) throw error;
      // Ignore other errors (e.g., 404 on empty repos) and proceed
    }

    // branch-utils API uses a different base path than /rest/api/1.0
    const url = `${this.config.baseUrl}/rest/branch-utils/1.0/projects/${project}/repos/${repository}/branches`;

    await axios.delete(url, {
      data: { name: `refs/heads/${branch}` },
      headers: this.config.token
        ? {
            Authorization: `Bearer ${this.config.token}`,
            'Content-Type': 'application/json'
          }
        : { 'Content-Type': 'application/json' },
      auth: this.config.username && this.config.password
        ? { username: this.config.username, password: this.config.password }
        : undefined,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Branch "${branch}" deleted from ${project}/${repository}`
        }, null, 2)
      }]
    };
  }

  private async approvePullRequest(params: PullRequestParams) {
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }

    const response = await this.api.post(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/approve`,
      {},
      { headers: { 'Content-Type': 'application/json' } }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  private async unapprovePullRequest(params: PullRequestParams) {
    const { project, repository, prId } = params;

    if (!project || !repository || !prId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Project, repository, and prId are required'
      );
    }

    const response = await this.api.delete(
      `/projects/${project}/repos/${repository}/pull-requests/${prId}/approve`,
      { headers: { 'Content-Type': 'application/json' } }
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Bitbucket MCP server running on stdio');
  }
}

// Entry point — only runs when this module is executed directly, not when imported.
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = new BitbucketServer();
  server.run().catch((error) => {
    logger.error('Server error', error);
    process.exit(1);
  });
}