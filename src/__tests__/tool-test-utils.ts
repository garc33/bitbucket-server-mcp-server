import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach } from "vitest";
import { ToolContext } from "../tools/shared.js";
import { ApiCache } from "../http/cache.js";
import { type MockApiClients, createMockClients } from "./test-utils.js";

export interface ToolTestContext {
  readonly client: Client;
  readonly mockClients: MockApiClients;
  readonly ctx: ToolContext;
}

/**
 * Spin up a fresh McpServer + Client pair with mocked API clients for each test.
 * The caller registers its tools against `harness.ctx` inside the register callback.
 *
 * Usage:
 *   const harness = setupToolHarness({
 *     register: (ctx) => registerBranchTools(ctx),
 *     defaultProject: "DEFAULT",
 *   });
 *   // inside tests:
 *   harness.client.callTool(...)
 *   harness.mockClients.api.get.mockReturnValueOnce(...)
 */
export function setupToolHarness(options: {
  register: (ctx: ToolContext) => void;
  defaultProject?: string;
  maxLinesPerFile?: number;
  cacheTtlMs?: number;
}): ToolTestContext {
  // Backing fields; updated in beforeEach.
  const state = {
    server: undefined as McpServer | undefined,
    client: undefined as Client | undefined,
    serverTransport: undefined as
      | ReturnType<typeof InMemoryTransport.createLinkedPair>[1]
      | undefined,
    mockClients: undefined as MockApiClients | undefined,
    ctx: undefined as ToolContext | undefined,
  };

  beforeEach(async () => {
    state.server = new McpServer({ name: "test", version: "1.0.0" });
    state.mockClients = createMockClients();
    const cache = new ApiCache({ defaultTtlMs: options.cacheTtlMs ?? 100 });
    state.ctx = new ToolContext({
      server: state.server,
      clients: state.mockClients,
      cache,
      defaultProject: options.defaultProject,
      maxLinesPerFile: options.maxLinesPerFile,
    });
    options.register(state.ctx);

    const [clientTransport, sTransport] = InMemoryTransport.createLinkedPair();
    state.serverTransport = sTransport;
    state.client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} },
    );
    await Promise.all([
      state.server.connect(sTransport),
      state.client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await state.client?.close();
    await state.serverTransport?.close();
  });

  // Proxy so `harness.client` always points to the current-test instance.
  return {
    get client() {
      return state.client!;
    },
    get mockClients() {
      return state.mockClients!;
    },
    get ctx() {
      return state.ctx!;
    },
  };
}

/**
 * Call a tool and parse its first text-content block as JSON.
 */
export async function callAndParse<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as T;
}
