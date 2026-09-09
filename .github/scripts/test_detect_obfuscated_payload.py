#!/usr/bin/env python3
"""Synthetic, inert fixture tests; no repository application code is executed."""

import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("incident_detector", Path(__file__).with_name("detect-obfuscated-payload.py"))
detector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)

# Split synthetic signature strings to avoid requiring any path exclusions in
# the scanner. These fixture bytes are written to temporary Git repositories.
MARKER = b"global" + b".o='8-" + b"123';"


class IndexScanTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.command("init", "--quiet")

    def command(self, *args, data=None):
        return subprocess.check_output(["git", "-c", "core.hooksPath=" + os.devnull, "-c", "core.fsmonitor=false", *args],
                                       cwd=self.root, env=detector.git_environment(), input=data, stderr=subprocess.DEVNULL)

    def track(self, path, content):
        destination = self.root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        self.command("add", "--", path)

    def test_all_file_types_and_generated_paths_are_scanned(self):
        paths = ["dist/bundle.js", "package-lock.json", "README.md", "image.bin", "node_modules/tracked/index.js", "unknown.extension"]
        for path in paths:
            self.track(path, b"\0binary prefix\xff\n" + MARKER)
        result = detector.scan_index(self.root)
        self.assertFalse(result["errors"])
        self.assertEqual(result["excluded_paths"], [])
        self.assertEqual(result["tracked_paths"], len(paths))
        detected = {p for f in result["findings"] if f["rule"] == "campaign-global-o" for p in f["paths"]}
        self.assertEqual(detected, set(paths))

    def test_staged_content_is_scanned_even_if_working_copy_changes(self):
        self.track("dist/bundle.js", MARKER)
        (self.root / "dist/bundle.js").write_bytes(b"benign working copy")
        self.assertTrue(detector.scan_index(self.root)["findings"])

    def test_payload_beyond_old_eight_megabyte_limit_is_scanned(self):
        content = b"." * (8 * 1024 * 1024 + 1) + b"\n" + MARKER
        self.track("dist/large.bin", content)
        result = detector.scan_index(self.root)
        self.assertFalse(result["errors"])
        self.assertEqual(result["bytes_scanned"], len(content))
        self.assertTrue(result["findings"])

    def test_untracked_content_is_outside_documented_scope(self):
        self.track("tracked.txt", b"ordinary content")
        (self.root / "untracked.js").write_bytes(MARKER)
        result = detector.scan_index(self.root)
        self.assertFalse(result["findings"])
        self.assertEqual(result["tracked_paths"], 1)

    def test_binary_utf16_and_nested_base64_are_inspected(self):
        self.track("utf16.bin", MARKER.decode().encode("utf-16-le"))
        self.track("encoded.txt", base64.b64encode(base64.b64encode(MARKER)))
        result = detector.scan_index(self.root)
        self.assertFalse(result["errors"])
        detected = {p for f in result["findings"] for p in f["paths"]}
        self.assertEqual(detected, {"utf16.bin", "encoded.txt"})

    def test_symlink_blob_is_scanned_without_following_target(self):
        (self.root / "link").symlink_to(MARKER.decode())
        self.command("add", "link")
        self.assertTrue(detector.scan_index(self.root)["findings"])

    def test_documented_installer_does_not_block(self):
        self.track("README.md", b"Install example: curl -fsSL https://example.com/install.sh | bash\n")
        result = detector.scan_index(self.root)
        self.assertFalse(result["errors"])
        self.assertFalse(result["findings"])

    def test_missing_object_fails_closed(self):
        self.track("tracked.js", b"ordinary content")
        oid = self.command("rev-parse", ":tracked.js").decode().strip()
        (self.root / ".git/objects" / oid[:2] / oid[2:]).unlink()
        result = detector.scan_index(self.root)
        self.assertTrue(result["errors"])
        self.assertEqual(result["blobs_scanned"], 0)

    def test_unmerged_index_fails_closed(self):
        oid = self.command("hash-object", "-w", "--stdin", data=b"fixture").strip()
        self.command("update-index", "--index-info", data=b"100644 " + oid + b" 1\tconflict.txt\n")
        self.assertTrue(detector.scan_index(self.root)["errors"])

    def test_submodule_fails_closed_instead_of_silent_skip(self):
        self.command("update-index", "--add", "--cacheinfo", "160000," + "1" * 40 + ",vendor")
        self.assertTrue(detector.scan_index(self.root)["errors"])

    def test_empty_index_fails_closed(self):
        self.assertTrue(detector.scan_index(self.root)["errors"])

    def test_read_failure_cannot_return_success_or_print_contents(self):
        self.track("tracked.js", b"ordinary content")
        with patch.object(detector, "read_blob", side_effect=detector.ScanError("Git read failed; index coverage is incomplete")):
            result = detector.scan_index(self.root)
        self.assertTrue(result["errors"])
        self.assertNotIn("ordinary content", json.dumps(result))

    def test_findings_never_include_source_excerpts(self):
        private_text = b"DO_NOT_PRINT_THIS_PRIVATE_FIXTURE"
        self.track("candidate.js", private_text + b"\n" + MARKER)
        result = detector.scan_index(self.root)
        output = json.dumps(result)
        self.assertTrue(result["findings"])
        self.assertNotIn(private_text.decode(), output)
        self.assertNotIn(MARKER.decode(), output)
        self.assertNotIn("excerpt", output)

    def test_cli_errors_exit_nonzero(self):
        with patch.object(detector, "git", side_effect=detector.ScanError("Git read failed")), patch("sys.argv", ["detector"]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(detector.main(), 2)

    def test_cli_findings_exit_nonzero(self):
        with patch.object(detector, "git", return_value=str(self.root).encode()), patch.object(detector, "scan_index", return_value={"findings": [{"rule": "synthetic"}], "errors": []}), patch("sys.argv", ["detector"]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(detector.main(), 1)

    def test_scanner_and_tests_need_no_exclusions(self):
        for filename in ("detect-obfuscated-payload.py", "test_detect_obfuscated_payload.py"):
            source = Path(__file__).with_name(filename).read_bytes()
            findings, _ = detector.scan_blob(source)
            self.assertEqual(findings, [], filename)


if __name__ == "__main__":
    unittest.main()
