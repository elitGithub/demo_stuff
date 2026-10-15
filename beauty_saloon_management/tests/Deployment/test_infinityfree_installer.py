import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import re
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location("installer", Path(__file__).resolve().parents[2] / "bin/build-infinityfree-installer.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InfinityFreeInstallerTest(unittest.TestCase):
    def test_bundle_pins_complete_payloads_and_keeps_activation_and_code_out_of_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            public = release / "htdocs/studio"
            for name, contents in {"index.php": "activation", ".htaccess": "protection", "_app/.htaccess": "private protection", "_app/.env": "fixed private application key", "_app/database/database.sqlite": "existing database", "assets/example.css": "body{}"}.items():
                path = public / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(contents)
            output = root / "handoff"
            with contextlib.redirect_stdout(io.StringIO()):
                installer.build(release, output)
            code = re.search(r"^   ([a-f0-9]{64})$", (output / "START-HERE.txt").read_text(), re.M).group(1)
            with zipfile.ZipFile(output / "01-setup.zip") as setup:
                script = setup.read("install-studio.php").decode()
                self.assertNotIn(code, script)
                self.assertIn(hashlib.sha256(code.encode()).hexdigest(), script)
                self.assertIn("studio/_app/.installation/", setup.namelist())
                self.assertIn("studio/_app/storage/fonts/", setup.namelist())
                self.assertNotIn("studio/index.php", setup.namelist())
            payloads = {}
            for name in ("02-studio-payload.zip", "03-studio-payload.zip"):
                self.assertIn(hashlib.sha256((output / name).read_bytes()).hexdigest(), script)
                self.assertLess((output / name).stat().st_size, 8_000_000)
                with zipfile.ZipFile(output / name) as archive:
                    for item in archive.namelist():
                        self.assertTrue(item.startswith("studio/"))
                        self.assertNotEqual(item, "studio/index.php")
                        self.assertNotIn(item, payloads)
                        payloads[item] = archive.read(item)
            self.assertEqual(b"existing database", payloads["studio/_app/database/database.sqlite"])
            self.assertEqual(b"fixed private application key", payloads["studio/_app/.env"])
            with zipfile.ZipFile(output / "Studio-InfinityFree.zip") as download:
                self.assertEqual(["01-setup.zip", "02-studio-payload.zip", "03-studio-payload.zip", "START-HERE.txt"], download.namelist())

    def test_builder_never_overwrites_an_existing_handoff(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "release/htdocs/studio").mkdir(parents=True)
            output = root / "handoff"
            output.mkdir()
            (output / "START-HERE.txt").write_text("preserve existing installation code")
            with self.assertRaises(ValueError):
                installer.build(root / "release", output)
            self.assertEqual("preserve existing installation code", (output / "START-HERE.txt").read_text())


if __name__ == "__main__":
    unittest.main()
