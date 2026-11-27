import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const message=read('tgcloud/handlers/message.js');
const callback=read('tgcloud/handlers/callback_query.js');
const store=read('tgcloud/lib/store.js');

test('no legacy send batch reachable from callback imports or function body',()=>{
  assert.doesNotMatch(callback,/\bbroadcastBatch\b/);
  assert.match(callback,/if \(data\.startsWith\('q:a:bcast:'\)\) \{/);
  const block=callback.slice(callback.indexOf("if (data.startsWith('q:a:bcast:'))"));
  assert.match(block,/SAFETY HOLD/);
  assert.doesNotMatch(block,/\bapi\.sendMessage\b/);
  assert.doesNotMatch(block,/\bnewBroadcast\b/);
});
test('owner broadcast command never creates a legacy draft',()=>{
  assert.doesNotMatch(message,/\bnewBroadcast\b/);
  assert.match(message,/notifications\.create\(/);
  assert.doesNotMatch(message,/\bbroadcastBatch\b/);
});
test('legacy risk is retained as a visible migration blocker',()=>{
  assert.match(store,/export async function broadcastBatch\(/);
  assert.match(store,/set\(\{cursorId\}\)/);
  const gate=read('tools/audit_broadcast_safety.mjs');
  assert.match(gate,/no-pre-send-cursor-advance/);
  assert.match(gate,/per-recipient-reconciliation/);
  assert.match(gate,/exclusive-batch-ownership/);
});
