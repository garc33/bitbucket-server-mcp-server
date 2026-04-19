import { describe, test, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../server.js";

async function connectServer(options: Record<string, unknown>) {
  const { server } = createServer({
    baseUrl: "http://localhost",
    token: "fake",
    ...options,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    async [Symbol.asyncDispose]() {
      await client.close();
      await serverTransport.close();
      await server.close?.();
    },
  };
}

async function listToolsOrEmpty(client: Client): Promise<string[]> {
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } catch (err) {
    let message = "";
    if (err instanceof Error) message = err.message;
    else if (typeof err === "string") message = err;
    const code = (err as { code?: number }).code;
    if (code === -32601 || /method not found/i.test(message)) {
      return [];
    }
    throw err;
  }
}

describe("readOnly mode", () => {
  test("should exclude write tools", async () => {
    await using conn = await connectServer({ readOnly: true });
    const { tools } = await conn.client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("list_projects");
    expect(names).toContain("get_pull_request");
    expect(names).toContain("get_diff");
    expect(names).toContain("search");

    expect(names).not.toContain("create_pull_request");
    expect(names).not.toContain("update_pull_request");
    expect(names).not.toContain("merge_pull_request");
    expect(names).not.toContain("decline_pull_request");
    expect(names).not.toContain("manage_comment");
    expect(names).not.toContain("submit_review");
    expect(names).not.toContain("delete_branch");
    expect(names).not.toContain("upload_attachment");
  });
});

describe("enabledTools filter", () => {
  test("should only register the specified tools", async () => {
    await using conn = await connectServer({
      enabledTools: ["list_projects", "get_pull_request", "search"],
    });
    const { tools } = await conn.client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining(["list_projects", "get_pull_request", "search"]),
    );
    expect(names).toHaveLength(3);
  });
});

describe("default mode (no readOnly, no enabledTools)", () => {
  test("registers all tools including write ones", async () => {
    await using conn = await connectServer({});
    const { tools } = await conn.client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("list_projects");
    expect(names).toContain("get_pull_request");
    expect(names).toContain("create_pull_request");
    expect(names).toContain("update_pull_request");
    expect(names).toContain("merge_pull_request");
    expect(names).toContain("decline_pull_request");
    expect(names).toContain("manage_comment");
    expect(names).toContain("submit_review");
    expect(names).toContain("delete_branch");
    expect(names).toContain("upload_attachment");
  });
});

describe("readOnly + enabledTools combined (decision table)", () => {
  test.each<{
    name: string;
    options: Record<string, unknown>;
    expected: string[];
  }>([
    {
      name: "readOnly=true + enabledTools read-only subset",
      options: {
        readOnly: true,
        enabledTools: ["list_projects", "search"],
      },
      expected: ["list_projects", "search"],
    },
    {
      name: "readOnly=true + enabledTools mix (filters out write)",
      options: {
        readOnly: true,
        enabledTools: ["list_projects", "create_pull_request", "search"],
      },
      expected: ["list_projects", "search"],
    },
    {
      name: "readOnly=false + enabledTools with write tools",
      options: {
        readOnly: false,
        enabledTools: ["create_pull_request", "merge_pull_request"],
      },
      expected: ["create_pull_request", "merge_pull_request"],
    },
  ])("$name", async ({ options, expected }) => {
    await using conn = await connectServer(options);
    const { tools } = await conn.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(expected.sort());
  });

  test("readOnly=true + only-write enabledTools exposes no tools", async () => {
    await using conn = await connectServer({
      readOnly: true,
      enabledTools: ["create_pull_request", "merge_pull_request"],
    });
    const toolNames = await listToolsOrEmpty(conn.client);
    expect(toolNames).toEqual([]);
  });
});

describe("server identity", () => {
  test("server name is bitbucket-server-mcp", async () => {
    await using conn = await connectServer({});
    const info = await conn.client.getServerVersion();
    expect(info?.name).toBe("bitbucket-server-mcp");
  });

  test("server exposes instructions with workflow tips", async () => {
    await using conn = await connectServer({});
    const instructions = await conn.client.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions!.length).toBeGreaterThan(100);
    expect(instructions).toContain("list_projects");
    expect(instructions).toContain("manage_comment");
    expect(instructions).toContain("submit_review");
    expect(instructions).toContain("BITBUCKET_DEFAULT_PROJECT");
  });
});
