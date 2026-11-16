import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qmr-v6-smoke-'));
try {
  fs.cpSync(path.join(root,'tgcloud'),path.join(tmp,'tgcloud'),{recursive:true});
  fs.mkdirSync(path.join(tmp,'node_modules','sdk'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'package.json'),JSON.stringify({type:'module'}));
  fs.writeFileSync(path.join(tmp,'node_modules','sdk','package.json'),JSON.stringify({name:'sdk',type:'module',exports:{'.':'./index.js','./db':'./db.js'}}));
  fs.writeFileSync(path.join(tmp,'node_modules','sdk','index.js'),`
    export const api={
      getChatMember: async ({user_id})=>{
        if(globalThis.qmrTest.memberError)throw Error('Not admin');
        return {status:globalThis.qmrTest.membership};
      },
      sendMessage: async (params)=>{globalThis.qmrTest.messages.push(params);return {message_id:100}},
      editMessageText: async (params)=>{if(globalThis.qmrTest.editError)throw globalThis.qmrTest.editError;globalThis.qmrTest.edits.push(params);return {message_id:params.message_id}},
      answerCallbackQuery: async (params)=>{globalThis.qmrTest.answers.push(params);return true},
      setMyCommands:async ()=>true,setMyDescription:async()=>true,setMyShortDescription:async()=>true,
    };
    export const db={insert(){throw Error('Database not migrated')},select(){throw Error('Database not migrated')},$count(){throw Error('Database not migrated')}};
    export const fetch=async ()=>{throw Error('No Internet in smoke test')};
  `);
  fs.writeFileSync(path.join(tmp,'node_modules','sdk','db.js'),`
    const col=()=>({primaryKey(){return this},notNull(){return this},default(){return this},unique(){return this}});
    export const table=(name,columns,fn)=>({name,...columns});
    export const integer=col; export const text=col;
    export const index=()=>({on(){return {}}});
    export const sql=(s,...xs)=>'';
    export const eq=()=>({});export const gt=()=>({});export const asc=()=>({});
  `);
  globalThis.qmrTest={membership:'left',memberError:false,messages:[],edits:[],answers:[]};
  const m=(await import(pathToFileURL(path.join(tmp,'tgcloud/handlers/message.js')).href)).default;
  const cb=(await import(pathToFileURL(path.join(tmp,'tgcloud/handlers/callback_query.js')).href)).default;
  const {getNodes,selectLiveNodes}=await import(pathToFileURL(path.join(tmp,'tgcloud/lib/nodes.js')).href);
  const fakeUser=(id,txt)=>({chat:{id,type:'private'},from:{id},text:txt});
  const fakeCb=(id,data)=>({id:'callback1',data,from:{id},message:{chat:{id},message_id:321}});
  const reset=()=>{globalThis.qmrTest.messages=[];globalThis.qmrTest.edits=[];globalThis.qmrTest.answers=[];};

  await m(fakeUser(10001,'/start'));
  assert.match(globalThis.qmrTest.messages.at(-1)?.text||'',/الاشتراك مطلوب/);
  assert.equal(globalThis.qmrTest.messages.at(-1)?.reply_markup?.inline_keyboard?.[0]?.[0]?.url,'https://t.me/QMR7S');
  reset();
  await m(fakeUser(10001,'/servers 2'));
  assert.match(globalThis.qmrTest.messages.at(-1)?.text||'',/الاشتراك مطلوب/);
  reset();
  globalThis.qmrTest.membership='member';
  await m(fakeUser(10001,'/servers 2'));
  const listed=globalThis.qmrTest.messages.at(-1);
  assert.match(listed.text,/11\. /);
  assert.equal(listed.reply_markup.inline_keyboard.filter(row=>row[0].url?.includes('t.me/proxy')).length,10);
  reset();
  await m(fakeUser(10001,'/admin'));
  assert.doesNotMatch(globalThis.qmrTest.messages.at(-1)?.text||'',/لوحة إدارة QMR Proxy/);
  reset();
  await m(fakeUser(6246913670,'/admin'));
  assert.match(globalThis.qmrTest.messages.at(-1)?.text||'',/لوحة إدارة QMR Proxy/);
  reset();
  await cb(fakeCb(10001,'q:admin'));
  assert.equal(globalThis.qmrTest.messages.length,0);
  assert.match(globalThis.qmrTest.answers.at(-1)?.text||'',/غير مخوّل/);
  reset();
  await cb(fakeCb(10001,'q:servers:3'));
  assert.equal(globalThis.qmrTest.edits.length,1);
  assert.match(globalThis.qmrTest.edits.at(-1)?.text||'',/21\. /);
  reset();
  globalThis.qmrTest.memberError=true;
  await cb(fakeCb(10001,'q:verify'));
  assert.match(globalThis.qmrTest.edits.at(-1)?.text||'',/تعذر التحقق/);
  globalThis.qmrTest.memberError=false;
  reset();
  await m(fakeUser(6246913670,'/setup'));
  assert.match(globalThis.qmrTest.messages.at(-1)?.text||'',/إعداد الملف الشخصي للبوت/);
  reset();
  await m(fakeUser(10001,'/maintenance on'));
  assert.equal(globalThis.qmrTest.messages.at(-1)?.text?.includes('مفعل'),false);
  reset();
  const source=await getNodes(async()=>{throw Error('offline')});
  assert.equal(source.nodes.length,60);
  assert.equal(source.from,'snapshot');
  assert.equal(selectLiveNodes({updated_at:'2020-01-01T00:00:00Z',endpoints:[]}),null);
  const defaultBtn=(await import(pathToFileURL(path.join(tmp,'tgcloud/lib/ui.js')).href)).home();
  const {sendScreen}=await import(pathToFileURL(path.join(tmp,'tgcloud/lib/ui.js')).href);
  reset();
  globalThis.qmrTest.editError={description:'Bad Request: message is not modified'};
  await sendScreen(10001,{text:'same screen'},321);
  assert.equal(globalThis.qmrTest.messages.length,0,'Repeated taps must not send duplicates');
  globalThis.qmrTest.editError={description:'Too Many Requests: retry after 5'};
  await assert.rejects(()=>sendScreen(10001,{text:'rate limited'},321));
  assert.equal(globalThis.qmrTest.messages.length,0,'Rate limits must not trigger a second send');
  globalThis.qmrTest.editError={description:'Bad Request: message to edit not found'};
  await sendScreen(10001,{text:'replacement'},321);
  assert.equal(globalThis.qmrTest.messages.length,1,'Deleted screens may be replaced');
  globalThis.qmrTest.editError=null;
  assert.equal(defaultBtn.inline_keyboard[2][0].style,undefined);
  const appRow=defaultBtn.inline_keyboard.find(row=>row.some(button=>button.web_app));
  assert.equal(appRow?.[0]?.web_app?.url,'https://qmr-proxy.alialnyamy675.chatgpt.site');
  reset();
  await m(fakeUser(10001,'/app'));
  assert.ok(globalThis.qmrTest.messages.at(-1)?.reply_markup?.inline_keyboard?.some(row=>row.some(x=>x.web_app?.url)));
  reset();
  await m(fakeUser(10001,'/faq'));
  assert.match(globalThis.qmrTest.messages.at(-1)?.text||'',/الأسئلة الشائعة/);
  reset();
  await cb(fakeCb(10001,'q:safety'));
  assert.match(globalThis.qmrTest.edits.at(-1)?.text||'',/دليل الأمان/);
  reset();
  await m(fakeUser(6246913670,'/setup'));
  assert.match(globalThis.qmrTest.messages.at(-1)?.text||'',/configure_profile.py/);
  console.log('PASS: v7 integration assertions — Mini App, safety, FAQ, subscription, callback permissions, fallback links, owner-only admin, safe profile setup');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
