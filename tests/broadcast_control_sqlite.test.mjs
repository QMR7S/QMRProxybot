import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {makeBroadcastControl} from '../tgcloud/lib/broadcast_control.js';
const OWNER=1234;
function fixture(send){
 const raw=new DatabaseSync(':memory:');
 raw.exec("CREATE TABLE qmr_users_v6(user_id INTEGER PRIMARY KEY,blocked INTEGER NOT NULL); INSERT INTO qmr_users_v6 VALUES(1234,0),(12,0),(13,0),(14,1);CREATE TABLE qmr_notify_optin_v13(user_id INTEGER PRIMARY KEY,enabled_at INTEGER NOT NULL);CREATE TABLE qmr_notify_jobs_v13(id INTEGER PRIMARY KEY AUTOINCREMENT,message_id INTEGER UNIQUE NOT NULL,scope TEXT NOT NULL,content TEXT NOT NULL,state TEXT NOT NULL,created_ms INTEGER NOT NULL,step_seq INTEGER NOT NULL DEFAULT 0);CREATE TABLE qmr_notify_delivery_v13(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,user_id INTEGER NOT NULL,state TEXT NOT NULL,attempted_ms INTEGER,resolved_ms INTEGER,retry_after_ms INTEGER,UNIQUE(job_id,user_id));");
 let time=1700000000000;
 const sends=[];
 const db={get:async(sql,args)=>raw.prepare(sql).get(args),all:async(sql,args)=>raw.prepare(sql).all(args),run:async(sql,args)=>raw.prepare(sql).run(args)};
 const ctl=makeBroadcastControl(db,async(uid,text)=>{sends.push(uid);return send?send(uid,text):{message_id:100,chat:{id:uid}};},OWNER,()=>time);
 return {ctl,raw,sends,advance:ms=>time+=ms};
}
async function canary(f,mid=1){const j=await f.ctl.create(OWNER,mid,'test','canary');assert.equal(j.total,1);await f.ctl.confirm(OWNER,j.id);return f.ctl.step(OWNER,j.id,0);}
test('owner-only canary, explicit confirmation, no automatic sends',async()=>{
 const f=fixture();try{
 await assert.rejects(f.ctl.create(12,1,'bad','canary'),/OWNER_ONLY/);
 await assert.rejects(f.ctl.create(OWNER,2,'news'),/CANARY_REQUIRED/);
 const j=await f.ctl.create(OWNER,1,'test','canary');
 assert.equal(j.state,'draft');assert.equal((await f.ctl.create(OWNER,1,'test','canary')).id,j.id);
 await f.ctl.step(OWNER,j.id,0);assert.deepEqual(f.sends,[]);
 await f.ctl.confirm(OWNER,j.id);assert.deepEqual(f.sends,[]);
 const d=await f.ctl.step(OWNER,j.id,0);assert.equal(d.state,'done');assert.deepEqual(f.sends,[OWNER]);
 await f.ctl.step(OWNER,j.id,0);assert.deepEqual(f.sends,[OWNER]);
 assert.equal(await f.ctl.unlocked(),true);
 }finally{f.raw.close();}
});
test('opt-in snapshot and one-time sequence prevent replay; opt-out rechecked',async()=>{
 const f=fixture();try{
 await canary(f);
 await f.ctl.preference(12,true);await f.ctl.preference(13,true);
 await assert.rejects(f.ctl.preference(14,true),/NOT_ELIGIBLE/);
 const j=await f.ctl.create(OWNER,2,'news');assert.equal(j.total,2);
 await f.ctl.confirm(OWNER,j.id);
 let d=await f.ctl.step(OWNER,j.id,0);assert.equal(d.stepSeq,1);assert.equal(d.counts.sent,1);
 await f.ctl.step(OWNER,j.id,0);assert.deepEqual(f.sends,[OWNER,12]);
 await f.ctl.preference(13,false);d=await f.ctl.step(OWNER,j.id,1);
 assert.equal(d.counts.skipped,1);assert.equal(d.state,'done');assert.deepEqual(f.sends,[OWNER,12]);
 }finally{f.raw.close();}
});
test('concurrent callbacks cannot both send',async()=>{
 let release;let started;const ready=new Promise(r=>started=r);
 const f=fixture(async uid=>{if(uid!==OWNER){started();await new Promise(r=>release=r);}return {message_id:100,chat:{id:uid}};});
 try{await canary(f);await f.ctl.preference(12,true);await f.ctl.preference(13,true);
 const j=await f.ctl.create(OWNER,2,'news');await f.ctl.confirm(OWNER,j.id);
 const first=f.ctl.step(OWNER,j.id,0);await ready;await f.ctl.step(OWNER,j.id,0);await f.ctl.step(OWNER,j.id,1);
 assert.deepEqual(f.sends,[OWNER,12]);release();await first;
 }finally{f.raw.close();}
});
test('ambiguous send stops campaign, never retries',async()=>{
 const f=fixture(async uid=>{if(uid!==OWNER)throw Error('network');return {message_id:100,chat:{id:uid}};});
 try{await canary(f);await f.ctl.preference(12,true);await f.ctl.preference(13,true);
 const j=await f.ctl.create(OWNER,2,'news');await f.ctl.confirm(OWNER,j.id);
 let d=await f.ctl.step(OWNER,j.id,0);assert.equal(d.counts.unknown,1);assert.equal(d.counts.pending,1);
 await f.ctl.step(OWNER,j.id,1);assert.deepEqual(f.sends,[OWNER,12]);
 d=await f.ctl.cancel(OWNER,j.id);assert.equal(d.state,'cancelled');
 }finally{f.raw.close();}
});
test('429 cooldown prevents another campaign from sending',async()=>{
 const f=fixture(async uid=>{if(uid!==OWNER)throw {code:429,parameters:{retry_after:30}};return {message_id:100,chat:{id:uid}};});
 try{await canary(f);await f.ctl.preference(12,true);const j=await f.ctl.create(OWNER,2,'news');await f.ctl.confirm(OWNER,j.id);await f.ctl.step(OWNER,j.id,0);await f.ctl.cancel(OWNER,j.id);
 const k=await f.ctl.create(OWNER,3,'second');await f.ctl.confirm(OWNER,k.id);
 await f.ctl.step(OWNER,k.id,0);assert.deepEqual(f.sends,[OWNER,12]);
 f.advance(31000);await f.ctl.step(OWNER,k.id,0);assert.deepEqual(f.sends,[OWNER,12,12]);
 }finally{f.raw.close();}
});
test('data deletion removes opt-in and settled delivery records',async()=>{
 const f=fixture();try{await canary(f);await f.ctl.preference(12,true);const j=await f.ctl.create(OWNER,2,'news');await f.ctl.confirm(OWNER,j.id);await f.ctl.step(OWNER,j.id,0);await f.ctl.forget(12);
 assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM qmr_notify_optin_v13 WHERE user_id=12').get().n,0);
 assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM qmr_notify_delivery_v13 WHERE user_id=12').get().n,0);
 }finally{f.raw.close();}
});
test('orphan attempt requires explicit aged abandonment',async()=>{
 const f=fixture();try{const j=await f.ctl.create(OWNER,1,'test','canary');await f.ctl.confirm(OWNER,j.id);
 f.raw.prepare("UPDATE qmr_notify_delivery_v13 SET state='attempting',attempted_ms=? WHERE job_id=?").run(1700000000000,j.id);
 assert.equal((await f.ctl.abandon(OWNER,j.id)).state,'sending');
 f.advance(300001);const d=await f.ctl.abandon(OWNER,j.id);assert.equal(d.state,'cancelled');assert.equal(d.counts.unknown,1);assert.deepEqual(f.sends,[]);assert.equal(await f.ctl.unlocked(),false);
 }finally{f.raw.close();}
});
