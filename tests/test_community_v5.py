import json
import pathlib
import unittest
R = pathlib.Path(__file__).resolve().parents[1]
class CommunityV5(unittest.TestCase):
 def test_60_real_attributed_external_nodes(self):
  d = json.loads((R/'handoff/community-v5/nodes.json').read_text())
  self.assertEqual(len(d['nodes']),60)
  self.assertEqual(len({(n['server'],n['port']) for n in d['nodes']}),60)
  self.assertTrue(all(n['source']=='third_party' and n['ads_status']=='unknown' for n in d['nodes']))
 def test_no_bot_webhook_mutation(self):
  source=(R/'tgcloud/handlers/message.js').read_text()
  self.assertIn("fetch as sdkFetch",source)
  self.assertIn("https://t.me/QMR7S",source)
  self.assertNotIn('deleteWebhook',source)
  self.assertNotIn('webhook sync',source)
 def test_dynamic_source_has_stale_and_ads_guards(self):
  source=(R/'tgcloud/lib/source.js').read_text()
  self.assertIn("n.ads?.status !== 'present'",source)
  self.assertIn("Date.now() - stamp > MAX_AGE_MS",source)
  self.assertIn("fetch",source)
if __name__=='__main__':
 unittest.main()
