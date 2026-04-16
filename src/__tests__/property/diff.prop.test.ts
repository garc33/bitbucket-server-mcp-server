import { test, fc } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import { truncateDiff } from "../../diff.js";

const diffLine = fc.oneof(
  fc.constant("+added line"),
  fc.constant("-removed line"),
  fc.constant(" context line"),
);

const diffFile = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9/.-]+$/),
    fc.array(diffLine, { minLength: 1, maxLength: 200 }),
  )
  .map(([name, lines]) =>
    [
      `diff --git a/${name} b/${name}`,
      `index abc1234..def5678 100644`,
      `--- a/${name}`,
      `+++ b/${name}`,
      `@@ -1,${lines.length} +1,${lines.length} @@`,
      ...lines,
    ].join("\n"),
  );

describe("truncateDiff (property-based)", () => {
  test.prop([diffFile])(
    "maxLinesPerFile=0 should return the diff unchanged",
    (diff) => {
      expect(truncateDiff(diff, 0)).toBe(diff);
    },
  );

  test.prop([diffFile, fc.integer({ min: -100, max: 0 })])(
    "negative or zero maxLinesPerFile should return the diff unchanged",
    (diff, maxLines) => {
      expect(truncateDiff(diff, maxLines)).toBe(diff);
    },
  );

  test.prop([diffFile, fc.integer({ min: 1, max: 500 })])(
    "truncation marker presence should match whether content exceeds maxLines",
    (diff, maxLines) => {
      const result = truncateDiff(diff, maxLines);
      const contentLines = diff
        .split("\n")
        .filter(
          (l) =>
            !l.startsWith("diff --git") &&
            !l.startsWith("index ") &&
            !l.startsWith("---") &&
            !l.startsWith("+++") &&
            !l.startsWith("@@"),
        );
      const wasTruncated = result.includes("[*** FILE TRUNCATED:");
      const shouldTruncate = contentLines.length > maxLines;
      expect(wasTruncated).toBe(shouldTruncate);
    },
  );

  test.prop([
    fc
      .array(diffFile, { minLength: 2, maxLength: 5 })
      .map((files) => files.join("\n")),
    fc.integer({ min: 5, max: 50 }),
  ])(
    "should preserve all diff --git headers in multi-file diffs",
    (multiDiff, maxLines) => {
      const result = truncateDiff(multiDiff, maxLines);
      const originalHeaders = multiDiff
        .split("\n")
        .filter((l) => l.startsWith("diff --git"));
      const resultHeaders = result
        .split("\n")
        .filter((l) => l.startsWith("diff --git"));
      expect(resultHeaders).toEqual(originalHeaders);
    },
  );
});
