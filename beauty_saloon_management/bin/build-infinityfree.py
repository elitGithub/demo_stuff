#!/usr/bin/env python3
"""Build a fresh, browse-only Studio installation for a shared-host subdirectory."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
from urllib.parse import urlsplit
import zipfile


SOURCE = Path(__file__).resolve().parents[1]
SOURCE_DIRECTORIES = ("app", "config", "resources", "routes", "database/migrations", "database/seeders", "database/factories")
SOURCE_FILES = ("artisan", "composer.json", "composer.lock", "bootstrap/app.php", "bootstrap/providers.php")
RUNTIME_DIRECTORIES = ("bootstrap/cache", "storage/app/private", "storage/app/public", "storage/framework/cache/data", "storage/framework/sessions", "storage/framework/views", "storage/fonts", "storage/logs")
PUBLIC_FILES = ("assets/studio.css", "assets/studio.js", "assets/salon-hero.jpg", "favicon.ico", "robots.txt")


def deployment_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not re.fullmatch(r"[A-Za-z0-9.-]+", parsed.netloc) or not re.fullmatch(r"/[a-z][a-z0-9-]*", parsed.path.rstrip("/")) or parsed.query or parsed.fragment:
        raise ValueError("URL must be HTTPS with one lowercase subdirectory, for example https://demo-sites.infinityfree.me/studio")
    return parsed.netloc, parsed.path.rstrip("/")


def copy_source(source, application, public):
    for relative in SOURCE_FILES:
        copy_regular_file(source / relative, application / relative)
    for relative in SOURCE_DIRECTORIES:
        for item in sorted((source / relative).rglob("*")):
            if item.is_symlink():
                raise ValueError(f"Source symlinks are not permitted: {item}")
            if item.is_file() and not any(part.startswith(".") for part in item.relative_to(source).parts):
                copy_regular_file(item, application / item.relative_to(source))
    for relative in PUBLIC_FILES:
        copy_regular_file(source / "public" / relative, public / relative)
    for relative in RUNTIME_DIRECTORIES:
        (application / relative).mkdir(parents=True, exist_ok=True)


def copy_regular_file(source, destination):
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"Expected regular source file: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def environment(url, path):
    values = {
        "APP_NAME": "Atelier", "APP_ENV": "production", "APP_KEY": "base64:" + base64.b64encode(secrets.token_bytes(32)).decode(),
        "APP_DEBUG": "false", "APP_URL": url, "APP_LOCALE": "en", "APP_FALLBACK_LOCALE": "en",
        "APP_MAINTENANCE_DRIVER": "file", "BCRYPT_ROUNDS": "12", "LOG_CHANNEL": "single", "LOG_LEVEL": "warning",
        "DB_CONNECTION": "sqlite", "SESSION_DRIVER": "file", "SESSION_LIFETIME": "120", "SESSION_ENCRYPT": "true",
        "SESSION_COOKIE": path.strip("/").replace("-", "_") + "_demo_session", "SESSION_PATH": path,
        "SESSION_SECURE_COOKIE": "true", "SESSION_HTTP_ONLY": "true", "SESSION_SAME_SITE": "lax",
        "BROADCAST_CONNECTION": "log", "FILESYSTEM_DISK": "local", "QUEUE_CONNECTION": "sync", "CACHE_STORE": "file",
        "MAIL_MAILER": "log", "MAIL_FROM_ADDRESS": "hello@example.com", "MAIL_FROM_NAME": "Atelier",
        "STUDIO_DEMO": "true", "STUDIO_PUBLIC_DEMO": "false", "STUDIO_NAME": "Atelier",
        "STUDIO_TIMEZONE": "Asia/Jerusalem", "STUDIO_CURRENCY": "USD", "STUDIO_TAX_PERCENT": "0",
        "STUDIO_DEMO_EMAIL": "hello@atelier.example",
    }
    return "\n".join(f"{key}={value}" for key, value in values.items()) + "\n"


def write_entrypoints(source, public, hostname):
    template = source / "bin/infinityfree"
    shutil.copyfile(template / "index.php", public / "index.php")
    (public / ".htaccess").write_text((template / "public.htaccess").read_text().replace("{{HOSTNAME}}", hostname))
    shutil.copyfile(template / "private.htaccess", public / "_app/.htaccess")


def clear_runtime(application):
    for relative in RUNTIME_DIRECTORIES:
        directory = application / relative
        shutil.rmtree(directory)
        directory.mkdir(parents=True)
    for item in (application / "database").glob("database.sqlite-*"):
        item.unlink()


def check_upload_limits(root):
    files = [item for item in root.rglob("*") if item.is_file()]
    for item in files:
        limit = 1_000_000 if item.suffix.lower() in (".php", ".html", ".htm") else 10_000_000
        if item.stat().st_size > limit:
            raise ValueError(f"Hosting upload limit exceeded: {item.relative_to(root)} ({item.stat().st_size} bytes; maximum {limit})")
        if item.is_symlink():
            raise ValueError(f"Unexpected upload symlink: {item}")
    return {"files": len(files), "bytes": sum(item.stat().st_size for item in files)}


def verify_staged_pdf(application, public, php, process_environment):
    script = r'''
require 'vendor/autoload.php';
$app = require 'bootstrap/app.php';
$app->usePublicPath($argv[1]);
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$invoice = App\Models\Invoice::with(['items', 'payment'])->firstOrFail();
$pdf = Barryvdh\DomPDF\Facade\Pdf::loadView('invoices.document', ['invoice' => $invoice, 'receipt' => false])->setPaper('a4')->output();
if (! str_starts_with($pdf, '%PDF-') || strlen($pdf) < 1000) {
    throw new RuntimeException('Staged invoice PDF failed to render.');
}
echo 'Staged invoice PDF rendered successfully ('.strlen($pdf).' bytes).'.PHP_EOL;
'''
    subprocess.run([php, "-r", script, "--", str(public)], cwd=application, env=process_environment, check=True)


def write_archives(output, public):
    archives = output / "archives"
    archives.mkdir(mode=0o700)
    protection = [public / ".htaccess", public / "_app/.htaccess"]
    activation = public / "index.php"
    files = [item for item in sorted(public.rglob("*")) if item.is_file() and item not in protection and item != activation]
    groups = []
    group, size = [], 0
    for item in files:
        if group and (len(group) >= 1000 or size + item.stat().st_size > 12_000_000):
            groups.append(group)
            group, size = [], 0
        group.append(item)
        size += item.stat().st_size
    if group:
        groups.append(group)
    results = []

    def write(name, entries, directories=()):
        destination = archives / name
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for item in entries:
                archive.write(item, item.relative_to(output / "htdocs"))
            for directory in directories:
                archive.write(directory, str(directory.relative_to(output / "htdocs")) + "/")
        destination.chmod(0o600)
        if destination.stat().st_size > 8_000_000:
            destination.unlink()
            if len(entries) < 2:
                raise ValueError(f"File cannot fit in an 8 MB upload archive: {entries[0]}")
            midpoint = len(entries) // 2
            write(name.replace(".zip", "-a.zip"), entries[:midpoint])
            write(name.replace(".zip", "-b.zip"), entries[midpoint:])
            return
        results.append({"file": str(destination), "bytes": destination.stat().st_size, "entries": len(entries) + len(directories), "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()})

    write("000-protection.zip", protection, [public / "_app" / directory for directory in RUNTIME_DIRECTORIES])
    for index, group in enumerate(groups, 1):
        write(f"{index:03d}-application.zip", group)
    write("999-activate.zip", [activation])
    return results


def build(output, url, php, composer):
    hostname, path = deployment_url(url)
    url = "https://" + hostname + path
    output = output.expanduser()
    if not output.is_absolute() or output.exists() or SOURCE == output or SOURCE in output.parents:
        raise ValueError("Output must be a new absolute directory outside the source application; existing paths are never overwritten")
    public = output / "htdocs" / path.strip("/")
    application = public / "_app"
    output.mkdir(parents=True, mode=0o700)
    copy_source(SOURCE, application, public)
    env_file = application / ".env"
    env_file.write_text(environment(url, path))
    env_file.chmod(0o600)
    (application / "database/database.sqlite").touch()
    # Only process settings needed by Composer are inherited; caller DB/APP values must never target a real database.
    process_environment = {key: value for key, value in os.environ.items() if key in ("PATH", "HOME", "TMPDIR", "COMPOSER_CACHE_DIR", "COMPOSER_HOME", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY")}
    process_environment["APP_ENV"] = "production"
    subprocess.run([php, composer, "install", "--no-dev", "--prefer-dist", "--no-interaction", "--optimize-autoloader"], cwd=application, env=process_environment, check=True)
    subprocess.run([php, "artisan", "migrate", "--seed", "--force", "--no-interaction"], cwd=application, env=process_environment, check=True)
    verify_staged_pdf(application, public, php, process_environment)
    subprocess.run([php, "artisan", "optimize:clear", "--no-interaction"], cwd=application, env=process_environment, check=True)
    clear_runtime(application)
    env_file.write_text(env_file.read_text().replace("STUDIO_PUBLIC_DEMO=false", "STUDIO_PUBLIC_DEMO=true"))
    write_entrypoints(SOURCE, public, hostname)
    summary = check_upload_limits(output / "htdocs")
    summary.update({"url": url, "public_directory": str(public), "php": php, "mode": "browse-only", "database": "fresh fictional SQLite", "composer_lock_sha256": hashlib.sha256((application / "composer.lock").read_bytes()).hexdigest(), "archives_in_upload_order": write_archives(output, public)})
    (output / "build-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New absolute output directory, outside the application")
    parser.add_argument("--url", default="https://demo-sites.infinityfree.me/studio")
    parser.add_argument("--php", default=shutil.which("php8.3") or shutil.which("php"))
    parser.add_argument("--composer", default=shutil.which("composer"))
    arguments = parser.parse_args()
    try:
        if not arguments.php or not arguments.composer:
            raise ValueError("PHP and Composer are required locally to build the upload")
        build(arguments.output, arguments.url, arguments.php, arguments.composer)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Build failed; do not upload partial output: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
