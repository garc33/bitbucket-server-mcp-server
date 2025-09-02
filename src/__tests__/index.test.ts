// Mock dependencies
jest.mock("@modelcontextprotocol/sdk/server/mcp.js");
jest.mock("axios");
import axios, { AxiosInstance } from "axios";
import { BitbucketServer } from "../server";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types";

describe("BitbucketServer", () => {
  // Mock variables
  let mockAxios: jest.Mocked<typeof axios>;
  let mockAxiosInstance: {
    post: jest.Mock;
    get: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
  };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save environment variables
    originalEnv = process.env;
    process.env = {
      BITBUCKET_URL: "https://bitbucket.example.com",
      BITBUCKET_TOKEN: "test-token",
      BITBUCKET_DEFAULT_PROJECT: "DEFAULT",
    };

    // Reset mocks
    jest.clearAllMocks();

    // Configure axios mock - create a proper mock instance
    mockAxios = axios as jest.Mocked<typeof axios>;
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };
    mockAxios.create.mockReturnValue(
      mockAxiosInstance as unknown as AxiosInstance,
    );
  });

  afterEach(() => {
    // Restore environment variables
    process.env = originalEnv;
  });

  describe("Configuration", () => {
    test("should throw if BITBUCKET_URL is not defined", () => {
      // Arrange
      delete process.env.BITBUCKET_URL;
      // Act & Assert
      expect(() => {
        new BitbucketServer();
      }).toThrow("BITBUCKET_URL is required");
    });

    test("should throw if neither token nor credentials are provided", () => {
      // Arrange

      delete process.env.BITBUCKET_TOKEN;

      // Act & Assert
      expect(() => {
        new BitbucketServer();
      }).toThrow(
        "Either BITBUCKET_TOKEN or BITBUCKET_USERNAME/PASSWORD is required",
      );
    });

    test("should configure axios with token and read default project", () => {
      // Arrange
      const expectedConfig = {
        baseURL: "https://bitbucket.example.com/rest/api/1.0",
        headers: { Authorization: "Bearer test-token" },
      };

      // Act
      new BitbucketServer();

      // Assert
      expect(mockAxios.create).toHaveBeenCalledWith(
        expect.objectContaining(expectedConfig),
      );
    });
  });

  describe("Pull Request Operations", () => {
    test("should create a pull request with explicit project", async () => {
      // Arrange
      const input = {
        project: "TEST",
        repository: "repo",
        title: "Test PR",
        description: "Test description",
        sourceBranch: "feature",
        targetBranch: "main",
        reviewers: ["user1"],
      };
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });
      const server = new BitbucketServer();
      const result = await server.createPullRequest(input);

      // Assert
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/repo/pull-requests",
        expect.objectContaining({
          title: input.title,
          description: input.description,
          fromRef: expect.any(Object),
          toRef: expect.any(Object),
          reviewers: [{ user: { name: "user1" } }],
        }),
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ id: 1 });
    });

    test("should create a pull request using default project", async () => {
      // Arrange
      const input = {
        repository: "repo",
        title: "Test PR",
        description: "Test description",
        sourceBranch: "feature",
        targetBranch: "main",
        reviewers: ["user1"],
      };

      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 1 } });

      // Act
      const server = new BitbucketServer();
      const result = await server.createPullRequest(input);

      // Assert
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/projects/DEFAULT/repos/repo/pull-requests",
        expect.objectContaining({
          title: input.title,
          description: input.description,
          fromRef: expect.any(Object),
          toRef: expect.any(Object),
          reviewers: [{ user: { name: "user1" } }],
        }),
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ id: 1 });
    });

    test("should throw error when no project is provided or defaulted", async () => {
      // Arrange
      delete process.env.BITBUCKET_DEFAULT_PROJECT;
      const input = {
        repository: "repo",
        title: "Test PR",
        description: "Test description",
        sourceBranch: "feature",
        targetBranch: "main",
      };

      // Act
      const server = new BitbucketServer();

      // Act & Assert
      await expect(server.createPullRequest(input)).rejects.toThrow(
        new McpError(
          ErrorCode.InvalidParams,
          "Project must be provided either as a parameter or through BITBUCKET_DEFAULT_PROJECT environment variable",
        ),
      );
    });

    test("should merge a pull request", async () => {
      // Arrange
      const input = {
        project: "TEST",
        repository: "repo",
        prId: 1,
        message: "Merged PR",
        strategy: "squash" as const,
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { state: "MERGED" },
      });

      // Act
      const server = new BitbucketServer();
      const result = await server.mergePullRequest({
        project: input.project,
        repository: input.repository,
        prId: input.prId,
        message: input.message,
        strategy: input.strategy,
      });

      // Assert
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/repo/pull-requests/1/merge",
        expect.objectContaining({
          version: -1,
          message: input.message,
          strategy: input.strategy,
        }),
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ state: "MERGED" });
    });

    test("should handle API errors", async () => {
      // Arrange
      const input = {
        project: "TEST",
        repository: "repo",
        prId: 1,
      };

      // Create a proper axios error structure
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            message: "Not found",
          },
        },
        message: "Request failed with status code 404",
      };

      // Set up the mock to reject with our error
      mockAxiosInstance.get.mockRejectedValueOnce(axiosError);

      // Act & Assert
      const server = new BitbucketServer();

      try {
        await server.getPullRequest(input);
        // If we get here, no error was thrown
        throw new Error("Expected error was not thrown");
      } catch (caughtError: unknown) {
        // Check if the error has the expected structure
        expect(caughtError).toHaveProperty("isAxiosError", true);
        expect(caughtError).toHaveProperty(
          "response.data.message",
          "Not found",
        );
      }
    });
  });

  describe("Reviews and Comments", () => {
    test("should filter review activities", async () => {
      // Arrange
      const input = {
        project: "TEST",
        repository: "repo",
        prId: 1,
      };

      const activities = {
        values: [
          { action: "APPROVED", user: { name: "user1" } },
          { action: "COMMENTED", user: { name: "user2" } },
          { action: "REVIEWED", user: { name: "user3" } },
        ],
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: activities });

      // Act
      const server = new BitbucketServer();
      const result = await server.getReviews(input);

      // Assert
      const reviews = JSON.parse(result.content[0].text);
      expect(reviews).toHaveLength(2);
      expect(
        reviews.every((r: { action: string }) =>
          ["APPROVED", "REVIEWED"].includes(r.action),
        ),
      ).toBe(true);
    });

    test("should add comment with parent", async () => {
      // Arrange
      const input = {
        project: "TEST",
        repository: "repo",
        prId: 1,
        text: "Test comment",
        parentId: 123,
      };

      mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: 456 } });

      // Act
      const server = new BitbucketServer();
      const result = await server.addComment({
        project: input.project,
        repository: input.repository,
        prId: input.prId,
        text: input.text,
        parentId: input.parentId,
      });

      // Assert
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/projects/TEST/repos/repo/pull-requests/1/comments",
        {
          text: input.text,
          parent: { id: input.parentId },
        },
      );
      expect(JSON.parse(result.content[0].text)).toEqual({ id: 456 });
    });
  });
});
