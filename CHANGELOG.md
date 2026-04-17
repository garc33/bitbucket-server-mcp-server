## [0.6.2](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.6.1...v0.6.2) (2026-04-17)


### Bug Fixes

* send empty json body on approve to make ky set Content-Type ([fcefe5c](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/fcefe5ceae1f13eda6ba65a6352d05b01911d254))

## [0.6.1](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.6.0...v0.6.1) (2026-04-16)


### Bug Fixes

* curate search response with curateList ([ae8d101](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/ae8d101547a84ce127bd699c885403a8a02eb3f8))
* use POST method for search API ([8749c7c](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/8749c7cbb9716f71fbe31a8551ad9a99b730a800))

# [0.6.0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.5.0...v0.6.0) (2026-04-15)


### Features

* expose diffType, fileType, and lineType options for inline comments ([4112aa2](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/4112aa2b161e002e1122d652c3cd3e7a08ea936c))

# [0.5.0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.4.1...v0.5.0) (2026-04-15)


### Features

* add get_server_info tool and update requirements to 8.5+ ([3db9d0c](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/3db9d0cc8cad587c12018b2598cc54f61e2e43c1))
* generate API types from official Bitbucket OpenAPI spec ([2afc992](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/2afc992422a3ddb8c128b6501dd9db9e850aef76))

## [0.4.1](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.4.0...v0.4.1) (2026-04-15)

# [0.4.0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.3.0...v0.4.0) (2026-04-14)


### Bug Fixes

* add pagination to get_pr_activity and file-level diff support ([512c265](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/512c265e31210d62555ad6c9f552dffaceed402e))


### Features

* add comment reactions and emoticon search ([bd22333](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/bd22333fa7758a1aa3ab5053334286ee3fb1356a))
* add excludeUsers filter to get_pr_activity ([b27b7d9](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/b27b7d9e5a955237da9b5d1f7f20f53239384b7d))

# [0.3.0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.2.1...v0.3.0) (2026-04-14)


### Features

* enforce readOnly and enabledTools config options ([a351592](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/a351592c8b4b5f16b4de579c97060d60fb5eeea0))

## [0.2.1](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.2.0...v0.2.1) (2026-04-14)

# [0.2.0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.1.6...v0.2.0) (2026-04-13)


### Bug Fixes

* preserve repository info in toRef when updating cross-repo PRs ([4fa3280](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/4fa3280a35ea7fae862d654167df026910805344))
* set executable permissions on husky hooks ([6fa99a0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/6fa99a05f55b4a04a00eaadc82fe7d9cb388e3bd))


### Features

* add get_build_status tool for CI build results ([f6a71b7](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/f6a71b7a22ba3c5b56305f33e0a55341804f01eb))
* add stat mode to get_diff for lightweight change summary ([4c7753c](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/4c7753c34fb201763b2980a9de106e5060b6fc22))

## [0.1.6](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.1.5...v0.1.6) (2026-04-10)


### Bug Fixes

* merge strategy + feat: resolve comments + refactor: prompt ([#15](https://github.com/pavel-kalmykov/bitbucket-server-mcp/issues/15)) ([2eb0c68](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/2eb0c68a07ad574fad8f76ab948a95c4c9cae4c0))

## [0.1.5](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.1.4...v0.1.5) (2026-04-10)


### Bug Fixes

* coerce numeric params, add upload_attachment, complete annotations ([#14](https://github.com/pavel-kalmykov/bitbucket-server-mcp/issues/14)) ([3bf5ed7](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/3bf5ed79e9cef534ad249a124ac95b64c0bebd78))

## [0.1.4](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.1.3...v0.1.4) (2026-04-08)


### Bug Fixes

* **ci:** concurrency and branch protection for releases ([#13](https://github.com/pavel-kalmykov/bitbucket-server-mcp/issues/13)) ([82cb833](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/82cb83306f9818c6525f8210b2415f01d6733792))
* **ci:** include all release types in notes + clean CHANGELOG ([#12](https://github.com/pavel-kalmykov/bitbucket-server-mcp/issues/12)) ([82fd268](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/82fd2688be08ed074f03841de77766c3b089d6c9))
* **ci:** move PR previews to GitHub Packages for full lifecycle control ([#11](https://github.com/pavel-kalmykov/bitbucket-server-mcp/issues/11)) ([f02304a](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/f02304ab64f879575115d2d985378908d5cfa18e)), closes [npm/cli#8547](https://github.com/npm/cli/issues/8547)

## [0.1.3](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.1.2...v0.1.3) (2026-04-08)

## [0.1.1](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.1.0...v0.1.1) (2026-04-07)


### Bug Fixes

* tag Docker image with release version instead of commit SHA ([29d3610](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/29d36103ede1011f176d8f4ecfb0e5d3128ca9b6))

# [0.1.0](https://github.com/pavel-kalmykov/bitbucket-server-mcp/compare/v0.0.1...v0.1.0) (2026-04-07)


### Features

* complete MCP server redesign with modular architecture ([#9](https://github.com/pavel-kalmykov/bitbucket-server-mcp/issues/9)) ([9825222](https://github.com/pavel-kalmykov/bitbucket-server-mcp/commit/9825222dcac8dfaecbc3fabae0d89e50ea9d74cd))
