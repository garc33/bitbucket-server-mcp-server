import { test, fc } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { curateResponse, curateList } from "../../response/curate.js";

const arbitraryObject = fc.dictionary(
  fc.stringMatching(/^[a-z][a-zA-Z0-9]*$/),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
);

describe("curateResponse (property-based)", () => {
  test.prop([arbitraryObject])(
    "*all should return the original object unchanged",
    (data) => {
      expect(curateResponse(data, "*all")).toEqual(data);
    },
  );

  test.prop([arbitraryObject])(
    "empty fields should return empty object",
    (data) => {
      expect(curateResponse(data, "")).toEqual({});
    },
  );

  test.prop([
    fc.dictionary(
      fc.stringMatching(/^[a-z][a-zA-Z0-9]*$/),
      fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
      { minKeys: 1 },
    ),
  ])("curated result should contain exactly the requested keys", (data) => {
    const keys = Object.keys(data);
    const requestedKeys = keys.slice(0, Math.ceil(keys.length / 2));
    const result = curateResponse(data, requestedKeys.join(","));
    // Bidirectional: requested keys must be present, and nothing else.
    expect(Object.keys(result).sort()).toEqual([...requestedKeys].sort());
  });

  test.prop([arbitraryObject])(
    "requesting non-existent fields should produce empty object",
    (data) => {
      const result = curateResponse(data, "nonExistentField123");
      expect(result).toEqual({});
    },
  );

  test.prop([fc.array(arbitraryObject, { minLength: 0, maxLength: 10 })])(
    "curateList with *all should return the original array",
    (items) => {
      expect(curateList(items, "*all")).toEqual(items);
    },
  );

  test.prop([
    fc.record({
      id: fc.integer(),
      title: fc.string(),
      author: fc.record({
        name: fc.string(),
        email: fc.string(),
        internal: fc.string(),
      }),
    }),
  ])(
    "nested field picking should extract sub-paths and discard others",
    (data) => {
      const result = curateResponse(
        data as unknown as Record<string, unknown>,
        "id,author.name,author.email",
      );
      expect(result).toHaveProperty("id", data.id);
      expect(result).toHaveProperty("author");
      const author = result.author as Record<string, unknown>;
      expect(author).toHaveProperty("name", data.author.name);
      expect(author).toHaveProperty("email", data.author.email);
      expect(author).not.toHaveProperty("internal");
      expect(result).not.toHaveProperty("title");
    },
  );

  test.prop([
    fc.array(
      fc.record({
        name: fc.string(),
        status: fc.string(),
        secret: fc.string(),
      }),
      { minLength: 1, maxLength: 5 },
    ),
  ])(
    "array elements should have sub-fields picked individually",
    (reviewers) => {
      const data = { reviewers } as unknown as Record<string, unknown>;
      const result = curateResponse(data, "reviewers.name,reviewers.status");
      // Whole-shape equality: one failure pinpoints the whole diff instead
      // of reporting an element-by-element assertion buried in a forEach.
      expect(result.reviewers).toEqual(
        reviewers.map(({ name, status }) => ({ name, status })),
      );
    },
  );
});
