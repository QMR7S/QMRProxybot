import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("check",Path(__file__).resolve().parents[1]/"tools/cloud_static_check.py")
check=importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

class CloudStaticCheck(unittest.TestCase):
    def test_html_fallback_is_not_json(self):
        self.assertEqual(check.classify("/nodes.json",b"<html></html>"),("INVALID_JSON",None))
    def test_actual_inventory(self):
        self.assertEqual(check.classify("/nodes.json",b'{"nodes":[{}]}'),("JSON_OK",1))
        self.assertEqual(check.classify("/extra-proxies.json",b'{"nodes":[]}'),("EMPTY_INVENTORY",0))
    def test_wrong_schema(self):
        self.assertEqual(check.classify("/nodes.json",b'{"items":[]}'),("INVALID_INVENTORY",None))
    def test_html(self):
        self.assertEqual(check.classify("/mini/",b"<HTML>app</HTML>"),("HTML_OK",None))
        self.assertEqual(check.classify("/mini/",b"{}"),("NOT_HTML",None))
