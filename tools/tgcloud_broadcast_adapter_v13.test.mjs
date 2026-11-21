import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBroadcastV13Adapter } from './tgcloud_broadcast_adapter_v13.mjs';

// In-memory single-row emulator: tests emitted CAS statements and parameters.
// Full SQL engine contract is separately checked by test_broadcast_v13_sqlite.py.
function mockDb() {
  const job = {id:1,state:'sending',content:'synthetic',owner:null,until:0,fence:0};
  const recipient = {id:123,state:'pending',attempts:0};
  const queries = [];
  const db = {
    queries, job, recipient,
    async get(statement, p) {
      queries.push(statement);
      if (statement.startsWith('UPDATE qmr_broadcast_jobs_v13') && statement.includes('fence=fence+1')) {
        if (p[':id']!==1 || job.state!=='sending' ||
          (job.owner!==null && job.until>p[':now'])) return null;
        job.owner=p[':token']; job.until=p[':until']; job.fence++;
        return {content:job.content,fence:job.fence};
      }
      if (statement.startsWith('SELECT user_id AS userId')) {
        return job.owner===p[':token'] && job.fence===p[':fence'] &&
          job.until>p[':now'] && job.state==='sending' && recipient.state==='pending'
          ? {userId:recipient.id} : null;
      }
      if (statement.startsWith('UPDATE qmr_broadcast_delivery_v13')) {
        if (job.owner!==p[':token'] || job.fence!==p[':fence'] ||
          job.until<=p[':now'] || job.state!=='sending' ||
          recipient.state!==p[':from'] || recipient.id!==p[':uid']) return null;
        recipient.state=p[':to']; recipient.attempts+=p[':inc'];
        return {userId:recipient.id};
      }
      if (statement.startsWith('UPDATE qmr_broadcast_jobs_v13') && statement.includes('owner_token=NULL')) {
        if (job.owner!==p[':token']||job.fence!==p[':fence']) return null;
        job.owner=null;job.until=0;return {id:1};
      }
      throw Error('unexpected query: '+statement);
    },
    async all(statement, p) {
      queries.push(statement);
      return [{state:recipient.state,count:1}];
    }
  };
  return db;
}
const a = 'a'.repeat(32), b='b'.repeat(32);
test('claim is fenced and rejects concurrent claimant', async () => {
  const db=mockDb(), store=makeBroadcastV13Adapter(db);
  assert.deepEqual(await store.claim(1,a,1000,1000),{content:'synthetic',fence:1});
  assert.equal(await store.claim(1,b,1001,1000),null);
  assert.equal(db.job.fence,1);
});
test('lease expiry permits takeover but old worker cannot persist transitions', async () => {
  const db=mockDb(), store=makeBroadcastV13Adapter(db);
  const first=await store.claim(1,a,1000,1000);
  const second=await store.claim(1,b,2000,1000);
  assert.equal(second.fence,first.fence+1);
  await assert.rejects(store.markAttempt(1,123,a,first.fence,2001),/stale lease/);
  await store.markAttempt(1,123,b,second.fence,2001);
  assert.equal(db.recipient.state,'attempting');
});
test('only pending recipients may enter attempting and attempts increment once', async () => {
  const db=mockDb(), store=makeBroadcastV13Adapter(db);
  const {fence}=await store.claim(1,a,1000,1000);
  await store.markAttempt(1,123,a,fence,1001);
  await assert.rejects(store.markAttempt(1,123,a,fence,1002),/invalid delivery state/);
  await store.markUnknown(1,123,a,fence,1003,429);
  assert.equal(db.recipient.attempts,1);
  assert.equal(db.recipient.state,'unknown');
  assert.equal(await store.nextPending(1,a,fence,1004),null);
});
test('released or cancelled worker cannot write', async () => {
  const db=mockDb(), store=makeBroadcastV13Adapter(db);
  const {fence}=await store.claim(1,a,1000,1000);
  db.job.state='cancelled';
  await assert.rejects(store.markAttempt(1,123,a,fence,1001),/stale lease/);
});
test('old lease release cannot clear new worker', async () => {
  const db=mockDb(), store=makeBroadcastV13Adapter(db);
  const first=await store.claim(1,a,1000,1000);
  await store.claim(1,b,2000,1000);
  await store.release(1,a,first.fence);
  assert.equal(db.job.owner,b);
});
test('invalid owner credentials and durations fail closed', async () => {
  const store=makeBroadcastV13Adapter(mockDb());
  await assert.rejects(store.claim(1,'short',1000,1000),/invalid claim/);
  await assert.rejects(store.claim(1,a,1000,1000000),/invalid claim/);
});
test('read-only reconciliation counts contain no content', async () => {
  const store=makeBroadcastV13Adapter(mockDb());
  assert.deepEqual(await store.counts(1),[{state:'pending',count:1}]);
});
