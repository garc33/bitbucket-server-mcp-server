import { describe, test, expect } from "vitest";
import {
  curateResponse,
  DEFAULT_PR_FIELDS,
  DEFAULT_PROJECT_FIELDS,
  DEFAULT_REPOSITORY_FIELDS,
  DEFAULT_BRANCH_FIELDS,
  DEFAULT_COMMIT_FIELDS,
} from "../../response/curate.js";

describe("curateResponse", () => {
  const fullPr = {
    id: 42,
    version: 3,
    title: "fix: something",
    description: "Fixes the thing",
    state: "OPEN",
    open: true,
    closed: false,
    createdDate: 1700000000000,
    updatedDate: 1700001000000,
    fromRef: {
      id: "refs/heads/feature/fix",
      displayId: "feature/fix",
      latestCommit: "abc123",
      type: "BRANCH",
      repository: {
        slug: "my-repo",
        id: 100,
        name: "my-repo",
        project: {
          key: "PROJ",
          id: 1,
          name: "Project",
          links: { self: [{ href: "..." }] },
        },
        links: {
          clone: [{ href: "ssh://...", name: "ssh" }],
          self: [{ href: "..." }],
        },
      },
    },
    toRef: {
      id: "refs/heads/main",
      displayId: "main",
      latestCommit: "def456",
      type: "BRANCH",
      repository: {
        slug: "my-repo",
        id: 100,
        name: "my-repo",
        project: {
          key: "PROJ",
          id: 1,
          name: "Project",
          links: { self: [{ href: "..." }] },
        },
        links: {
          clone: [{ href: "ssh://...", name: "ssh" }],
          self: [{ href: "..." }],
        },
      },
    },
    author: {
      user: {
        name: "alice",
        displayName: "Alice Smith",
        emailAddress: "alice@example.com",
        id: 1,
        slug: "alice",
        type: "NORMAL",
        links: { self: [{ href: "..." }] },
      },
      role: "AUTHOR",
      approved: false,
      status: "UNAPPROVED",
    },
    reviewers: [
      {
        user: {
          name: "bob",
          displayName: "Bob Jones",
          id: 2,
          slug: "bob",
          type: "NORMAL",
          links: { self: [{ href: "..." }] },
        },
        role: "REVIEWER",
        approved: true,
        status: "APPROVED",
      },
      {
        user: {
          name: "charlie",
          displayName: "Charlie Brown",
          id: 3,
          slug: "charlie",
          type: "NORMAL",
          links: { self: [{ href: "..." }] },
        },
        role: "REVIEWER",
        approved: false,
        status: "NEEDS_WORK",
      },
    ],
    participants: [],
    properties: {
      mergeResult: { outcome: "CLEAN", current: true },
      commentCount: 5,
      openTaskCount: 1,
    },
    links: {
      self: [
        {
          href: "https://git.example.com/projects/PROJ/repos/my-repo/pull-requests/42",
        },
      ],
    },
    locked: false,
  };

  test("should curate PR with default fields", () => {
    const result = curateResponse(fullPr, DEFAULT_PR_FIELDS);

    expect(result.id).toBe(42);
    expect(result.title).toBe("fix: something");
    expect(result.state).toBe("OPEN");
    expect(result.author).toBeDefined();
    expect(result.reviewers).toBeDefined();
    // Should NOT have deeply nested objects
    expect(
      (result.fromRef as Record<string, unknown>)?.repository,
    ).toBeUndefined();
    expect(
      (result.toRef as Record<string, unknown>)?.repository,
    ).toBeUndefined();
    // Should NOT have links
    expect(result.links).toBeUndefined();
  });

  test("should return all fields with '*all'", () => {
    const result = curateResponse(fullPr, "*all");

    expect(result).toEqual(fullPr);
  });

  test("should return only specified fields", () => {
    const result = curateResponse(fullPr, "id,title,state");

    expect(result.id).toBe(42);
    expect(result.title).toBe("fix: something");
    expect(result.state).toBe("OPEN");
    expect(Object.keys(result)).toEqual(["id", "title", "state"]);
  });

  test("should handle nested field paths", () => {
    const result = curateResponse(
      fullPr,
      "id,author.user.name,fromRef.displayId",
    );

    expect(result.id).toBe(42);
    const author = result.author as Record<string, unknown>;
    const authorUser = author?.user as Record<string, unknown>;
    expect(authorUser?.name).toBe("alice");
    expect((result.fromRef as Record<string, unknown>)?.displayId).toBe(
      "feature/fix",
    );
    expect(authorUser?.displayName).toBeUndefined();
  });

  test("should return empty object for non-existent fields", () => {
    const result = curateResponse(fullPr, "nonexistent");

    expect(result.nonexistent).toBeUndefined();
  });

  test("should handle arrays in default field sets", () => {
    const result = curateResponse(fullPr, DEFAULT_PR_FIELDS);

    expect(Array.isArray(result.reviewers)).toBe(true);
    const reviewers = result.reviewers as Record<string, unknown>[];
    expect((reviewers[0].user as Record<string, unknown>)?.name).toBeDefined();
    expect(reviewers[0].status).toBeDefined();
  });
});

describe("default field sets exist", () => {
  test("PR fields should include essential fields", () => {
    expect(DEFAULT_PR_FIELDS).toContain("id");
    expect(DEFAULT_PR_FIELDS).toContain("title");
    expect(DEFAULT_PR_FIELDS).toContain("state");
    expect(DEFAULT_PR_FIELDS).toContain("author");
  });

  test("project fields should include key and name", () => {
    expect(DEFAULT_PROJECT_FIELDS).toContain("key");
    expect(DEFAULT_PROJECT_FIELDS).toContain("name");
  });

  test("repository fields should include slug", () => {
    expect(DEFAULT_REPOSITORY_FIELDS).toContain("slug");
  });

  test("branch fields should include displayId", () => {
    expect(DEFAULT_BRANCH_FIELDS).toContain("displayId");
  });

  test("commit fields should include id and message", () => {
    expect(DEFAULT_COMMIT_FIELDS).toContain("id");
    expect(DEFAULT_COMMIT_FIELDS).toContain("message");
  });
});
