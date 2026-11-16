// Staged Telegram Serverless handler; deploy targeted modules only after a live diff.
import { api, fetch as sdkFetch } from 'sdk';
import { currentNodes } from 'lib/source';

const WEBSITE = 'https://qmr-proxy.alialnyamy675.chatgpt.site';
const CHANNEL = 'https://t.me/QMR7S';
function link(n) {
  return 'https://t.me/proxy?server=' + encodeURIComponent(n.server)
    + '&port=' + n.port + '&secret=' + encodeURIComponent(n.secret);
}
export default async function(message) {
  if (!message?.chat?.id || typeof message.text !== 'string') return;
  const parts = message.text.trim().split(/\s+/);
  const command = parts[0].split('@')[0].toLowerCase();
  if (!['/start','/help','/proxy','/servers','/channel'].includes(command)) return;
  const chatId = message.chat.id;
  if (command === '/start' || command === '/help') {
    await api.sendMessage({chat_id:chatId,
      text:'QMR Proxy — روابط MTProto\n/servers — أفضل 10 بروكسيات\n/servers 2 — الصفحة 2 حتى 6\n/proxy — روابط الاتصال\n/channel — قناة QMR7S\n/help — المساعدة\n\nالموقع مستقل عند تعذر فتح تيليجرام. الروابط من مشغلين خارجيين؛ لا نضمن الخصوصية أو خلوها من قناة ترويجية.',
      reply_markup:{inline_keyboard:[[{text:'موقع QMR Proxy',url:WEBSITE},{text:'قناة QMR7S',url:CHANNEL}]]}});
    return;
  }
  if (command === '/channel') {
    await api.sendMessage({chat_id:chatId,
      text:'تابع @QMR7S. تنبيه: لا يمكننا تغيير القناة الترويجية التي يحددها مشغّل بروكسي خارجي.',
      reply_markup:{inline_keyboard:[[{text:'قناة QMR7S',url:CHANNEL}]]}});
    return;
  }
  const result = await currentNodes(sdkFetch);
  const nodes = Array.isArray(result.nodes) ? result.nodes : [];
  if (!nodes.length) {
    await api.sendMessage({chat_id:chatId,text:'لا توجد روابط عامة حالياً. يمكنك إضافة بروكسي خاص بك من الموقع.'});
    return;
  }
  const pages = Math.ceil(nodes.length/10);
  const requested = Number(parts[1] || 1);
  const page = Number.isInteger(requested) && requested>=1 && requested<=pages ? requested : 1;
  const slice = nodes.slice((page-1)*10,page*10);
  const keyboard=slice.map((n,i) => [{text:'🔗 '+String((page-1)*10+i+1).padStart(2,'0')+' · '+n.server.slice(0,26),url:link(n)}]);
  keyboard.push([{text:'قناة QMR7S',url:CHANNEL},{text:'الموقع الكامل',url:WEBSITE}]);
  await api.sendMessage({chat_id:chatId,
    text:'بروكسيات MTProto المجتمعية — '+page+'/'+pages+'\n'+
    (result.origin==='remote'?'بيانات مصدر حديثة':'نسخة احتياطية من المصدر')+
    ' · '+nodes.length+' عنواناً.\n⚠️ ليست خوادم QMR7S ولم تُختبر من العراق، وحالة الإعلان الترويجي غير مؤكدة. مشغّلها قد يعرف IP وأوقات اتصالك.\nللتصفح اكتب /servers 2 ... /servers '+pages,
    reply_markup:{inline_keyboard:keyboard},link_preview_options:{is_disabled:true}});
}
