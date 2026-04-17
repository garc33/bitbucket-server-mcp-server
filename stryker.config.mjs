/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: ["src/**/*.ts", "!src/__tests__/**", "!src/generated/**"],
  reporters: ["html", "clear-text", "progress", "dashboard"],
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  dashboard: {
    project: "github.com/pavel-kalmykov/bitbucket-server-mcp",
    version: process.env.GITHUB_REF_NAME || "main",
  },
};
export default config;
