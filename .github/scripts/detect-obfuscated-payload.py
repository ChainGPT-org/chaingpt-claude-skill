#!/usr/bin/env python3
"""Review gate for known incident signatures in every blob in the Git index.

This is a static signature check, not a general malware or secret detector. It
reads Git objects, never imports project code, and never runs package scripts.
Untracked files and unstaged working-tree changes are outside this index scan.
No tracked paths, extensions, generated files, lockfiles or binaries are skipped.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote_to_bytes


RULES = [
    ("campaign-global-o", rb"""global\.o\s*=\s*['"]8-\d{3,8}['"]"""),
    ("campaign-manifest-v", rb"""['"]_V['"]\s*:\s*['"]8-\d{3,8}['"]"""),
    ("campaign-global-marker", rb"""global\s*\[\s*['"](?:_V|!|i)['"]\s*\]\s*=|\bglobal\.i\s*="""),
    ("payload-decoder", rb"\b_\$_[0-9a-fA-F]{3,8}\b"),
    ("payload-packer", rb"String\.fromCharCode\s*\(\s*127\s*\)"),
    ("obfuscated-global-require", rb"global\s*\[\s*_\$_[0-9a-fA-F]{3,8}\s*\[\s*\d+\s*\]\s*\]\s*=\s*require"),
    ("payload-execution-tail", rb"GpX\s*\(\s*5866\s*\)\s*;\s*return\s+5429"),
    ("decoded-dynamic-execution", rb"(?:eval|Function)\s*\(\s*(?:atob|Buffer\.from|window\.atob|String\.fromCharCode)\s*\("),
    ("known-campaign-ioc", rb"(?:23\.27\.20\.(?:168|187)|154\.91\.0\.196)(?::443)?|/(?:inz|inz-notify)\b|"
     rb"0xa3047f3ccd7ed808076b49f9187453fe1" rb"02f6e6a4f994af2b2dc00d24c455e88"),
    ("encoded-powershell", rb"powershell(?:\.exe)?[^\n]{0,100}-(?:enc|encodedcommand)\b"),
    ("whitespace-concealed-executable", rb"[ \t]{512,}(?:global\.|var\s+_\$_|\(?function\s*\(|(?:eval|Function)\s*\()"),
]
PATTERNS = [(rule, re.compile(pattern, re.IGNORECASE)) for rule, pattern in RULES]
PACKED_HINT = re.compile(
    rb"global\.o|_\$_[0-9a-f]{3}|fromCharCode|GpX\s*\(\s*5866\s*\)|(?:eval|Function)\s*\(|(?:\\x[0-9a-f]{2}){8,}",
    re.IGNORECASE,
)
BASE64_LITERAL = re.compile(rb"(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/-]{16,}={0,2}(?![A-Za-z0-9_+/=-])")
HEX_LITERAL = re.compile(rb"(?<![A-Fa-f0-9])[A-Fa-f0-9]{32,}(?![A-Fa-f0-9])")
HEX_ESCAPES = re.compile(rb"(?:\\x[0-9a-fA-F]{2}){4,}")
UNICODE_ESCAPES = re.compile(rb"(?:\\u00[0-9a-fA-F]{2}){4,}")
MAX_DECODE_DEPTH = 3


class ScanError(Exception):
    """A coverage failure. Messages must never include blob data or Git stderr."""


def git_environment() -> dict[str, str]:
    env = os.environ.copy()
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_OPTIONAL_LOCKS="0", GIT_NO_REPLACE_OBJECTS="1")
    return env


def git(root: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["git", "-c", "core.hooksPath=" + os.devnull, "-c", "core.fsmonitor=false", *args],
            cwd=root, env=git_environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=False,
        )
    except OSError as exc:
        raise ScanError("Cannot start Git; index coverage is incomplete") from exc
    if result.returncode:
        raise ScanError("Git read failed; index coverage is incomplete")
    return result.stdout


def index_entries(root: Path) -> list[tuple[str, str]]:
    records = git(root, "ls-files", "--stage", "--full-name", "-z")
    entries = []
    for record in records.split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, raw_oid, stage = metadata.split()
            oid = raw_oid.decode("ascii")
        except (ValueError, UnicodeError) as exc:
            raise ScanError("Malformed index entry; index coverage is incomplete") from exc
        if stage != b"0":
            raise ScanError("Unmerged index entry; resolve conflicts before scanning")
        if mode not in (b"100644", b"100755", b"120000"):
            raise ScanError("Unsupported index entry (such as a submodule); index coverage is incomplete")
        if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", oid) or set(oid) == {"0"}:
            raise ScanError("Missing or invalid index object; index coverage is incomplete")
        entries.append((raw_path.decode("utf-8", errors="surrogateescape"), oid))
    if not entries:
        raise ScanError("Index contains no tracked blobs; refusing an empty scan")
    return entries


def read_blob(root: Path, oid: str) -> bytes:
    data = git(root, "cat-file", "blob", oid)
    header = b"blob " + str(len(data)).encode("ascii") + b"\0"
    algorithm = hashlib.sha1 if len(oid) == 40 else hashlib.sha256
    if algorithm(header + data).hexdigest() != oid:
        raise ScanError("Git blob hash mismatch; index coverage is incomplete")
    return data


def decoded_candidates(data: bytes, include_utf16: bool = False):
    """Yield inert byte strings. Nothing decoded is evaluated or imported."""
    # Interpret binary blob text once in each endian order. Reinterpreting
    # arbitrary decoded bytes repeatedly creates meaningless expansion trees.
    if include_utf16 and b"\0" in data:
        for encoding in ("utf-16-le", "utf-16-be"):
            yield encoding, data.decode(encoding, errors="replace").encode("utf-8")
    if re.search(rb"%[0-9a-fA-F]{2}", data):
        yield "percent", unquote_to_bytes(data)
    for match in BASE64_LITERAL.finditer(data):
        value = match.group().replace(b"-", b"+").replace(b"_", b"/")
        try:
            yield "base64@" + str(match.start()), base64.b64decode(value + b"=" * (-len(value) % 4), validate=True)
        except binascii.Error:
            pass
    for match in HEX_LITERAL.finditer(data):
        if len(match.group()) % 2 == 0:
            yield "hex@" + str(match.start()), bytes.fromhex(match.group().decode("ascii"))
    for pattern, stride, name in ((HEX_ESCAPES, 4, "hex-escape"), (UNICODE_ESCAPES, 6, "unicode-escape")):
        for match in pattern.finditer(data):
            value = match.group()
            yield name + "@" + str(match.start()), bytes(int(value[i+stride-2:i+stride], 16) for i in range(0, len(value), stride))


def views(data: bytes):
    # A decoding budget fails the scan rather than silently skipping content.
    # Raw blobs have no file-size limit and are always scanned in full.
    budget = max(1024 * 1024, len(data) * 16)
    seen = {hashlib.sha256(data).digest()}
    queue = [("raw", data, 0)]
    total = 0
    for label, content, depth in queue:
        yield label, content
        if depth == MAX_DECODE_DEPTH:
            continue
        for encoding, decoded in decoded_candidates(content, include_utf16=depth == 0):
            digest = hashlib.sha256(decoded).digest()
            if not decoded or digest in seen:
                continue
            total += len(decoded)
            if total > budget or len(seen) >= 10000:
                raise ScanError("Static-decoding resource limit exceeded; review this blob manually")
            seen.add(digest)
            queue.append((encoding + "/" + label, decoded, depth + 1))


def scan_blob(data: bytes) -> tuple[list[dict], int]:
    findings = []
    count = 0
    for view, content in views(data):
        count += 1
        for rule, pattern in PATTERNS:
            for match in pattern.finditer(content):
                findings.append({"rule": rule, "view": view, "line": content.count(b"\n", 0, match.start()) + 1,
                                 "byte_offset": match.start()})
        for line_number, line in enumerate(content.split(b"\n"), 1):
            if len(line) >= 4000 and PACKED_HINT.search(line):
                findings.append({"rule": "long-packed-line", "view": view, "line": line_number})
    return findings, count


def scan_index(root: Path) -> dict:
    result = {"mode": "git-index", "tracked_paths": 0, "blobs_scanned": 0, "bytes_scanned": 0,
              "views_scanned": 0, "excluded_paths": [], "findings": [], "errors": [],
              "scope": "Known static signatures only; untracked/unstaged files and historical revisions are outside this scan"}
    try:
        entries = index_entries(root)
    except ScanError as exc:
        result["errors"].append({"error": str(exc)})
        return result
    result["tracked_paths"] = len(entries)
    paths_by_oid: dict[str, list[str]] = {}
    for path, oid in entries:
        paths_by_oid.setdefault(oid, []).append(path)
    for oid, paths in paths_by_oid.items():
        try:
            data = read_blob(root, oid)
            findings, view_count = scan_blob(data)
        except ScanError as exc:
            result["errors"].append({"object": oid, "paths": paths, "error": str(exc)})
            continue
        result["blobs_scanned"] += 1
        result["bytes_scanned"] += len(data)
        result["views_scanned"] += view_count
        result["findings"].extend({"object": oid, "paths": paths, **finding} for finding in findings)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Optional JSON report containing metadata only, never source excerpts")
    args = parser.parse_args()
    try:
        root = Path(os.fsdecode(git(Path.cwd(), "rev-parse", "--show-toplevel")).rstrip("\n"))
        result = scan_index(root)
    except ScanError as exc:
        result = {"mode": "git-index", "findings": [], "errors": [{"error": str(exc)}]}
    output = json.dumps(result, indent=2, ensure_ascii=True) + "\n"
    # JSON escaping prevents repository-controlled filenames becoming log commands.
    print(output, end="")
    if args.report:
        try:
            args.report.write_text(output, encoding="utf-8")
        except OSError:
            print("Cannot write scan report; review required", file=sys.stderr)
            return 2
    if result["errors"]:
        print("Scan incomplete. Resolve coverage errors before building or merging.")
        return 2
    if result["findings"]:
        print("Signature matches require review before building or merging; a match is not proof of malware.")
        return 1
    print("No configured signature matches in the scanned index. This is not a malware-free guarantee.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
