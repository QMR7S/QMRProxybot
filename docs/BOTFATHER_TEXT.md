# QMR Proxy BotFather profile and Main Mini App (v7)

**Warning:** revoke the leaked bot token before any Bot API call. The profile release script only prompts for a NEW token locally and never saves it.

## Name
QMR Proxy | QMR7S

## Short description — displayed on profile / shares
روابط MTProto متجددة وMini App تفاعلي من QMR7S. القناة @QMR7S • الدعم @QMRSupportbot

## Main description — when opening an empty chat
QMR Proxy من QMR7S — دليل تفاعلي لإدارة روابط بروكسي MTProto وفتحها داخل تيليجرام. استعرض الروابط المجتمعية، استخدم التطبيق المصغّر، وتعرّف على خطوات الإعداد والخصوصية. الروابط من مشغّلين خارجيين وليست خوادم خاصة بنا؛ قد تظهر قنوات ترويجية، ولا نضمن سرعة الاتصال أو تجاوزه للحظر في جميع الشبكات. التحديثات: @QMR7S | الدعم: @QMRSupportbot

## App URL (HTTPS)
https://qmr-proxy.alialnyamy675.chatgpt.site

## Main Mini App configuration
BotFather → My Bots → @QMRProxybot → Bot Settings → Configure Mini App → Main Mini App. Enable and specify the HTTPS URL above. Upload `assets/QMRProxy_main_app_preview_1080x1920.jpg` for media previews, and set the relevant title/short description.

## Profile photo
`assets/QMRProxy_avatar_512.jpg`; use `scripts/configure_profile.py --apply` with a ROTATED token or upload it manually through BotFather.

## Commands
/start - الرئيسية
/app - فتح QMR Proxy داخلياً
/servers - الروابط المجتمعية
/steps - خطوات الاتصال
/faq - أسئلة شائعة
/safety - إرشادات الأمان
/terms - الشروط
/privacy - الخصوصية
/support - الدعم
/help - دليل الاستخدام

Owner-only commands scoped to private owner chat: /admin, /stats, /broadcast, /maintenance.
