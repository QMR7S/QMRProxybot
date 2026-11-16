// Shared QMR Proxy Telegram interface. Default inline buttons use Telegram's
// theme-native transparent style; only the primary action uses primary color.
import { api, fetch as sdkFetch } from 'sdk';
import { getNodes } from './nodes.js';
import { getSetting, getStats } from './store.js';

export const OWNER_ID = 6246913670;
export const CHANNEL = '@QMR7S';
export const CHANNEL_URL = 'https://t.me/QMR7S';
export const SUPPORT_URL = 'https://t.me/QMRSupportbot';
export const SITE_URL = 'https://qmr-proxy.alialnyamy675.chatgpt.site';
export const IS_OWNER = id => Number(id) === OWNER_ID;
const btn = (text, data, style) => ({text,callback_data:data,...(style?{style}:{})});
const url = (text, link) => ({text,url:link});
export const keyboard = rows => ({inline_keyboard:rows});

export const text = {
  welcome:'◈ QMR Proxy | QMR7S\n\nدليل تفاعلي لبروكسيات MTProto وفتح روابط الاتصال بتيليجرام. يحتوي على روابط مجتمعية مستقلة، وليست خوادم مملوكة لنا.\n\n⛨ اشترك في قناة QMR7S ثم تحقق لتفتح قائمة الروابط.\n\nملاحظة: لا توجد ضمانات لتجاوز الحظر في العراق أو أمان مشغّل البروكسي أو عدم ظهور قناته الترويجية.',
  help:'📚 دليل QMR Proxy\n\n/start — القائمة الرئيسية\n/servers — أول 10 بروكسيات\n/servers 2 — الصفحة التالية (حتى 6)\n/proxy — قائمة الاتصال\n/channel — قناة QMR7S\n/steps — خطوات التوصيل\n/terms — شروط الاستخدام\n/privacy — الخصوصية\n/support — الدعم\n/delete_my_data — حذف بيانات حسابك المحفوظة في البوت\n\nتظهر قائمة البوت بعد التحقق من الاشتراك في القناة.',
  steps:'🧭 خطوات الاتصال\n\n1) اشترك في قناة QMR7S وتحقق من العضوية.\n2) اختر بروكسياً من قائمة /servers.\n3) افتح رابط tg://proxy أو رابط الويب البديل، ووافق على إضافة البروكسي من تيليجرام.\n4) إذا تعطل، جرّب خادماً آخر وفعّل Auto-Switch Proxies من إعدادات تيليجرام.\n5) عند تعذر فتح تيليجرام، استخدم موقعنا المستقل للحصول على الروابط.\n\nالموقع لا يفتح اتصال TCP بنفسه؛ يفعل ذلك خادم MTProto الخارجي.',
  terms:'📜 شروط الاستخدام\n\n• الروابط العامة تخص مشغّلين خارجيين وقد تختفي أو تتوقف دون إشعار.\n• لا تُستخدم الخدمة لإيذاء الآخرين أو لإرسال إزعاج أو انتهاك القانون.\n• لا نقدم ضماناً للسرعة أو التوفر أو تجاوز جميع أنواع الحجب.\n• قد يضيف مشغّل البروكسي قناة ترويجية لا نتحكم بها.\n• لا تستخدم بروكسياً غير موثوق في أنشطة تتطلب خصوصية إضافية.\n• الاشتراك في قناة QMR7S مطلوب للوصول إلى روابط البوت.\n• لا ترسل كلمات المرور أو رمز تسجيل الدخول لأي جهة.',
  privacy:'🔐 سياسة الخصوصية\n\n• لا نطلب رمز تسجيل دخول تيليجرام ولا كلمة المرور ولا رقم هاتفك.\n• يحتفظ البوت، بعد تفعيل قاعدة البيانات، بمعرّف حساب تيليجرام وتوقيت أول/آخر استخدام وعدد الأوامر وحالة الحظر، لأغراض التشغيل والإحصاء.\n• لا نحفظ نصوص المحادثات الخاصة أو قوائم جهات الاتصال.\n• يستطيع مشغّل البروكسي الخارجي معرفة عنوان IP وأوقات الاتصال التي تمر عبر خادمه.\n• قائمة الروابط المجتمعية مستقاة من مصدر مستقل؛ لا يمكن ضمان أمان مشغّليه.\n• /delete_my_data يحذف سجل حسابك من قاعدة بيانات البوت.\n• الدعم: @QMRSupportbot',
  about:'ℹ️ عن QMR Proxy\n\nمشروع QMR7S لتنظيم روابط MTProto.\nالموقع PWA قابل للتثبيت على الشاشة الرئيسية.\nالبوت يعمل على Telegram Serverless.\nالخوادم المدرجة مجتمعية، ليست ملكاً لـQMR7S.\nقد تظهر إعلانات أو قنوات من مشغّلي البروكسي.\n\nقناة التحديثات: @QMR7S\nالدعم: @QMRSupportbot',
  required:'🔒 الاشتراك مطلوب\n\nللحصول على روابط البروكسي من البوت، انضم إلى قناة @QMR7S ثم اضغط «تحقق من الاشتراك».\n\nلو كنت مشتركاً بالفعل ولم يتم التحقق، يلزم إضافة البوت مشرفاً في القناة ليستطيع فحص العضوية بصورة موثوقة.',
  failedCheck:'⚠️ تعذر التحقق من العضوية الآن. قد يكون البوت غير مشرف في قناة QMR7S أو أن Telegram لا يستجيب. لا يمكن تجاوز التحقق تلقائياً. تواصل مع @QMRSupportbot.',
  blocked:'⛔ هذا الحساب موقوف عن استخدام خدمات البوت. للاستفسار: @QMRSupportbot.',
  unavailable:'⚠️ خدمة الروابط متوقفة مؤقتاً للصيانة. تابع @QMR7S للإعلانات.',
};

export function home(owner=false) {
  const rows=[
    [btn('🌐 استعراض البروكسيات','q:servers:1','primary'),btn('📡 حالة القائمة','q:status')],
    [url('📲 فتح تطبيق QMR Proxy',SITE_URL)],
    [btn('🧭 طريقة الاتصال','q:steps'),btn('❔ التعليمات','q:help')],
    [btn('📜 الشروط','q:terms'),btn('🔐 الخصوصية','q:privacy')],
    [url('📣 قناة QMR7S',CHANNEL_URL),url('🛟 الدعم',SUPPORT_URL)],
  ];
  if (owner) rows.unshift([btn('⚙️ لوحة تحكم المالك','q:admin','primary')]);
  return keyboard(rows);
}
export function subscribeKeyboard() {return keyboard([
  [url('📣 اشترك في قناة QMR7S',CHANNEL_URL)],
  [btn('✅ تحقق من الاشتراك','q:verify','success')],
  [url('🛟 الدعم',SUPPORT_URL)],
]);}
export function backKeyboard() {return keyboard([[btn('⌂ القائمة الرئيسية','q:home')]]);}
export function genericScreen(name,owner) {
  if (name==='help'||name==='steps'||name==='terms'||name==='privacy'||name==='about') {
    return {text:text[name],reply_markup:backKeyboard()};
  }
  if (name==='support') return {text:'🛟 الدعم والتواصل\n\nأي مشكلة في الروابط أو الاشتراك أو استخدام التطبيق، تواصل مع @QMRSupportbot.\n\nلا ترسل رموز تسجيل الدخول أو كلمات المرور.',reply_markup:keyboard([[url('🛟 فتح الدعم',SUPPORT_URL)],[btn('⌂ القائمة','q:home')]])};
  if (name==='channel') return {text:'📣 القناة الرسمية: @QMR7S\nتابع الأخبار والتحديثات. ظهور قناة مختلفة أعلى تيليجرام يأتي من مالك البروكسي الخارجي ولا يغيّره البوت.',reply_markup:keyboard([[url('📣 فتح قناة QMR7S',CHANNEL_URL)],[btn('⌂ القائمة','q:home')]])};
  return {text:text.welcome,reply_markup:home(owner)};
}

function tgUrl(n) {
  return 'tg://proxy?server='+encodeURIComponent(n.server)+'&port='+n.port+'&secret='+encodeURIComponent(n.secret);
}
function webUrl(n) {
  return 'https://t.me/proxy?server='+encodeURIComponent(n.server)+'&port='+n.port+'&secret='+encodeURIComponent(n.secret);
}
export async function serversScreen(page=1) {
  const result=await getNodes(sdkFetch);
  const all=Array.isArray(result.nodes)?result.nodes:[];
  const max=Math.max(1,Math.ceil(all.length/10));
  const p=Math.min(max,Math.max(1,Number(page)||1));
  const listed=all.slice((p-1)*10,p*10);
  if (!listed.length) return {text:'لا توجد روابط مدرجة الآن. راجع الموقع أو حاول لاحقاً.',reply_markup:backKeyboard()};
  const lines=listed.map((n,i)=>{
    const ms=Number.isFinite(n.median_rtt_ms)?' · '+Math.round(n.median_rtt_ms)+'ms من المصدر':'';
    return String((p-1)*10+i+1).padStart(2,'0')+'. '+n.server+':'+n.port+ms;
  });
  const rows=listed.map((n,i)=>[url('🔗 '+String((p-1)*10+i+1).padStart(2,'0')+' · اتصال',webUrl(n))]);
  const nav=[];
  if (p>1) nav.push(btn('◀ السابق','q:servers:'+(p-1)));
  nav.push(btn(p+'/'+max,'q:status'));
  if (p<max) nav.push(btn('التالي ▶','q:servers:'+(p+1)));
  rows.push(nav);
  rows.push([btn('🔄 تحديث','q:servers:'+p),url('🌐 الموقع',SITE_URL)]);
  rows.push([btn('⌂ القائمة الرئيسية','q:home')]);
  return {
    text:'⚡ QMR Proxy — خوادم MTProto المجتمعية\n\n'+lines.join('\n')+ '\n\n'+
      '📅 فحص المصدر: '+result.updated_at+'\n'+
      '⚠️ فحص المصدر لا يعني أن الخوادم سريعة في العراق أو آمنة. قد يظهر إعلان قناة خارجية، ومشغّلو الخوادم غير تابعين لـQMR7S.',
    reply_markup:keyboard(rows)
  };
}
export async function statusScreen() {
  const res=await getNodes(sdkFetch);
  return {text:'📡 حالة بروكسيات QMR Proxy\n\n'+
    'عدد الروابط المدرجة: '+res.nodes.length+'\n'+
    'المصدر: '+(res.from==='remote'?'قائمة مُحدّثة من المصدر':'لقطة احتياطية من المصدر')+'\n'+
    'آخر فحص أعلن عنه المصدر: '+res.updated_at+'\n'+
    'القنوات الترويجية: غير مؤكدة\n'+
    'اختبار من شبكات العراق: غير متاح\n\n'+
    'لا نعرض عنواناً على أنه «متصل الآن» بناء على البيانات الخارجية وحدها.',reply_markup:keyboard([[btn('⚡ السيرفرات','q:servers:1','primary')],[btn('⌂ القائمة','q:home')]])};
}
export async function adminScreen() {
  let stats,maintenance,dbReady=true;
  try {stats=await getStats();maintenance=await getSetting('maintenance','0');}
  catch (_) {dbReady=false;stats=null;maintenance='0';}
  return {
    text:'⚙️ لوحة إدارة QMR Proxy | المالك\n\n🆔 6246913670\n'+
      (dbReady?'👥 المستخدمون: '+stats.total+'\n📈 نشطون خلال 7 أيام: '+stats.active+'\n⛔ المحظورون: '+stats.blocked+'\n':'⚠️ قاعدة البيانات غير مفعّلة؛ راجع فحص الترحيل.\n')+
      '🛠 وضع الصيانة: '+(maintenance==='1'?'مفعل':'متوقف')+'\n'+
      '🔐 فحص الاشتراك: مفروض على جميع المستخدمين باستثناء المالك\n'+
      '📣 القناة: @QMR7S\n🛟 الدعم: @QMRSupportbot',
    reply_markup:keyboard([
      [btn('📊 الإحصاءات','q:a:stats'),btn('📡 المصدر','q:a:source')],
      [btn(maintenance==='1'?'✅ إيقاف الصيانة':'⏸ تفعيل الصيانة','q:a:maintenance',maintenance==='1'?'success':'danger')],
      [btn('📢 إدارة الإشعارات','q:a:broadcast'),btn('🔐 الاشتراك','q:a:channel')],
      [btn('⌂ القائمة','q:home')]
    ])
  };
}
export function broadcastIntro() {
  return {text:'📢 إرسال تنبيه إداري\n\nأرسل في المحادثة الخاصة فقط:\n/broadcast نص الرسالة\n\nسأعرض معاينة وأطلب تأكيداً قبل الإرسال. التنفيذ يكون بحد أقصى 15 مستخدماً لكل دفعة لتجنب الضغط وحدود Telegram. يمكن إيقاف المسودة.\n\nتنبيه: الإرسال العام مسؤولية المالك، ويجب عدم إرسال رسائل غير مرغوبة.',reply_markup:backKeyboard()};
}
export async function sendScreen(chatId,screen,editMessageId=null) {
  const params={chat_id:chatId,...screen,link_preview_options:{is_disabled:true}};
  if (editMessageId) {
    try { return await api.editMessageText({...params,message_id:editMessageId}); }
    catch (_) { /* Older/deleted message or no text change; send replacement */ }
  }
  return api.sendMessage(params);
}

export async function checkSubscription(userId) {
  if (IS_OWNER(userId)) return {ok:true};
  try {
    const member=await api.getChatMember({chat_id:CHANNEL,user_id:userId});
    if (['creator','administrator','member'].includes(member?.status)) return {ok:true};
    if (member?.status==='restricted' && member?.is_member===true) return {ok:true};
    return {ok:false,reason:'not_joined'};
  } catch (_) { return {ok:false,reason:'unavailable'}; }
}
export function subscriptionScreen(check) {
  return {text:check?.reason==='unavailable'?text.failedCheck:text.required,reply_markup:subscribeKeyboard()};
}
