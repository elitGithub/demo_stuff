import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location("infinityfree", Path(__file__).resolve().parents[2] / "bin/build-infinityfree.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class InfinityFreePackageTest(unittest.TestCase):
    def test_url_requires_a_single_safe_https_subdirectory(self):
        self.assertEqual(("demo-sites.infinityfree.me", "/studio"), package.deployment_url("https://demo-sites.infinityfree.me/studio/"))
        for url in ("http://example.com/studio", "https://example.com", "https://example.com/studio/nested", "https://user@example.com/studio", "https://example.com/studio?debug=true", "https://example.com/studio\nRewriteRule"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                package.deployment_url(url)

    def test_copy_excludes_existing_database_environment_and_runtime_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, destination = root / "source", root / "public"
            for relative in package.SOURCE_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("source")
            for relative in package.SOURCE_DIRECTORIES:
                (source / relative).mkdir(parents=True, exist_ok=True)
                (source / relative / "Example.php").write_text("source")
            for relative in package.PUBLIC_FILES:
                path = source / "public" / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("public")
            for relative in (".env", "database/database.sqlite", "bootstrap/cache/config.php", "storage/app/private/demo-credentials.json", "public/unexpected.php", "app/.env"):
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("SECRET")
            package.copy_source(source, destination / "_app", destination)
            self.assertTrue((destination / "_app/app/Example.php").is_file())
            self.assertFalse(any("SECRET" in item.read_text() for item in destination.rglob("*") if item.is_file()))

    def test_environment_uses_isolated_cookie_fresh_key_and_no_host_database_path(self):
        first = package.environment("https://example.com/studio", "/studio")
        second = package.environment("https://example.com/studio", "/studio")
        self.assertNotEqual(first, second)
        self.assertIn("SESSION_PATH=/studio\n", first)
        self.assertIn("SESSION_COOKIE=studio_demo_session\n", first)
        self.assertIn("APP_DEBUG=false\n", first)
        self.assertIn("SESSION_SECURE_COOKIE=true\n", first)
        self.assertNotIn("DB_DATABASE=", first)
        self.assertNotIn("STUDIO_DEMO_PASSWORD=", first)

    def test_host_file_limits_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "oversize.php").write_bytes(b"x" * 1_000_001)
            with self.assertRaisesRegex(ValueError, "upload limit"):
                package.check_upload_limits(root)

    def test_runtime_cleanup_removes_seed_credentials_and_generated_caches(self):
        with tempfile.TemporaryDirectory() as temporary:
            application = Path(temporary)
            for relative in package.RUNTIME_DIRECTORIES:
                (application / relative).mkdir(parents=True, exist_ok=True)
                (application / relative / "generated").write_text("secret")
            (application / "database").mkdir()
            (application / "database/database.sqlite").write_text("seeded")
            (application / "database/database.sqlite-wal").touch()
            package.clear_runtime(application)
            self.assertEqual("seeded", (application / "database/database.sqlite").read_text())
            self.assertEqual([application / "database/database.sqlite"], [item for item in application.rglob("*") if item.is_file()])

    def test_archives_protect_first_activate_last_and_preserve_empty_runtime_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            public = output / "htdocs/studio"
            for relative in package.RUNTIME_DIRECTORIES:
                (public / "_app" / relative).mkdir(parents=True, exist_ok=True)
            for relative in (".htaccess", "_app/.htaccess", "_app/.env", "index.php"):
                (public / relative).write_text("test")
            for index in range(1001):
                (public / "_app" / f"file{index}.php").write_text("fixture")
            archives = package.write_archives(output, public)
            self.assertTrue(archives[0]["file"].endswith("000-protection.zip"))
            self.assertTrue(archives[-1]["file"].endswith("999-activate.zip"))
            names = []
            for item in archives:
                self.assertLessEqual(item["entries"], 1000)
                self.assertLessEqual(item["bytes"], 8_000_000)
                self.assertNotIn("htdocs", Path(item["file"]).parts)
                with zipfile.ZipFile(item["file"]) as archive:
                    names.extend(archive.namelist())
            self.assertEqual("studio/.htaccess", names[0])
            self.assertEqual("studio/_app/.htaccess", names[1])
            self.assertEqual("studio/index.php", names[-1])
            self.assertIn("studio/_app/storage/framework/sessions/", names)
            self.assertTrue(all(name.startswith("studio/") for name in names))


if __name__ == "__main__":
    unittest.main()
