import { vi, describe, test, expect, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { AxiosInstance, AxiosResponse } from "axios";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ListToolsRequest,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";

function createAxiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as AxiosResponse<T>["config"],
  };
}

const mockCreate: Mock<(config?: unknown) => AxiosInstance> = vi.fn();
const mockApiGet: Mock<(url: string) => Promise<AxiosResponse>> = vi.fn();
const mockApiPost: Mock<
  (url: string, data?: unknown) => Promise<AxiosResponse>
> = vi.fn();
const mockIsAxiosError: Mock<(payload: unknown) => boolean> = vi.fn();
const mockSetRequestHandler: Mock<
  (
    schema: typeof CallToolRequestSchema | typeof ListToolsRequestSchema,
    handler:
      | ((request: CallToolRequest) => Promise<CallToolResult>)
      | ((request: ListToolsRequest) => Promise<ListToolsResult>),
  ) => void
> = vi.fn();

vi.mock("axios", () => {
  const mockAxios = {
    create: mockCreate,
    isAxiosError: mockIsAxiosError,
  };
  return {
    default: mockAxios,
  };
});

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  return {
    Server: class MockServer {
      setRequestHandler = mockSetRequestHandler;
      connect = vi.fn();
      onerror = undefined;
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

// Dynamic import after mocks are registered.
const { BitbucketServer } = await import("../index.js");

// ---- helpers ----------------------------------------------------------------

function withEnv(vars: NodeJS.ProcessEnv, fn: () => void): void {
  const original = process.env;
  process.env = { ...vars };
  try {
    fn();
  } finally {
    process.env = original;
  }
}

function makeServer(env: NodeJS.ProcessEnv): void {
  withEnv(env, () => {
    new BitbucketServer();
  });
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // ListToolsRequestSchema is registered first (index 0), CallToolRequestSchema second (index 1).
  type Handler = (
    req: unknown,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
  const handler = mockSetRequestHandler.mock.calls[1]?.[1] as
    | Handler
    | undefined;
  if (!handler) throw new Error("CallTool handler not registered");
  return handler(
    { params: { name: toolName, arguments: args } },
    {},
  ) as Promise<{ content: Array<{ type: string; text: string }> }>;
}

const BASE_ENV: NodeJS.ProcessEnv = {
  BITBUCKET_URL: "https://bb.example.com",
  BITBUCKET_TOKEN: "test-token",
  BITBUCKET_DEFAULT_PROJECT: "DEFAULT",
};

// ---- tests ------------------------------------------------------------------

describe("BitbucketServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReturnValue({
      get: mockApiGet,
      post: mockApiPost,
    } as unknown as AxiosInstance);
  });

  describe("Configuration", () => {
    test("should throw if BITBUCKET_URL is not defined", () => {
      withEnv({ BITBUCKET_TOKEN: "tok" }, () => {
        expect(() => new BitbucketServer()).toThrow(
          "BITBUCKET_URL is required",
        );
      });
    });

    test("should throw if neither token nor credentials are provided", () => {
      withEnv({ BITBUCKET_URL: "https://bb.example.com" }, () => {
        expect(() => new BitbucketServer()).toThrow(
          "Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required",
        );
      });
    });

    test("should configure axios with token and read default project", () => {
      withEnv(
        {
          BITBUCKET_URL: "https://bb.example.com",
          BITBUCKET_TOKEN: "test-token",
        },
        () => {
          new BitbucketServer();
          expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              baseURL: "https://bb.example.com/rest/api/1.0",
              headers: expect.objectContaining({
                Authorization: "Bearer test-token",
              }),
            }),
          );
        },
      );
    });

    test("should merge BITBUCKET_CUSTOM_HEADERS into axios headers", () => {
      withEnv(
        {
          BITBUCKET_URL: "https://bb.example.com",
          BITBUCKET_TOKEN: "test-token",
          BITBUCKET_CUSTOM_HEADERS:
            "X-Zero-Trust-Token=eyJ.payload.sig,X-Custom=value",
        },
        () => {
          new BitbucketServer();
          expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              headers: expect.objectContaining({
                Authorization: "Bearer test-token",
                "X-Zero-Trust-Token": "eyJ.payload.sig",
                "X-Custom": "value",
              }),
            }),
          );
        },
      );
    });

    test("should not add extra headers when BITBUCKET_CUSTOM_HEADERS is unset", () => {
      withEnv(
        {
          BITBUCKET_URL: "https://bb.example.com",
          BITBUCKET_TOKEN: "test-token",
        },
        () => {
          new BitbucketServer();
          const call = mockCreate.mock.calls[0];
          if (!call || call.length === 0)
            throw new Error("mockCreate was not called");
          const callArgs = call[0] as { headers: Record<string, string> };
          expect(Object.keys(callArgs.headers)).toEqual(["Authorization"]);
        },
      );
    });
  });

  describe("Pull Request Operations", () => {
    beforeEach(() => {
      makeServer(BASE_ENV);
    });

    test("should create a pull request with explicit project", async () => {
      mockApiPost.mockResolvedValueOnce(createAxiosResponse({ id: 1 }));

      const result = await callTool("create_pull_request", {
        project: "TEST",
        repository: "repo",
        title: "Test PR",
        description: "Test description",
        sourceBranch: "feature",
        targetBranch: "main",
        reviewers: ["user1"],
      });

      expect(mockApiPost).toHaveBeenCalledWith(
        "/projects/TEST/repos/repo/pull-requests",
        expect.objectContaining({
          title: "Test PR",
          description: "Test description",
          fromRef: expect.any(Object),
          toRef: expect.any(Object),
          reviewers: [{ user: { name: "user1" } }],
        }),
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ id: 1 });
    });

    test("should create a pull request using default project", async () => {
      mockApiPost.mockResolvedValueOnce(createAxiosResponse({ id: 1 }));

      const result = await callTool("create_pull_request", {
        repository: "repo",
        title: "Test PR",
        description: "Test description",
        sourceBranch: "feature",
        targetBranch: "main",
        reviewers: ["user1"],
      });

      expect(mockApiPost).toHaveBeenCalledWith(
        "/projects/DEFAULT/repos/repo/pull-requests",
        expect.objectContaining({
          title: "Test PR",
          description: "Test description",
          fromRef: expect.any(Object),
          toRef: expect.any(Object),
          reviewers: [{ user: { name: "user1" } }],
        }),
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ id: 1 });
    });

    test("should throw error when no project is provided or defaulted", async () => {
      vi.clearAllMocks();
      mockCreate.mockReturnValue({
        get: mockApiGet,
        post: mockApiPost,
      } as unknown as AxiosInstance);
      makeServer({
        BITBUCKET_URL: "https://bb.example.com",
        BITBUCKET_TOKEN: "tok",
      });

      await expect(
        callTool("get_pull_request", { repository: "repo", prId: 1 }),
      ).rejects.toThrow("Project must be provided");
    });

    test("should merge a pull request", async () => {
      mockApiGet.mockResolvedValueOnce(
        createAxiosResponse({ id: 1, version: 3 }),
      );
      mockApiPost.mockResolvedValueOnce(
        createAxiosResponse({ state: "MERGED" }),
      );

      const result = await callTool("merge_pull_request", {
        project: "TEST",
        repository: "repo",
        prId: 1,
        message: "Merged PR",
        strategy: "squash",
      });

      expect(mockApiPost).toHaveBeenCalledWith(
        "/projects/TEST/repos/repo/pull-requests/1/merge",
        expect.objectContaining({
          version: 3,
          message: "Merged PR",
          strategy: "squash",
        }),
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ state: "MERGED" });
    });

    test("should handle API errors", async () => {
      mockIsAxiosError.mockReturnValue(true);
      mockApiGet.mockRejectedValueOnce({
        response: { data: { message: "Not found" } },
        message: "Request failed",
      });

      await expect(
        callTool("get_pull_request", {
          project: "TEST",
          repository: "repo",
          prId: 1,
        }),
      ).rejects.toThrow("Bitbucket API error: Not found");
    });
  });

  describe("Reviews and Comments", () => {
    beforeEach(() => {
      makeServer(BASE_ENV);
    });

    test("should filter review activities", async () => {
      mockApiGet.mockResolvedValueOnce(
        createAxiosResponse({
          values: [
            { action: "APPROVED", user: { name: "user1" } },
            { action: "COMMENTED", user: { name: "user2" } },
            { action: "REVIEWED", user: { name: "user3" } },
          ],
        }),
      );

      const result = await callTool("get_reviews", {
        project: "TEST",
        repository: "repo",
        prId: 1,
      });

      const reviews = JSON.parse(result.content[0].text);
      expect(reviews).toHaveLength(2);
      expect(
        reviews.every((r: { action: string }) =>
          ["APPROVED", "REVIEWED"].includes(r.action),
        ),
      ).toBe(true);
    });

    test("should add comment with parent", async () => {
      mockApiPost.mockResolvedValueOnce(createAxiosResponse({ id: 456 }));

      const result = await callTool("add_comment", {
        project: "TEST",
        repository: "repo",
        prId: 1,
        text: "Test comment",
        parentId: 123,
      });

      expect(mockApiPost).toHaveBeenCalledWith(
        "/projects/TEST/repos/repo/pull-requests/1/comments",
        { text: "Test comment", parent: { id: 123 } },
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ id: 456 });
    });
  });
});
