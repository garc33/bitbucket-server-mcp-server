import { describe, test, expect } from "vitest";
import type { Input } from "ky";
import { registerBranchTools } from "../../tools/branches.js";
import { fakeResponse, mockJson } from "../test-utils.js";
import {
  callAndParse,
  expectCalledWith,
  expectCalledWithSearchParams,
  setupToolHarness,
} from "../tool-test-utils.js";

describe("Branch tools", () => {
  const h = setupToolHarness({
    register: registerBranchTools,
    defaultProject: "DEFAULT",
  });

  describe("list_branches", () => {
    test("should list branches and include default branch", async () => {
      const branchesResponse = {
        values: [
          { displayId: "main", id: "refs/heads/main", isDefault: true },
          { displayId: "develop", id: "refs/heads/develop", isDefault: false },
        ],
        size: 2,
        isLastPage: true,
      };
      const defaultBranchResponse = {
        displayId: "main",
        id: "refs/heads/main",
      };

      h.mockClients.api.get.mockImplementation((url: Input) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({
            json: () => Promise.resolve(defaultBranchResponse),
          });
        }
        return fakeResponse({ json: () => Promise.resolve(branchesResponse) });
      });

      const parsed = await callAndParse<{
        total: number;
        branches: Array<{ displayId: string }>;
        defaultBranch: { displayId: string };
      }>(h.client, "list_branches", {
        project: "TEST",
        repository: "my-repo",
      });

      expect(parsed.total).toBe(2);
      expect(parsed.branches).toHaveLength(2);
      expect(parsed.branches[0].displayId).toBe("main");
      expect(parsed.defaultBranch.displayId).toBe("main");
    });

    test("should use default project when not provided", async () => {
      h.mockClients.api.get.mockImplementation((url: Input) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({ json: () => Promise.resolve(null) });
        }
        return fakeResponse({
          json: () =>
            Promise.resolve({ values: [], size: 0, isLastPage: true }),
        });
      });

      await callAndParse(h.client, "list_branches", { repository: "my-repo" });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/branches",
        expect.anything(),
      );
    });

    test("should return raw output when fields is '*all'", async () => {
      const branchesResponse = {
        values: [
          {
            displayId: "main",
            id: "refs/heads/main",
            isDefault: true,
            type: "BRANCH",
            latestCommit: "abc123",
            metadata: { someKey: "someValue" },
            extraField: "should be kept",
          },
        ],
        size: 1,
        isLastPage: true,
      };
      const defaultBranchResponse = {
        displayId: "main",
        id: "refs/heads/main",
        extraField: "also kept",
      };

      h.mockClients.api.get.mockImplementation((url: Input) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({
            json: () => Promise.resolve(defaultBranchResponse),
          });
        }
        return fakeResponse({ json: () => Promise.resolve(branchesResponse) });
      });

      const parsed = await callAndParse<{
        branches: Array<{ extraField: string }>;
        defaultBranch: { extraField: string };
      }>(h.client, "list_branches", {
        project: "TEST",
        repository: "my-repo",
        fields: "*all",
      });

      expect(parsed.branches[0].extraField).toBe("should be kept");
      expect(parsed.defaultBranch.extraField).toBe("also kept");
    });

    test("should handle default branch fetch failure gracefully", async () => {
      const branchesResponse = {
        values: [{ displayId: "main", id: "refs/heads/main" }],
        size: 1,
        isLastPage: true,
      };

      h.mockClients.api.get.mockImplementation((url: Input) => {
        if (String(url).includes("default-branch")) {
          return fakeResponse({
            json: () => Promise.reject(new Error("Not found")),
          });
        }
        return fakeResponse({ json: () => Promise.resolve(branchesResponse) });
      });

      const parsed = await callAndParse<{
        total: number;
        defaultBranch: unknown;
      }>(h.client, "list_branches", { project: "TEST", repository: "my-repo" });

      expect(parsed.total).toBe(1);
      expect(parsed.defaultBranch).toBeNull();
    });
  });

  describe("list_commits", () => {
    test("should list commits for a branch", async () => {
      const mockResponse = {
        values: [
          {
            id: "abc123",
            message: "Initial commit",
            author: { name: "john", displayName: "John Doe", slug: "jdoe" },
          },
          {
            id: "def456",
            message: "Second commit",
            author: { name: "jane", displayName: "Jane Smith", slug: "jsmith" },
          },
        ],
        size: 2,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        total: number;
        commits: Array<{ id: string }>;
      }>(h.client, "list_commits", {
        project: "TEST",
        repository: "my-repo",
        branch: "main",
      });

      expect(parsed.total).toBe(2);
      expect(parsed.commits).toHaveLength(2);
      expect(parsed.commits[0].id).toBe("abc123");

      expectCalledWithSearchParams(
        h.mockClients.api.get,
        "projects/TEST/repos/my-repo/commits",
        { until: "main" },
      );
    });

    test("should filter commits by author (case-insensitive)", async () => {
      const mockResponse = {
        values: [
          {
            id: "abc123",
            message: "First",
            author: { name: "john", displayName: "John Doe", slug: "jdoe" },
          },
          {
            id: "def456",
            message: "Second",
            author: { name: "jane", displayName: "Jane Smith", slug: "jsmith" },
          },
        ],
        size: 2,
        isLastPage: true,
      };

      mockJson(h.mockClients.api.get, mockResponse);

      const parsed = await callAndParse<{
        total: number;
        commits: Array<{ id: string }>;
      }>(h.client, "list_commits", {
        project: "TEST",
        repository: "my-repo",
        author: "JOHN",
      });

      expect(parsed.total).toBe(1);
      expect(parsed.commits).toHaveLength(1);
      expect(parsed.commits[0].id).toBe("abc123");
    });

    test("should use default project when not provided", async () => {
      mockJson(h.mockClients.api.get, {
        values: [],
        size: 0,
        isLastPage: true,
      });

      await callAndParse(h.client, "list_commits", { repository: "my-repo" });

      expect(h.mockClients.api.get).toHaveBeenCalledWith(
        "projects/DEFAULT/repos/my-repo/commits",
        expect.anything(),
      );
    });
  });

  describe("delete_branch", () => {
    test("should delete a non-default branch", async () => {
      mockJson(h.mockClients.api.get, {
        displayId: "main",
        id: "refs/heads/main",
      });
      mockJson(h.mockClients.branchUtils.post, {});

      const parsed = await callAndParse<{
        deleted: boolean;
        branch: string;
      }>(h.client, "delete_branch", {
        project: "TEST",
        repository: "my-repo",
        branch: "feature/old",
      });

      expect(parsed.deleted).toBe(true);
      expect(parsed.branch).toBe("feature/old");

      expect(h.mockClients.branchUtils.post).toHaveBeenCalledWith(
        "projects/TEST/repos/my-repo/branches",
        { json: { name: "refs/heads/feature/old", dryRun: false } },
      );
    });

    test("should refuse to delete the default branch", async () => {
      mockJson(h.mockClients.api.get, {
        displayId: "main",
        id: "refs/heads/main",
      });

      const result = await h.client.callTool({
        name: "delete_branch",
        arguments: { project: "TEST", repository: "my-repo", branch: "main" },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("Cannot delete the default branch");
      expect(result.isError).toBe(true);

      expect(h.mockClients.branchUtils.post).not.toHaveBeenCalled();
    });

    test("should use default project when not provided", async () => {
      mockJson(h.mockClients.api.get, {
        displayId: "main",
        id: "refs/heads/main",
      });
      mockJson(h.mockClients.branchUtils.post, {});

      await h.client.callTool({
        name: "delete_branch",
        arguments: { repository: "my-repo", branch: "feature/old" },
      });

      expectCalledWith(
        h.mockClients.api.get,
        "projects/DEFAULT/repos/my-repo/default-branch",
      );
    });
  });

  describe("list_branches (decision table: filterText x pagination)", () => {
    test.each([
      { filterText: "feature", limit: 10, start: 0 },
      { filterText: "fix", limit: 25, start: 50 },
      { filterText: undefined, limit: 1000, start: 0 },
    ])(
      "passes filterText=$filterText, limit=$limit, start=$start",
      async ({ filterText, limit, start }) => {
        mockJson(h.mockClients.api.get, { values: [], isLastPage: true });

        await h.client.callTool({
          name: "list_branches",
          arguments: { repository: "r", filterText, limit, start },
        });

        const callArgs = h.mockClients.api.get.mock.calls.find((c) =>
          String(c[0]).endsWith("/branches"),
        );
        const searchParams = (
          callArgs?.[1] as { searchParams: Record<string, unknown> }
        ).searchParams;
        expect(searchParams.limit).toBe(limit);
        expect(searchParams.start).toBe(start);
        if (filterText !== undefined) {
          expect(searchParams.filterText).toBe(filterText);
        }
      },
    );
  });

  describe("list_commits author filter (equivalence: case + partial match)", () => {
    const commitWithAuthor = (name: string, displayName?: string) => ({
      id: `sha${name}`,
      displayId: name,
      message: "c",
      authorTimestamp: 1,
      author: { name, displayName, emailAddress: `${name}@x.com` },
    });

    test.each<{ filter: string; expected: string[] }>([
      { filter: "alice", expected: ["alice"] },
      { filter: "ALICE", expected: ["alice"] }, // case-insensitive
      { filter: "Ali", expected: ["alice"] }, // partial match
      { filter: "Bob", expected: ["bob"] },
      { filter: "xyz", expected: [] }, // no match
    ])("filter '$filter' returns $expected", async ({ filter, expected }) => {
      mockJson(h.mockClients.api.get, {
        values: [
          commitWithAuthor("alice"),
          commitWithAuthor("bob"),
          commitWithAuthor("charlie"),
        ],
        isLastPage: true,
      });

      const parsed = await callAndParse<{
        commits: Array<{ author: { name: string } }>;
      }>(h.client, "list_commits", {
        repository: "r",
        author: filter,
        fields: "author.name",
      });
      const names = parsed.commits.map((c) => c.author.name);
      expect(names).toEqual(expected);
    });

    test("matches on displayName too", async () => {
      mockJson(h.mockClients.api.get, {
        values: [commitWithAuthor("user1", "Alice Smith")],
        isLastPage: true,
      });

      const parsed = await callAndParse<{ commits: unknown[] }>(
        h.client,
        "list_commits",
        { repository: "r", author: "smith" },
      );
      expect(parsed.commits).toHaveLength(1);
    });
  });
});
