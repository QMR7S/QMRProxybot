import pathlib
import subprocess
import sys
import tempfile
import unittest
import json

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXE = ROOT / 'proxy-node' / 'export-node.py'

class ProxyNodeExportTests(unittest.TestCase):
    def run_export(self, args, config):
        return subprocess.run([sys.executable, str(EXE), '--config', str(config), *args],
                              capture_output=True, text=True)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = pathlib.Path(self.tmp.name) / 'config.toml'
        self.config.write_text('secret = "ee' + '12' * 16 + '6578616d706c652e636f6d"\nbind-to = "0.0.0.0:3128"\n')

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_unverified_inventory(self):
        p = self.run_export(['--server', '8.8.8.8'], self.config)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('--confirm-client-test', p.stderr)

    def test_preview_link_but_no_publication(self):
        p = self.run_export(['--server', '8.8.8.8', '--preview'], self.config)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('TEST LINK ONLY', p.stdout)
        self.assertIn('t.me/proxy?server=8.8.8.8', p.stdout)

    def test_reject_private_ip(self):
        p = self.run_export(['--server', '192.168.1.1', '--preview'], self.config)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('public', p.stderr)

    def test_reject_invalid_config(self):
        self.config.write_text('secret = "fake"\n')
        p = self.run_export(['--server', '8.8.8.8', '--preview'], self.config)
        self.assertNotEqual(p.returncode, 0)

    def test_explicitly_confirmed_json_only(self):
        p = self.run_export(['--server', '8.8.8.8', '--confirm-client-test'], self.config)
        self.assertEqual(p.returncode, 0, p.stderr)
        obj = json.loads(p.stdout)
        self.assertEqual(obj['nodes'][0]['server'], '8.8.8.8')
        self.assertEqual(obj['nodes'][0]['port'], 443)
        self.assertTrue(obj['nodes'][0]['secret'].startswith('ee'))

    def test_compose_uses_tcp_and_no_host_conflict(self):
        compose = (ROOT / 'proxy-node' / 'docker-compose.yml').read_text()
        self.assertIn('443:3128/tcp', compose)
        self.assertIn('nineseconds/mtg:2', compose)
        self.assertIn('no-new-privileges:true', compose)

if __name__ == '__main__':
    unittest.main()
