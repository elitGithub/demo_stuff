#!/usr/bin/env python3
"""Turn an existing verified release into a small manual-install handoff."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import secrets
import zipfile

SOURCE = Path(__file__).resolve().parents[1]
ROOT_HTACCESS = """Options -Indexes
DirectoryIndex index.html index.php
<FilesMatch "(?i)\\.zip$">
    Require all denied
</FilesMatch>
RewriteEngine On
RewriteRule (^|/)\\. - [F,L]
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://demo-sites.infinityfree.me%{REQUEST_URI} [R=301,L,NE]
"""


def build(release, output):
    public = release / "htdocs/studio"
    if not public.is_dir() or output.exists():
        raise ValueError("A verified release and a new output directory are required")
    output.mkdir(parents=True, mode=0o700)
    files = [p for p in sorted(public.rglob("*")) if p.is_file() and p not in [public / "index.php", public / ".htaccess", public / "_app/.htaccess"]]
    groups = [[], []]
    totals = [0, 0]
    for path in sorted(files, key=lambda p: p.stat().st_size, reverse=True):
        index = totals.index(min(totals))
        groups[index].append(path)
        totals[index] += path.stat().st_size
    parts = {}
    for number, group in enumerate(groups, 2):
        archive = output / f"{number:02d}-studio-payload.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as package:
            for path in sorted(group):
                package.write(path, path.relative_to(release / "htdocs"))
        if archive.stat().st_size >= 8_000_000:
            raise ValueError("Payload exceeds 8 MB; do not upload this incomplete handoff")
        parts[archive.name] = hashlib.sha256(archive.read_bytes()).hexdigest()
    code = secrets.token_hex(32)
    installer = (SOURCE / "bin/infinityfree/install-studio.php.template").read_text()
    replacements = {"PARTS": "[" + ",".join(f"'{name}'=>'{digest}'" for name, digest in parts.items()) + "]", "RELEASE_HASH": hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest(), "CODE_HASH": hashlib.sha256(code.encode()).hexdigest(), "PUBLIC_INDEX": base64.b64encode((public / "index.php").read_bytes()).decode(), "HUB_HTML": base64.b64encode((SOURCE / "deploy/infinityfree/hub.html").read_bytes()).decode()}
    for key, value in replacements.items():
        installer = installer.replace("{{" + key + "}}", value)
    with zipfile.ZipFile(output / "01-setup.zip", "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr(".htaccess", ROOT_HTACCESS)
        for path in [public / ".htaccess", public / "_app/.htaccess"]:
            package.write(path, path.relative_to(release / "htdocs"))
        for directory in ["bootstrap/cache", "storage/app/private", "storage/app/public", "storage/framework/cache/data", "storage/framework/sessions", "storage/framework/views", "storage/fonts", "storage/logs", ".installation"]:
            package.writestr("studio/_app/" + directory + "/", "")
        package.writestr("install-studio.php", installer)
    instructions = f"""STUDIO — INFINITYFREE INSTALLATION

Account: if0_43183405
Domain: demo-sites.infinityfree.me

1. Download Studio-InfinityFree.zip and extract it ON YOUR COMPUTER.
   Do not upload that outer archive, START-HERE.txt, or the installation code.
2. Open InfinityFree File Manager, then open htdocs.
3. Use Upload & Unzip for 01-setup.zip. Extract its contents directly into htdocs.
   This enables protection before the private application files are uploaded.
4. Use Upload Files for 02-studio-payload.zip and 03-studio-payload.zip.
   Leave both ZIP files in htdocs. Do not unzip them manually.
5. Open https://demo-sites.infinityfree.me/install-studio.php
   Enter this installation code:

   {code}

6. Click Install 02-studio-payload.zip, wait for success, then Install
   03-studio-payload.zip. Wait for success, then click Finish installation.
   Each step is safe to retry. The active website is protected against replacement.
   If an upload is incomplete, upload the same payload again and retry its button.
7. The installer verifies the application and fictional database, enables the
   demo collection and Studio, then deletes the payload ZIPs and itself.

Demo collection: https://demo-sites.infinityfree.me/
Salon website: https://demo-sites.infinityfree.me/studio/
Workspace: https://demo-sites.infinityfree.me/studio/login
Choose “Explore the demo”. Visitors can browse and download sample invoices.
Bookings, changes, outgoing messages and payments are disabled in this public demo.
Other demos can be added under their own subdirectories; the root has no catch-all.

The existing partial Studio upload may remain: the installer completes it.
An existing active Studio or root index.html/index.php is never overwritten.
If Finish reports an existing website, stop and review those files first.
This package includes a private fresh application key: keep it and this file private.
"""
    (output / "START-HERE.txt").write_text(instructions)
    with zipfile.ZipFile(output / "Studio-InfinityFree.zip", "w", zipfile.ZIP_STORED) as package:
        for name in ["01-setup.zip", *parts, "START-HERE.txt"]:
            package.write(output / name, name)
    for path in output.iterdir():
        path.chmod(0o600)
    print(json.dumps({"directory": str(output), "files": {p.name: p.stat().st_size for p in output.iterdir()}, "payload_sha256": parts}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    build(arguments.release.resolve(), arguments.output.resolve())
