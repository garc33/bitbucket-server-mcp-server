import { type MockProxy, mock } from "vitest-mock-extended";
import type { KyInstance } from "ky";
import type { KyResponse, ResponsePromise } from "ky";
import type { ApiClients } from "../client.js";

export type MockApiClients = {
  [K in keyof ApiClients]: MockProxy<ApiClients[K]>;
};

export function createMockClients(): MockApiClients {
  return {
    api: mock<KyInstance>(),
    buildStatus: mock<KyInstance>(),
    insights: mock<KyInstance>(),
    search: mock<KyInstance>(),
    branchUtils: mock<KyInstance>(),
    defaultReviewers: mock<KyInstance>(),
  };
}

export function fakeResponse<T>(overrides: {
  json?: () => Promise<T>;
  text?: () => Promise<string>;
}): ResponsePromise<T> {
  const noop = () => Promise.resolve();
  return Object.assign(Promise.resolve(new Response() as KyResponse<T>), {
    json: overrides.json ?? (noop as () => Promise<T>),
    text: overrides.text ?? (() => Promise.resolve("")),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  }) as ResponsePromise<T>;
}

export function mockJson<T>(fn: MockProxy<KyInstance>["get"], response: T) {
  fn.mockReturnValueOnce(
    fakeResponse({ json: () => Promise.resolve(response) }),
  );
}

export function mockText(fn: MockProxy<KyInstance>["get"], text: string) {
  fn.mockReturnValueOnce(fakeResponse({ text: () => Promise.resolve(text) }));
}

export function mockVoid(fn: MockProxy<KyInstance>["delete"]) {
  fn.mockReturnValue(fakeResponse({}));
}

export function mockError(fn: MockProxy<KyInstance>["get"], error: Error) {
  fn.mockReturnValue(fakeResponse({ json: () => Promise.reject(error) }));
}
