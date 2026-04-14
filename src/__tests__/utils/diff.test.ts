import { describe, test, expect } from "vitest";
import { truncateDiff } from "../../diff.js";

const SMALL_DIFF = [
  "diff --git a/file.ts b/file.ts",
  "index abc..def 100644",
  "--- a/file.ts",
  "+++ b/file.ts",
  "@@ -1,3 +1,3 @@",
  " line1",
  "-old",
  "+new",
  " line3",
].join("\n");

describe("truncateDiff", () => {
  test("should return diff unchanged when maxLines is 0", () => {
    expect(truncateDiff(SMALL_DIFF, 0)).toBe(SMALL_DIFF);
  });

  test("should return diff unchanged when maxLines is negative", () => {
    expect(truncateDiff(SMALL_DIFF, -1)).toBe(SMALL_DIFF);
  });

  test("should return diff unchanged when within limit", () => {
    expect(truncateDiff(SMALL_DIFF, 100)).toBe(SMALL_DIFF);
  });

  test("should truncate file sections that exceed maxLines", () => {
    const lines = [
      "diff --git a/big.ts b/big.ts",
      "index abc..def",
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,50 +1,50 @@",
    ];
    for (let i = 0; i < 50; i++) {
      lines.push(`+line ${i}`);
    }
    const bigDiff = lines.join("\n");

    const result = truncateDiff(bigDiff, 10);

    expect(result).toContain("FILE TRUNCATED");
    expect(result).toContain("big.ts");
    expect(result).toContain("maxLinesPerFile=0");
  });

  test("should preserve file headers even when truncating", () => {
    const lines = [
      "diff --git a/f.ts b/f.ts",
      "index abc..def",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,20 +1,20 @@",
    ];
    for (let i = 0; i < 20; i++) lines.push(`+line ${i}`);

    const result = truncateDiff(lines.join("\n"), 5);

    expect(result).toContain("diff --git a/f.ts b/f.ts");
    expect(result).toContain("--- a/f.ts");
    expect(result).toContain("+++ b/f.ts");
  });

  test("should handle multiple files", () => {
    const lines = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,3 +1,3 @@",
      "+short",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,30 +1,30 @@",
    ];
    for (let i = 0; i < 30; i++) lines.push(`+long line ${i}`);

    const result = truncateDiff(lines.join("\n"), 10);

    expect(result).toContain("+short");
    expect(result).toContain("FILE TRUNCATED");
    expect(result).toContain("b.ts");
  });
});
