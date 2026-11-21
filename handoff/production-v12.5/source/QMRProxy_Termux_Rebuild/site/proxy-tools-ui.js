/* QMR Studio Tools: link extraction, local format validation, preview-first save. */
(()=>{'use strict';const core=window.QMRProxyTools;if(!core)return;
const script=document.currentScript;const root=script?new URL('./',script.src):new URL('./',location.href);
const ico=n=>`<svg class="ico" aria-hidden="true"><use href="${new URL('assets/ui-icons.svg',root)}#${n}"></use></svg>`;
const dialog=document.createElement('dialog');dialog.id='q-tool-modal';dialog.className='q-tool-modal';dialog.setAttribute('aria-label','أدوات بروكسي MTProto');
dialog.innerHTML=`<div class="q-tool-shell"><header><div><small>QMR7S / PROXY WORKSPACE</small><h2 id="q-tool-title">إضافة بروكسي</h2></div><button type="button" id="q-tool-close" aria-label="إغلاق">${ico('close')}</button></header>
<nav class="q-tool-tabs" aria-label="نوع الأداة"><button type="button" data-mode="add">${ico('plus')} إضافة</button><button type="button" data-mode="extract">${ico('scan')} استخراج</button><button type="button" data-mode="check">${ico('check')} فحص</button></nav>
<div class="q-tool-content">
 <div class="q-tool-steps"><span><strong>01</strong> إدخال الرابط</span><span><strong>02</strong> معاينة النتيجة</span><span><strong>03</strong> تنفيذ الإجراء</span></div>
 <label class="q-field">رابط Telegram MTProto<textarea id="q-tool-link" dir="ltr" rows="2" autocomplete="off" spellcheck="false" placeholder="https://t.me/proxy?server=...&port=443&secret=..."></textarea></label>
 <details class="q-tool-advanced"><summary>ليس لديك رابط؟ إدخال بيانات البروكسي يدويًا</summary><div class="q-tool-fields"><label class="q-field">عنوان الخادم<input id="q-tool-server" dir="ltr" autocomplete="off" placeholder="proxy.example.org"></label><label class="q-field">المنفذ<input id="q-tool-port" dir="ltr" type="number" min="1" max="65535" placeholder="443"></label><label class="q-field q-span">Secret (محفوظ على جهازك فقط)<input id="q-tool-secret" type="password" dir="ltr" maxlength="684" autocomplete="off" spellcheck="false"><button type="button" id="q-tool-show">إظهار</button></label><label class="q-field q-span" id="q-tool-name-wrap">اسم لتسهيل التعرف عليه<input id="q-tool-name" maxlength="60" placeholder="بروكسي شخصي"></label></div></details>
 <section class="q-tool-preview" aria-live="polite"><div class="q-tool-health" id="q-tool-health">${ico('scan')} <span id="q-tool-state">في انتظار البيانات</span></div><h3 id="q-tool-heading">ستظهر معاينة الرابط هنا</h3><p id="q-tool-message">يمكن فحص الصيغة، لكن الاتصال الفعلي ومشغّل الخادم غير مؤكدين.</p><dl id="q-tool-details" hidden></dl><button type="button" id="q-tool-reveal" hidden>إظهار Secret كاملًا</button><p id="q-tool-duplicate" class="q-tool-hint"></p></section>
 <div class="q-tool-buttons"><button id="q-tool-action" type="button">${ico('check')} تحقق وأظهر المعاينة</button><button id="q-tool-copy" type="button" disabled>${ico('copy')} نسخ</button><button id="q-tool-connect" type="button" disabled>${ico('external')} فتح Telegram</button></div>
 </div><footer>فحص محلي للصيغة فقط · لا نتصل بخادم البروكسي · لا تطلب الخدمة رمز تسجيل دخولك.</footer></div>`;
document.body.append(dialog);const $=s=>dialog.querySelector(s),link=$('#q-tool-link'),server=$('#q-tool-server'),port=$('#q-tool-port'),secret=$('#q-tool-secret'),name=$('#q-tool-name');let mode='add',ready=null,previewed=false,revealed=false,sourceKeys=new Set(),lastFocus;
const notices={add:'لإضافة بروكسي، الصق رابطه أو أدخل بياناته يدويًا. ستظهر معاينة قبل الحفظ.',extract:'أدخل رابط MTProto لاستخراج الخادم والمنفذ والـSecret بشكل محلي.',check:'فحص الصيغة لا يعني اختبار سرعة البروكسي أو ضمان اتصاله.'};
function inform(message){const toast=document.getElementById('toast');if(toast){toast.textContent=message;toast.classList.add('visible');clearTimeout(inform.t);inform.t=setTimeout(()=>toast.classList.remove('visible'),3200);}else alert(message);}
function read(){const raw=link.value.trim();const input=raw?core.parse(raw):core.validate({server:server.value,port:port.value,secret:secret.value,name:name.value});if(input.ok&&raw){server.value=input.node.server;port.value=String(input.node.port);secret.value=input.node.secret;}return input;}
function draw(showDetails=false){const res=read();ready=res.ok?{...res.node,name:name.value.trim()||res.node.name}:null;
 const enough=Boolean(link.value.trim()||server.value.trim()||port.value.trim()||secret.value.trim()),isValid=Boolean(res.ok);
 const status=$('#q-tool-health');status.classList.toggle('invalid',enough&&!isValid);$('#q-tool-state').textContent= !enough?'في انتظار الإدخال':isValid?'صيغة MTProto صحيحة':'تحتاج تصحيحًا';
 $('#q-tool-heading').textContent=!enough?'ستظهر معاينة الرابط هنا':isValid?'الرابط مكتمل من ناحية الصيغة':'هناك حقول غير صالحة';
 $('#q-tool-message').textContent=!enough?notices[mode]:isValid?'تم التأكد من شكل الحقول فقط. لا يعني ذلك أن الخادم يعمل أو أنه آمن.':res.errors.join(' ');
 const dl=$('#q-tool-details');dl.replaceChildren();dl.hidden=!isValid||!showDetails;$('#q-tool-reveal').hidden=!isValid||!showDetails;
 if(isValid&&showDetails){for(const [key,value] of [['الخادم',ready.server],['المنفذ',String(ready.port)],['Secret',revealed?ready.secret:ready.secret.slice(0,4)+'••••'+ready.secret.slice(-4)],['الرابط','صيغة t.me/proxy معتمدة']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);}}
 const customMatch=isValid&&core.saved().some(n=>core.key(n)===core.key(ready));const sourceMatch=isValid&&sourceKeys.has(core.key(ready));$('#q-tool-duplicate').textContent=customMatch?'هذا الرابط موجود ضمن إضافاتك؛ لن نضيف نسخة ثانية.':sourceMatch?'هذا الرابط موجود أصلًا في دليل البروكسيات العام.':'البيانات لا تُرسل للخادم، وتبقى اختياراتك في المتصفح.';
 $('#q-tool-copy').disabled=$('#q-tool-connect').disabled=!isValid;
 $('#q-tool-action').textContent= mode==='add'&&isValid&&previewed?'حفظ البروكسي على جهازي':mode==='extract'?'استخراج ومعاينة البيانات':mode==='check'?'فحص الصيغة':'تحقق وأظهر المعاينة';
 return {res,customMatch};}
function change(){previewed=false;revealed=false;draw(false);}
function choose(next,node){mode=next;previewed=false;revealed=false;for(const el of dialog.querySelectorAll('[data-mode]')){el.classList.toggle('active',el.dataset.mode===next);el.setAttribute('aria-pressed',String(el.dataset.mode===next));}
 $('#q-tool-title').textContent={add:'إضافة بروكسي شخصي',extract:'استخراج بيانات MTProto',check:'فحص صيغة الرابط'}[next];$('#q-tool-name-wrap').hidden=next!=='add';
 if(node){link.value=core.canonical(node);name.value=node.name||'';}else{link.value=server.value=port.value=secret.value=name.value='';}
 draw(false);}
function open(next='add',node){lastFocus=document.activeElement;choose(['add','check','extract'].includes(next)?next:'add',node);if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();else dialog.setAttribute('open','');link.focus();}
function close(){if(dialog.open&&dialog.close)dialog.close();else dialog.removeAttribute('open');if(lastFocus?.isConnected)lastFocus.focus();}
$('#q-tool-close').addEventListener('click',close);dialog.addEventListener('click',e=>{if(e.target===dialog)close();});dialog.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>choose(el.dataset.mode)));
link.addEventListener('input',change);for(const el of [server,port,secret,name])el.addEventListener('input',()=>{if(el!==name)link.value='';change();});
$('#q-tool-reveal').addEventListener('click',()=>{revealed=!revealed;$('#q-tool-reveal').textContent=revealed?'إخفاء Secret':'إظهار Secret كاملًا';draw(true);});
$('#q-tool-show').addEventListener('click',()=>{const exposed=secret.type==='password';secret.type=exposed?'text':'password';$('#q-tool-show').textContent=exposed?'إخفاء':'إظهار';});
$('#q-tool-action').addEventListener('click',()=>{const {res,customMatch}=draw(true);if(!res.ok)return; if(mode==='add'){
 if(!previewed){previewed=true;draw(true);inform('البيانات جاهزة للمعاينة. اضغط حفظ للتأكيد.');return;}if(customMatch){inform('هذا الرابط موجود ضمن إضافاتك مسبقًا.');return;}const result=core.add(ready);if(result.ok){inform('تم الحفظ محليًا.');close();}else inform(result.error);
 }else{previewed=true;draw(true);inform(mode==='check'?'فحص الصيغة ناجح. الاتصال غير مفحوص.':'تم استخراج البيانات محليًا. يمكنك نسخ الرابط.');}});
$('#q-tool-copy').addEventListener('click',async()=>{if(!ready)return;const text=core.canonical(ready);try{await navigator.clipboard.writeText(text);inform('تم نسخ الرابط.');}catch{prompt('انسخ الرابط:',text);}});
$('#q-tool-connect').addEventListener('click',()=>{if(!ready)return;const url=core.canonical(ready),tg=window.Telegram?.WebApp;if(tg?.platform&&tg.platform!=='unknown'&&typeof tg.openTelegramLink==='function'){try{tg.openTelegramLink(url);return;}catch{}}
 if(/Android|iPhone|iPad/i.test(navigator.userAgent)){location.assign('tg://proxy?'+new URLSearchParams({server:ready.server,port:String(ready.port),secret:ready.secret}));}else window.open(url,'_blank','noopener,noreferrer');});
window.QMRTools={open};document.addEventListener('click',e=>{const el=e.target.closest('[data-qmr-tool]');if(el){e.preventDefault();open(el.dataset.qmrTool||'add');}});
function hashTool(){const match=location.hash.match(/^#tool=(add|extract|check)$/);if(match&&!dialog.open)open(match[1]);}addEventListener('hashchange',hashTool);if(location.hash.startsWith('#tool='))setTimeout(hashTool,1);
// Optional source duplicate metadata: no secrets are sent to any server.
Promise.allSettled(['nodes.json','extra-proxies.json'].map(file=>fetch(new URL(file,root),{cache:'no-store'}).then(r=>r.ok?r.json():null))).then(results=>{for(const r of results){if(r.status==='fulfilled'&&Array.isArray(r.value?.nodes))for(const n of r.value.nodes)if(core.validate(n).ok)sourceKeys.add(core.key(n));}if(dialog.open)draw(previewed);}).catch(()=>{});
})();
