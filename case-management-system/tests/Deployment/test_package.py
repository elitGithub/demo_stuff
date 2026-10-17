import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile


class PackageTest(unittest.TestCase):
    ROOT = Path(__file__).resolve().parents[2]

    @classmethod
    def setUpClass(cls):
        if not all(shutil.which(command) for command in ("composer", "npm", "php")):
            raise unittest.SkipTest("Package integration needs composer, npm and php; no installation attempted.")
        template_value = os.environ.get("CASEFILE_PACKAGE_TEMPLATE")
        output_value = os.environ.get("CASEFILE_PACKAGE_TEST_ROOT")
        if not template_value or not output_value:
            raise unittest.SkipTest("Set CASEFILE_PACKAGE_TEMPLATE and CASEFILE_PACKAGE_TEST_ROOT to operator-approved isolated paths.")
        specification = importlib.util.spec_from_file_location("package_policy", cls.ROOT / "deploy/package_policy.py")
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        cls.policy = module.PackagePolicy
        cls.template = cls.policy.scoped(Path(template_value), cls.ROOT / "storage")
        cls.output = cls.policy.scoped(Path(output_value), cls.ROOT / "storage/framework/testing")
        cls.output.mkdir(parents=True, exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix="package-test-", dir=cls.output)
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.work = Path(cls.temporary.name)
        cls.template_hash = cls.policy.digest(cls.template)
        cls.lock_hash = cls.policy.digest(cls.ROOT / "composer.lock")
        cls.result = subprocess.run([
            sys.executable, "deploy/package.py", "--template", str(cls.template),
            "--output-root", str(cls.work / "valid"),
        ], cwd=cls.ROOT, text=True, capture_output=True)
        if cls.result.returncode:
            raise RuntimeError(cls.result.stdout + cls.result.stderr)
        cls.archive = cls.work / "valid/casefile-upload.zip"
        cls.manifest = json.loads((cls.archive.parent / "manifest.json").read_text())

    def test_package_verifies_and_preserves_sources(self):
        result = subprocess.run([sys.executable, "deploy/verify-package.py", str(self.archive)], cwd=self.ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("files-only extraction", result.stdout)
        self.assertLess(int(result.stdout.rsplit("Files: ", 1)[1]), 12000)
        self.assertEqual(self.policy.digest(self.template), self.template_hash)
        self.assertEqual(self.policy.digest(self.ROOT / "composer.lock"), self.lock_hash)
        with zipfile.ZipFile(self.archive) as archive:
            names = archive.namelist()
            self.assertIn("casefile/_app/.htaccess", names)
            self.assertIn("casefile/build/Instrument-Sans-OFL.txt", names)
            self.assertFalse(any(name.endswith("/.env") or "/tests/" in name or "/node_modules/" in name for name in names))
            self.assertEqual([name for name in names if name.endswith(".sqlite")], ["casefile/" + self.policy.TEMPLATE])

    def test_archive_attacks_are_rejected_before_extraction(self):
        for label, name, mode in (
            ("traversal", "casefile/../../escaped.txt", 0),
            ("absolute", "/casefile/escaped.txt", 0),
            ("backslash", "casefile/..\\escaped.txt", 0),
            ("drive", "C:/casefile/escaped.txt", 0),
            ("symlink", "casefile/linked", stat.S_IFLNK | 0o777),
            ("environment", "casefile/_app/.env", 0),
            ("database", "casefile/_app/database/private.sqlite", 0),
            ("tests", "casefile/_app/tests/leak.txt", 0),
            ("duplicate", "casefile/index.php", 0),
        ):
            with self.subTest(label=label):
                directory = self.work / ("archive-" + label)
                directory.mkdir()
                damaged = directory / "casefile-upload.zip"
                shutil.copy2(self.archive, damaged)
                shutil.copy2(self.archive.parent / "manifest.json", directory / "manifest.json")
                with zipfile.ZipFile(damaged, "a") as archive:
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = mode << 16
                    archive.writestr(entry, "unsafe")
                result = subprocess.run([sys.executable, "deploy/verify-package.py", str(damaged)], cwd=self.ROOT, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.work / "escaped.txt").exists())

    def test_semantic_tampering_is_rejected_even_with_updated_manifest(self):
        changes = {
            "public-protection": (".htaccess", b"RewriteEngine On\n"),
            "private-protection": ("_app/.htaccess", b"Require all granted\n"),
            "runtime-marker": ("_app/storage/app/sandboxes/index.html", None),
            "font": ("build/assets/instrument-sans-400-normal-DRC__1Mx.woff2", None),
            "license": ("build/Instrument-Sans-OFL.txt", b"license missing"),
            "template": (self.policy.TEMPLATE, b"not sqlite"),
            "environment": ("_app/.env.example", b"CASEFILE_MODE=production\nAPP_DEBUG=true\n"),
        }
        for label, (target, replacement) in changes.items():
            with self.subTest(label=label):
                directory = self.work / ("semantic-" + label)
                directory.mkdir()
                damaged = directory / "casefile-upload.zip"
                records = []
                with zipfile.ZipFile(self.archive) as original, zipfile.ZipFile(damaged, "w", zipfile.ZIP_DEFLATED) as archive:
                    for entry in original.infolist():
                        relative = entry.filename.removeprefix("casefile/")
                        content = original.read(entry)
                        if relative == target:
                            if replacement is None:
                                continue
                            content = replacement
                        archive.writestr(entry, content)
                        if not entry.is_dir():
                            records.append({"path": relative, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
                (directory / "manifest.json").write_text(json.dumps(records))
                result = subprocess.run([sys.executable, "deploy/verify-package.py", str(damaged)], cwd=self.ROOT, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)

    def test_checksum_mismatch_is_rejected(self):
        directory = self.work / "checksum"
        directory.mkdir()
        shutil.copy2(self.archive, directory / "casefile-upload.zip")
        records = json.loads(json.dumps(self.manifest))
        records[0]["sha256"] = "0" * 64
        (directory / "manifest.json").write_text(json.dumps(records))
        result = subprocess.run([sys.executable, "deploy/verify-package.py", str(directory / "casefile-upload.zip")], cwd=self.ROOT, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)

    def test_path_boundaries_and_missing_template_fail_without_install(self):
        for path in (self.ROOT / "storage", self.ROOT / "README.md", self.ROOT.parent / "outside"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.policy.scoped(path, self.ROOT / "storage")
        result = subprocess.run([
            sys.executable, "deploy/package.py", "--template", str(self.work / "missing.sqlite"),
            "--output-root", str(self.work / "must-not-exist"),
        ], cwd=self.ROOT, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.work / "must-not-exist").exists())
