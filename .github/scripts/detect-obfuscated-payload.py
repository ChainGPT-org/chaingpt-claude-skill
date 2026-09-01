#!/usr/bin/env python3
"""Fail closed on the August 2026 obfuscated JavaScript payload family."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.environ.get("GITHUB_WORKSPACE") or ".").resolve()
RESULTS = ROOT / "incident-malware-scan-results.json"
MAX_BYTES = 8 * 1024 * 1024

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo",
    "__pycache__", "artifacts", "cache", "typechain-types",
}
SKIP_PATHS = {".github/scripts/detect-obfuscated-payload.py"}
SKIP_NAMES = {
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
}
TEXT_SUFFIXES = {
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte",
    ".html", ".htm", ".json", ".yml", ".yaml", ".sh", ".bash", ".zsh",
    ".ps1", ".py", ".toml", ".npmrc",
}
TEXT_NAMES = {"Dockerfile", "Makefile", ".npmrc"}

RULES = [
    ("campaign-global-o", re.compile(r"""global\.o\s*=\s*['"]8-\d{3,8}['"]""")),
    ("campaign-manifest-v", re.compile(r"""['"]_V['"]\s*:\s*['"]8-\d{3,8}['"]""")),
    (
        "campaign-global-marker",
        re.compile(r"""global\s*\[\s*['"](?:_V|!|i)['"]\s*\]\s*=|\bglobal\.i\s*="""),
    ),
    ("payload-decoder", re.compile(r"""\b_\$_[0-9a-fA-F]{3,8}\b""")),
    ("payload-packer", re.compile(r"""String\.fromCharCode\s*\(\s*127\s*\)""")),
    (
        "obfuscated-global-require",
        re.compile(
            r"""global\s*\[\s*_\$_[0-9a-fA-F]{3,8}\s*"""
            r"""\[\s*\d+\s*\]\s*\]\s*=\s*require"""
        ),
    ),
    (
        "payload-execution-tail",
        re.compile(r"""GpX\s*\(\s*5866\s*\)\s*;\s*return\s+5429"""),
    ),
    (
        "decoded-dynamic-execution",
        re.compile(
            r"""(?:eval|Function)\s*\(\s*(?:atob|Buffer\.from|window\.atob|"""
            r"""String\.fromCharCode)\s*\(""",
            re.IGNORECASE,
        ),
    ),
    (
        "known-campaign-ioc",
        re.compile(
            r"""(?:23\.27\.20\.(?:168|187)|154\.91\.0\.196)(?::443)?"""
            r"""|/(?:inz|inz-notify)(?:\b|['"])"""
            r"""|0xa3047f3ccd7ed808076b49f9187453fe102f6e6a4f994af2b2dc00d24c455e88""",
            re.IGNORECASE,
        ),
    ),
    (
        "encoded-powershell",
        re.compile(
            r"""powershell(?:\.exe)?[^\n]{0,100}-(?:enc|encodedcommand)\b""",
            re.IGNORECASE,
        ),
    ),
    (
        "download-pipe-shell",
        re.compile(
            r"""(?:curl|wget)\s[^;\n]{0,240}\|\s*(?:ba|z)?sh\b""",
            re.IGNORECASE,
        ),
    ),
]

PACKED_HINT = re.compile(
    r"""global\.o|_\$_[0-9a-fA-F]{3}|fromCharCode|GpX\s*\(\s*5866\s*\)|"""
    r"""(?:eval|Function)\s*\(|(?:\\x[0-9a-fA-F]{2}){8,}"""
)
CONCEALED_EXECUTABLE = re.compile(
    r"""\s{512,}(?:global\.|var\s+_\$_|\(?function\s*\(|"""
    r"""(?:eval|Function)\s*\()"""
)


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def eligible(path: Path) -> bool:
    relative = rel(path)
    parts = set(path.relative_to(ROOT).parts)
    if relative in SKIP_PATHS or parts & SKIP_DIRS or path.name in SKIP_NAMES:
        return False
    return path.suffix.lower() in TEXT_SUFFIXES or path.name in TEXT_NAMES


def files() -> list[Path]:
    found: list[Path] = []
    for root, dirs, names in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS]
        for name in names:
            path = (Path(root) / name).resolve()
            try:
                path.relative_to(ROOT)
            except ValueError:
                continue
            if path.is_file() and eligible(path):
                found.append(path)
    return found


def excerpt(text: str, start: int) -> str:
    return (
        text[max(0, start - 80): min(len(text), start + 100)]
        .replace("\n", " ").replace("\r", " ")[:180]
    )


def scan(path: Path) -> list[dict[str, object]]:
    try:
        data = path.read_bytes()
    except OSError:
        return []
    if len(data) > MAX_BYTES or b"\x00" in data[:4096]:
        return []

    text = data.decode("utf-8-sig", errors="replace")
    findings: list[dict[str, object]] = []
    for rule, pattern in RULES:
        for match in pattern.finditer(text):
            findings.append({
                "severity": "CRITICAL",
                "rule": rule,
                "file": rel(path),
                "line": text.count("\n", 0, match.start()) + 1,
                "excerpt": excerpt(text, match.start()),
            })

    for number, line in enumerate(text.splitlines(), 1):
        if len(line) >= 4000 and PACKED_HINT.search(line):
            findings.append({
                "severity": "CRITICAL",
                "rule": "long-packed-line",
                "file": rel(path),
                "line": number,
                "excerpt": excerpt(line, 0),
            })
        match = CONCEALED_EXECUTABLE.search(line)
        if match:
            findings.append({
                "severity": "CRITICAL",
                "rule": "whitespace-concealed-executable",
                "file": rel(path),
                "line": number,
                "excerpt": excerpt(line, match.start()),
            })
    return findings


def main() -> int:
    targets = files()
    findings = [item for path in targets for item in scan(path)]
    RESULTS.write_text(json.dumps({
        "mode": "full-tree",
        "files_scanned": len(targets),
        "critical_count": len(findings),
        "findings": findings,
    }, indent=2), encoding="utf-8")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("# Incident malware scan\n\n")
            handle.write(f"Files scanned: **{len(targets)}**\n\n")
            handle.write(f"Critical findings: **{len(findings)}**\n")

    print(
        f"incident-malware-scan mode=full-tree files={len(targets)} "
        f"critical={len(findings)}"
    )
    for item in findings:
        safe = str(item["excerpt"]).encode("ascii", "replace").decode("ascii")
        print(
            f"[CRITICAL] {item['rule']} {item['file']}:{item['line']}\n  {safe}"
        )
    if findings:
        print(
            f"::error::{len(findings)} CRITICAL incident-malware finding(s). "
            "Do not merge or build this revision."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
