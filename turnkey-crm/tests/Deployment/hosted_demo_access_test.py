#!/usr/bin/env python3
"""Test the hosted demo page in an isolated PHP fixture with no application or DB."""
import http.client
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from urllib.parse import urlencode

from infinityfree_access_test import ROOT, TEMPLATES, free_port, server


def request(port, method="GET", query="", cookie=None, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if cookie:
        headers["Cookie"] = cookie
    connection.request(method, "/turnkey-demo-setup.php" + query, body=body, headers=headers)
    result = connection.getresponse()
    response = result.status, dict(result.getheaders()), result.read().decode()
    connection.close()
    return response


class HostedDemoAccessTest(unittest.TestCase):
    def test_private_confirmation_and_completion_gates_without_application_bootstrap(self):
        with tempfile.TemporaryDirectory(prefix="turnkey-demo-gate-") as temporary:
            root = Path(temporary)
            private = root / "_app"
            support = private / "packages/Webkul/Turnkey/src/Support"
            support.mkdir(parents=True)
            (private / "storage/framework").mkdir(parents=True)
            (private / "bootstrap/cache").mkdir(parents=True)
            shutil.copy2(TEMPLATES / "turnkey-demo-setup.php", root / "turnkey-demo-setup.php")
            shutil.copy2(ROOT / "packages/Webkul/Turnkey/src/Support/HostedDemoSetup.php", support)
            shutil.copy2(TEMPLATES / "setup-access.php", private / "setup-access.php")
            token = "a" * 64
            (private / "setup-token.php").write_text("<?php return '" + token + "';")
            port = free_port()
            cookie = "turnkey_demo_setup=" + token
            with server(["php", "-d", "opcache.enable_cli=0", "-d", "opcache.enable=0", "-S", "127.0.0.1:" + str(port), "-t", str(root)], port, root):
                for query in ["", "?setup_key=wrong", "?setup_key[]=invalid"]:
                    self.assertEqual(request(port, query=query)[0], 403)
                self.assertEqual(request(port, cookie="turnkey_demo_setup=wrong")[0], 403)
                self.assertEqual(request(port, method="POST", query="?setup_key=" + token)[0], 403)
                status, headers, body = request(port, query="?setup_key=" + token)
                self.assertEqual(status, 303)
                self.assertEqual(headers["Location"], "/turnkey-demo-setup.php")
                for flag in ["secure", "HttpOnly", "SameSite=Strict", "path=/turnkey-demo-setup.php"]:
                    self.assertIn(flag.lower(), headers["Set-Cookie"].lower())
                self.assertEqual(headers["Referrer-Policy"], "no-referrer")
                self.assertIn("no-store", headers["Cache-Control"])
                status, _, body = request(port, cookie=cookie)
                self.assertEqual(status, 200)
                self.assertIn("Load demo data and enable read-only", body)
                form = dict(re.findall(r'name="([^"]+)" value="([^"]+)"', body))
                for bad_form in [
                    dict(form, action="reset"),
                    dict(form, signature="wrong"),
                    dict(form, expiry="1"),
                    {"action": "prepare", "expiry[]": "invalid", "signature": "wrong"},
                ]:
                    self.assertEqual(request(port, method="POST", cookie=cookie, body=urlencode(bad_form))[0], 403)
                # A correctly authenticated POST still cannot load any app until preflight passes.
                status, _, body = request(port, method="POST", cookie=cookie, body=urlencode(form))
                self.assertEqual(status, 409)
                self.assertIn("Complete the initial CRM installation", body)
                (private / "storage/installed").write_text("installed")
                (private / "bootstrap/cache/config.php").write_text("<?php return [];")
                status, _, body = request(port, method="POST", cookie=cookie, body=urlencode(form))
                self.assertEqual(status, 409)
                self.assertIn("environment must not be cached", body)
                # An omitted gate patch stops setup before any app/bootstrap or database access.
                (private / "setup-access.php").write_text("<?php // old gate")
                status, _, body = request(port, method="POST", cookie=cookie, body=urlencode(form))
                self.assertEqual(status, 409)
                self.assertIn("Upload the updated _app/setup-access.php", body)
                shutil.copy2(TEMPLATES / "setup-access.php", private / "setup-access.php")
                # The private setup request can pass the maintenance gate to finish a retry.
                (private / "storage/turnkey-demo-preparing").write_text("preparing")
                status, _, body = request(port, method="POST", cookie=cookie, body=urlencode(form))
                self.assertEqual(status, 409)
                self.assertIn("environment must not be cached", body)
                self.assertTrue((private / "storage/turnkey-demo-preparing").exists())
                (private / "storage/turnkey-demo-live").write_text("complete")
                for method in ["GET", "POST"]:
                    status, _, body = request(port, method=method, cookie=cookie, body=urlencode(form))
                    self.assertEqual(status, 410)
                    self.assertIn("setup page is disabled", body)
                self.assertFalse((private / "vendor").exists())


if __name__ == "__main__":
    unittest.main()
