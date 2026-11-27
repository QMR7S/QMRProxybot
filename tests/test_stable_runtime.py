import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("stable",ROOT/"tools/stable_runtime.py")
stable=importlib.util.module_from_spec(spec)
spec.loader.exec_module(stable)

class StableRuntime(unittest.TestCase):
    def test_exact_host_validation(self):
        self.assertEqual(stable.validate_host("bot.example.com"),"bot.example.com")
        for host in ("localhost","127.0.0.1","https://example.com","foo.trycloudflare.com",
                     "foo.local","example.com/path","foo@bar.com","a..com","-foo.com"):
            with self.subTest(host=host),self.assertRaises(ValueError):
                stable.validate_host(host)
    def test_verified_stage_without_secrets_or_db(self):
        manifest=stable.verify_source()
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/"stage"
            stable.prepare(target,"bot.example.com")
            self.assertEqual(stable.verify_source(),manifest)
            self.assertEqual(stable.target_host(target),"bot.example.com")
            for name in stable.MONITORS:
                content=(target/name).read_text()
                self.assertIn("host != 'bot.example.com'",content)
                self.assertNotIn(r"not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com',host or '')",content)
            guard=json.loads((target/stable.GUARDIAN/"manifest.json").read_text())
            self.assertTrue(all(stable.digest(target/p)==h for p,h in guard.items()))
            self.assertFalse((target/stable.BOT/"data/qmr.sqlite3").exists())
            self.assertFalse((target/stable.BOT/".secrets/bot_token").exists())
            with self.assertRaises(ValueError):
                stable.prepare(target,"bot.example.com")
    def test_preflight_refuses_wrong_receiver(self):
        with patch.object(stable,"public_dns"),patch.object(stable,"identity",side_effect=["a","b"]):
            with self.assertRaisesRegex(ValueError,"receiver mismatch"):
                stable.preflight("bot.example.com",samples=1)
    def test_preflight_refuses_unprotected_webhook(self):
        with patch.object(stable,"public_dns"),patch.object(stable,"identity",return_value="same"),patch.object(stable,"request",return_value=(200,b"{}")):
            with self.assertRaisesRegex(ValueError,"protection"):
                stable.preflight("bot.example.com",samples=1)
    def test_preflight_checks_routes_and_admin_gate(self):
        responses=[(403,b'{"error":"forbidden"}')]
        responses.extend((200,b'{"nodes":[{}]}') if r.endswith(".json") else (200,b"<html></html>") for r in stable.ROUTES)
        responses.extend([(401,b"{}"),(401,b"{}")])
        with patch.object(stable,"public_dns"),patch.object(stable,"identity",return_value="same"),patch.object(stable,"request",side_effect=responses):
            self.assertEqual(stable.preflight("bot.example.com",samples=1),"https://bot.example.com")

if __name__=="__main__":
    unittest.main()
