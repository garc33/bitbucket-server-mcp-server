/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: ["src/**/*.ts", "!src/__tests__/**", "!src/generated/**"],
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
};
export default config;
