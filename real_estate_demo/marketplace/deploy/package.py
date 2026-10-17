"""Build a reviewable InfinityFree package. No database access, Artisan or publishing."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import subprocess
import zipfile

app = Path(__file__).resolve().parents[1]
demo = app.parent
assert app == Path("/var/www/demo_stuff/real_estate_demo/marketplace")
fixture = Path((demo / ".cache/latest-deploy-fixture.txt").read_text().strip()).resolve()
assert fixture.is_relative_to(demo / ".cache/deploy-fixtures")
assert (fixture / "import.sql").is_file()
assert (app / "public/build/manifest.json").is_file()

stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
out = demo / ".cache" / ("haven-infinityfree-" + stamp)
out.mkdir(mode=0o700, parents=True, exist_ok=False)
site = out / "haven"
private = site / "_app"
private.mkdir(parents=True)

for folder in ["app", "config", "routes"]:
    shutil.copytree(app / folder, private / folder)
(private / "bootstrap/cache").mkdir(parents=True)
for file in ["bootstrap/app.php", "bootstrap/providers.php", "composer.json", "composer.lock"]:
    shutil.copy2(app / file, private / file)
# Kept for later controlled upgrades, not executed on shared hosting.
shutil.copytree(app / "database/migrations", private / "database/migrations")
shutil.copytree(app / "resources/views", private / "resources/views")
for folder in ["storage/app/private/request-photos", "storage/framework/cache/data",
               "storage/framework/sessions", "storage/framework/views", "storage/logs"]:
    (private / folder).mkdir(parents=True, exist_ok=True)
shutil.copytree(fixture / "photos", private / "storage/app/private/request-photos", dirs_exist_ok=True)
# Web file managers may ignore ZIP directory entries. Retain real, non-hidden
# files so required runtime paths survive extraction even when initially empty.
for folder in ["bootstrap/cache", "storage/app/private/request-photos",
               "storage/framework/cache/data", "storage/framework/sessions",
               "storage/framework/views", "storage/logs"]:
    directory = private / folder
    directory.chmod(0o755)
    marker = directory / "index.html"
    marker.write_text("<!-- Required Haven runtime directory. Keep this file. -->\n")
    marker.chmod(0o644)
for folder in ["build", "images"]:
    shutil.copytree(app / "public" / folder, site / folder)
for file in ["favicon.ico", "robots.txt"]:
    if (app / "public" / file).is_file():
        shutil.copy2(app / "public" / file, site / file)
shutil.copy2(app / "deploy/index.php", site / "index.php")
shutil.copy2(app / "deploy/public.htaccess", site / ".htaccess")
shutil.copy2(app / "deploy/private.htaccess", private / ".htaccess")
shutil.copy2(app / "deploy/.env.infinityfree.example", private / ".env.example")
shutil.copy2(fixture / "import.sql", out / "import-into-empty-database.sql")
shutil.copy2(app / "docs/DEPLOYMENT.md", out / "DEPLOYMENT.md")

subprocess.run(["composer", "install", "--no-dev", "--no-scripts", "--no-plugins",
                "--classmap-authoritative", "--no-interaction", "--prefer-dist"],
               cwd=private, check=True)
# Composer's generated public metadata references only production packages.
manifest = []
for file in sorted(site.rglob("*")):
    if file.is_symlink():
        raise RuntimeError("Symlinks are not permitted in the deployment: " + str(file))
    if not file.is_file():
        continue
    relative = file.relative_to(site).as_posix()
    if relative.endswith((".sqlite", ".log")) or relative in ["_app/.env", "import.sql"]:
        raise RuntimeError("Unexpected runtime or private environment file: " + relative)
    if file.suffix.lower() == ".php" and file.stat().st_size > 1_000_000:
        raise RuntimeError("PHP file exceeds conservative shared-host upload limit: " + relative)
    manifest.append({"path": relative, "bytes": file.stat().st_size,
                     "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
(out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
with zipfile.ZipFile(out / "haven-upload.zip", "x", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(site.rglob("*")):
        archive.write(file, file.relative_to(out))
subprocess.run(["python3", str(app / "deploy/verify-package.py"), str(out / "haven-upload.zip")], check=True)
(out / "READY.txt").write_text(
    "Prepared locally; not uploaded.\n"
    "1. Confirm PHP 8.4+ and a NEW EMPTY MySQL database.\n"
    "2. Review/import import-into-empty-database.sql through phpMyAdmin.\n"
    "3. Upload the haven directory inside htdocs.\n"
    "4. Create _app/.env from .env.example with a NEW key and host credentials.\n"
    "5. Keep MODE=demo; match APP_URL and SESSION_PATH to the actual directory.\n"
    "6. Verify private-path denials and read-only behavior before sharing.\n"
    "Never upload the SQL, manifest or this package's outer directory as a website.\n"
)
(demo / ".cache/latest-infinityfree-package.txt").write_text(str(out))
print("Prepared package:", out)
print("Files:", len(manifest), "Bytes:", sum(item["bytes"] for item in manifest))
