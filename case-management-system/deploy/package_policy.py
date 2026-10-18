from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import sqlite3
import stat


class PackagePolicy:
    ROOT = Path(__file__).resolve().parents[1]
    TEMPLATE = "_app/storage/app/template/casefile-template.sqlite"
    RUNTIME = (
        "bootstrap/cache", "storage/app/sandboxes", "storage/framework/cache/data",
        "storage/framework/sessions", "storage/framework/views", "storage/logs",
    )
    RUNTIME_MARKER = "<!-- Required Casefile runtime directory. Keep this file. -->\n"
    FIXTURES = (
        "furnace-filter-invoice.pdf", "snow-clearing-quote.pdf",
        "kitchen-sink-leak.png", "thermostat-error.png",
    )
    BLOCKED = {"tests", "test", "node_modules", ".git", ".github", "__pycache__"}
    MAX_FILES = 12000
    MAX_BYTES = 400_000_000

    @staticmethod
    def scoped(path, base):
        path = Path(path).absolute()
        base = Path(base).resolve()
        if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
            raise ValueError(f"Symlink path rejected: {path}")
        resolved = path.resolve()
        if not resolved.is_relative_to(base) or resolved == base:
            raise ValueError(f"Path must be below {base}: {path}")
        return resolved

    @staticmethod
    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    @staticmethod
    def safe_name(name):
        path = PurePosixPath(name)
        if (not name or "\\" in name or ":" in name or "\x00" in name
                or path.is_absolute() or any(part in {"", ".", ".."} for part in name.rstrip("/").split("/"))):
            raise ValueError(f"Unsafe archive path: {name}")
        return path

    @classmethod
    def allowed(cls, relative):
        path = PurePosixPath(relative)
        lowered = tuple(part.lower() for part in path.parts)
        if any(part in cls.BLOCKED for part in lowered):
            return False
        if path.name == ".env" or (path.name.startswith(".env.") and relative != "_app/.env.example"):
            return False
        if path.suffix.lower() in {".sqlite", ".db", ".sqlite3"} and relative != cls.TEMPLATE:
            return False
        if path.name.endswith(("-wal", "-shm", "-journal", ".log")) or path.name == "hot":
            return False
        return True

    @classmethod
    def template(cls, path):
        before = cls.digest(path)
        connection = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
                raise ValueError("Template SQLite integrity check failed")
            for table, expected in (("cases", 16), ("mailbox_messages", 43), ("script_entries", 20)):
                count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if count != expected:
                    raise ValueError(f"Template {table}: expected {expected}, got {count}")
            schema = connection.execute("SELECT schema_version FROM installation_meta").fetchall()
            expected_schema = max(file.stem for file in (cls.ROOT / "database/migrations").glob("*.php"))
            if schema != [(expected_schema,)]:
                raise ValueError(f"Template schema does not match source migrations: {schema}")
        finally:
            connection.close()
        if cls.digest(path) != before:
            raise ValueError("Template changed during read-only validation")
        return before

    @classmethod
    def asset(cls, site, reference):
        if reference.startswith("/casefile/build/"):
            reference = reference.removeprefix("/casefile/")
        elif reference.startswith("assets/"):
            reference = "build/" + reference
        else:
            raise ValueError(f"Unexpected asset reference: {reference}")
        cls.safe_name(reference)
        if not (site / reference).is_file():
            raise ValueError(f"Missing asset: {reference}")

    @classmethod
    def assets(cls, site):
        manifest = json.loads((site / "build/manifest.json").read_text())
        for entry in manifest.values():
            cls.asset(site, entry["file"])
            for reference in entry.get("css", []) + entry.get("assets", []):
                cls.asset(site, reference)
            for reference in entry.get("imports", []) + entry.get("dynamicImports", []):
                if reference not in manifest:
                    raise ValueError(f"Missing manifest import: {reference}")
        for required in ("resources/css/app.css", "resources/js/app.js"):
            if required not in manifest:
                raise ValueError(f"Missing Vite entry: {required}")
        fonts = json.loads((site / "build/fonts-manifest.json").read_text())
        cls.asset(site, fonts["style"]["file"])
        for preload in fonts["preloads"]:
            cls.asset(site, preload["file"])
        for family in fonts["families"].values():
            for variant in family["variants"].values():
                for file in variant["files"]:
                    cls.asset(site, file["file"])
        styles = list(fonts["style"]["familyStyles"].values())
        styles.extend(file.read_text() for file in (site / "build").rglob("*.css"))
        for style in styles:
            for reference in re.findall(r"url\([\"']?([^\)\"']+)[\"']?\)", style):
                if not reference.startswith("data:"):
                    cls.asset(site, reference)
        license_text = (site / "build/Instrument-Sans-OFL.txt").read_text()
        if "Copyright 2022 The Instrument Sans Project Authors" not in license_text or "SIL OPEN FONT LICENSE Version 1.1" not in license_text:
            raise ValueError("Instrument Sans redistribution notice is missing")

    @classmethod
    def site(cls, site):
        required = (
            "index.php", ".htaccess", "_app/.htaccess", "_app/.env.example",
            "_app/vendor/autoload.php", "_app/bootstrap/app.php", "_app/bootstrap/providers.php",
            "_app/composer.json", "_app/composer.lock", cls.TEMPLATE,
        )
        for relative in required:
            if not (site / relative).is_file():
                raise ValueError(f"Missing package file: {relative}")
        for shipped, source in ((".htaccess", "public.htaccess"), ("_app/.htaccess", "private.htaccess"), ("index.php", "index.php")):
            if (site / shipped).read_bytes() != (cls.ROOT / "deploy" / source).read_bytes():
                raise ValueError(f"Deployment protection/entry point differs: {shipped}")
        environment = (site / "_app/.env.example").read_text().splitlines()
        for setting in ("CASEFILE_MODE=demo", "APP_DEBUG=false", "APP_KEY=", "SESSION_DRIVER=file", "CACHE_STORE=file", "SESSION_PATH=/casefile", "SESSION_COOKIE=casefile_session"):
            if setting not in environment:
                raise ValueError(f"Unsafe environment default: {setting}")
        for relative in cls.RUNTIME:
            marker = site / "_app" / relative / "index.html"
            if not marker.is_file() or marker.read_text() != cls.RUNTIME_MARKER:
                raise ValueError(f"Missing or empty runtime directory marker: {relative}")
        for filename in cls.FIXTURES:
            source = cls.ROOT / "database/fixtures/attachments" / filename
            shipped = site / "_app/database/fixtures/attachments" / filename
            if not shipped.is_file() or cls.digest(source) != cls.digest(shipped):
                raise ValueError(f"Fixture missing or changed: {filename}")
        installed = json.loads((site / "_app/vendor/composer/installed.json").read_text())
        locked = json.loads((site / "_app/composer.lock").read_text())
        actual_packages = {(entry["name"], entry["version"]) for entry in installed["packages"]}
        expected_packages = {(entry["name"], entry["version"]) for entry in locked["packages"]}
        if installed["dev"] or actual_packages != expected_packages:
            raise ValueError("Installed vendor does not match locked production dependencies")
        cls.assets(site)
        return cls.template(site / cls.TEMPLATE)

    @classmethod
    def entries(cls, archive):
        names = set()
        total_bytes = 0
        files = 0
        for entry in archive.infolist():
            path = cls.safe_name(entry.filename)
            if entry.filename.casefold() in names:
                raise ValueError(f"Duplicate archive entry: {entry.filename}")
            names.add(entry.filename.casefold())
            if path.parts[0] != "casefile":
                raise ValueError(f"Unexpected archive root: {entry.filename}")
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f"Symlink archive entry: {entry.filename}")
            if not cls.allowed(path.relative_to("casefile").as_posix()):
                raise ValueError(f"Forbidden package file: {entry.filename}")
            if not entry.is_dir():
                if entry.file_size == 0:
                    raise ValueError(f"Empty archive file would be dropped by host extraction: {entry.filename}")
                files += 1
                total_bytes += entry.file_size
        if files == 0 or files >= cls.MAX_FILES or total_bytes > cls.MAX_BYTES:
            raise ValueError(f"Archive exceeds package limits: {files} files, {total_bytes} bytes")
        return files
