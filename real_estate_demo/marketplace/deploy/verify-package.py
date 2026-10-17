"""Validate the upload archive after extraction; never bootstrap Laravel or access a DB."""
from pathlib import Path, PurePosixPath
import sys
import subprocess
import tempfile
import zipfile

archive_path = Path(sys.argv[1]).resolve()
demo = Path(__file__).resolve().parents[2]
assert archive_path.is_relative_to(demo / ".cache"), "Only local generated packages may be inspected."
with zipfile.ZipFile(archive_path) as archive:
    names = archive.namelist()
    assert all(not PurePosixPath(n).is_absolute() and ".." not in PurePosixPath(n).parts for n in names)
    assert all(n.startswith("haven/") for n in names)
    assert not any(n.endswith((".sqlite", ".sql", ".log", "/.env")) for n in names)
    for files_only in [False, True]:
        with tempfile.TemporaryDirectory(prefix="verify-package-", dir=demo / ".cache") as temporary:
            if files_only:
                for entry in archive.infolist():
                    if not entry.is_dir():
                        archive.extract(entry, temporary)
            else:
                archive.extractall(temporary)
            site = Path(temporary) / "haven"
            for directory in ["_app/bootstrap/cache", "_app/storage/framework/sessions",
                              "_app/storage/framework/views", "_app/storage/framework/cache/data",
                              "_app/storage/logs", "_app/storage/app/private/request-photos"]:
                assert (site / directory).is_dir(), ("Missing required directory (files_only="
                                                    + str(files_only) + "): " + directory)
                probe = site / directory / "haven-write-probe"
                probe.write_text("writable")
                probe.unlink()
            for file in ["index.php", ".htaccess", "_app/.htaccess", "_app/.env.example",
                         "_app/vendor/autoload.php", "build/manifest.json"]:
                assert (site / file).is_file(), "Missing required file: " + file
            assert "Deny from all" in (site / "_app/.htaccess").read_text()
            assert "^_app(?:/|$)" in (site / ".htaccess").read_text()
            assert "MODE=demo" in (site / "_app/.env.example").read_text()
            # Exercise the exact startup operation without booting the app or accessing a DB.
            subprocess.run(["php", "-r", r"""
    require $argv[1].'/vendor/autoload.php';
    $manifest = new Illuminate\Foundation\PackageManifest(
        new Illuminate\Filesystem\Filesystem(),
        $argv[1],
        $argv[1].'/bootstrap/cache/packages.php'
    );
    $manifest->build();
    if (! is_file($argv[1].'/bootstrap/cache/packages.php')) {
        throw new RuntimeException('Package manifest was not written.');
    }
    """, str(site / "_app")], check=True)
print("Normal and files-only extraction, runtime writes, Laravel package manifest, private-path protections and demo template verified.")
