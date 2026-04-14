import { describe, test, expect } from "vitest";
import { createApiClients } from "../../http/client.js";
import type { BitbucketConfig } from "../../types.js";

const config: BitbucketConfig = {
  baseUrl: "https://git.example.com",
  token: "test-token",
  readOnly: false,
  customHeaders: { "X-Custom": "value" },
  cacheTtlMs: 300_000,
};

describe("createApiClients", () => {
  test("should create all named client instances", () => {
    const clients = createApiClients(config);

    expect(clients.api).toBeDefined();
    expect(clients.insights).toBeDefined();
    expect(clients.search).toBeDefined();
    expect(clients.branchUtils).toBeDefined();
    expect(clients.defaultReviewers).toBeDefined();
  });

  test("should create clients with basic auth when no token", () => {
    const basicConfig: BitbucketConfig = {
      baseUrl: "https://git.example.com",
      username: "user",
      password: "pass",
      readOnly: false,
      customHeaders: {},
      cacheTtlMs: 300_000,
    };

    const clients = createApiClients(basicConfig);
    expect(clients.api).toBeDefined();
  });
});
