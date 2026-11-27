import pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class ProfileV7(unittest.TestCase):
 def test_profile_is_secure(self):
  p=(ROOT/'scripts/configure_profile.py').read_text()
  for x in ['getpass.getpass','setMyProfilePhoto','setMyDescription','setMyShortDescription','setChatMenuButton','getMe','--apply']:
   self.assertIn(x,p)
  for x in ["call(token,'setWebhook'", "call(token,'deleteWebhook'"]:
   self.assertNotIn(x,p)
 def test_jpg_avatar_exists(self):
  p=ROOT/'assets/QMRProxy_avatar_512.jpg'
  self.assertTrue(p.exists())
  self.assertTrue(p.read_bytes().startswith(bytes([255,216,255])))
 def test_mini_app_button_is_real_webapp(self):
  s=(ROOT/'tgcloud/lib/ui.js').read_text()
  self.assertIn('web_app:{url:MINI_APP_URL}',s)
  self.assertIn("MINI_APP_URL = 'https://app9239734904.tgcloud.ai/mini/'",s)
  self.assertIn("SITE_URL = 'https://qmr-proxy.alialnyamy675.chatgpt.site'",s)
  self.assertIn('q:faq',s)
  self.assertIn('q:safety',s)
 def test_owner_authorization_is_preserved(self):
  s=(ROOT/'tgcloud/lib/ui.js').read_text()
  self.assertIn('6246913670',s)
  self.assertIn("CHANNEL = '@QMR7S'",s)
if __name__=='__main__':unittest.main()
