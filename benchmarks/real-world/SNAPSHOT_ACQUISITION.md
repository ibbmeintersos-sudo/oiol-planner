# P12.2 — Pinned snapshot acquisition

## Scope

The first acquisition tranche contains the 12 primary candidates in the intake inventory: 4 small, 4 medium, and 4 large repositories. Each artifact contains the source tree at the exact historical PR base commit for its candidate, plus provenance metadata and a deterministic SHA-256 fingerprint.

This tranche is an acquisition and reproducibility check, not a completed 30-case benchmark. The additional historical candidates require their own exact base snapshots or a deduplicated multi-revision acquisition plan before they can be annotated.

## Execution

The GitHub Actions workflow `.github/workflows/p12-snapshot-acquisition.yml` runs a 12-entry matrix, with a maximum of four concurrent downloads. It downloads official codeload archives pinned by full commit SHA, safely extracts the source files, verifies that the declared license file exists, hashes the license file, fingerprints the extracted snapshot, and uploads one artifact per case.

Artifacts are named `p12-snapshot-<index>` and retained for 30 days. Download all 12 artifacts from the workflow run and preserve their `snapshot-metadata.json` files with the extracted trees.

## Read-only boundary

The acquisition job does not run Git, shell commands from target repositories, package managers, builds, tests, migrations, or application code. It only downloads, safely extracts, inventories, and hashes source files. OIOL's own workflow actions are separate from target project contents.

## Integrity

Each metadata file records:
- repository URL, immutable base and change commits, and historical PR;
- license identifier, pinned license URL, and license-file SHA-256;
- archive URL, extracted snapshot SHA-256, and regular-file count;
- the difference between extracted regular-file count and the previously measured Git tracked-file count.

A non-zero tracked-file count delta is a review signal, not something to silently normalize. Investigate symlinks, submodules, archive omissions, or inventory drift before accepting the snapshot. Recompute the snapshot fingerprint after artifact extraction using the same sorted relative-path/raw-byte algorithm used by `scripts/validate-real-world-corpus.mjs`.

## Acceptance status

Do not mark any case ready for annotation solely because its snapshot downloaded. Verify its commit, file-count delta, license file, archive integrity, and snapshot fingerprint first. The 30-case corpus remains blocked until all cases have two independent blinded annotations and adjudication where required.
