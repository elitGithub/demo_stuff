import argparse
import json
from pathlib import Path
import tempfile
import zipfile

from package_policy import PackagePolicy


parser = argparse.ArgumentParser(description="Audit generated ZIP, read template immutably, remove only own extraction directories.")
parser.add_argument("archive", type=Path)
arguments = parser.parse_args()
archive_path = PackagePolicy.scoped(arguments.archive, PackagePolicy.ROOT / "storage")
manifest_path = PackagePolicy.scoped(archive_path.parent / "manifest.json", PackagePolicy.ROOT / "storage")
manifest = json.loads(manifest_path.read_text())
expected = {}
for entry in manifest:
    PackagePolicy.safe_name(entry["path"])
    if entry["path"] in expected:
        raise ValueError("Duplicate manifest path")
    expected[entry["path"]] = entry
with zipfile.ZipFile(archive_path) as archive:
    count = PackagePolicy.entries(archive)
    names = {entry.filename.removeprefix("casefile/") for entry in archive.infolist() if not entry.is_dir()}
    if names != set(expected):
        raise ValueError("Manifest file set differs from archive")
    for files_only in (False, True):
        with tempfile.TemporaryDirectory(prefix="verify-", dir=archive_path.parent) as temporary:
            for entry in archive.infolist():
                if not files_only or not entry.is_dir():
                    archive.extract(entry, temporary)
            site = Path(temporary) / "casefile"
            for relative, entry in expected.items():
                file = site / relative
                if file.stat().st_size != entry["bytes"] or PackagePolicy.digest(file) != entry["sha256"]:
                    raise ValueError(f"Manifest checksum mismatch: {relative}")
            PackagePolicy.site(site)
            for relative in PackagePolicy.RUNTIME:
                probe = site / "_app" / relative / "casefile-write-probe"
                probe.write_text("writable", encoding="utf-8")
                probe.unlink()
print(f"Verified ordinary and files-only extraction, checksums, assets, production dependencies, template and protections. Files: {count}")
