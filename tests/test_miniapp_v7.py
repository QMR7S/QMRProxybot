"""Static release gates for the EXISTING QMR Proxy v7 Mini App handoff.

These checks do not establish live proxy reachability, Telegram delivery, or Sites deployment.
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "handoff" / "miniapp-v7" / "site"


class MiniAppV7ReleaseTests(unittest.TestCase):
    def test_required_assets_present(self):
        for relative in (
            "index.html", "styles.css", "app.js", "sw.js",
            "telegram-miniapp.js", "manifest.webmanifest", "nodes.json",
            "assets/icon.svg", "assets/icon-192.png", "assets/icon-512.png",
            "assets/icons.svg", "assets/qmr-social-preview.png",
        ):
            with self.subTest(relative=relative):
                self.assertTrue((SITE / relative).is_file(), relative)

    def test_community_snapshot_is_60_unique_external_entries(self):
        data = json.loads((SITE / "nodes.json").read_text(encoding="utf-8"))
        nodes = data["nodes"]
        self.assertEqual(len(nodes), 60)
        self.assertEqual(len({n["id"] for n in nodes}), 60)
        for n in nodes:
            with self.subTest(id=n["id"]):
                self.assertEqual(n["source"], "third_party")
                self.assertEqual(n["ads_status"], "unknown")
                self.assertTrue(n["enabled"])
                self.assertTrue(n["server"].strip())
                self.assertTrue(n["secret"].strip())
                self.assertTrue(isinstance(n["port"], int) and 1 <= n["port"] <= 65535)

    def test_pwa_and_telegram_webapp_entrypoints(self):
        manifest = json.loads((SITE / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        self.assertEqual(manifest["start_url"], "./")
        for icon in manifest["icons"]:
            self.assertTrue((SITE / icon["src"]).is_file(), icon["src"])
        index = (SITE / "index.html").read_text(encoding="utf-8")
        for path in ("./app.js", "./telegram-miniapp.js", "./manifest.webmanifest"):
            self.assertIn(path, index)
        self.assertIn("https://telegram.org/js/telegram-web-app.js", index)
        bridge = (SITE / "telegram-miniapp.js").read_text(encoding="utf-8")
        self.assertIn("tg.ready()", bridge)

    def test_user_storage_and_backup_controls_present(self):
        script = (SITE / "app.js").read_text(encoding="utf-8")
        index = (SITE / "index.html").read_text(encoding="utf-8")
        self.assertIn("qmrproxy.personal.v3", script)
        self.assertIn("localStorage", script)
        for control in ("export-btn", "import-file-btn", "backup-file"):
            self.assertIn(control, script)
            self.assertIn(control, index)

    def test_service_worker_uses_versioned_cache(self):
        sw = (SITE / "sw.js").read_text(encoding="utf-8")
        self.assertIn("qmrproxy-shell-v7-miniapp", sw)
        self.assertIn("nodes.json", sw)
        self.assertIn("telegram-miniapp.js", sw)


if __name__ == "__main__":
    unittest.main()
