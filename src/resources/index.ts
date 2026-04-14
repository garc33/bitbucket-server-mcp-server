import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClients } from "../http/client.js";
import type { ApiCache } from "../http/cache.js";

export function registerResources(
  server: McpServer,
  clients: ApiClients,
  cache: ApiCache,
) {
  server.registerResource(
    "projects",
    "bitbucket://projects",
    {
      description:
        "List of all accessible Bitbucket projects with their keys and names",
      mimeType: "application/json",
    },
    async () => {
      const cacheKey = "resource:projects";
      let projects = cache.get<unknown[]>(cacheKey);

      if (!projects) {
        const data = await clients.api
          .get("projects", {
            searchParams: { limit: 1000 },
          })
          .json<{ values: unknown[] }>();
        projects = data.values;
        cache.set(cacheKey, projects, 5 * 60 * 1000);
      }

      return {
        contents: [
          {
            uri: "bitbucket://projects",
            mimeType: "application/json" as const,
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    },
  );
}
