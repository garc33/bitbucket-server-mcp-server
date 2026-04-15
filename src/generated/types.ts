/**
 * Re-exports of Bitbucket Server API types from the OpenAPI spec.
 * Generated from the official Atlassian spec (v8.5).
 *
 * We use 8.5 because it's the lowest version that includes all schemas
 * we need (including RestUserReaction/RestEmoticon added in 8.5).
 * The project supports Bitbucket Server/DC 7.x+, and the core schemas
 * (PR, Comment, Branch, etc.) are identical between 7.x and 8.x.
 * No 7.x OpenAPI spec exists (only WADL).
 *
 * For types not in the spec (search, emoticons), define manually below.
 */
import type { components } from "./bitbucket-api.js";

// Core entities
export type PullRequest = components["schemas"]["RestPullRequest"];
export type Project = components["schemas"]["RestProject"];
export type Repository = components["schemas"]["RestRepository"];
export type Branch = components["schemas"]["RestBranch"];
export type Commit = components["schemas"]["RestCommit"];
export type Comment = components["schemas"]["RestComment"];
export type PullRequestActivity =
  components["schemas"]["RestPullRequestActivity"];
export type PullRequestParticipant =
  components["schemas"]["RestPullRequestParticipant"];

// CI / Insights
export type BuildStatus = components["schemas"]["RestBuildStatus"];
export type InsightReport = components["schemas"]["RestInsightReport"];
export type InsightAnnotation = components["schemas"]["RestInsightAnnotation"];

// Request bodies
export type PullRequestMergeRequest =
  components["schemas"]["RestPullRequestMergeRequest"];
export type PullRequestDeclineRequest =
  components["schemas"]["RestPullRequestDeclineRequest"];

// Reactions
export type UserReaction = components["schemas"]["RestUserReaction"];
export type Emoticon = components["schemas"]["RestEmoticon"];

// --- Types NOT in the official spec (undocumented plugin APIs) ---

/** Search result from /rest/search/latest/search */
export interface SearchResult {
  file: {
    path: string;
    name: string;
  };
  hitContexts: Array<{
    context: string;
    line: number;
  }>;
  pathMatches: Array<{
    start: number;
    end: number;
  }>;
}

/** Emoticon search result from /rest/emoticons/latest/search */
export interface EmoticonSearchResult {
  shortcut: string;
  url: string;
}
