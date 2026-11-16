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
const appButton = (label = '✨ فتح تطبيق QMR Proxy') => ({text:label,web_app:{url:SITE_URL},style:'primary'});
export const keyboard = rows => ({inline_keyboard:rows});

export const text = {
  welcome:'◈ QMR Proxy | QMR7S\n\nدليل تفاعلي لبروكسيات MTProto وفتح روابط الاتصال بتيليجرام. يحتوي على روابط مجتمعية مستقلة، وليست خوادم مملوكة لنا.\n\n⛨ اشترك في قناة QMR7S ثم تحقق لتفتح قائمة الروابط.\n\nملاحظة: لا توجد ضمانات لتجاوز الحظر في العراق أو أمان مشغّل البروكسي أو عدم ظهور قناته الترويجية.',
  help:'📚 دليل QMR Proxy | مركز المساعدة\n\n✨ /app — التطبيق المصغّر داخل تيليجرام\n🌐 /servers — قائمة الروابط (60 عنواناً مجتمعياً)\n🧭 /steps — خطوات الإعداد على الهاتف\n💡 /faq — إجابات الأسئلة الشائعة\n🛡️ /safety — الأمان وتقييم الروابط\n📜 /terms — شروط الاستخدام\n🔐 /privacy — سياسة الخصوصية\n🛟 /support — التواصل مع الدعم\n🗑 /delete_my_data — حذف سجل حسابك في البوت\n\n• لا تطلب الخدمة رمز تسجيل الدخول أو كلمة المرور.\n• عند تعذر فتح تيليجرام، يمكن الوصول للموقع المستقل مباشرة.',
  steps:'🧭 طريقة الاتصال — 5 خطوات\n\n01 — اشترك في @QMR7S، ثم اضغط «تحقق» داخل البوت.\n02 — افتح «استعراض البروكسيات» أو «فتح QMR Proxy داخل تيليجرام».\n03 — اختر رابط MTProto؛ سيعرض تيليجرام نافذة إضافة البروكسي. وافق بعد مراجعة البيانات.\n04 — افتح الإعدادات ← البيانات والتخزين ← إعدادات البروكسي، وفعّل بروكسياً احتياطياً والتبديل التلقائي إن كان متاحاً.\n05 — إذا فشل الاتصال، جرب رابطاً آخر أو شبكة مختلفة، ولا تكرر تسجيل الدخول.\n\nمهم: هذا تطبيق لإدارة روابط البروكسي، وليس VPN. الشبكة الفعلية والخادم الخارجي هما المسؤولان عن الاتصال.',
  faq:'💡 الأسئلة الشائعة\n\n❓ لماذا يظهر إعلان قناة غير QMR7S؟\nيحدده مشغّل بروكسي MTProto الخارجي، ولا يستطيع البوت استبداله.\n\n❓ هل الـ60 بروكسي تعمل دائماً؟\nلا. المصدر الخارجي يفحص عناوينها، لكن توفرها داخل العراق يتغير حسب الشبكة والحجب.\n\n❓ هل يمكن تثبيت التطبيق؟\nنعم، من متصفح الهاتف عبر «إضافة إلى الشاشة الرئيسية». وداخل تيليجرام يُفتح كـMini App.\n\n❓ هل أحتاج حساباً أو بيانات خاصة؟\nلا. لا ترسل أي كود تحقق أو كلمة مرور.\n\n❓ ماذا أفعل إن لم يعمل زر الاتصال؟\nجرّب الرابط البديل أو انسخه، ثم أضفه من إعدادات البروكسي في تيليجرام.\n\nالدعم: @QMRSupportbot',
  safety:'🛡️ دليل الأمان والخصوصية\n\n• لا تُدخل رمز تسجيل الدخول أو كلمة المرور أو رمز التحقق في أي موقع بروكسي.\n• مشغّل البروكسي يمكن أن يعرف عنوان IP وأوقات الاتصال؛ لا نتحقق من هويته أو سياسته.\n• اتصال MTProto لا يجعل الإنترنت كله محمياً، ولا يستبدل VPN شاملاً.\n• لا تصف رابطاً بأنه آمن أو خالٍ من الإعلانات بناءً على اختبار سرعة فقط.\n• ظهور قناة دعائية يخص مشغّل البروكسي الخارجي.\n• إذا تغيّر الرابط أو توقّف، انتقل إلى بديل ولا تمنح أي صلاحيات إضافية.\n• بلّغ عن الروابط غير المرغوبة عبر @QMRSupportbot.',
  terms:'📜 شروط استخدام QMR Proxy\nإصدار: 2026-11-16\n\n1. الخدمة دليل لإدارة روابط اتصال MTProto، وليست مزوّداً لشبكة أو VPN خاص.\n2. الروابط المعروضة عامة ومن مشغّلين مستقلين؛ قد تتغير أو تتعطل وتعرض قنوات ترويجية.\n3. لا نضمن السرعة أو التوفر أو الخصوصية أو تجاوز الحظر على كل شبكات العراق.\n4. المستخدم مسؤول عن اختيار البروكسي والتحقق من مشغّله والالتزام بالقوانين المنطبقة.\n5. يُمنع استخدام البوت للإزعاج أو الاحتيال أو إساءة الاستخدام.\n6. اشتراك @QMR7S شرط للوصول لقائمة الروابط عبر البوت؛ الموقع العام مستقل.\n7. قد تتوقف الخدمات أو تتغير دون موعد محدد للصيانة والأمان.\n8. للدعم أو الإبلاغ: @QMRSupportbot.',
  privacy:'🔐 سياسة خصوصية QMR Proxy\nإصدار: 2026-11-16\n\n• لا نطلب رقم الهاتف أو كلمة المرور أو رمز تسجيل الدخول.\n• يستخدم البوت معرّف Telegram والعضوية بالقناة لتقديم الخدمة.\n• عند تفعيل قاعدة البيانات، يسجّل معرّف الحساب، أول وآخر استخدام، عدّاد الأوامر وحالة الحظر لأغراض التشغيل والإدارة.\n• قد تُحفظ سجلات الإشعارات الإدارية وحالة تسليمها؛ لا نخزّن نصوص الدردشة العادية بغرض تحليلها.\n• الموقع يحتفظ بالبروكسيات التي تضيفها في المتصفح المحلي؛ يمكن حذفها أو تصديرها.\n• قد تعالج الاستضافة العامة طلبات الشبكة وفق سياستها.\n• مشغّل أي بروكسي خارجي يستطيع رؤية IP وتوقيت اتصالك، وقد يعرض قناة دعائية.\n• لحذف سجل البوت: /delete_my_data، ولحذف بيانات الموقع امسحها من المتصفح.\n• الاستفسارات: @QMRSupportbot.',
  about:'ℹ️ QMR Proxy | QMR7S\n\nتطبيق مصغّر PWA ودليل Telegram Serverless لتنظيم بروكسيات MTProto العامة.\n✨ واجهة عربية حديثة، حفظ محلي، بحث، وتحديث عند توفر بيانات المصدر.\n🌐 الموقع: qmr-proxy.alialnyamy675.chatgpt.site\n📣 التحديثات: @QMR7S\n🛟 الدعم: @QMRSupportbot\n\nالبروكسيات الخارجية ليست مملوكة لنا؛ لا نضمن توافرها أو خصوصية مشغّليها.',
  required:'🔒 الاشتراك مطلوب\n\nللحصول على روابط البروكسي من البوت، انضم إلى قناة @QMR7S ثم اضغط «تحقق من الاشتراك».\n\nلو كنت مشتركاً بالفعل ولم يتم التحقق، يلزم إضافة البوت مشرفاً في القناة ليستطيع فحص العضوية بصورة موثوقة.',
  failedCheck:'⚠️ تعذر التحقق من العضوية الآن. قد يكون البوت غير مشرف في قناة QMR7S أو أن Telegram لا يستجيب. لا يمكن تجاوز التحقق تلقائياً. تواصل مع @QMRSupportbot.',
  blocked:'⛔ هذا الحساب موقوف عن استخدام خدمات البوت. للاستفسار: @QMRSupportbot.',
  unavailable:'⚠️ خدمة الروابط متوقفة مؤقتاً للصيانة. تابع @QMR7S للإعلانات.',
};

export function home(owner=false) {
  const rows=[
    [btn('🌐 استعراض البروكسيات','q:servers:1','primary'),btn('📡 حالة القائمة','q:status')],
    [appButton('✨ فتح QMR Proxy داخل تيليجرام')],
    [btn('🧭 طريقة الاتصال','q:steps'),btn('❔ المساعدة','q:help')],
    [btn('💡 الأسئلة الشائعة','q:faq'),btn('🛡️ الأمان','q:safety')],
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
  if (['help','steps','faq','safety','terms','privacy','about'].includes(name)) {
    return {text:text[name],reply_markup:backKeyboard()};
  }
  if (name==='app') return {text:'✨ QMR Proxy Mini App\n\nافتح واجهة QMR Proxy مباشرة داخل تيليجرام. تستطيع البحث في الروابط العامة وحفظ بروكسياتك الشخصية على جهازك.\n\nيمكنك أيضاً فتح الموقع المستقل عند تعذر الوصول إلى البوت.',reply_markup:keyboard([[appButton('🚀 تشغيل QMR Proxy الآن')],[url('🌐 فتح الموقع في المتصفح',SITE_URL)],[btn('⌂ الرئيسية','q:home')]])};
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
