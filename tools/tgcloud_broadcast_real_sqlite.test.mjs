import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {makeBroadcastV13Adapter} from './tgcloud_broadcast_adapter_v13.mjs';
import {createV13DispatchBridge} from './tgcloud_broadcast_bridge_v13.mjs';

const TOKEN_A='a'.repeat(32), TOKEN_B='b'.repeat(32);
function fixture(ids=[101,102,103]) {
  const raw=new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('./broadcast_v13_review_schema.sql', import.meta.url),'utf8'));
  raw.exec('CREATE TABLE qmr_users_v6(user_id INTEGER PRIMARY KEY,blocked INTEGER NOT NULL DEFAULT 0)');
  raw.prepare("INSERT INTO qmr_broadcast_jobs_v13(id,content,state,created_ms) VALUES(1,'Synthetic broadcast','sending',0)").run();
  for(const userId of ids) {
    raw.prepare('INSERT INTO qmr_users_v6(user_id,blocked) VALUES(?,?)').run(userId,userId===103?1:0);
    raw.prepare('INSERT INTO qmr_broadcast_delivery_v13(broadcast_id,user_id) VALUES(1,?)').run(userId);
  }
  const db={
    async get(sql,params={}) {return raw.prepare(sql).get(params)??null;},
    async all(sql,params={}) {return raw.prepare(sql).all(params);},
  };
  return {raw,adapter:makeBroadcastV13Adapter(db)};
}
const state=(raw,id)=>raw.prepare('SELECT state FROM qmr_broadcast_delivery_v13 WHERE user_id=?').get(id)?.state;

test('real SQLite executes bridge and journal for all recipients',async()=>{
  const {raw,adapter}=fixture();
  try {
    const result=await createV13DispatchBridge(adapter,async()=>{}).dispatch(1,TOKEN_A);
    assert.deepEqual(result,{status:'complete',sent:2,uncertain:0,blocked:1});
    assert.equal(state(raw,101),'sent');assert.equal(state(raw,102),'sent');
    assert.equal(state(raw,103),'blocked');
    assert.equal(raw.prepare('SELECT attempts FROM qmr_broadcast_delivery_v13 WHERE user_id=101').get().attempts,1);
  } finally {raw.close();}
});
test('real SQLite stores timeout as unknown without duplicate send',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    let called=0;
    const bridge=createV13DispatchBridge(adapter,async()=>{called++;throw Error('ambiguous timeout');});
    assert.equal((await bridge.dispatch(1,TOKEN_A)).uncertain,1);
    await bridge.dispatch(1,TOKEN_B);
    assert.equal(called,1);assert.equal(state(raw,101),'unknown');
  } finally {raw.close();}
});
test('real SQLite exclusive lease and stale owner fencing',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    const a=await adapter.claim(1,TOKEN_A,100,1000);
    assert.equal(await adapter.claim(1,TOKEN_B,999,1000),null);
    const b=await adapter.claim(1,TOKEN_B,1100,1000);
    assert.equal(b.fence,a.fence+1);
    await assert.rejects(adapter.markAttempt(1,101,TOKEN_A,a.fence,1101),/stale lease/);
    await adapter.markAttempt(1,101,TOKEN_B,b.fence,1101);
    await adapter.release(1,TOKEN_A,a.fence);
    assert.equal(raw.prepare('SELECT owner_token FROM qmr_broadcast_jobs_v13').get().owner_token,TOKEN_B);
  } finally {raw.close();}
});
test('real SQLite cancellation prevents dispatch',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    raw.exec("UPDATE qmr_broadcast_jobs_v13 SET state='cancelled'");
    const result=await createV13DispatchBridge(adapter,async()=>assert.fail('send forbidden')).dispatch(1,TOKEN_A);
    assert.equal(result.status,'busy');assert.equal(state(raw,101),'pending');
  } finally {raw.close();}
});
test('missing blocklist schema fails closed before Telegram send',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    raw.exec('DROP TABLE qmr_users_v6');
    let sends=0;
    await assert.rejects(createV13DispatchBridge(adapter,async()=>{sends++;}).dispatch(1,TOKEN_A),/no such table/);
    assert.equal(sends,0);assert.equal(state(raw,101),'pending');
  } finally {raw.close();}
});

test('missing recipient row fails closed even when user table exists',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    raw.exec('DELETE FROM qmr_users_v6 WHERE user_id=101');
    let sends=0;
    await assert.rejects(
      createV13DispatchBridge(adapter,async()=>{sends++;}).dispatch(1,TOKEN_A),
      /recipient absent from verified user table/);
    assert.equal(sends,0);
    assert.equal(state(raw,101),'pending');
  } finally {raw.close();}
});

test('actual SQLite preserves rest of queue when first Telegram send fails',async()=>{
  const {raw,adapter}=fixture([101,102]);
  try {
    let calls=0;
    const result=await createV13DispatchBridge(adapter,async()=>{
      calls++;throw Error('upstream disconnected');
    }).dispatch(1,TOKEN_A);
    assert.equal(result.status,'send-error');
    assert.equal(calls,1);
    assert.equal(state(raw,101),'unknown');
    assert.equal(state(raw,102),'pending');
  } finally {raw.close();}
});

test('cannot finalize empty broadcast or a broadcast with pending recipients',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    assert.equal(await adapter.finalize(1,1000),false);
    raw.exec('DELETE FROM qmr_broadcast_delivery_v13');
    assert.equal(await adapter.finalize(1,1000),false);
    assert.equal(raw.prepare('SELECT state FROM qmr_broadcast_jobs_v13').get().state,'sending');
  } finally {raw.close();}
});
test('cannot finalize unknown recipient after ambiguous Telegram outcome',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    await createV13DispatchBridge(adapter,async()=>{throw Error('timeout');}).dispatch(1,TOKEN_A);
    assert.equal(state(raw,101),'unknown');
    assert.equal(await adapter.finalize(1,Date.now()),false);
    assert.equal(raw.prepare('SELECT state FROM qmr_broadcast_jobs_v13').get().state,'sending');
  } finally {raw.close();}
});
test('finalize succeeds only after all recipients are settled and lease is released',async()=>{
  const {raw,adapter}=fixture([101,102,103]);
  try {
    const lease=await adapter.claim(1,TOKEN_A,1000,1000);
    assert.equal(await adapter.finalize(1,1001),false);
    await adapter.release(1,TOKEN_A,lease.fence);
    const d=createV13DispatchBridge(adapter,async()=>{});
    const result=await d.dispatch(1,TOKEN_B);
    assert.equal(result.sent,2);
    assert.equal(result.blocked,1);
    assert.equal(await adapter.finalize(1,Date.now()),true);
    assert.equal(raw.prepare('SELECT state FROM qmr_broadcast_jobs_v13').get().state,'done');
    assert.equal(await adapter.claim(1,TOKEN_A,Date.now(),1000),null);
  } finally {raw.close();}
});
test('cancellation cannot be reversed by finalization',async()=>{
  const {raw,adapter}=fixture([101]);
  try {
    raw.exec("UPDATE qmr_broadcast_jobs_v13 SET state='cancelled'");
    raw.exec("UPDATE qmr_broadcast_delivery_v13 SET state='blocked'");
    assert.equal(await adapter.finalize(1,1000),false);
    assert.equal(raw.prepare('SELECT state FROM qmr_broadcast_jobs_v13').get().state,'cancelled');
  } finally {raw.close();}
});
