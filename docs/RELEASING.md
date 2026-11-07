# Release process

## Version lines

The repository changelog records the progression from 0.4.0 to 0.4.1 and then 0.5.0. The release policy going forward is:

- Patch (0.5.x): backward-compatible fixes, reliability improvements, and documentation corrections.
- Minor (0.6.0, then 0.7.0, etc.): additive capabilities and optional integrations that preserve existing plan consumers where practical.
- Major (1.0.0): a breaking public contract or a deliberate change to OIOL's product boundary.

Because the package is still in the 0.x series, a minor release may introduce changes that would normally need a major release after 1.0. Keep those changes documented and migration steps explicit.

## Release checklist

1. Ensure [Unreleased] in CHANGELOG.md describes user-visible changes and any migration notes.
2. Run npm ci, npm run check, npm test, npm run benchmark:scanner, and npm run release:check.
3. Confirm package.json and package-lock.json versions match.
4. Confirm the newest stable changelog heading matches the currently released package version.
5. If the plan schema changes, update SCHEMA_VERSION and CONTRACT_VERSION, publish a new immutable schema snapshot, retain old snapshots, and test old/new plan validation.
6. Move the release notes out of [Unreleased] into a versioned section and update the package version and lockfile together.
7. Tag the release as v<package-version> only after the release PR is reviewed and merged.
8. Publish release notes that state test coverage, scanner measurement scope, known limitations, and whether a live provider benchmark/human review was actually completed.

## Schema versioning is independent

Package releases do not automatically change the plan schema. Schema patch/minor/major semantics are documented in schemas/README.md. Keep versioned schema snapshots immutable even if a later package release fixes validator implementation bugs.
