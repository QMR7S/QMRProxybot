// Link distribution only. Must NOT be deployed over existing live handlers without a diff.
import { api } from 'sdk';
import { nodes, PUBLIC_SITE_URL } from '../lib/nodes.js';

function good(n){return n && n.enabled!==false && typeof n.server==='string' && /^[a-zA-Z0-9.-]{1,253}$/.test(n.server) &&
 Number.isInteger(n.port) && n.port>=1 && n.port<=65535 && typeof n.secret==='string' && /^[A-Za-z0-9_-]{16,}$/.test(n.secret);}
function proxy(n){return 'https://t.me/proxy?'+new URLSearchParams({server:n.server,port:String(n.port),secret:n.secret}).toString();}
export default async function(message){
 if(!message?.chat?.id || typeof message.text!=='string')return;
 const cmd=message.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
 if(!['/start','/help','/proxy','/servers'].includes(cmd))return;
 if(cmd==='/start'||cmd==='/help'){
  await api.sendMessage({chat_id:message.chat.id,text:'QMR Proxy — إعداد بروكسي MTProto لتيليجرام\n/proxy — روابط الاتصال\n/servers — الخوادم\n/help — المساعدة\n\nاحتفظ بعنوان الموقع المستقل، لأن البوت غير متاح قبل الاتصال بتيليجرام. لا يوجد ضمان بتجاوز كل حجب أو تسريع.'});return;
 }
 const active=(Array.isArray(nodes)?nodes:[]).filter(good).slice(0,10);
 if(!active.length){await api.sendMessage({chat_id:message.chat.id,text:'لا توجد خوادم موثقة بعد. يجب تشغيل MTProto على خادم TCP مستقل واختباره.'});return;}
 const keyboard=active.map(n=>[{text:String(n.name||'MTProto').slice(0,35),url:proxy(n)}]);
 if(typeof PUBLIC_SITE_URL==='string' && /^https:\/\//.test(PUBLIC_SITE_URL))keyboard.push([{text:'الموقع المستقل',url:PUBLIC_SITE_URL}]);
 await api.sendMessage({chat_id:message.chat.id,text:'روابط QMR Proxy. صلاحية كل خادم وسرعته تختلف حسب الشبكة؛ أضف خادماً احتياطياً وفعّل التبديل التلقائي.',reply_markup:{inline_keyboard:keyboard},link_preview_options:{is_disabled:true}});
}
