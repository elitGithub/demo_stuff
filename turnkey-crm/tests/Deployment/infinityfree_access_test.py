#!/usr/bin/env python3
"""Exercise deployment gates against isolated fixtures, never the CRM database."""
import contextlib
import http.client
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / "deploy/infinityfree"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(port, path, cookie=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    connection.request("GET", path, headers={"Cookie": cookie} if cookie else {})
    result = connection.getresponse()
    response = result.status, dict(result.getheaders()), result.read().decode()
    connection.close()
    return response


@contextlib.contextmanager
def server(command, port, cwd):
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read().decode())
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                        break
                except OSError:
                    time.sleep(0.05)
            else:
                raise RuntimeError("Fixture server failed to start")
            yield
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


class HostingAccessTest(unittest.TestCase):
    def test_php_installer_gate(self):
        with tempfile.TemporaryDirectory(prefix="turnkey-gate-") as temporary:
            root = Path(temporary)
            (root / "storage").mkdir()
            shutil.copy2(TEMPLATES / "setup-access.php", root / "setup-access.php")
            token = "a" * 64
            (root / "setup-token.php").write_text("<?php return '" + token + "';")
            (root / "router.php").write_text("<?php require __DIR__.'/setup-access.php'; echo 'ALLOWED';")
            port = free_port()
            with server(["php", "-S", "127.0.0.1:" + str(port), str(root / "router.php")], port, root):
                for path in ["/install", "/install/api/run-migration", "/?setup_key=wrong", "/?setup_key[]=invalid"]:
                    self.assertEqual(request(port, path)[0], 403, path)
                self.assertEqual(request(port, "/install", "turnkey_setup=wrong")[0], 403)
                status, headers, body = request(port, "/install?setup_key=" + token)
                self.assertEqual(status, 303)
                self.assertEqual(headers["Location"], "/install")
                cookie = headers["Set-Cookie"]
                for flag in ["secure", "HttpOnly", "SameSite=Strict"]:
                    self.assertIn(flag.lower(), cookie.lower())
                self.assertEqual(request(port, "/install", "turnkey_setup=" + token)[2], "ALLOWED")
                # Finished installations no longer need the temporary setup cookie.
                (root / "storage/installed").write_text("installed")
                self.assertEqual(request(port, "/admin/login")[2], "ALLOWED")
                # Preparation takes precedence over the installed marker and setup cookie.
                (root / "storage/turnkey-demo-preparing").write_text("preparing")
                for path in ["/admin/login", "/admin/dashboard", "/install"]:
                    status, headers, body = request(port, path, "turnkey_setup=" + token)
                    self.assertEqual(status, 503)
                    self.assertNotIn("ALLOWED", body)
                    self.assertIn("no-store", headers["Cache-Control"])
                (root / "storage/turnkey-demo-preparing").unlink()
                self.assertEqual(request(port, "/admin/login")[2], "ALLOWED")
                (root / "storage/installed").unlink()
                (root / "setup-token.php").unlink()
                self.assertEqual(request(port, "/install")[0], 403)

    @unittest.skipUnless(shutil.which("apache2"), "Apache is required for rewrite/access verification")
    def test_apache_blocks_private_files_and_executable_uploads(self):
        with tempfile.TemporaryDirectory(prefix="turnkey-apache-") as temporary:
            root = Path(temporary)
            root.chmod(0o755)
            web = root / "htdocs"
            for directory in [web, web / "_app", web / "storage", web / "turnkey"]:
                directory.mkdir(exist_ok=True)
                directory.chmod(0o755)
            for source, dest in [
                ("root.htaccess", web / ".htaccess"),
                ("private.htaccess", web / "_app/.htaccess"),
                ("storage.htaccess", web / "storage/.htaccess"),
            ]:
                shutil.copy2(TEMPLATES / source, dest)
            for path in ["_app/.env", "_app/composer.json", "_app/setup-token.php", "storage/upload.php", "storage/upload.svg"]:
                (web / path).write_text("PRIVATE SENTINEL")
            (web / "index.php").write_text("PUBLIC ROUTE")
            (web / "turnkey/brand.css").write_text("PUBLIC ASSET")
            (web / "storage/avatar.png").write_text("PUBLIC IMAGE")
            port = free_port()
            modules = ["mpm_event", "authz_core", "authz_host", "dir", "rewrite"]
            config = [
                'ServerRoot "' + str(root) + '"',
                'PidFile "' + str(root / "apache.pid") + '"',
                'ErrorLog "' + str(root / "error.log") + '"',
                "Listen 127.0.0.1:" + str(port),
                "ServerName localhost",
                'DocumentRoot "' + str(web) + '"',
            ]
            for module in modules:
                config.append("LoadModule " + module + "_module /usr/lib/apache2/modules/mod_" + module + ".so")
            if os.geteuid() == 0:
                config.extend(["User www-data", "Group www-data"])
            config.extend([
                '<Directory "' + str(web) + '">',
                "AllowOverride All",
                "Options FollowSymLinks",
                "Require all granted",
                "</Directory>",
            ])
            (root / "httpd.conf").write_text("\n".join(config) + "\n")
            with server(["apache2", "-f", str(root / "httpd.conf"), "-X"], port, root):
                for path in ["/_app/composer.json", "/_app/.env", "/%5fapp/composer.json",
                             "/_app/setup-token.php", "/storage/upload.php", "/storage/upload.svg", "/.htaccess"]:
                    status, _, body = request(port, path)
                    self.assertEqual(status, 403, path + " " + body)
                    self.assertNotIn("PRIVATE SENTINEL", body)
                for path, content in [("/turnkey/brand.css", "PUBLIC ASSET"), ("/storage/avatar.png", "PUBLIC IMAGE"),
                                      ("/install", "PUBLIC ROUTE"), ("/admin/login", "PUBLIC ROUTE")]:
                    status, _, body = request(port, path)
                    self.assertEqual(status, 200, path + " " + body)
                    self.assertEqual(body, content)


if __name__ == "__main__":
    unittest.main()
