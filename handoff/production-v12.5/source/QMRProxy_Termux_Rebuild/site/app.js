(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const KEY = 'qmrproxy.personal.v3'; // SAME array format as original v5/v7.
  const FAV_KEY = 'qmrproxy.favorites.termux.v1';
  const sourceTag = $('#source');
  let sourceNodes = [], extraNodes = [], sourceDate = '', saved = new Set(), custom = [];
  let installation,visible=12;
  const format = n => String(n).padStart(2,'0');
  const urlFor = n => 'https://t.me/proxy?'+new URLSearchParams({server:n.server,port:String(n.port),secret:n.secret}).toString();
  const token = n => [n.server,n.port,n.secret].join('|');
  const telegramUrlFor = n => 'tg://proxy?'+new URLSearchParams({server:n.server,port:String(n.port),secret:n.secret}).toString();
  const insideTelegram = () => {
    const tg=window.Telegram && window.Telegram.WebApp;
    return tg && tg.platform && tg.platform!=='unknown' && typeof tg.openTelegramLink==='function';
  };
  function connectToProxy(node) {
    const link=urlFor(node);
    // openTelegramLink only works as a direct consequence of the user's tap.
    // It keeps t.me links inside Telegram instead of opening a WebView tab.
    if (insideTelegram()) {
      try {
        window.Telegram.WebApp.openTelegramLink(link);
        toast('تم إرسال الرابط إلى Telegram؛ إن لم تظهر نافذة الإضافة، استخدم «رابط بديل» أو «نسخ».');
        return;
      } catch (error) { /* Continue with the normal app link fallback. */ }
    }
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      window.location.assign(telegramUrlFor(node));
      toast('إذا لم تُفتح نافذة Telegram، انسخ الرابط وأرسله إلى الرسائل المحفوظة.');
      return;
    }
    window.open(link,'_blank','noopener,noreferrer');
    toast('فتح رابط Telegram في نافذة أخرى.');
  }
  async function copyProxy(node) {
    const link=urlFor(node);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(link);
      else {
        const field=document.createElement('textarea');field.value=link;
        field.style.position='fixed';field.style.opacity='0';document.body.append(field);
        field.select();const ok=document.execCommand('copy');field.remove();if(!ok)throw Error('clipboard');
      }
      toast('نُسخ الرابط. أرسله إلى «الرسائل المحفوظة» في Telegram وافتحه من هناك.');
    } catch { window.prompt('انسخ رابط البروكسي يدويًا:',link); }
  }
  const validNode = n => {
    if (!n || typeof n!=='object') return false;
    const server = String(n.server||''), port=Number(n.port), secret=String(n.secret||'');
    return server.length<=253 && server.length>0 && /^[A-Za-z0-9.-]+$/.test(server)
      && !server.startsWith('.') && !server.endsWith('.') && !server.includes('..')
      && server.split('.').every(label=>label.length>0 && label.length<=63 && !label.startsWith('-') && !label.endsWith('-'))
      && Number.isInteger(port) && port>0 && port<65536
      && ((/^[a-fA-F0-9]{32,512}$/.test(secret) && secret.length%2===0) || /^[A-Za-z0-9_-]{22,684}={0,2}$/.test(secret));
  };
  function toast(message) {
    const el=$('#toast');el.textContent=message;el.classList.add('visible');
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),3500);
  }
  function readLocal() {
    try {
      const data=JSON.parse(localStorage.getItem(KEY)||'[]');
      const nodes=Array.isArray(data)?data:Array.isArray(data.custom)?data.custom:[];
      const favorites=JSON.parse(localStorage.getItem(FAV_KEY)||'[]');
      saved=new Set(Array.isArray(favorites)?favorites.filter(x=>typeof x==='string').slice(0,400):[]);
      custom=nodes.filter(validNode).slice(0,30).map(n=>({...n,custom:true}));
    } catch { saved=new Set();custom=[]; }
  }
  function store() {
    try {
      // Never replace the established array at qmrproxy.personal.v3 with an
      // incompatible object: the original website expects an array of nodes.
      localStorage.setItem(KEY,JSON.stringify(custom.map(({custom,...node})=>node)));
      localStorage.setItem(FAV_KEY,JSON.stringify([...saved]));
    } catch {toast('تعذر الحفظ على جهازك. تحقق من مساحة التخزين.');}
  }
  async function load() {
    $('#status-source').textContent='قراءة القائمة…';
    try {
      const resp=await fetch('./nodes.json',{cache:'no-store'});
      if (!resp.ok) throw Error('Failed to load');
      const data=await resp.json();
      const collection=Array.isArray(data.nodes)?data.nodes:[];
      const ids=new Set();
      sourceNodes=collection.filter(validNode).filter(n=>{
        const k=token(n);if(ids.has(k)) return false;ids.add(k);return true;
      }).slice(0,60);
      sourceDate=data.source_checked_at||data.updated_at||'غير معلوم';
      const age=Date.now()-Date.parse(sourceDate);
      const freshness=(Number.isFinite(age)&&age>36*3600000)?' · تنبيه: بيانات المصدر قديمة':' · مصدر خارجي';
      sourceTag.textContent='آخر فحص أعلنه المصدر: '+sourceDate+freshness+' · لم نتحقق من الاتصال من العراق.';
      $('#status-source').textContent=sourceNodes.length?'الروابط مستوردة · الاتصال غير مؤكد':'لا توجد روابط في المصدر الحالي';
    } catch {
      sourceNodes=[];sourceDate='غير متاح';
      sourceTag.textContent='تعذر تحميل nodes.json؛ جرّب تحديث الموقع أو تشغيل ./sync-site.sh في Termux.';
      $('#status-source').textContent='مصدر البيانات غير متاح';
    }
    await loadExtra();
  }
  async function loadExtra() {
    try {
      const response=await fetch('./extra-proxies.json',{cache:'no-store'});
      if(!response.ok)throw Error('extra source unavailable');
      const data=await response.json();
      if(data.schema!=='qmr-extra-v1'||!Array.isArray(data.nodes))throw Error('bad extra source');
      const checked=Date.parse(data.source_checked_at);
      const age=Date.now()-checked;
      const stale=!Number.isFinite(age)||age<0||age>72*3600000;
      // A stale feed remains visible for reference but is never described as currently tested.
      const seen=new Set(sourceNodes.map(token));
      extraNodes=data.nodes.filter(validNode).filter(n=>{
        if(n.origin!=='extra'||!n.community_source||seen.has(token(n)))return false;
        seen.add(token(n));return true;
      }).slice(0,200).map(n=>({...n,origin:'extra',stale_source:stale}));
      $('#q-extra-count').textContent=extraNodes.length+' رابط إضافي';
      $('#q-extra-date').textContent=stale?'⚠️ بيانات المصدر قديمة — يلزم تحديثها':'تحديث المصدر: '+new Date(checked).toLocaleDateString('ar-IQ');
    }catch(e){extraNodes=[];$('#q-extra-count').textContent='المجموعة الإضافية غير متاحة';$('#q-extra-date').textContent='لا نعرض بيانات غير قابلة للقراءة';}
    render();
  }
  function all() {
    const set=new Set([...sourceNodes,...extraNodes].map(token));
    return [...custom.filter(n=>!set.has(token(n))),...sourceNodes,...extraNodes];
  }
  function render() {
    const search=$('#search').value.trim().toLowerCase(),filter=$('#filter').value;
    let items=all().filter(n=>{
      if (filter==='saved'&&!saved.has(token(n)))return false;
      if (filter==='custom'&&!n.custom)return false;
      if (filter==='extra'&&n.origin!=='extra')return false;
      // NEVER assume external proxy is ad-free on missing status.
      if (filter==='adfree'&&n.ads_status!=='verified_ad_free')return false;
      return (n.name||'').toLowerCase().includes(search)||n.server.toLowerCase().includes(search);
    });
    items=window.QMRQuality119?.arrange(items)||items;
    const list=$('#list');list.replaceChildren();
    for(const [i,n] of items.slice(0,visible).entries()) {
      const card=document.createElement('article');card.className='proxy studio-proxy-card';
      const head=document.createElement('div');head.className='studio-proxy-head';
      const identity=document.createElement('div');identity.className='studio-proxy-id';
      const symbol=document.createElement('span');symbol.className='studio-proxy-symbol';symbol.innerHTML='<svg class="ico" aria-hidden="true"><use href="./assets/ui-icons.svg#server"></use></svg>';
      const names=document.createElement('div');const title=document.createElement('div');title.className='studio-proxy-title';title.textContent=n.name||`بروكسي ${format(i+1)}`;
      const sub=document.createElement('div');sub.className='studio-proxy-sub';sub.textContent=n.custom?'رابطك الشخصي · محفوظ على الجهاز':n.origin==='extra'?'المجموعة الإضافية · مصدر خارجي مستقل':'رابط مجتمعي · مشغّل مستقل';names.append(title,sub);identity.append(symbol,names);
      const fav=document.createElement('button');fav.type='button';fav.className='studio-fav-icon'+(saved.has(token(n))?' is-favorite':'');fav.textContent=saved.has(token(n))?'★':'☆';fav.setAttribute('aria-label',saved.has(token(n))?'إزالة من المفضلة':'إضافة إلى المفضلة');fav.addEventListener('click',()=>{saved.has(token(n))?saved.delete(token(n)):saved.add(token(n));store();render();});head.append(identity,fav);
      const host=document.createElement('div');host.className='studio-server-line';const address=document.createElement('code');address.dir='ltr';address.textContent=n.server+':'+n.port;
      const quick=document.createElement('button');quick.type='button';quick.className='studio-copy-mini';quick.setAttribute('aria-label','نسخ رابط البروكسي');quick.innerHTML='<svg class="ico"><use href="./assets/ui-icons.svg#copy"></use></svg>';quick.addEventListener('click',()=>void copyProxy(n));host.append(address,quick);
      const tags=document.createElement('div');tags.className='studio-tags';
      const t1=document.createElement('span');t1.className='studio-tag info';t1.textContent=n.origin==='extra'?'MTProto · إضافي':'MTProto';
      const t2=document.createElement('span');t2.className='studio-tag warning';t2.textContent=n.ads_status==='verified_ad_free'?'لا إعلانات وفق المصدر':'الإعلانات غير مؤكدة';
      const t3=document.createElement('span');t3.className='studio-tag';t3.textContent=Number.isFinite(n.median_rtt_ms)?Math.round(n.median_rtt_ms)+' ms · قياس المصدر وليس شبكتك':'حالة الاتصال غير مؤكدة';tags.append(t1,t2,t3);window.QMRQuality119?.attach(tags,n);
      const actions=document.createElement('div');actions.className='studio-proxy-actions';
      const connect=document.createElement('button');connect.type='button';connect.className='primary';connect.innerHTML='<svg class="ico"><use href="./assets/ui-icons.svg#external"></use></svg> فتح في Telegram';connect.addEventListener('click',()=>connectToProxy(n));
      const copy=document.createElement('button');copy.type='button';copy.innerHTML='<svg class="ico"><use href="./assets/ui-icons.svg#copy"></use></svg> نسخ الرابط';copy.addEventListener('click',()=>void copyProxy(n));actions.append(connect,copy);
      const details=document.createElement('details');details.className='studio-proxy-details';const summary=document.createElement('summary');summary.textContent='التفاصيل والفحص والبدائل';const body=document.createElement('div');body.className='studio-detail-body';
      const note=document.createElement('p');note.textContent='المصدر مجتمعي مستقل. لا يثبت فحص الصيغة صلاحية الاتصال أو موثوقية المشغّل، وقد تظهر قناة إعلانية.';
      const more=document.createElement('div');more.className='studio-detail-actions';for(const [label,mode] of [['فحص الصيغة','check'],['استخراج البيانات','extract']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>window.QMRTools?.open(mode,n));more.append(button);}if(n.origin==='extra'){note.textContent=(n.stale_source?'⚠️ بيانات القياس قديمة. ':'')+'إحصاءات مصدر خارجي (عدد الفحوص '+(n.source_checks||'؟')+'، نجاح تاريخي '+(Number.isFinite(n.source_uptime)?Math.round(n.source_uptime*100)+'%':'غير معلوم')+'). ليست شهادة أمان أو ضمان سرعة.';}body.append(note,more);
      if(n.custom){const remove=document.createElement('button');remove.type='button';remove.textContent='حذف من إضافاتي';remove.addEventListener('click',()=>{if(!confirm('حذف البروكسي من جهازك فقط؟'))return;custom=custom.filter(x=>token(x)!==token(n));saved.delete(token(n));store();render();toast('تم حذف الرابط المحلي.');});more.append(remove);}
      details.append(summary,body);card.append(head,host,tags,actions,details);list.append(card);
    }
    $('#empty').hidden=items.length>0;
    $('#counter').textContent='النتائج: '+Math.min(visible,items.length)+' من '+items.length;const more=$('#q-more');if(more)more.hidden=visible>=items.length;
    $('#stat-total').textContent=sourceNodes.length+extraNodes.length;
    $('#stat-saved').textContent=saved.size;
  }
  window.QMRQuality119?.onChange(()=>render());
  $('#search').addEventListener('input',()=>{visible=12;render()});$('#filter').addEventListener('change',()=>{visible=12;render()});$('#q-more').addEventListener('click',()=>{visible+=12;render()});window.addEventListener('qmr:stored',()=>{readLocal();render()});
  $('#refresh').addEventListener('click',load);
  if(location.hash==='#extras'){$('#filter').value='extra';setTimeout(()=>document.getElementById('extras')?.scrollIntoView({block:'start'}),100);}
  addEventListener('hashchange',()=>{if(location.hash==='#extras'){$('#filter').value='extra';visible=12;render();document.getElementById('extras')?.scrollIntoView({behavior:'smooth'});}});
  $('#add').addEventListener('click',()=>window.QMRTools?.open('add'));
  $('#proxy-form').addEventListener('submit',event=>{
    if(event.submitter?.value!=='save')return;
    const n={server:$('#server').value.trim(),port:Number($('#port').value),secret:$('#secret').value.trim(),name:'بروكسي شخصي',custom:true};
    if(!validNode(n)){event.preventDefault();$('#form-error').textContent='تحقق من عنوان الخادم والمنفذ والـSecret.';return;}
    if(custom.some(x=>token(x)===token(n))){event.preventDefault();$('#form-error').textContent='هذا البروكسي موجود سابقًا.';return;}
    if(custom.length>=30){event.preventDefault();$('#form-error').textContent='يمكن حفظ 30 بروكسي شخصيًا كحد أقصى للحفاظ على توافق v7.';return;}
    custom.unshift(n);store();render();toast('تم حفظ البروكسي محليًا.');$('#proxy-form').reset();
  });
  $('#export').addEventListener('click',()=>{
    const content=JSON.stringify({schema:'qmrproxy.saved.v1',exported_at:new Date().toISOString(),nodes:custom.map(({custom,...node})=>node),favorites:[...saved]},null,2);
    const blob=new Blob([content],{type:'application/json'}),uri=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=uri;link.download='QMRProxy-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(uri),3000);
    toast('تم تصدير ملف الاختيارات. احتفظ به في مكان آمن.');
  });
  $('#import').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try {
      if(file.size>1024*1024)throw Error('ملف كبير جدًا.');
      const data=JSON.parse(await file.text());
      if(!data || typeof data!=='object')throw Error('الملف غير صالح.');
      const incoming=(data.schema==='qmrproxy.saved.v1'&&Array.isArray(data.nodes)?data.nodes:(Array.isArray(data.custom)?data.custom:[])).filter(validNode).slice(0,30);
      const map=new Map([...custom,...incoming].map(n=>[token(n),{...n,custom:true}]));
      custom=[...map.values()].slice(0,30);
      if(Array.isArray(data.favorites))for(const k of data.favorites.filter(x=>typeof x==='string').slice(0,400))saved.add(k);
      store();render();toast('استيراد ناجح: '+incoming.length+' بروكسي شخصي صالح.');
    }catch(e){toast('تعذر استيراد الملف: '+e.message);}
    event.target.value='';
  });
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installation=e;});
  $('#install').addEventListener('click',async()=>{
    if(installation){installation.prompt();await installation.userChoice;installation=null;}
    else toast('من قائمة المتصفح اختر إضافة إلى الشاشة الرئيسية أو تثبيت التطبيق.');
  });
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  const mode=$('#telegram-mode');
  if (insideTelegram()) {
    document.documentElement.classList.add('qmr-miniapp');
    if(mode)mode.textContent='◉ Telegram Mini App — فتح روابط البروكسي عبر Telegram';
    try { window.Telegram.WebApp.ready();window.Telegram.WebApp.expand(); } catch {}
  } else if(mode)mode.textContent='◉ متصفح خارجي — قد تحتاج فتح الرابط في تطبيق Telegram';
  readLocal();load();
  setInterval(()=>{if(!document.hidden)void load();},30*60*1000);
})();
