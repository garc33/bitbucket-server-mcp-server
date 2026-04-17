import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect } from "vitest";
import type { MockProxy } from "vitest-mock-extended";
import type { KyInstance } from "ky";
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

/**
 * Call a tool and return both the raw result and the parsed first text-content
 * block as JSON. Use this when the test needs to assert on `result.isError` or
 * inspect the raw text alongside the parsed payload.
 */
export async function callAndParseFull<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  result: Awaited<ReturnType<Client["callTool"]>>;
  text: string;
  parsed: T;
}> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0].text;
  return { result, text, parsed: JSON.parse(text) as T };
}

/**
 * Call a tool and return the raw result without parsing. Use this when the
 * test only cares about `result.isError` or the raw text (e.g. error paths).
 */
export async function callRaw(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  return client.callTool({ name, arguments: args });
}

/**
 * Assert that a ky mock was called with the given URL and (optionally) options
 * matching `expect.objectContaining(opts)`. Shortens the common pattern of
 * `toHaveBeenCalledWith(url, expect.objectContaining({...}))`.
 */
export function expectCalledWith<
  F extends MockProxy<KyInstance>[keyof KyInstance],
>(
  fn: F,
  url: string | ReturnType<typeof expect.stringContaining>,
  opts?: Record<string, unknown>,
): void {
  if (opts === undefined) {
    expect(fn).toHaveBeenCalledWith(url);
  } else {
    expect(fn).toHaveBeenCalledWith(url, expect.objectContaining(opts));
  }
}

/**
 * Assert that a ky mock was called with a URL and `searchParams` containing
 * all of `params`. Shortens the very common pattern:
 *   toHaveBeenCalledWith(url, expect.objectContaining({
 *     searchParams: expect.objectContaining({...})
 *   }))
 */
export function expectCalledWithSearchParams<
  F extends MockProxy<KyInstance>[keyof KyInstance],
>(
  fn: F,
  url: string | ReturnType<typeof expect.stringContaining>,
  params: Record<string, unknown>,
): void {
  expect(fn).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      searchParams: expect.objectContaining(params),
    }),
  );
}

/**
 * Assert that a ky mock was called with a URL and `json` body containing all
 * of `body`. Shortens:
 *   toHaveBeenCalledWith(url, expect.objectContaining({
 *     json: expect.objectContaining({...})
 *   }))
 */
export function expectCalledWithJson<
  F extends MockProxy<KyInstance>[keyof KyInstance],
>(
  fn: F,
  url: string | ReturnType<typeof expect.stringContaining>,
  body: Record<string, unknown>,
): void {
  expect(fn).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      json: expect.objectContaining(body),
    }),
  );
}
