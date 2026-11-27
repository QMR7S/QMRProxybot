// Read-only source aggregation. HTTPS source-reported data, not MTProto probes.
const BASE='https://raw.githubusercontent.com/0xRadikal/Free-Telegram-Proxy/main/';
const SNAPSHOT='https://app9239734904.tgcloud.ai/extra-proxies.json';
const MAX_AGE=72*3600000, MAX_SIZE=1100000;
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
export function publicIPv4(host){
  if(typeof host!=='string'||!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host))return false;
  const [a,b,c,d]=host.split('.').map(Number);
  if([a,b,c,d].some(n=>n>255))return false;
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
function hostOK(s){
 if(typeof s!=='string'||s.length>253||!s.includes('.')||!s.split('.').every(p=>/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(p)))return false;
 if(/^[\d.]+$/.test(s))return publicIPv4(s);
 return /^[a-z][a-z0-9-]*$/i.test(s.split('.').at(-1))&&!/\.(local|internal|test|invalid|localhost|onion)$/i.test(s);
}
function linkOK(n){
 return n&&hostOK(n.server)&&Number.isSafeInteger(n.port)&&n.port>0&&n.port<=65535&&
 typeof n.secret==='string'&&/^[a-f0-9]{32,512}$/i.test(n.secret)&&n.secret.length%2===0&&
 (n.secret.match(/0/g)||[]).length/n.secret.length<.76;
}
function fresh(stamp,now){const t=Date.parse(stamp);return Number.isFinite(t)&&t<=now&&now-t<=MAX_AGE;}
export function selectExtra(fast,stable,stamp,now=Date.now()){
 if(!fresh(stamp,now)||!Array.isArray(fast)||!Array.isArray(stable))return null;
 const valid=n=>linkOK(n)&&publicIPv4(n.ip)&&Number.isSafeInteger(n.checks)&&n.checks>=72&&finite(n.uptime,.96,1)&&finite(n.rtt_ms,0.001,250);
 const rank=a=>a.filter(valid).sort((a,b)=>a.rtt_ms-b.rtt_ms||b.uptime-a.uptime);
 const seen=new Set(),ips=new Set(),asn=new Map(),country=new Map(),nodes=[];
 for(const n of [...rank(fast),...rank(stable)]){
   const key=n.server.toLowerCase()+':'+n.port+':'+n.secret.toLowerCase();
   const a=String(n.asn??'unknown'),c=/^[a-z]{2}$/i.test(n.country||'')?n.country.toUpperCase():'??';
   if(seen.has(key)||ips.has(n.ip)||(asn.get(a)||0)>=8||(country.get(c)||0)>=35)continue;
   seen.add(key);ips.add(n.ip);asn.set(a,(asn.get(a)||0)+1);country.set(c,(country.get(c)||0)+1);
   nodes.push({name:'إضافي '+String(nodes.length+1).padStart(3,'0')+' · '+c,server:n.server,port:n.port,secret:n.secret,origin:'extra',community_source:'0xRadikal',source_rtt_ms:Math.round(n.rtt_ms),median_rtt_ms:Math.round(n.rtt_ms),source_uptime:n.uptime,country:c,ads_status:'unknown'});
   if(nodes.length>=160)break;
 }
 return nodes.length>=15?{nodes,updated_at:stamp,from:'remote',stale:false}:null;
}
export function selectSnapshot(d,now=Date.now()){
 if(d?.schema!=='qmr-extra-v1'||!Array.isArray(d.nodes))return null;
 const nodes=d.nodes.filter(linkOK).slice(0,160);
 if(!nodes.length)return null;
 const updated_at=d.source_checked_at||d.updated_at||null;
 return {nodes,updated_at,from:'snapshot',stale:!fresh(updated_at,now)};
}
async function load(fetcher,url){
 const r=await fetcher(url);if(!r.ok)throw Error('source HTTP');
 const text=await r.text();if(text.length>MAX_SIZE)throw Error('source size');
 return JSON.parse(text);
}
export async function getExtraNodes(fetcher,now=Date.now()){
 try{
   const [idx,fast,stable]=await Promise.all(['index.json','fast/proxies.json','stable/proxies.json'].map(p=>load(fetcher,BASE+p)));
   const result=selectExtra(fast,stable,idx.updated,now);
   if(result)return result;
 }catch(_){}
 try{const result=selectSnapshot(await load(fetcher,SNAPSHOT),now);if(result)return result;}catch(_){}
 return {nodes:[],updated_at:null,from:'unavailable',stale:true};
}
export function extraPage(result,page=1){
 const n=Number(page),max=Math.max(1,Math.ceil(result.nodes.length/10)),p=Math.min(max,Math.max(1,Number.isFinite(n)?Math.trunc(n):1));
 const selected=result.nodes.slice((p-1)*10,p*10);
 const rows=selected.map((x,i)=>[{text:'اتصال '+((p-1)*10+i+1),url:'https://t.me/proxy?server='+encodeURIComponent(x.server)+'&port='+x.port+'&secret='+encodeURIComponent(x.secret)}]);
 if(selected.length){const nav=[];if(p>1)nav.push({text:'◀ السابق',callback_data:'q:extra:'+(p-1)});if(p<max)nav.push({text:'التالي ▶',callback_data:'q:extra:'+(p+1)});if(nav.length)rows.push(nav);}
 rows.push([{text:'القائمة الأساسية',callback_data:'q:servers:1'},{text:'الرئيسية',callback_data:'q:home'}]);
 const header='🌐 المجموعة الإضافية · '+p+'/'+max+'\n\n';
 const list=selected.map((x,i)=>((p-1)*10+i+1)+'. '+x.server+':'+x.port).join('\n');
 return {text:header+(list||'المصدر غير متاح حاليًا.')+'\n\nآخر تحديث للمصدر: '+(result.updated_at||'غير معلوم')+'\n'+(result.stale?'⚠️ لقطة قديمة أو غير متاحة.\n':'')+'هذه روابط طرف ثالث؛ قياسات المصدر لا تثبت الاتصال من جهازك أو الأمان أو خلو الإعلانات.',reply_markup:{inline_keyboard:rows}};
}
export function qualityUnavailable(){
 return {text:'⚡ الاختيار حسب الجودة\n\nلا يوجد قياس MTProto مستقل وحديث من مراقب معتمد في TGCloud. لا نعرض ترشيحًا على أنه الأفضل بناءً على بيانات طرف ثالث فقط. يمكنك تصفح القائمة الأساسية والإضافية.',reply_markup:{inline_keyboard:[[{text:'الأساسية',callback_data:'q:servers:1'},{text:'الإضافية',callback_data:'q:extra:1'}],[{text:'الرئيسية',callback_data:'q:home'}]]}};
}
