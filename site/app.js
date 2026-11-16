'use strict';
const list = document.getElementById('list'), stamp = document.getElementById('updated'), refresh = document.getElementById('refresh'), toast = document.getElementById('toast');
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function valid(n){return n && n.enabled!==false && typeof n.server==='string' && /^[a-zA-Z0-9.-]{1,253}$/.test(n.server) && Number.isInteger(n.port) && n.port>0 && n.port<=65535 && typeof n.secret==='string' && /^[A-Za-z0-9_-]{16,}$/.test(n.secret);}
function url(n,scheme){return scheme+'?'+new URLSearchParams({server:n.server,port:String(n.port),secret:n.secret});}
function notify(t){toast.textContent=t;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),2500);}
function link(text,href,cls){const a=element('a',text,'btn '+cls);a.href=href;a.rel='noopener noreferrer';return a;}
function render(n){
  const card=element('article',undefined,'node');
  card.append(element('h3',n.name||'MTProto'),element('p',n.region||'إعداد اتصال متاح (غير مفحوص)', 'detail'),element('p',n.server+':'+n.port,'detail'));
  const actions=element('div',undefined,'actions');
  actions.append(link('فتح في تيليجرام',url(n,'tg://proxy'),'primary'),link('رابط بديل',url(n,'https://t.me/proxy'),'alt'));
  const copy=element('button','نسخ الرابط','btn alt');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(url(n,'https://t.me/proxy'));notify('تم نسخ الرابط');}catch{notify('لم ينجح النسخ');}});
  const manualButton=element('button','الإعداد اليدوي','btn alt'), manual=element('div',undefined,'manual');
  manual.append(element('div','Server: '+n.server),element('div','Port: '+n.port),element('div','Secret: '+n.secret));
  manualButton.addEventListener('click',()=>manual.classList.toggle('open'));
  actions.append(copy,manualButton);card.append(actions,manual,element('p','إضافة الخادم لا تثبت أنه سريع أو يعمل من شبكتك؛ يجب اختباره فعلياً.','detail'));return card;
}
async function load(){refresh.disabled=true;list.replaceChildren();stamp.textContent='جارٍ تحديث القائمة...';
  try{const resp=await fetch('./nodes.json',{cache:'no-store'});if(!resp.ok)throw Error('network');
    const data=await resp.json();if(!Array.isArray(data.nodes))throw Error('invalid');const nodes=data.nodes.filter(valid);
    if(!nodes.length)list.append(element('p','لا توجد خوادم مهيأة بعد. يحتاج المشروع إلى تشغيل واختبار عقدة MTProto فعلية.','muted'));
    for(const n of nodes)list.append(render(n));
    stamp.textContent=nodes.length+' خادم ضمن القائمة · لم تُقَس حالة الاتصال من جهازك';
  }catch{stamp.textContent='تعذر تحميل قائمة الخوادم';list.append(element('p','تحقق من الإنترنت أو أعد المحاولة.','muted'));}
  finally{refresh.disabled=false;}
}
refresh.addEventListener('click',load);
let promptInstall;window.addEventListener('beforeinstallprompt',ev=>{ev.preventDefault();promptInstall=ev;document.getElementById('install').hidden=false;});
document.getElementById('install').addEventListener('click',async()=>{if(promptInstall){promptInstall.prompt();await promptInstall.userChoice;promptInstall=null;}});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
load();
