import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class MaintenanceTools(unittest.TestCase):
    def checkout(self, destination):
        for item in ('scripts', 'tgcloud', 'site', '.gitignore'):
            source = ROOT / item
            target = destination / item
            if source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)

    def test_static_generator_preserves_live_feed_module(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout = pathlib.Path(directory)
            self.checkout(checkout)
            module = checkout / 'tgcloud/lib/nodes.js'
            before = module.read_bytes()
            result = subprocess.run(
                ['python3', 'scripts/sync_nodes.py'], cwd=checkout,
                text=True, capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Refusing to replace the live-feed module', result.stderr)
            self.assertEqual(module.read_bytes(), before)

    def test_root_audit_accepts_unchanged_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout = pathlib.Path(directory)
            self.checkout(checkout)
            subprocess.run(['git', 'init', '-q'], cwd=checkout, check=True)
            (checkout / '.tgcloud').mkdir()
            tools = checkout / 'mock-bin'
            tools.mkdir()
            npx = tools / 'npx'
            npx.write_text('#!/bin/sh\ncase "$*" in\n'
                           '"tgcloud fetch") exit 0 ;;\n'
                           '"tgcloud --no-pager status") echo "app9239734904: No changes" ;;\n'
                           '*) exit 99 ;;\nesac\n')
            npx.chmod(0o700)
            env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'])
            result = subprocess.run(['bash', 'scripts/repair-tgcloud-root.sh'],
                                    cwd=checkout, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('READY FOR REVIEW', result.stdout)
