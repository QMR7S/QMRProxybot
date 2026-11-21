/* QMR Proxy v11.3 — direct-navigation drawer; optional hover/focus previews. */
(()=>{'use strict';
const script=document.currentScript;
if(!script)return;
const root=new URL('./',script.src), mini=document.body.classList.contains('q-mini-mode'),privatePage=document.body.classList.contains('q-admin')||document.body.classList.contains('q-ops');
const icon=n=>`<svg class="q-icon" aria-hidden="true"><use href="${new URL('assets/ui-icons.svg',root)}#${n}"></use></svg>`;
const sections=[
 ['الصفحات الأساسية',[
  ['الرئيسية','لمحة سريعة وأدوات الوصول','home','./'],
  ['دليل البروكسيات','بحث وفلاتر وبطاقات وروابط اتصال','server','./#servers'],
  ['المجموعة الإضافية','روابط مستقلة بقياسات مصدر خارجي','server',mini?'./mini/#extras':'./#extras'],
  ['Telegram Mini App','تجربة مستقلة داخل تيليجرام','heart','./mini/']]],
 ['أدوات البروكسي',[
  ['إضافة بروكسي','بيانات يدوية، معاينة ثم حفظ محلي','plus',mini?'./mini/#tool=add':'./#tool=add'],
  ['استخراج الرابط','إظهار الخادم والمنفذ وSecret قبل الحفظ','scan',mini?'./mini/#tool=extract':'./#tool=extract'],
  ['فحص الصيغة','الحقول والتكرار فقط، دون اختبار شبكة','check',mini?'./mini/#tool=check':'./#tool=check']]],
 ['المعرفة والتواصل',[
  ['دليل الاستخدام','خطوات الإعداد والحماية','list','./guide/'],
  ['الأسئلة الشائعة','إجابات على شكل قوائم منسدلة','help','./faq/'],
  ['الأمان والخصوصية','ما الذي يستطيع البروكسي معرفته؟','shield','./safety/'],
  ['سياسة الخصوصية','بياناتك وما يُخزّن على جهازك','lock','./privacy/'],
  ['الشروط','حدود الخدمة وإخلاء المسؤولية','list','./terms/'],
  ['الدعم والحسابات','قناة QMR7S والتواصل الرسمي','support','./contact/']]]
];
if(privatePage)sections.unshift(['لوحات الإدارة',[
 ['لوحة التشغيل','إحصائيات وقراءة حالة النظام فقط','chart','./ops/'],
 ['لوحة المالك','إجراءات محمية بعد تحقق Telegram','shield','./admin/']]]);
const header=document.querySelector('.studio-header,.top,.bar,.q-v11-bar,.nav,body > header,.shell > header');
if(!header)return;
header.querySelectorAll('nav').forEach(n=>n.classList.add('q-old-nav'));
document.querySelectorAll('.q-v11-nav').forEach(n=>n.remove());
const trigger=document.createElement('button');trigger.type='button';trigger.className='q-menu-btn';trigger.setAttribute('aria-label','فتح قائمة التنقل');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','qmr-drawer');trigger.innerHTML=icon('menu')+'<span>القائمة</span>';header.prepend(trigger);
const shade=document.createElement('div');shade.className='q-shade';shade.hidden=true;
const drawer=document.createElement('aside');drawer.className='q-drawer';drawer.id='qmr-drawer';drawer.hidden=true;drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-label','القائمة الجانبية لـ QMR Proxy');
drawer.innerHTML=`<header class="q-drawer-head"><div class="q-drawer-logo"><img src="${new URL('icon.svg',root)}" alt=""><span><strong>QMR PROXY</strong><small>BY QMR7S · القائمة الموحدة</small></span></div><button type="button" class="q-drawer-x" aria-label="إغلاق القائمة">${icon('close')}</button></header><div class="q-drawer-items" id="q-drawer-items"></div><div class="q-drawer-preview" aria-live="polite"><small>معاينة القسم</small><h3>انتقال بنقرة واحدة</h3><p>اضغط أي خيار للانتقال مباشرة. مرّر أو ركز على الخيار لقراءة وصفه.</p></div><footer><a href="https://t.me/QMR7S" target="_blank" rel="noopener noreferrer">@QMR7S</a><a href="https://t.me/QMRSupportbot" target="_blank" rel="noopener noreferrer">الدعم</a></footer>`;
document.body.append(shade,drawer);
let lastFocused=null,bodyScroll='';const itemsBox=drawer.querySelector('#q-drawer-items');
function showPreview(name,desc){const preview=drawer.querySelector('.q-drawer-preview');preview.querySelector('h3').textContent=name;preview.querySelector('p').textContent=desc;}
function goto(href){const dest=new URL(href,root);close();if(dest.origin===location.origin&&dest.pathname===location.pathname){if(dest.hash){location.hash=dest.hash;dispatchEvent(new Event('hashchange'));if(!dest.hash.startsWith('#tool=')){try{document.querySelector(dest.hash)?.scrollIntoView({behavior:'smooth',block:'start'});}catch(_){}}}else scrollTo({top:0,behavior:'smooth'});}else location.assign(dest.href);}
for(const [group,items] of sections){const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=group;section.append(heading);
 for(const [name,desc,glyph,href] of items){const item=document.createElement('button');item.type='button';item.className='q-drawer-item';item.innerHTML=icon(glyph)+'<span><b></b><small></small></span>';item.querySelector('b').textContent=name;item.querySelector('small').textContent=desc;
 item.addEventListener('pointerenter',()=>showPreview(name,desc));item.addEventListener('focus',()=>showPreview(name,desc));item.addEventListener('click',()=>goto(href));section.append(item);}itemsBox.append(section);}
function open(){if(!drawer.hidden)return;lastFocused=document.activeElement;bodyScroll=document.body.style.overflow;document.body.style.overflow='hidden';shade.hidden=false;drawer.hidden=false;trigger.setAttribute('aria-expanded','true');drawer.querySelector('.q-drawer-x').focus();}
function close(){if(drawer.hidden)return;shade.hidden=true;drawer.hidden=true;document.body.style.overflow=bodyScroll;trigger.setAttribute('aria-expanded','false');if(lastFocused?.isConnected)lastFocused.focus();}
trigger.addEventListener('click',()=>drawer.hidden?open():close());shade.addEventListener('click',close);drawer.querySelector('.q-drawer-x').addEventListener('click',close);
document.addEventListener('keydown',e=>{if(drawer.hidden)return;if(e.key==='Escape'){e.preventDefault();close();return;}if(e.key==='Tab'){const focusable=[...drawer.querySelectorAll('button:not([disabled]),a[href]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
window.QMRNav={open,close};
})();
