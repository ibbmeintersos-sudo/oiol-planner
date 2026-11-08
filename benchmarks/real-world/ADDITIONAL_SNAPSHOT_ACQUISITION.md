# P12.3 — Additional snapshot acquisition

The first 12 primary cases are already acquired and recorded in `acquisition-report.json`. The intake contains 24 further historical changes. These 24 changes require 22 additional unique snapshots because two pairs of cases share an identical repository and base commit:

- Pydantic cases 4 and 21 share base `9895381aa55eb2a1e74079f0b4fb745d1ea12d12`.
- ripgrep cases 18 and 19 share base `6892bc2b7efe5909cbbeec8f757ed2c4c76b1d30`.

The acquisition matrix therefore uses candidate indices 12–35 excluding 19 and 21. The mapping is explicit in [additional-snapshot-batch.json](./additional-snapshot-batch.json). This produces 34 unique repository/base snapshots for 36 change cases. Sharing a snapshot does not share annotations: each change case still requires its own two independent reviews and adjudication.

The workflow `.github/workflows/p12-additional-snapshot-acquisition.yml` runs at most two jobs concurrently because the remaining batch includes large repositories. It uses the same downloader, pinned-tree completeness checks, fingerprint policy, license validation, and eight regression tests as the primary batch. Artifacts are named `p12-snapshot-<candidate-index>`.

Do not mark the additional batch complete until all 22 jobs succeed, all 22 artifacts are present, their metadata matches the pinned intake records, and their GitHub upload digests match the Artifacts API. This remains acquisition only; it does not create ground truth or run OIOL against target repositories.
