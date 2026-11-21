#!/usr/bin/env node
// QMR Proxy: read-only migration gate for legacy native Serverless broadcast code.
// Run: node tools/audit_broadcast_safety.mjs
// Exit 1 means migration is BLOCKED; it does not modify any running service.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = readFileSync(resolve(root, 'tgcloud/lib/store.js'), 'utf8');
const callbacks = readFileSync(resolve(root, 'tgcloud/handlers/callback_query.js'), 'utf8');
const batch = store.slice(store.indexOf('export async function broadcastBatch'));
const failures = [];
function gate(name, ok, detail) {
  const result = ok ? 'PASS' : 'BLOCK';
  console.log(result + ' ' + name + ': ' + detail);
  if (!ok) failures.push(name);
}
// Narrow structural checks, not a proof of runtime correctness.
// Detection is deliberately conservative: substantive rewrites require a human audit.
const cursorFirst = /set\(\{cursorId\}\)[\s\S]{0,400}await api\.sendMessage/.test(batch);
gate('no-pre-send-cursor-advance', !cursorFirst,
  'A crash after cursor advancement must not silently discard an unsent recipient.');
const durableLedger = /broadcastDeliveries|deliveryLedger|deliveryAttempt/.test(store);
gate('per-recipient-reconciliation', durableLedger,
  'Use persisted recipient-level attempts/results plus a retry/reconciliation policy.');
const exclusiveClaim = /claimBatch|dispatchLease|exclusiveLease|transaction/.test(batch);
gate('exclusive-batch-ownership', exclusiveClaim,
  'Protect overlapping callbacks with an atomic claim or serialized dispatcher.');
const ownerGuard = /if\s*\(ownerOnly\(data\)\s*&&\s*!ownerCallbackAllowed\(query,\s*IS_OWNER\)\)/.test(callbacks);
gate('owner-callback-guard-present', ownerGuard,
  'This checks source shape only; separately test all privileged callbacks as non-owner.');
console.log(JSON.stringify({gate:'broadcast-migration',status:failures.length?'BLOCKED':'STRUCTURAL_CHECKS_PASSED',failures}));
if (failures.length) process.exitCode = 1;
