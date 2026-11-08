# P12.2 — Pinned snapshot acquisition

## Scope

The first acquisition tranche contains the 12 primary candidates in the intake inventory: 4 small, 4 medium, and 4 large repositories. Each artifact contains the source tree at the exact historical PR base commit for its candidate, plus provenance metadata and a deterministic SHA-256 fingerprint.

This tranche is an acquisition and reproducibility check, not a completed 30-case benchmark. The additional historical candidates require their own exact base snapshots or a deduplicated multi-revision acquisition plan before they can be annotated.

## Acquisition and completeness

The GitHub Actions workflow `.github/workflows/p12-snapshot-acquisition.yml` runs a 12-entry matrix, with a maximum of four concurrent downloads.

The acquirer uses the codeload archive as a transport optimization, **not as the source of truth for completeness**. GitHub archive generation honors `.gitattributes export-ignore`, which can omit tracked files such as tests, tooling, and repository metadata. Therefore the acquirer:

1. Downloads the archive at the exact pinned base commit SHA and safely extracts it.
2. Resolves the commit's actual Git tree SHA through the GitHub API and requests the complete recursive tree.
3. Rejects truncated Git tree responses, unsafe paths, and archive paths absent from the pinned tree.
4. Compares every tracked blob path with the extracted archive and restores omitted regular blobs from `raw.githubusercontent.com` at the same immutable commit. Missing symlink blobs are restored from the Git blob API only after validating that the link target remains inside the snapshot.
5. Requires the final set of file and symlink paths to equal the pinned Git tree's blob path set exactly, and requires the Git tree blob count to equal the intake inventory's tracked-file count.
6. Verifies the declared license file, computes its SHA-256, and writes provenance metadata.

The script never imports, installs, builds, tests, or executes code from a target repository. Network access is limited to pinned GitHub archive, Git tree/blob, and raw-file retrieval.

## Read-only boundary

The acquisition job does not run Git, shell commands from target repositories, package managers, builds, tests, migrations, or application code. It only downloads, safely extracts, inventories, restores omitted tracked blobs, and hashes source files. OIOL's own tests and workflow actions are separate from target project contents.

## Integrity and fingerprint contract

Each `snapshot-metadata.json` records:
- repository URL, immutable base and change commits, and historical PR;
- license identifier, pinned license URL, and license-file SHA-256;
- archive URL, actual Git tree SHA, Git tree blob count, and restored/extra archive path counts;
- the complete snapshot path-set check against the pinned Git tree;
- `snapshotSha256` and `snapshotFileCount` using the exact fingerprint policy in `scripts/validate-real-world-corpus.mjs`;
- the delta between the Git tree blob count and the previously measured intake tracked-file count.

The fingerprint deliberately matches OIOL's corpus validator: sort relative paths, skip `.git`, `node_modules`, `.venv`, `venv`, `vendor`, `dist`, `build`, and `coverage` path components, skip symbolic links, then hash each included UTF-8 relative path, a NUL byte, the raw file bytes, and a NUL byte. This fingerprint file count is therefore not the same as the full Git tree blob count. The full tree path-set and count checks separately establish that the snapshot contains every tracked blob.

A non-zero `trackedFileCountDelta`, a non-zero archive-extra count, a truncated Git tree, or a path-set mismatch blocks acquisition. The archive-missing count is expected to be non-zero for repositories using `export-ignore`; those files must be restored and included in the final tree comparison.

The GitHub Actions artifact ZIP digest is a separate transport-integrity value. Preserve it alongside the snapshot fingerprint; do not treat the two hashes as interchangeable.

## Acceptance status

A case is eligible for annotation only after its workflow job succeeds and its metadata confirms exact Git tree path-set parity, zero tracked-file-count delta, valid license hash, and a reproducible snapshot fingerprint. The 30-case corpus remains blocked until all cases have two independent blinded annotations and adjudication where required.
