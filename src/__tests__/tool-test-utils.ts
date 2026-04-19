import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect } from "vitest";
import type { MockProxy } from "vitest-mock-extended";
import type { KyInstance } from "ky";
import { ToolContext, type ToolContextParams } from "../tools/shared.js";
import { ApiCache } from "../http/cache.js";
import { type MockApiClients, createMockClients } from "./test-utils.js";

export interface ToolTestContext {
  readonly client: Client;
  readonly mockClients: MockApiClients;
  readonly ctx: ToolContext;
}

export interface McpConnection extends AsyncDisposable {
  readonly client: Client;
}

export async function connectMcp(server: McpServer): Promise<McpConnection> {
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

/**
 * Build a standalone ToolContext for unit tests that do not need an MCP
 * client/server pair. Mirrors the construction inside `setupToolHarness` so
 * both entry points stay in sync.
 */
export function createTestToolContext(
  overrides: Partial<ToolContextParams> = {},
): ToolContext {
  return new ToolContext({
    server: new McpServer({ name: "test", version: "1.0.0" }),
    clients: createMockClients(),
    cache: new ApiCache({ defaultTtlMs: 100 }),
    ...overrides,
  });
}

/**
 * Spin up a fresh McpServer + Client pair with mocked API clients for each test.
 * The caller registers its tools against `harness.ctx` inside the register callback.
 *
 * IMPORTANT: must be called at describe() scope. It registers `beforeEach` and
 * `afterEach` hooks as a side effect; calling it from a helper or outside a
 * describe block would bind those hooks to the wrong scope (or to root scope).
 *
 * Usage:
 *   describe("Branch tools", () => {
 *     const h = setupToolHarness({
 *       register: registerBranchTools,
 *       defaultProject: "DEFAULT",
 *     });
 *     // inside tests:
 *     h.client.callTool(...)
 *     h.mockClients.api.get.mockReturnValueOnce(...)
 *   });
 */
export function setupToolHarness(options: {
  register: (ctx: ToolContext) => void;
  defaultProject?: string;
  maxLinesPerFile?: number;
  cacheTtlMs?: number;
}): ToolTestContext {
  const state = {
    server: undefined as McpServer | undefined,
    client: undefined as Client | undefined,
    conn: undefined as McpConnection | undefined,
    mockClients: undefined as MockApiClients | undefined,
    ctx: undefined as ToolContext | undefined,
  };

  beforeEach(async () => {
    state.mockClients = createMockClients();
    state.ctx = createTestToolContext({
      clients: state.mockClients,
      cache: new ApiCache({ defaultTtlMs: options.cacheTtlMs ?? 100 }),
      defaultProject: options.defaultProject,
      maxLinesPerFile: options.maxLinesPerFile,
    });
    state.server = state.ctx.server;
    options.register(state.ctx);

    state.conn = await connectMcp(state.ctx.server);
    state.client = state.conn.client;
  });

  afterEach(async () => {
    await state.conn?.[Symbol.asyncDispose]();
  });

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
 * Helpers below are sugar over `expect(fn).toHaveBeenCalledWith(url, expect.objectContaining({...}))`.
 * They cover the three common request shapes (plain options, searchParams, json body).
 *
 * When to fall back to a raw `toHaveBeenCalledWith`:
 *   - combined search params AND headers (build the matcher inline)
 *   - non-JSON bodies like FormData (use `expectCalledWith(fn, url, { body: expect.any(FormData) })`)
 *   - `.not.toHaveBeenCalled()` and similar negative assertions
 *
 * For strict equality on the json body (catches unexpected extra keys) use
 * `expectCalledWithStrictJson`; the default `expectCalledWithJson` only asserts
 * a subset so tool tests can lock the fields they care about.
 */

/**
 * Assert that a ky mock was called with the given URL and (optionally) options
 * matching `expect.objectContaining(opts)`. Values inside `opts` are matched
 * verbatim (use `expect.objectContaining`, `expect.any`, etc. explicitly when
 * needed for nested partial matches).
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
 * Assert that a ky mock was called with a URL and `json` body partially
 * matching `body`. Uses `expect.objectContaining` on the body so extra keys
 * sent by the code under test are ignored. Prefer `expectCalledWithStrictJson`
 * when the test should fail if the production code starts sending additional
 * fields (leak-sensitive endpoints, contract-shaped payloads).
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

/**
 * Stricter variant of `expectCalledWithJson`: asserts that `json` equals
 * `body` exactly. Use for endpoints where an extra unexpected field would be
 * a regression (e.g. credentials/config keys leaking into a request body).
 */
export function expectCalledWithStrictJson<
  F extends MockProxy<KyInstance>[keyof KyInstance],
>(
  fn: F,
  url: string | ReturnType<typeof expect.stringContaining>,
  body: Record<string, unknown>,
): void {
  expect(fn).toHaveBeenCalledWith(url, expect.objectContaining({ json: body }));
}
