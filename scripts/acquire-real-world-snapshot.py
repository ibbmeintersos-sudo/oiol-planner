#!/usr/bin/env python3
"""Acquire complete immutable public source snapshots for OIOL P12.

GitHub codeload archives can honor .gitattributes export-ignore and omit
tracked files. This tool restores omitted Git blobs from raw.githubusercontent.com
using the exact pinned base commit. It never imports, installs, builds, tests,
or executes code from a target repository.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import tempfile
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
INTAKE = ROOT / "benchmarks" / "real-world" / "intake-candidates.json"
USER_AGENT = "OIOL-P12-ReadOnly-Snapshot-Acquirer/1.0"
DOWNLOAD_WORKERS = 8
FINGERPRINT_IGNORED = {".git", "node_modules", ".venv", "venv", "vendor", "dist", "build", "coverage"}


def load_candidates() -> list[dict]:
    intake = json.loads(INTAKE.read_text(encoding="utf-8"))
    return intake["candidates"] + intake.get("additionalChangeCandidates", [])


def validate_repo_path(value: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value:
        raise ValueError(f"Unsafe Git tree path: {value!r}")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Unsafe Git tree path: {value!r}")
    return PurePosixPath(*parts)


def fingerprint(root: Path) -> dict:
    """Match validate-real-world-corpus.mjs fingerprintSnapshot exactly."""
    files = []
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if any(part in FINGERPRINT_IGNORED for part in relative.parts):
            continue
        if path.is_symlink() or not path.is_file():
            continue
        files.append((relative.as_posix(), path))
    files.sort(key=lambda item: item[0])
    digest = hashlib.sha256()
    for rel, path in files:
        digest.update(rel.encode("utf-8"))
        digest.update(bytes([0]))
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(bytes([0]))
    return {"sha256": digest.hexdigest(), "fileCount": len(files)}


def resolve_license_file(snapshot_root: Path, license_file: str) -> Path:
    relative = validate_repo_path(license_file)
    current = snapshot_root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Declared license path must not traverse symlinks")
    try:
        resolved = current.resolve(strict=True)
        resolved.relative_to(snapshot_root.resolve(strict=True))
    except (OSError, ValueError) as exc:
        raise ValueError("Declared license file is missing or escapes the snapshot") from exc
    if not resolved.is_file():
        raise ValueError("Declared license path is not a regular file")
    return resolved


def safe_extract(archive: tarfile.TarFile, destination: Path) -> None:
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


def request_json(url: str) -> dict:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    token = os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_missing_blob(repository: str, base_sha: str, entry: dict, snapshot: Path) -> None:
    relative = validate_repo_path(entry["path"])
    destination = snapshot.joinpath(*relative.parts)
    destination.parent.mkdir(parents=True, exist_ok=True)

    if entry.get("mode") == "120000":
        blob_url = f"https://api.github.com/repos/{repository}/git/blobs/{entry['sha']}"
        blob = request_json(blob_url)
        target = base64.b64decode(blob["content"]).decode("utf-8")
        if not target or target.startswith("/") or "\\" in target:
            raise ValueError(f"Unsafe symlink target for {entry['path']}")
        resolved_target = (destination.parent / target).resolve(strict=False)
        try:
            resolved_target.relative_to(snapshot.resolve(strict=True))
        except ValueError as exc:
            raise ValueError(f"Symlink target escapes snapshot: {entry['path']}") from exc
        os.symlink(target, destination)
        return

    if entry.get("mode") not in ("100644", "100755"):
        raise ValueError(f"Unsupported Git blob mode for {entry['path']}: {entry.get('mode')}")
    encoded_path = urllib.parse.quote(relative.as_posix(), safe="/")
    url = f"https://raw.githubusercontent.com/{repository}/{base_sha}/{encoded_path}"

    last_error = None
    for attempt in range(4):
        temporary = None
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".oiol-", delete=False) as out:
                    temporary = Path(out.name)
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
            os.replace(temporary, destination)
            if entry.get("mode") == "100755":
                destination.chmod(0o755)
            return
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 404:
                raise ValueError(f"Pinned raw blob is unavailable: {entry['path']}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
        if attempt < 3:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not restore omitted blob {entry['path']}: {last_error}")


def complete_snapshot(repository: str, base_sha: str, snapshot: Path) -> dict:
    commit_data = request_json(f"https://api.github.com/repos/{repository}/commits/{base_sha}")
    tree_sha = commit_data["commit"]["tree"]["sha"]
    tree_data = request_json(
        f"https://api.github.com/repos/{repository}/git/trees/{tree_sha}?recursive=1"
    )
    if tree_data.get("truncated"):
        raise RuntimeError("Git tree response was truncated; refusing an incomplete snapshot")
    entries = [item for item in tree_data.get("tree", []) if item.get("type") == "blob"]
    expected = {}
    for entry in entries:
        relative = validate_repo_path(entry["path"])
        expected[relative.as_posix()] = entry

    actual = {
        path.relative_to(snapshot).as_posix()
        for path in snapshot.rglob("*")
        if path.is_symlink() or path.is_file()
    }
    extras = sorted(actual - set(expected))
    if extras:
        raise RuntimeError(f"Archive contains paths absent from pinned Git tree: {extras[:10]}")

    missing = [expected[path] for path in sorted(set(expected) - actual)]
    if missing:
        with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
            futures = [
                pool.submit(fetch_missing_blob, repository, base_sha, entry, snapshot)
                for entry in missing
            ]
            for future in as_completed(futures):
                future.result()

    final_paths = {
        path.relative_to(snapshot).as_posix()
        for path in snapshot.rglob("*")
        if path.is_symlink() or path.is_file()
    }
    if final_paths != set(expected):
        absent = sorted(set(expected) - final_paths)
        unexpected = sorted(final_paths - set(expected))
        raise RuntimeError(f"Snapshot does not match pinned Git tree; missing={absent[:10]}, extra={unexpected[:10]}")
    return {
        "gitTreeSha": tree_sha,
        "gitTreeFileCount": len(entries),
        "archiveMissingFileCount": len(missing),
        "archiveExtraFileCount": len(extras),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case-index", type=int, required=True, help="0-based index in intake-candidates.json candidates[]")
    parser.add_argument("--output", default="acquired")
    args = parser.parse_args()

    candidates = load_candidates()
    if args.case_index < 0 or args.case_index >= len(candidates):
        raise SystemExit("case-index is outside the primary candidate list")
    candidate = candidates[args.case_index]
    source, change = candidate["source"], candidate["change"]
    repository, base_sha = source["repository"], source["baseCommit"]
    if len(base_sha) != 40 or any(ch not in "0123456789abcdef" for ch in base_sha):
        raise SystemExit("Base commit is not an immutable full SHA")

    output_root = Path(args.output).resolve()
    case_dir = output_root / candidate["caseId"]
    snapshot = case_dir / "snapshot"
    case_dir.mkdir(parents=True, exist_ok=True)
    if snapshot.exists():
        raise SystemExit(f"Refusing to overwrite existing snapshot: {snapshot}")

    archive_url = f"https://codeload.github.com/{repository}/tar.gz/{base_sha}"
    request = urllib.request.Request(archive_url, headers={"User-Agent": USER_AGENT})
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

    tree_info = complete_snapshot(repository, base_sha, snapshot)
    if tree_info["gitTreeFileCount"] != source["trackedFileCountAtBase"]:
        raise RuntimeError(
            "Pinned Git tree file count differs from the intake inventory: "
            f"{tree_info['gitTreeFileCount']} != {source['trackedFileCountAtBase']}"
        )
    result = fingerprint(snapshot)
    license_path = resolve_license_file(snapshot, source["licenseFile"])
    metadata = {
        "schemaVersion": "1.0.0",
        "candidateIndex": args.case_index,
        "caseId": candidate["caseId"],
        "sharedSnapshotCases": [
            {"candidateIndex": index, "caseId": item["caseId"], "changeCommit": item["source"]["changeCommit"],
             "pullRequest": item["change"]["pullRequest"], "changeUrl": item["change"]["url"]}
            for index, item in enumerate(candidates)
            if item["source"]["repository"] == repository and item["source"]["baseCommit"] == base_sha
        ],
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
        "trackedFileCountDelta": tree_info["gitTreeFileCount"] - source["trackedFileCountAtBase"],
        "licenseFileSha256": hashlib.sha256(license_path.read_bytes()).hexdigest(),
        "archiveUrl": archive_url,
        "gitTreeSha": tree_info["gitTreeSha"],
        "gitTreeFileCount": tree_info["gitTreeFileCount"],
        "archiveMissingFileCountRestored": tree_info["archiveMissingFileCount"],
        "archiveExtraFileCount": tree_info["archiveExtraFileCount"],
        "acquiredAt": datetime.now(timezone.utc).isoformat(),
        "executionBoundary": "download-and-extract-only; target project code was not executed"
    }
    (case_dir / "snapshot-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
