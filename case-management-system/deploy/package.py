import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

from package_policy import PackagePolicy


parser = argparse.ArgumentParser(description="Build a local Casefile upload; never runs Artisan or publishes.")
parser.add_argument("--template", type=Path, default=PackagePolicy.ROOT / "storage/app/template/casefile-template.sqlite")
parser.add_argument("--output-root", type=Path)
arguments = parser.parse_args()
root = PackagePolicy.ROOT
template = PackagePolicy.scoped(arguments.template, root / "storage")
if not template.is_file():
    parser.error("Template missing. Build it separately with operator approval, or supply --template.")
template_hash = PackagePolicy.template(template)
for executable in ("composer", "php"):
    if shutil.which(executable) is None:
        parser.error(f"Required executable missing: {executable}")
stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
output = PackagePolicy.scoped(arguments.output_root or root / "storage/infinityfree" / stamp, root / "storage")
if template.is_relative_to(output):
    parser.error("Template must be outside the generated output directory.")
output.mkdir(mode=0o700, parents=True, exist_ok=False)
workspace = output / "workspace"
workspace.mkdir()
site = output / "casefile"
private = site / "_app"
private.mkdir(parents=True)
for directory in ("app", "config", "routes", "database/migrations", "resources/views"):
    source = PackagePolicy.scoped(root / directory, root)
    for item in source.rglob("*"):
        if item.is_symlink():
            raise ValueError(f"Source symlink rejected: {item}")
        if item.is_file():
            relative = item.relative_to(root)
            if not PackagePolicy.allowed("_app/" + relative.as_posix()):
                raise ValueError(f"Unexpected source file: {relative}")
            destination = private / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, destination)
for filename in ("bootstrap/app.php", "bootstrap/providers.php", "composer.json", "composer.lock"):
    source = PackagePolicy.scoped(root / filename, root)
    destination = private / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
for filename in ("composer.json", "composer.lock"):
    shutil.copy2(root / filename, workspace / filename)
source_lock = PackagePolicy.digest(root / "composer.lock")
environment = {key: value for key, value in os.environ.items() if not key.startswith("COMPOSER")}
environment.update({"COMPOSER_HOME": str(workspace / "composer-home"), "COMPOSER_CACHE_DIR": str(workspace / "composer-cache")})
subprocess.run([
    "composer", "install", "--no-dev", "--no-scripts", "--no-plugins",
    "--no-interaction", "--prefer-dist", "--no-progress",
], cwd=workspace, env=environment, check=True)
if PackagePolicy.digest(workspace / "composer.lock") != source_lock or PackagePolicy.digest(root / "composer.lock") != source_lock:
    raise ValueError("Composer lock changed")
for item in (workspace / "vendor").rglob("*"):
    if item.is_symlink():
        raise ValueError(f"Vendor symlink rejected: {item}")
    relative = item.relative_to(workspace)
    if item.is_file() and PackagePolicy.allowed("_app/" + relative.as_posix()):
        destination = private / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)
for relative in PackagePolicy.RUNTIME:
    directory = private / relative
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "index.html").write_text("", encoding="utf-8")
for filename in PackagePolicy.FIXTURES:
    source = PackagePolicy.scoped(root / "database/fixtures/attachments" / filename, root)
    destination = private / "database/fixtures/attachments" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
destination = site / PackagePolicy.TEMPLATE
destination.parent.mkdir(parents=True)
shutil.copy2(template, destination)
destination.chmod(0o444)
build = PackagePolicy.scoped(root / "public/build", root)
for item in build.rglob("*"):
    if item.is_symlink():
        raise ValueError(f"Build symlink rejected: {item}")
    if item.is_file():
        destination = site / "build" / item.relative_to(build)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if item.suffix in {".css", ".json"}:
            destination.write_text(item.read_text().replace("/build/", "/casefile/build/"), encoding="utf-8")
        else:
            shutil.copy2(item, destination)
for source, relative in (
    ("deploy/index.php", "index.php"), ("deploy/public.htaccess", ".htaccess"),
    ("deploy/private.htaccess", "_app/.htaccess"), ("deploy/.env.infinityfree.example", "_app/.env.example"),
    ("deploy/Instrument-Sans-OFL.txt", "build/Instrument-Sans-OFL.txt"),
):
    shutil.copy2(root / source, site / relative)
PackagePolicy.site(site)
manifest = []
for item in sorted(site.rglob("*")):
    if item.is_symlink():
        raise ValueError(f"Package symlink rejected: {item}")
    if item.is_file():
        relative = item.relative_to(site).as_posix()
        if not PackagePolicy.allowed(relative):
            raise ValueError(f"Forbidden package file: {relative}")
        if item.suffix.lower() == ".php" and item.stat().st_size > 1_000_000:
            raise ValueError(f"PHP file exceeds conservative shared-host limit: {relative}")
        manifest.append({"path": relative, "bytes": item.stat().st_size, "sha256": PackagePolicy.digest(item)})
if len(manifest) >= PackagePolicy.MAX_FILES:
    raise ValueError(f"Too many files: {len(manifest)}")
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
archive_path = output / "casefile-upload.zip"
with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(site.rglob("*")):
        archive.write(item, item.relative_to(output).as_posix())
subprocess.run([sys.executable, str(root / "deploy/verify-package.py"), str(archive_path)], check=True)
if PackagePolicy.digest(template) != template_hash:
    raise ValueError("Source template changed during packaging")
shutil.copy2(root / "docs/DEPLOYMENT.md", output / "DEPLOYMENT.md")
(output / "INSTRUCTIONS.txt").write_text(
    "Prepared locally only; no upload or remote verification.\n"
    "Confirm PHP 8.4+, pdo_sqlite, account file limits and Apache protections before sharing.\n"
    "Upload only casefile/ from casefile-upload.zip into htdocs.\n"
    "Create private _app/.env from _app/.env.example and set a fresh APP_KEY.\n"
    "Keep CASEFILE_MODE=demo; follow DEPLOYMENT.md for URL, cookies, permissions and checks.\n"
    "Never upload workspace/, this outer directory, ZIP, manifest or this instructions file.\n"
    "No Artisan, migrations, database importer or queue worker runs on the host.\n",
    encoding="utf-8",
)
print(f"Prepared package: {archive_path}")
print(f"Files: {len(manifest)}")
print(f"Template SHA-256: {template_hash}")
