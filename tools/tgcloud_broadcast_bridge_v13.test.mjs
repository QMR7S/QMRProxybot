import test from 'node:test';
import assert from 'node:assert/strict';
import { createV13DispatchBridge } from './tgcloud_broadcast_bridge_v13.mjs';

const TOKEN='x'.repeat(32);
function storage(ids=[101], blocked=[]) {
  const states=new Map(ids.map(id=>[id,'pending']));
  const history=[];
  let holder=null,fence=0,until=0;
  const assertLease=(token,f,t)=>{if(holder!==token||fence!==f||t>=until)throw Error('stale lease');};
  return {
    states,history,
    async claim(id,token,t,ms) {if(holder&&t<until)return null;holder=token;until=t+ms;fence++;return {content:'synthetic',fence};},
    async nextPending(id,token,f,t) {assertLease(token,f,t);const entry=[...states].find(([,s])=>s==='pending');return entry?{userId:entry[0]}:null;},
    async isBlocked(id){return blocked.includes(id);},
    async markBlocked(id,user,token,f,t){assertLease(token,f,t);states.set(user,'blocked');},
    async markAttempt(id,user,token,f,t){assertLease(token,f,t);assert.equal(states.get(user),'pending');states.set(user,'attempting');history.push('attempt');},
    async markSent(id,user,token,f,t){assertLease(token,f,t);states.set(user,'sent');history.push('sent');},
    async markUnknown(id,user,token,f,t){assertLease(token,f,t);states.set(user,'unknown');history.push('unknown');},
    async release(id,token,f){if(holder===token&&fence===f){holder=null;until=0;}},
  };
}
test('successful send persists attempt before telegram and success after',async()=>{
  const s=storage();
  const result=await createV13DispatchBridge(s,async()=>s.history.push('send')).dispatch(1,TOKEN);
  assert.equal(result.sent,1);
  assert.deepEqual(s.history,['attempt','send','sent']);
});
test('Telegram timeout marks uncertain and no resend on next run',async()=>{
  const s=storage();let count=0;
  const d=createV13DispatchBridge(s,async()=>{count++;throw Error('timeout');});
  assert.equal((await d.dispatch(1,TOKEN)).uncertain,1);
  await d.dispatch(1,TOKEN);
  assert.equal(count,1);
  assert.equal(s.states.get(101),'unknown');
});
test('rate-limit stops batch and retains manual reconciliation record',async()=>{
  const s=storage([101,102]);let count=0;
  const r=await createV13DispatchBridge(s,async()=>{count++;throw {parameters:{retry_after:19}};}).dispatch(1,TOKEN);
  assert.equal(r.status,'rate-limited');
  assert.equal(count,1);assert.equal(s.states.get(101),'unknown');
  assert.equal(s.states.get(102),'pending');
});
test('blocked users are excluded',async()=>{
  const s=storage([101],[101]);let calls=0;
  const r=await createV13DispatchBridge(s,async()=>{calls++;}).dispatch(1,TOKEN);
  assert.equal(r.blocked,1);assert.equal(calls,0);
});
test('near-expired lease prevents starting an attempt',async()=>{
  let clock=0;const s=storage();
  const d=createV13DispatchBridge(s,async()=>assert.fail('must not send'),()=>clock);
  const claim=s.claim.bind(s);
  s.claim=async(...args)=>{const lease=await claim(...args);clock=21001;return lease;};
  const r=await d.dispatch(1,TOKEN);
  assert.equal(r.status,'lease-near-expiry');
  assert.equal(s.states.get(101),'pending');
});
test('late Telegram acknowledgement leaves durable attempting when lease expires',async()=>{
  let clock=0;const s=storage();let calls=0;
  const r=await createV13DispatchBridge(s,async()=>{calls++;clock=35000;},()=>clock).dispatch(1,TOKEN);
  assert.equal(calls,1);assert.equal(r.status,'lost-lease-or-db-error');
  assert.equal(s.states.get(101),'attempting');
});
test('simultaneous requests never acquire same lease',async()=>{
  const s=storage();let done;
  const blocker=new Promise(resolve=>done=resolve);
  const d=createV13DispatchBridge(s,async()=>blocker);
  const first=d.dispatch(1,TOKEN);
  const second=await d.dispatch(1,'y'.repeat(32));
  assert.equal(second.status,'busy');
  done();assert.equal((await first).sent,1);
});
test('oversized batches and invalid tokens fail closed',async()=>{
  const d=createV13DispatchBridge(storage(),async()=>{});
  await assert.rejects(d.dispatch(1,'abc'),/invalid dispatch/);
  await assert.rejects(d.dispatch(1,TOKEN,{limit:16}),/invalid dispatch/);
});

test('429 retry_after seconds becomes absolute millisecond deadline',async()=>{
  const s=storage([101,102]);
  let deadline;
  const mark=s.markUnknown.bind(s);
  s.markUnknown=async(...args)=>{deadline=args[5];return mark(...args);};
  const fixedTime=1700000000000;
  const result=await createV13DispatchBridge(s,async()=>{
    throw {code:429,parameters:{retry_after:19}};
  },()=>fixedTime).dispatch(1,TOKEN);
  assert.equal(result.status,'rate-limited');
  assert.equal(deadline,fixedTime+19000);
  assert.equal(s.states.get(102),'pending');
});
test('429 with invalid retry_after stops further sends conservatively',async()=>{
  const s=storage([101,102]);
  let deadline,calls=0;
  const mark=s.markUnknown.bind(s);
  s.markUnknown=async(...args)=>{deadline=args[5];return mark(...args);};
  const fixedTime=1700000000000;
  const result=await createV13DispatchBridge(s,async()=>{
    calls++;throw {error_code:429,parameters:{retry_after:'invalid'}};
  },()=>fixedTime).dispatch(1,TOKEN);
  assert.equal(result.status,'rate-limited');
  assert.equal(deadline,fixedTime+86400000);
  assert.equal(calls,1);
});
