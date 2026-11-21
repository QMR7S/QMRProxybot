import test from 'node:test';
import assert from 'node:assert/strict';
import {createBroadcastDispatcher} from './broadcast_dispatcher_reference.mjs';

function fakeStorage(ids = [101, 102, 103]) {
  let owner = null;
  const states = new Map(ids.map(id => [id, 'pending']));
  const calls = [];
  const storage = {
    states, calls,
    async claim(id, token) {
      if (owner) return null;
      owner = token;
      calls.push('claim');
      return {content: 'Synthetic test message'};
    },
    async release(id, token) { if (owner === token) owner = null; },
    async nextPending(id, token) {
      assert.equal(owner, token);
      const item = [...states].find(([, status]) => status === 'pending');
      return item ? {userId: item[0]} : null;
    },
    async isBlocked(id) { return id === 103; },
    async markBlocked(b, id, token) { assert.equal(owner, token); states.set(id, 'blocked'); },
    async markAttempt(b, id, token) { assert.equal(owner, token); states.set(id, 'unknown'); calls.push('attempt:' + id); },
    async markSent(b, id, token) { assert.equal(owner, token); states.set(id, 'sent'); calls.push('sent:' + id); },
    async markUnknown(b, id, token) { assert.equal(owner, token); states.set(id, 'unknown'); calls.push('unknown:' + id); }
  };
  return storage;
}
test('successful send is confirmed only after persistent attempt', async () => {
  const s = fakeStorage([101]);
  const result = await createBroadcastDispatcher(s, async () => {s.calls.push('network');}).dispatch(1, 'owner');
  assert.equal(result.sent, 1);
  assert.deepEqual(s.calls, ['claim', 'attempt:101', 'network', 'sent:101']);
});
test('network exception remains unknown; never retried automatically', async () => {
  const s = fakeStorage([101]);
  let attempts = 0;
  const dispatcher = createBroadcastDispatcher(s, async () => {attempts++; throw Error('timeout');});
  assert.equal((await dispatcher.dispatch(1, 'owner')).uncertain, 1);
  await dispatcher.dispatch(1, 'owner');
  assert.equal(attempts, 1);
  assert.equal(s.states.get(101), 'unknown');
});
test('concurrent callbacks cannot acquire the same lease', async () => {
  const s = fakeStorage([101]);
  let unblock;
  const pending = new Promise(resolve => { unblock = resolve; });
  const d = createBroadcastDispatcher(s, async () => pending);
  const first = d.dispatch(1, 'one');
  // Advance to first external await's next microtask; the claim is immediate.
  const second = await d.dispatch(1, 'two');
  assert.equal(second.status, 'busy');
  unblock();
  assert.equal((await first).sent, 1);
});
test('blocked recipients are not sent', async () => {
  const s = fakeStorage([103]);
  let count = 0;
  const r = await createBroadcastDispatcher(s, async () => {count++;}).dispatch(1, 'owner');
  assert.equal(count, 0);
  assert.equal(r.blocked, 1);
});
test('batch cannot exceed 15 and refuses malformed IDs', async () => {
  const d = createBroadcastDispatcher(fakeStorage(), async () => {});
  await assert.rejects(() => d.dispatch(1, 'x', 16), /batch limit/);
  await assert.rejects(() => d.dispatch(0, 'x'), /invalid dispatch/);
});
test('crashed send after durable mark leaves ambiguous record, not pending', async () => {
  const s = fakeStorage([101]);
  await s.claim(1, 'crashed');
  await s.markAttempt(1, 101, 'crashed');
  await s.release(1, 'crashed');
  let calls = 0;
  await createBroadcastDispatcher(s, async () => {calls++;}).dispatch(1, 'new-worker');
  assert.equal(calls, 0);
  assert.equal(s.states.get(101), 'unknown');
});
