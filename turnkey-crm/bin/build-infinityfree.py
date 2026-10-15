#!/usr/bin/env python3
"""Build an InfinityFree release without booting Laravel or touching a database."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "deploy/infinityfree"
OUTPUT = ROOT / "storage/app/turnkey-deploy" / (
    "release-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
)
DOCROOT = OUTPUT / "htdocs"
APP = DOCROOT / "_app"
OMITTED = []
# These fonts cannot fit InfinityFree's 10 MB file limit. The demo is English.
LARGE_FONTS = {
    "public/fonts/NotoSansSC-Regular.ttf",
    "public/fonts/NotoSansSC-Bold.ttf",
    "vendor/mpdf/mpdf/ttfonts/Sun-ExtA.ttf",
    "vendor/mpdf/mpdf/ttfonts/Sun-ExtB.ttf",
}


def copy_tree(source, destination):
    for entry in sorted(source.iterdir()):
        relative = entry.relative_to(ROOT).as_posix()
        if entry.name in {".git", "node_modules", "tests", "Tests", "docs", ".github", ".DS_Store"}:
            continue
        if relative in LARGE_FONTS or entry.suffix in {".map", ".hot"}:
            OMITTED.append(relative)
            continue
        if relative.startswith("vendor/google/apiclient-services/src/"):
            service = Path(relative).parts[4]
            if service not in {"PeopleService", "PeopleService.php", "Oauth2", "Oauth2.php"}:
                continue
        if entry.is_symlink():
            raise RuntimeError("Unexpected symlink: " + relative)
        target = destination / entry.name
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            copy_tree(entry, target)
        else:
            destination.mkdir(parents=True, exist_ok=True)
            shutil.copy2(entry, target)


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=False)
    APP.mkdir(parents=True)
    for name in ["app", "config", "database", "resources", "routes", "packages"]:
        copy_tree(ROOT / name, APP / name)
    # Never carry local configuration, route or provider caches into a release.
    (APP / "bootstrap").mkdir(exist_ok=True)
    for name in ["app.php", "providers.php"]:
        shutil.copy2(ROOT / "bootstrap" / name, APP / "bootstrap" / name)
    for name in ["bootstrap/cache", "storage/framework/cache/data", "storage/framework/sessions",
                 "storage/framework/views", "storage/logs", "storage/app/public"]:
        write(APP / name / ".gitignore", "*\n!.gitignore\n")
    # Public assets only: omit the local storage symlink and local source maps.
    for entry in sorted((ROOT / "public").iterdir()):
        if entry.name in {"storage", ".htaccess", "index.php", "web.config"} or entry.suffix == ".hot":
            continue
        if entry.is_dir():
            copy_tree(entry, DOCROOT / entry.name)
        else:
            shutil.copy2(entry, DOCROOT / entry.name)
    for name, dest in [
        ("root.htaccess", DOCROOT / ".htaccess"),
        ("private.htaccess", APP / ".htaccess"),
        ("storage.htaccess", DOCROOT / "storage/.htaccess"),
        ("setup-access.php", APP / "setup-access.php"),
        ("index.php", DOCROOT / "index.php"),
    ]:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(TEMPLATES / name, dest)
    write(DOCROOT / "robots.txt", "User-agent: *\nDisallow: /\n")
    setup_token = secrets.token_hex(32)
    write(APP / "setup-token.php", "<?php\nreturn '" + setup_token + "';\n")
    template = (TEMPLATES / "hosting.env.example").read_text()
    write(APP / ".env.example", template)
    app_key = base64.b64encode(secrets.token_bytes(32)).decode()
    write(APP / ".env", template.replace("APP_KEY=\n", "APP_KEY=base64:" + app_key + "\n"))

    lock = json.loads((ROOT / "composer.lock").read_text())
    installed = json.loads((ROOT / "vendor/composer/installed.json").read_text())
    versions = {p["name"]: p["version"] for p in installed["packages"]}
    for package in lock["packages"]:
        if versions.get(package["name"]) != package["version"]:
            raise RuntimeError("Local dependency does not match lock: " + package["name"])
        path = Path("vendor") / package["name"]
        copy_tree(ROOT / path, APP / path)
    (APP / "vendor/composer").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "vendor/composer/installed.json", APP / "vendor/composer/installed.json")
    # Composer rebuilds installed.php and the autoloader; plugins and scripts are disabled.
    composer = json.loads((ROOT / "composer.json").read_text())
    composer["config"]["optimize-autoloader"] = False
    composer["config"]["bin-dir"] = str(OUTPUT / "unused-bin")
    write(APP / "composer.json", json.dumps(composer, indent=4) + "\n")
    shutil.copy2(ROOT / "composer.lock", APP / "composer.lock")
    for name in ["LICENSE", "LICENSE.md"]:
        if (ROOT / name).is_file():
            shutil.copy2(ROOT / name, APP / name)
    result = subprocess.run(
        ["composer", "install", "--no-dev", "--no-scripts", "--no-plugins",
         "--no-interaction", "--no-progress"],
        cwd=APP, env={**os.environ, "COMPOSER_DISABLE_NETWORK": "1"},
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if result.returncode:
        raise RuntimeError(result.stdout[-6000:])
    # A runtime release should not contain paths to the build machine.
    composer["config"]["bin-dir"] = "vendor/bin"
    write(APP / "composer.json", json.dumps(composer, indent=4) + "\n")

    files = sorted(p for p in DOCROOT.rglob("*") if p.is_file())
    for file in files:
        if file.is_symlink():
            raise RuntimeError("Symlink in release: " + str(file))
        size = file.stat().st_size
        limit = 10000 if file.name == ".htaccess" else (
            1000000 if file.suffix.lower() in {".php", ".html", ".htm"} else 10000000
        )
        if size >= limit:
            raise RuntimeError("File exceeds hosting limit: " + str(file.relative_to(DOCROOT)))
    # Protect private files first; activate the front controller last.
    priority = {".htaccess": -3, "_app/.htaccess": -2, "index.php": 2}
    files.sort(key=lambda p: (priority.get(p.relative_to(DOCROOT).as_posix(), 0), p.as_posix()))
    archive_dir = OUTPUT / "upload-zips"
    archive_dir.mkdir()
    parts, group, size = [], [], 0
    for file in files:
        cost = len(zlib.compress(file.read_bytes())) + len(file.relative_to(DOCROOT).as_posix()) * 2 + 200
        if group and size + cost > 8500000:
            parts.append(group)
            group, size = [], 0
        group.append(file)
        size += cost
    if group:
        parts.append(group)
    for i, part in enumerate(parts, 1):
        archive = archive_dir / ("turnkey-%02d-of-%02d.zip" % (i, len(parts)))
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as target:
            for file in part:
                target.write(file, file.relative_to(DOCROOT))
        if archive.stat().st_size >= 10000000:
            raise RuntimeError("Upload archive exceeds host limit")

    manifest = {
        "file_count": len(files),
        "uncompressed_bytes": sum(p.stat().st_size for p in files),
        "archive_count": len(parts),
        "omitted_oversized_fonts": sorted(LARGE_FONTS),
        "google_services_retained": ["PeopleService", "Oauth2"],
        "files": {p.relative_to(DOCROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
    }
    write(OUTPUT / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    instructions = (TEMPLATES / "START-HERE.txt").read_text()
    write(OUTPUT / "START-HERE.txt", instructions.replace(
        "PRIVATE_SETUP_URL", "https://turnkey-demo.is-great.org/install?setup_key=" + setup_token
    ).replace("ARCHIVE_COUNT", str(len(parts))))
    print(json.dumps({
        "release": str(OUTPUT), "files": len(files),
        "uncompressed_mb": round(manifest["uncompressed_bytes"] / 1000000, 1),
        "archives": [{"name": p.name, "bytes": p.stat().st_size} for p in archive_dir.iterdir()],
    }, indent=2))


if __name__ == "__main__":
    main()
