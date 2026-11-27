import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("stage",ROOT/"tools/cloud_v14_stage.py")
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)

class CloudStage(unittest.TestCase):
    def make_backup(self,root):
        backup=root/"backup";shutil.copytree(stage.REF,backup)
        for p in ("nodes.json","extra-proxies.json","quality-public-v119.json"):
            (backup/p).write_text('{"nodes":[]}')
        hashes={str(p.relative_to(backup)):stage.digest(p.read_bytes()) for p in backup.rglob("*") if p.is_file()}
        self.assertEqual(set(hashes),stage.EXPECTED)
        (backup/"backup-manifest.json").write_text(json.dumps({"sha256":hashes,"failed":[]}))
        return backup,hashes

    def test_exact_inventory_and_generated_javascript(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);backup,hashes=self.make_backup(root)
            release=root/"dist";files=stage.stage(backup,release,verify_live=False)
            self.assertEqual(len(files),40)
            self.assertEqual(set(files),stage.EXPECTED|{"source-live.js"})
            self.assertEqual(stage.verified(backup),hashes)
            self.assertEqual((release/"nodes.json").read_bytes(),(backup/"nodes.json").read_bytes())
            self.assertEqual((release/"extra-proxies.json").read_bytes(),(backup/"extra-proxies.json").read_bytes())
            for p in ("index.html","mini/index.html"):
                html=(release/p).read_text()
                self.assertIn("source-live.js?v=cloud14",html)
            self.assertIn("QMRSourceLive?.primary",(release/"app.js").read_text())
            self.assertIn("QMRSourceLive?.extra",(release/"mini/mini.js").read_text())
            self.assertIn("qmr_admin",(release/"admin/admin.js").read_text())
            self.assertIn("qmr_ops",(release/"ops/ops.js").read_text())
            self.assertIn("qmr-cloud14",(release/"sw.js").read_text())
            for f in release.rglob("*.js"):
                subprocess.run(["node","--check",str(f)],check=True,capture_output=True)

    def test_dns_failure_uses_verified_https_fallback(self):
        with patch.object(stage,"python_download",side_effect=stage.URLError("DNS failure")), patch.object(stage,"curl_download",return_value=b"actual remote content") as curl:
            self.assertEqual(stage.remote_digest("index.html"),stage.digest(b"actual remote content"))
            curl.assert_called_once_with(stage.BASE+"index.html?qmr_verify=14")

    def test_both_transports_unavailable_stops(self):
        with patch.object(stage,"python_download",side_effect=stage.URLError("DNS failure")), patch.object(stage,"curl_download",side_effect=OSError("curl exit 6")), patch.object(stage.time,"sleep"):
            with self.assertRaisesRegex(RuntimeError,"No deployment authorized"):
                stage.remote_digest("index.html")

    def test_no_fallback_on_invalid_body(self):
        with patch.object(stage,"python_download",return_value=b""), patch.object(stage,"curl_download") as curl:
            with self.assertRaisesRegex(ValueError,"invalid body size"):
                stage.remote_digest("index.html")
            curl.assert_not_called()

    def test_modified_backup_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);backup,_=self.make_backup(root)
            (backup/"app.js").write_text("tampered")
            with self.assertRaisesRegex(ValueError,"hash mismatch"):
                stage.stage(backup,root/"dist",verify_live=False)

    def test_live_hash_mismatch_refuses_replacement(self):
        with patch.object(stage,"remote_digest",return_value="bad"):
            with self.assertRaisesRegex(ValueError,"live static file changed"):
                stage.check_remote({"index.html":"good"})

    def test_no_blind_dashboard_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);backup,hashes=self.make_backup(root)
            p=backup/"admin/admin.js";p.write_text("changed live version")
            hashes["admin/admin.js"]=stage.digest(p.read_bytes())
            (backup/"backup-manifest.json").write_text(json.dumps({"sha256":hashes,"failed":[]}))
            with self.assertRaisesRegex(ValueError,"dashboard source diverged"):
                stage.stage(backup,root/"dist",verify_live=False)

if __name__=="__main__":
    unittest.main()
