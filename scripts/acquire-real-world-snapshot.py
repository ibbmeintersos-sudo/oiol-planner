#!/usr/bin/env python3
"""Acquire immutable public source snapshots for OIOL P12.

This script downloads and extracts source archives only. It never imports,
installs, builds, tests, or executes code from a target repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
INTAKE = ROOT / "benchmarks" / "real-world" / "intake-candidates.json"
IGNORED = {".git", "node_modules", ".venv", "venv", "vendor", "dist", "build", "coverage"}


def fingerprint(root: Path) -> dict:
    files = []
    for path in root.rglob("*"):
        if any(part in IGNORED for part in path.relative_to(root).parts):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        files.append((rel, path))
    files.sort(key=lambda item: item[0])
    digest = hashlib.sha256()
    for rel, path in files:
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return {"sha256": digest.hexdigest(), "fileCount": len(files)}


def safe_extract(archive: tarfile.TarFile, destination: Path) -> str:
    members = archive.getmembers()
    roots = {PurePosixPath(member.name).parts[0] for member in members if PurePosixPath(member.name).parts}
    if len(roots) != 1:
        raise ValueError("Archive must contain exactly one top-level directory")
    prefix = next(iter(roots))
    rewritten = []
    for member in members:
        parts = PurePosixPath(member.name).parts
        if not parts or parts[0] != prefix:
            raise ValueError("Unexpected archive path")
        relative = PurePosixPath(*parts[1:])
        if not relative.parts:
            continue
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Unsafe archive path")
        member.name = relative.as_posix()
        rewritten.append(member)
    archive.extractall(destination, members=rewritten, filter="data")
    return prefix


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-index", type=int, required=True, help="0-based index in intake-candidates.json candidates[]")
    parser.add_argument("--output", default="acquired")
    args = parser.parse_args()

    intake = json.loads(INTAKE.read_text(encoding="utf-8"))
    candidates = intake["candidates"]
    if args.case_index < 0 or args.case_index >= len(candidates):
        raise SystemExit("case-index is outside the primary candidate list")
    candidate = candidates[args.case_index]
    source = candidate["source"]
    change = candidate["change"]
    repository = source["repository"]
    base_sha = source["baseCommit"]
    if len(base_sha) != 40 or any(ch not in "0123456789abcdef" for ch in base_sha):
        raise SystemExit("Base commit is not an immutable full SHA")

    output_root = Path(args.output).resolve()
    case_dir = output_root / candidate["caseId"]
    snapshot = case_dir / "snapshot"
    case_dir.mkdir(parents=True, exist_ok=True)
    if snapshot.exists():
        raise SystemExit(f"Refusing to overwrite existing snapshot: {snapshot}")

    url = f"https://codeload.github.com/{repository}/tar.gz/{base_sha}"
    request = urllib.request.Request(url, headers={"User-Agent": "OIOL-P12-ReadOnly-Snapshot-Acquirer/1.0"})
    with tempfile.TemporaryFile() as archive_file:
        with urllib.request.urlopen(request, timeout=180) as response:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                archive_file.write(chunk)
        archive_file.seek(0)
        with tarfile.open(fileobj=archive_file, mode="r:gz") as archive:
            safe_extract(archive, snapshot)

    result = fingerprint(snapshot)
    license_path = snapshot / source["licenseFile"]
    if not license_path.is_file():
        raise SystemExit("Declared license file missing from pinned snapshot: " + source["licenseFile"])
    license_sha256 = hashlib.sha256(license_path.read_bytes()).hexdigest()
    metadata = {
        "schemaVersion": "1.0.0",
        "caseId": candidate["caseId"],
        "repository": repository,
        "repositoryUrl": source["repositoryUrl"],
        "baseCommit": base_sha,
        "changeCommit": source["changeCommit"],
        "pullRequest": change["pullRequest"],
        "changeUrl": change["url"],
        "license": source["license"],
        "licenseFile": source["licenseFile"],
        "licenseFileUrl": source["licenseFileUrl"],
        "sizeClass": source["sizeClass"],
        "trackedFileCountAtBase": source["trackedFileCountAtBase"],
        "primaryLanguages": source["primaryLanguages"],
        "snapshotPath": "snapshot",
        "snapshotSha256": result["sha256"],
        "snapshotFileCount": result["fileCount"],
        "trackedFileCountDelta": result["fileCount"] - source["trackedFileCountAtBase"],
        "licenseFileSha256": license_sha256,
        "archiveUrl": url,
        "acquiredAt": datetime.now(timezone.utc).isoformat(),
        "executionBoundary": "download-and-extract-only; target project code was not executed"
    }
    (case_dir / "snapshot-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
