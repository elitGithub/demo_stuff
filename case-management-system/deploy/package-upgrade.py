#!/usr/bin/env python3
"""Transform a reviewed full Casefile ZIP into an existing-install overlay."""

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import stat
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    if arguments.source.is_symlink() or arguments.output.exists():
        parser.error("Source must not be a symlink; output must be new.")

    excluded_prefixes = (
        "casefile/_app/storage/",
        "casefile/_app/bootstrap/cache/",
        "casefile/_app/database/fixtures/attachments/",
    )
    with ZipFile(arguments.source) as source:
        if source.testzip() is not None:
            parser.error("Source ZIP failed its CRC check.")
        retained = []
        names = set()
        for member in source.infolist():
            name = member.filename
            parts = PurePosixPath(name).parts
            if (
                not name.startswith("casefile/")
                or "\\" in name
                or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
                or stat.S_ISLNK(member.external_attr >> 16)
                or name.casefold() in names
            ):
                parser.error("Unsafe, duplicate or unexpected source member: " + name)
            names.add(name.casefold())
            if name.startswith(excluded_prefixes):
                continue
            leaf = parts[-1]
            if (
                (leaf.startswith(".env") and leaf != ".env.example")
                or re.search(r"\.(?:sqlite(?:3)?|db|key|log)(?:-(?:wal|shm|journal))?$", leaf, re.I)
                or leaf in ("auth.json", "credentials.json")
            ):
                parser.error("Unexpected protected data outside excluded trees: " + name)
            retained.append((member, source.read(member)))

    digest = hashlib.sha256()
    for member, content in sorted(retained, key=lambda entry: entry[0].filename):
        digest.update(member.filename.encode() + b"\0")
        digest.update(hashlib.sha256(content).digest())
    release_id = digest.hexdigest()[:24]
    anchor = b"$app->usePublicPath(__DIR__);\n"
    hook = (
        "$app->afterBootstrapping(\\Illuminate\\Foundation\\Bootstrap\\LoadConfiguration::class, static function (Application $application): void {\n"
        "    $application['config']->set('view.compiled_extension', 'casefile-"
        + release_id
        + ".php');\n"
        "});\n"
    ).encode()
    entry_count = 0
    for member, content in retained:
        if member.filename == "casefile/index.php":
            entry_count += 1
            if content.count(anchor) != 1 or b"compiled_extension" in content:
                parser.error("Source entry point is not the expected unmodified full-package entry.")
    if entry_count != 1:
        parser.error("Source must contain exactly one Casefile entry point.")

    with arguments.output.open("xb") as destination:
        with ZipFile(destination, "w") as output:
            for member, content in sorted(retained, key=lambda entry: entry[0].filename == "casefile/index.php"):
                if member.filename == "casefile/index.php":
                    content = content.replace(anchor, anchor + hook)
                output.writestr(member, content)
    print("Release ID:", release_id)
    print("Files:", len(retained))
    print("Bytes:", arguments.output.stat().st_size)
    print("SHA-256:", hashlib.sha256(arguments.output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
