import { vi } from "vitest";
import ky from "ky";
import type { ApiClients } from "../client.js";

export function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as ReturnType<typeof ky.create>;
}

export function createMockClients(): ApiClients {
  return {
    api: createMockClient(),
    insights: createMockClient(),
    search: createMockClient(),
    branchUtils: createMockClient(),
    defaultReviewers: createMockClient(),
  };
}

type MockFn = ReturnType<typeof vi.fn>;

export function mockJson(fn: unknown, response: unknown) {
  (fn as MockFn).mockReturnValueOnce({
    json: () => Promise.resolve(response),
  });
}

export function mockVoid(fn: unknown) {
  (fn as MockFn).mockReturnValue(Promise.resolve());
}
