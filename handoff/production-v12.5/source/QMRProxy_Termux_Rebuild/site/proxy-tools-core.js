/* Format-only local MTProto validation; intentionally makes no network probes. */
((g)=>{'use strict';
const key=n=>[String(n.server||'').toLowerCase(),Number(n.port)||0,String(n.secret||'')].join('|');
function validate(x){const server=String(x?.server??'').trim().toLowerCase(),portText=String(x?.port??'').trim(),port=/^\d+$/.test(portText)?Number(portText):NaN,secret=String(x?.secret??'').trim(),errors=[];
if(!server||server.length>253||!/^[a-z0-9.-]+$/.test(server)||server.startsWith('.')||server.endsWith('.')||server.includes('..')||server.split('.').some(s=>!s||s.length>63||s.startsWith('-')||s.endsWith('-')))errors.push('عنوان الخادم غير صالح.');
if(/^\d+\.\d+\.\d+\.\d+$/.test(server)&&server.split('.').some(s=>Number(s)>255))errors.push('عنوان IPv4 خارج المدى.');
if(!Number.isInteger(port)||port<1||port>65535)errors.push('منفذ غير صالح (1–65535).');
if(!((/^[a-f0-9]{32,512}$/i.test(secret)&&secret.length%2===0)||/^[A-Za-z0-9_-]{22,684}={0,2}$/.test(secret)))errors.push('صيغة Secret غير مدعومة.');
return {ok:errors.length===0,errors,node:{server,port,secret,name:String(x?.name||'بروكسي شخصي').slice(0,60)}};}
function parse(text){const raw=String(text||'').trim();if(!raw)return{ok:false,errors:['ألصق رابط MTProto.']};if(raw.length>2500)return{ok:false,errors:['الرابط طويل جدًا.']};let u;try{u=new URL(raw);}catch{return{ok:false,errors:['صيغة الرابط غير مفهومة.']};}
if(!((u.protocol==='tg:'&&u.hostname==='proxy')||(u.protocol==='https:'&&['t.me','www.t.me','telegram.me'].includes(u.hostname)&&u.pathname.replace(/\/$/,'')==='/proxy')))return{ok:false,errors:['استخدم رابط tg://proxy أو t.me/proxy؛ روابط SOCKS غير مدعومة.']};
for(const part of ['server','port','secret'])if(u.searchParams.getAll(part).length!==1)return{ok:false,errors:['رابط ناقص أو يحتوي حقولًا مكررة.']};
return validate({server:u.searchParams.get('server'),port:u.searchParams.get('port'),secret:u.searchParams.get('secret')});}
const canonical=n=>'https://t.me/proxy?'+new URLSearchParams({server:n.server,port:String(n.port),secret:n.secret});
function saved(){try{const d=JSON.parse(localStorage.getItem('qmrproxy.personal.v3')||'[]');return(Array.isArray(d)?d:Array.isArray(d.custom)?d.custom:[]).filter(x=>validate(x).ok).slice(0,30);}catch{return[];}}
function add(n){const check=validate(n);if(!check.ok)return{ok:false,error:check.errors.join(' ')};const current=saved();if(current.some(x=>key(x)===key(n)))return{ok:false,error:'هذا البروكسي موجود بالفعل في إضافاتك.'};if(current.length>=30)return{ok:false,error:'الحد الأقصى 30 بروكسي شخصيًا.'};try{localStorage.setItem('qmrproxy.personal.v3',JSON.stringify([check.node,...current]));g.dispatchEvent(new Event('qmr:stored'));return{ok:true};}catch{return{ok:false,error:'فشل التخزين المحلي.'};}}
const api={key,parse,validate,canonical,saved,add};g.QMRProxyTools=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
