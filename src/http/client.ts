import ky, { type KyInstance, type Options } from "ky";
import type { BitbucketConfig } from "../types.js";
import { logger } from "../logging.js";

export interface ApiClients {
  api: KyInstance;
  buildStatus: KyInstance;
  commentLikes: KyInstance;
  emoticons: KyInstance;
  insights: KyInstance;
  search: KyInstance;
  branchUtils: KyInstance;
  defaultReviewers: KyInstance;
}

export function createApiClients(config: BitbucketConfig): ApiClients {
  const authHeaders: Record<string, string> = {};

  if (config.token) {
    authHeaders["Authorization"] = `Bearer ${config.token}`;
  } else if (config.username && config.password) {
    authHeaders["Authorization"] =
      `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }

  const allHeaders = { ...authHeaders, ...config.customHeaders };

  const commonOptions: Options = {
    timeout: 30_000,
    retry: {
      limit: 2,
      methods: ["get"],
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
    hooks: {
      beforeRequest: [
        ({ request }) => {
          for (const [key, value] of Object.entries(allHeaders)) {
            request.headers.set(key, value);
          }
          logger.debug(`${request.method} ${request.url}`);
        },
      ],
      afterResponse: [
        ({ response }) => {
          if (!response.ok) {
            logger.warn(`HTTP ${response.status} ${response.url}`);
          }
        },
      ],
    },
  };

  const create = (path: string) =>
    ky.create({
      ...commonOptions,
      prefix: `${config.baseUrl}${path}`,
    });

  return {
    api: create("/rest/api/1.0"),
    buildStatus: create("/rest/build-status/1.0"),
    commentLikes: create("/rest/comment-likes/1.0"),
    emoticons: create("/rest/emoticons/latest"),
    insights: create("/rest/insights/latest"),
    search: create("/rest/search/latest"),
    branchUtils: create("/rest/branch-utils/1.0"),
    defaultReviewers: create("/rest/default-reviewers/1.0"),
  };
}
