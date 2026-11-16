// Additive QMR Proxy v6 tables. Deploy schema and review `tgcloud migrate --dry-run`
// before applying; never drop or rewrite unrelated tables.
import { table, integer, text, index } from 'sdk/db';

export const qmrUsers = table('qmr_users_v6', {
  userId: integer('user_id').primaryKey(),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  requests: integer('requests').notNull().default(0),
  blocked: integer('blocked').notNull().default(0),
}, t => ({ lastSeenIdx: index('qmr_users_v6_recent_idx').on(t.lastSeen) }));

export const qmrSettings = table('qmr_settings_v6', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const qmrBroadcasts = table('qmr_broadcasts_v6', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  content: text('content').notNull(),
  status: text('status').notNull().default('draft'),
  cursorId: integer('cursor_id').notNull().default(0),
  sent: integer('sent').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
