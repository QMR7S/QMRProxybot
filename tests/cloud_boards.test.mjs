import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeOwner,parseAction,createBoards,OWNER_ID} from '../tgcloud/lib/cloud_boards_core.js';
const now=()=>1700000000000;
const ctx={initData:{user:{id:OWNER_ID},auth_date:1700000000}};
test('owner identity comes only from verified context and is age bounded',()=>{
 assert.equal(authorizeOwner(ctx,now()),OWNER_ID);
 for(const bad of [{},{initData:{user:{id:1},auth_date:1700000000}}, {initData:{user:{id:String(OWNER_ID)},auth_date:1700000000}}, {initData:{user:{id:OWNER_ID},auth_date:1699990000}}, {initData:{user:{id:OWNER_ID},auth_date:1700001000}}])
   assert.throws(()=>authorizeOwner(bad,now()));
});
test('action validation prevents owner ban and unconfirmed writes',()=>{
 assert.throws(()=>parseAction({action:'ban',uid:OWNER_ID,confirm:'CONFIRM'}));
 assert.throws(()=>parseAction({action:'ban',uid:1}));
 assert.throws(()=>parseAction({action:'maintenance',enabled:'true',confirm:'CONFIRM'}));
 assert.equal(parseAction({action:'maintenance',enabled:true,confirm:'CONFIRM'}).target,'on');
});
function fixture(fail=false){
 const calls=[];
 const db={get:async(sql,params)=>{calls.push(sql);if(sql.startsWith('SELECT COUNT'))return {users:2,active_7d:1,blocked:0,requests:5};if(!sql.startsWith('SELECT'))throw Error('Read query looks like a write one');throw Error('unexpected query');},
 all:async(sql)=>{calls.push(sql);return [];},insertAudit:async()=>{calls.push('INSERT audit');return {id:1};},updateOne:async()=>{calls.push('UPDATE audit');return {id:1};}};
 const boards=createBoards({db,api:{getMe:async()=>({id:9239734904,username:'QMRProxybot'})},getNodes:async()=>({nodes:[{}],updated_at:'2026-11-27',from:'remote'}),getSetting:async()=> '0',setSetting:async()=>{calls.push('mutate');if(fail)throw Error('lost response');},setBlocked:async()=>{calls.push('mutate');},now});
 return {boards,calls};
}
test('nonowner rejected before DB read or mutation including forged input',async()=>{
 const {boards,calls}=fixture();
 await assert.rejects(boards.admin({op:'summary',user:{id:OWNER_ID}},{}));
 await assert.rejects(boards.ops({},{}));
 await assert.rejects(boards.admin({op:'action',action:'maintenance',enabled:true,confirm:'CONFIRM'},{}));
 assert.equal(calls.length,0);
});
test('ops does not fabricate queue counters or return user IDs',async()=>{
 const {boards}=fixture();const v=await boards.ops({},ctx);
 assert.equal(v.webhook.receiver,'bot_api_verified');assert.equal(v.webhook.inbox.pending,null);
 assert.equal(v.activity.users,2);assert.equal(v.users,undefined);
});
test('admin action records intent before write and confirmation after',async()=>{
 const {boards,calls}=fixture();
 assert.deepEqual(await boards.admin({op:'action',action:'maintenance',enabled:true,confirm:'CONFIRM'},ctx),{ok:true});
 assert.match(calls[0],/^INSERT/);assert.equal(calls[1],'mutate');assert.match(calls[2],/^UPDATE/);
});
test('ambiguous writes never claim success or retry',async()=>{
 const {boards,calls}=fixture(true);
 await assert.rejects(boards.admin({op:'action',action:'maintenance',enabled:true,confirm:'CONFIRM'},ctx),/ACTION_UNCERTAIN_RELOAD/);
 assert.equal(calls.length,2);
});
test('admin summary returns current DB fields',async()=>{
 const {boards}=fixture();const d=await boards.admin({op:'summary'},ctx);
 assert.deepEqual(d.users,[]);assert.deepEqual(d.events,[]);assert.equal(d.maintenance,false);
});

test('verified numeric-string auth_date works with unchanged one-hour freshness limit',()=>{
 const make=auth_date=>({initData:{user:{id:OWNER_ID},auth_date}});
 assert.equal(authorizeOwner(make('1700000000'),now()),OWNER_ID);
 assert.equal(authorizeOwner(make('1699996400'),now()),OWNER_ID);
 assert.throws(()=>authorizeOwner(make('1699996399'),now()),/REOPEN_TELEGRAM/);
 assert.throws(()=>authorizeOwner(make('1700000061'),now()),/AUTH_DATE_FUTURE/);
 for(const bad of ['', ' 1700000000', '1.7e9', '1700000000.0', '1700000000000', true, {}, -1, 0])
   assert.throws(()=>authorizeOwner(make(bad),now()),/AUTH_DATE_FORMAT/);
 assert.throws(()=>authorizeOwner(make(undefined),now()),/AUTH_DATE_MISSING/);
 assert.throws(()=>authorizeOwner({initData:{user:{id:1},auth_date:'1700000000'}},now()),/OWNER_ONLY/);
});
test('client cannot repair missing or stale signed date by sending input',async()=>{
 const {boards,calls}=fixture();
 await assert.rejects(boards.admin({op:'summary',auth_date:1700000000},{initData:{user:{id:OWNER_ID}}}),/AUTH_DATE_MISSING/);
 await assert.rejects(boards.admin({op:'action',action:'maintenance',enabled:true,confirm:'CONFIRM',auth_date:1700000000},{initData:{user:{id:OWNER_ID},auth_date:'1699996399'}}),/REOPEN_TELEGRAM/);
 assert.equal(calls.length,0);
});
