// Telegram Serverless message handler — staged review only.
// Existing live bot/webhook must be inspected before targeted deployment.
import { api } from 'sdk';
import { nodes, PUBLIC_SITE_URL } from '../lib/nodes.js';

function good(n) {
  return n && n.enabled !== false
    && typeof n.server === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(n.server)
    && Number.isInteger(n.port) && n.port >= 1 && n.port <= 65535
    && typeof n.secret === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(n.secret);
}
function link(n) {
  return 'https://t.me/proxy?server=' + encodeURIComponent(n.server)
    + '&port=' + n.port + '&secret=' + encodeURIComponent(n.secret);
}
export default async function(message) {
  if (!message?.chat?.id || typeof message.text !== 'string') return;
  const cmd = message.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
  if (!['/start','/help','/proxy','/servers'].includes(cmd)) return;
  if (cmd === '/start' || cmd === '/help') {
    await api.sendMessage({chat_id: message.chat.id,
      text: 'QMR Proxy — إدارة روابط MTProto لتيليجرام\n/proxy — روابط بروكسيات عامة\n/servers — الخوادم المدرجة\n/help — المساعدة\n\nتنبيه: الروابط المدرجة تعود لمشغّلين خارجيين، ليست خوادم QMR7S. لم نختبرها من العراق؛ مشغّلها قد يرى IP وأوقات اتصالك. الموقع المستقل: ' + PUBLIC_SITE_URL});
    return;
  }
  const available = (Array.isArray(nodes) ? nodes : []).filter(good).slice(0, 10);
  if (!available.length) {
    await api.sendMessage({chat_id: message.chat.id,
      text:'لا توجد بروكسيات عامة مدرجة حالياً. راجع الموقع المستقل أو أضف بروكسي موثوقاً يدوياً.'});
    return;
  }
  const keyboard = available.map(n => [{text: String(n.name || 'بروكسي خارجي').slice(0,35), url: link(n)}]);
  if (/^https:\/\//.test(PUBLIC_SITE_URL)) {
    keyboard.push([{text:'الموقع المستقل',url:PUBLIC_SITE_URL}]);
  }
  await api.sendMessage({chat_id: message.chat.id,
    text:'هذه روابط بروكسيات MTProto مجتمعية من مشغّلين خارجيين، ليست خوادم QMR7S. لم نختبرها من العراق ولا نضمن سرعتها أو توفرها أو خصوصيتها. انتبه: المشغّل قد يعرف IP ووقت الاتصال، وقد تظهر قنوات ترويجية. اختر بروكسي تثق به.',
    reply_markup:{inline_keyboard: keyboard},
    link_preview_options:{is_disabled:true}});
}
