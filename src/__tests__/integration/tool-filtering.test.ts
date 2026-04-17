import { describe, test, expect, afterAll, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../server.js";

/**
 * Call listTools, mapping the "tools capability not advertised" rejection to
 * an empty list. Any other error (transport failure, type error, etc.) is
 * rethrown so the test fails loudly instead of silently reporting "no tools".
 */
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

function connectServer(options: Record<string, unknown>) {
  return async () => {
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
    return { client, serverTransport };
  };
}

describe("readOnly mode", () => {
  let client: Client;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeAll(async () => {
    const conn = await connectServer({ readOnly: true })();
    client = conn.client;
    serverTransport = conn.serverTransport;
  });

  afterAll(async () => {
    await client.close();
    await serverTransport.close();
  });

  test("should exclude write tools", async () => {
    const { tools } = await client.listTools();
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
  let client: Client;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeAll(async () => {
    const conn = await connectServer({
      enabledTools: ["list_projects", "get_pull_request", "search"],
    })();
    client = conn.client;
    serverTransport = conn.serverTransport;
  });

  afterAll(async () => {
    await client.close();
    await serverTransport.close();
  });

  test("should only register the specified tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining(["list_projects", "get_pull_request", "search"]),
    );
    expect(names).toHaveLength(3);
  });
});

describe("default mode (no readOnly, no enabledTools)", () => {
  let client: Client;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeAll(async () => {
    const conn = await connectServer({})();
    client = conn.client;
    serverTransport = conn.serverTransport;
  });

  afterAll(async () => {
    await client.close();
    await serverTransport.close();
  });

  test("registers all tools including write ones", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    // Read tools
    expect(names).toContain("list_projects");
    expect(names).toContain("get_pull_request");
    // Write tools
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
    const conn = await connectServer(options)();
    try {
      const { tools } = await conn.client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(expected.sort());
    } finally {
      await conn.client.close();
      await conn.serverTransport.close();
    }
  });

  test("readOnly=true + only-write enabledTools exposes no tools", async () => {
    const conn = await connectServer({
      readOnly: true,
      enabledTools: ["create_pull_request", "merge_pull_request"],
    })();
    try {
      const toolNames = await listToolsOrEmpty(conn.client);
      expect(toolNames).toEqual([]);
    } finally {
      await conn.client.close();
      await conn.serverTransport.close();
    }
  });
});
