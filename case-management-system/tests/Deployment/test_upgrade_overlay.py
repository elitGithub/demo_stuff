import hashlib
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import unittest
from zipfile import ZipFile


class UpgradeOverlayTest(unittest.TestCase):
    project = Path(__file__).resolve().parents[2]
    source = project / "storage/infinityfree/upgrade-fix-input-20261018/casefile-reviewed-full.zip"
    casefile = project / "storage/infinityfree/releases/2026-10-18-fixes/casefile-upload.zip"
    elsewhere = project.parent / "travel-business/storage/infinityfree/releases/2026-10-18-fixes/elsewhere-upload.zip"

    def test_safe_state_free_payloads_and_overlay(self):
        for archive, root in ((self.casefile, "casefile"), (self.elsewhere, "travel-agency-demo")):
            with self.subTest(archive=archive.name), ZipFile(archive) as package:
                self.assertIsNone(package.testzip())
                names = set()
                for member in package.infolist():
                    name = member.filename
                    self.assertTrue(name.startswith(root + "/"), name)
                    self.assertNotIn("\\", name)
                    self.assertTrue(all(part not in ("", ".", "..") for part in name.rstrip("/").split("/")), name)
                    self.assertFalse(stat.S_ISLNK(member.external_attr >> 16), name)
                    self.assertNotIn(name.casefold(), names, name)
                    names.add(name.casefold())
                    self.assertFalse(name.startswith((root + "/_app/storage/", root + "/_app/bootstrap/cache/", root + "/_app/database/fixtures/attachments/", root + "/private/runtime/")), name)
                    leaf = PurePosixPath(name).name
                    self.assertFalse(leaf.startswith(".env") and leaf != ".env.example", name)
                    self.assertIsNone(re.search(r"\.(?:sqlite(?:3)?|db|key|log)(?:-(?:wal|shm|journal))?$", leaf, re.I), name)
                    self.assertNotIn(leaf, ("auth.json", "credentials.json", "preflight.php", "preflight-secret.php"))
                for name in names:
                    for parent in PurePosixPath(name).parents:
                        self.assertNotIn(str(parent), names, "File/directory collision: " + name)
                self.assertIn(root + "/.htaccess", names)
                self.assertIn(root + ("/_app/.htaccess" if root == "casefile" else "/private/.htaccess"), names)
                with tempfile.TemporaryDirectory(prefix="upgrade-overlay-") as temporary:
                    destination = Path(temporary)
                    sentinels = (
                        ("_app/.env", "_app/storage/app/template/casefile-template.sqlite", "_app/storage/app/sandboxes/visitor.sqlite", "_app/storage/framework/sessions/session", "_app/storage/framework/cache/data/cache", "_app/storage/framework/views/old.php", "_app/storage/logs/laravel.log", "_app/bootstrap/cache/config.php", "_app/database/fixtures/attachments/kitchen-sink-leak.png", "remote-only/state")
                        if root == "casefile" else
                        ("private/runtime/sandbox-runtime/registry.json", "private/runtime/sandbox-runtime/visitor.sqlite", "private/legacy.sqlite", "private/sessions/session", "remote-only/state")
                    )
                    for relative in sentinels:
                        path = destination / root / relative
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(("opaque-existing:" + relative).encode())
                    application = root + ("/index.php" if root == "casefile" else "/index.html")
                    (destination / application).write_bytes(b"old application")
                    package.extractall(destination)
                    for relative in sentinels:
                        self.assertEqual((destination / root / relative).read_bytes(), ("opaque-existing:" + relative).encode())
                    self.assertEqual((destination / application).read_bytes(), package.read(application))
                self.assertEqual(list(archive.parent.iterdir()), [archive])

    def test_retained_reviewed_bytes_and_supported_hook(self):
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), "f6e3184f7b66977a8c6eed1c9eab705ef8852699f84b6cd827459997ead877ef")
        with ZipFile(self.source) as source, ZipFile(self.casefile) as output:
            excluded = ("casefile/_app/storage/", "casefile/_app/bootstrap/cache/", "casefile/_app/database/fixtures/attachments/")
            retained = [name for name in source.namelist() if not name.startswith(excluded)]
            self.assertEqual(set(output.namelist()), set(retained))
            digest = hashlib.sha256()
            for name in sorted(retained):
                digest.update(name.encode() + b"\0")
                digest.update(hashlib.sha256(source.read(name)).digest())
            release_id = digest.hexdigest()[:24]
            hook = ("$app->afterBootstrapping(\\Illuminate\\Foundation\\Bootstrap\\LoadConfiguration::class, static function (Application $application): void {\n"
                    "    $application['config']->set('view.compiled_extension', 'casefile-" + release_id + ".php');\n});\n").encode()
            for name in retained:
                expected = source.read(name)
                if name == "casefile/index.php":
                    expected = expected.replace(b"$app->usePublicPath(__DIR__);\n", b"$app->usePublicPath(__DIR__);\n" + hook)
                self.assertEqual(output.read(name), expected, name)
            self.assertEqual(output.namelist()[-1], "casefile/index.php")
            provider = output.read("casefile/_app/vendor/laravel/framework/src/Illuminate/View/ViewServiceProvider.php")
            self.assertIn(b"$app['config']->get('view.compiled_extension', 'php')", provider)
            self.assertIn("casefile/build/assets/app-D-VNy6s6.css", retained)
            self.assertIn("casefile/build/assets/app-CBc_cVwR.js", retained)
            for component in ("app-layout", "layout-switcher", "theme-script", "theme-switcher"):
                self.assertIn("casefile/_app/resources/views/components/" + component + ".blade.php", retained)
            with tempfile.TemporaryDirectory(prefix="upgrade-blade-") as temporary:
                entry = Path(temporary) / "index.php"
                entry.write_bytes(output.read("casefile/index.php"))
                subprocess.run(["php", "-l", str(entry)], check=True)
                subprocess.run(["php", str(self.project / "tests/Deployment/verify_upgrade_views.php"), str(self.project), temporary, "casefile-" + release_id + ".php"], check=True)
        self.assertEqual(hashlib.sha256(self.elsewhere.read_bytes()).hexdigest(), "7cfe4b03241950d08471131b482358503199e068f13a35c40f8507250a4a4121")

    def test_builder_reproduces_final_zip(self):
        with tempfile.TemporaryDirectory(prefix="upgrade-builder-") as temporary:
            rebuilt = Path(temporary) / "casefile-upload.zip"
            subprocess.run(["python3", str(self.project / "deploy/package-upgrade.py"), str(self.source), str(rebuilt)], check=True)
            self.assertEqual(rebuilt.read_bytes(), self.casefile.read_bytes())


if __name__ == "__main__":
    unittest.main()
