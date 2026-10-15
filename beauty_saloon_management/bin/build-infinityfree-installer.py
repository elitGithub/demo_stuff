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
    replacements = {"PARTS": "[" + ",".join(f"'{name}'=>'{digest}'" for name, digest in parts.items()) + "]", "RELEASE_HASH": hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest(), "CODE_HASH": hashlib.sha256(code.encode()).hexdigest(), "PUBLIC_INDEX": base64.b64encode((public / "index.php").read_bytes()).decode()}
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

1. Open InfinityFree File Manager, then open htdocs.
2. Use Upload & Unzip for 01-setup.zip. Extract its contents directly into htdocs.
   This enables protection before the private application files are uploaded.
3. Use Upload & Unzip for 02-studio-payload.zip and 03-studio-payload.zip too.
   Extract both directly into htdocs, just like 01-setup.zip.
4. Open https://demo-sites.infinityfree.me/install-studio.php
   Enter this installation code:

   {code}

5. Click Continue, then Finish installation.
   The installer uses the files already extracted by File Manager.
   It creates missing runtime folders and checks the database before activation.
   If it reports a missing file, extract the payload ZIPs again and retry.
6. The installer verifies the application and fictional SQLite database, enables
   Studio at /studio/, then deletes the payload ZIPs and itself.

Salon website: https://demo-sites.infinityfree.me/studio/
Workspace: https://demo-sites.infinityfree.me/studio/login
Choose “Explore the demo”. Visitors can browse and download sample invoices.
Bookings, changes, outgoing messages and payments are disabled in this public demo.
No landing page or demo listing is created. Existing root pages are preserved.
No local extraction or MySQL setup is needed. Do not upload START-HERE.txt.

The existing partial Studio upload may remain: the installer completes it.
An existing active Studio is never overwritten.
If Finish reports an existing website, stop and review those files first.
This package includes a private fresh application key: keep it and this file private.
"""
    (output / "START-HERE.txt").write_text(instructions)
    for path in output.iterdir():
        path.chmod(0o600)
    print(json.dumps({"directory": str(output), "files": {p.name: p.stat().st_size for p in output.iterdir()}, "payload_sha256": parts}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    build(arguments.release.resolve(), arguments.output.resolve())
