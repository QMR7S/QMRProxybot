import json, pathlib, unittest
R=pathlib.Path(__file__).resolve().parents[1]
class RepoChecks(unittest.TestCase):
 def test_inventory_shape(self):
  d=json.loads((R/'site/nodes.json').read_text(encoding='utf8'))
  self.assertIsInstance(d['nodes'],list)
 def test_no_automatic_pages_release(self):
  wf=(R/'.github/workflows/pages.yml').read_text()
  self.assertIn('workflow_dispatch:',wf)
  self.assertNotIn('branches: [main]',wf)
 def test_gitignore_credentials(self):
  g=(R/'.gitignore').read_text()
  for x in ('.env','.tgcloud/','runtime/','node_modules/'):self.assertIn(x,g)
 def test_handler_uses_serverless_sdk(self):
  self.assertIn("import { api } from 'sdk'",(R/'tgcloud/handlers/message.js').read_text())
 def test_no_pretend_nodes(self):
  self.assertEqual(json.loads((R/'site/nodes.json').read_text())['nodes'],[])
if __name__=='__main__':unittest.main()
