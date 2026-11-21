// Candidate additive Telegram Serverless SDK schema declarations, NOT imported.
// Staging review ONLY. Never use tgcloud push/migrate without schema diff, backup,
// complete private data mapping and authorized cutover.
// The matching reference DDL is tools/broadcast_v13_review_schema.sql.
import { table, integer, text, index, primaryKey, check, sql } from 'sdk/db';

export const qmrBroadcastJobsV13 = table('qmr_broadcast_jobs_v13', {
  id: integer('id').primaryKey(),
  content: text('content').notNull(),
  state: text('state').notNull().default('draft'),
  ownerToken: text('owner_token'),
  leaseUntilMs: integer('lease_until_ms').notNull().default(0),
  fence: integer('fence').notNull().default(0),
  createdMs: integer('created_ms').notNull(),
}, t => ({
  stateCheck: check('qmr_bcast_jobs_v13_state_ck',
    sql`${t.state} IN ('draft','sending','cancelled','done')`),
}));

export const qmrBroadcastDeliveryV13 = table('qmr_broadcast_delivery_v13', {
  broadcastId: integer('broadcast_id').notNull(),
  userId: integer('user_id').notNull(),
  state: text('state').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  attemptedMs: integer('attempted_ms'),
  resolvedMs: integer('resolved_ms'),
  retryAfterMs: integer('retry_after_ms'),
}, t => ({
  compoundPk: primaryKey({columns:[t.broadcastId,t.userId]}),
  stateCheck: check('qmr_bcast_delivery_v13_state_ck',
    sql`${t.state} IN ('pending','attempting','sent','unknown','blocked')`),
  pendingIndex: index('qmr_broadcast_delivery_pending_v13')
    .on(t.broadcastId,t.state,t.userId),
}));
